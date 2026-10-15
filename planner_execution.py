"""Responsibility: compose factual activity lifecycle and blocker intervals during an atomic store save."""

from copy import deepcopy

from planner_issues import affects

FIELDS = ("startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals")


def _clip_blocking(item, parse_timestamp):
    if not item.get("startedAt") or not item.get("blockerTrackingSince"):
        return
    started = parse_timestamp(item["startedAt"], "Activity startedAt")
    completed = parse_timestamp(item["completedAt"], "Activity completedAt") if item.get("completedAt") else None
    tracking = parse_timestamp(item["blockerTrackingSince"], "Activity blockerTrackingSince")
    if completed and tracking > completed:
        item.pop("blockerTrackingSince", None)
        item.pop("blockerIntervals", None)
        return
    if tracking < started:
        item["blockerTrackingSince"] = item["startedAt"]
    intervals = []
    for interval in item.get("blockerIntervals", []):
        start = parse_timestamp(interval["startedAt"], "Blocker interval start")
        end = parse_timestamp(interval["endedAt"], "Blocker interval end") if interval["endedAt"] else None
        if (end and end <= started) or (completed and start >= completed):
            continue
        if start < started:
            interval["startedAt"] = item["startedAt"]
        if completed and (not end or end > completed):
            interval["endedAt"] = item["completedAt"]
        intervals.append(interval)
    if intervals or "blockerIntervals" in item:
        item["blockerIntervals"] = intervals


def _apply_actions(item, old, action, timestamp, parse_timestamp):
    if action.get("started") is False:
        if action.get("done") or "startedAt" in action or "completedAt" in action:
            raise ValueError("Not started cannot include actual dates or Done")
        item["progress"] = 0
        for field in FIELDS:
            item.pop(field, None)
        return
    for field in ("startedAt", "completedAt"):
        if field in action:
            value = parse_timestamp(action[field], f"Activity {field}")
            if value > parse_timestamp(timestamp(), "Current time"):
                raise ValueError("Actual dates cannot be in the future")
    if action.get("done") is False:
        if item["progress"] == 100 or "completedAt" in action:
            raise ValueError("Choose progress below 100% when undoing Done")
        item.pop("completedAt", None)
    if "startedAt" in action:
        item["startedAt"] = action["startedAt"]
    elif action.get("started") and not item.get("startedAt"):
        item["startedAt"] = timestamp()
    if action.get("done") or (old is not None and old["progress"] < 100 and item["progress"] == 100):
        if item["progress"] != 100:
            raise ValueError("Done requires 100% progress")
        if not item.get("completedAt"):
            item["completedAt"] = timestamp()
    if "completedAt" in action:
        item["completedAt"] = action["completedAt"]
    if item["progress"] < 100:
        if "completedAt" in action:
            raise ValueError("Completion requires 100% progress")
        item.pop("completedAt", None)
    if "startedAt" in action or "completedAt" in action:
        _clip_blocking(item, parse_timestamp)


def record(document, current, actions, timestamp, parse_timestamp):
    previous = {(plan["id"], item["id"]): item for plan in current["plans"] for item in plan["activities"]}
    for plan in document["plans"]:
        for item in plan["activities"]:
            old = previous.get((plan["id"], item["id"]))
            action = actions.get((plan["id"], item["id"]), {})
            if old is not None:
                for field in FIELDS:
                    if field in item and item[field] != old.get(field):
                        raise ValueError(f"{field} is server-owned; use Started/Done actions")
                    if field in old:
                        item[field] = deepcopy(old[field])
            _apply_actions(item, old, action, timestamp, parse_timestamp)
            if not item.get("startedAt"):
                continue
            if not item.get("blockerTrackingSince") and item["progress"] < 100:
                item["blockerTrackingSince"] = timestamp()
            intervals = item.get("blockerIntervals", [])
            active = {issue["id"]: issue for issue in plan["issues"] if issue["open"] and issue["blocker"] and affects(issue, item)} if item["progress"] < 100 else {}
            for interval in intervals:
                if interval["endedAt"] is None and interval["issueId"] not in active:
                    interval["endedAt"] = timestamp()
            recorded = {interval["issueId"] for interval in intervals if interval["endedAt"] is None}
            for issue_id, issue in active.items():
                if issue_id not in recorded:
                    intervals.append({"issueId": issue_id, "title": issue["title"], "startedAt": timestamp(), "endedAt": None})
            if intervals or "blockerIntervals" in item:
                item["blockerIntervals"] = intervals
    return document
