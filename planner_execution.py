"""Responsibility: compose factual activity lifecycle and blocker intervals during an atomic store save."""

from copy import deepcopy

from planner_issues import affects

FIELDS = ("startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals")


def record(document, current, actions, timestamp):
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
            if action.get("started") and not item.get("startedAt"):
                if item["progress"] == 100 and not action.get("done"):
                    raise ValueError("Reopen the activity or select Started and Done together")
                item["startedAt"] = timestamp()
            if action.get("done") or (old is not None and old["progress"] < 100 and item["progress"] == 100):
                if item["progress"] != 100:
                    raise ValueError("Done requires 100% progress")
                if not item.get("completedAt"):
                    item["completedAt"] = timestamp()
            if item["progress"] < 100:
                item.pop("completedAt", None)
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
