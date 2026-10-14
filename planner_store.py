"""Responsibility: validate and persist the planner workspace. Must not: serve HTTP or resolve identity. Contract: docs/ARCHITECTURE.md#data-contract."""

import json
import os
import re
import sqlite3
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from planner_execution import record as record_execution

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("TESTPLANNER_DB", ROOT / "data" / "planner.sqlite3"))
SCHEMA_VERSION = 1
MAX_DOCUMENT_BYTES = 1024 * 1024


class InvalidState(ValueError):
    pass


class RevisionConflict(Exception):
    pass


def _text(value, field, maximum=2000, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise InvalidState(f"Invalid {field}")
    return value.strip()


def _url(value, field):
    value = _text(value, field, 1000)
    parsed = urlparse(value)
    if value and (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password):
        raise InvalidState(f"{field} must be an HTTPS URL")
    return value


def _calendar_date(value, field):
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise InvalidState(f"{field} must be a valid YYYY-MM-DD calendar date") from None


def _serialize(document):
    try:
        serialized = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        size = len(serialized.encode("utf-8"))
    except (TypeError, ValueError, UnicodeError):
        raise InvalidState("Workspace must contain valid UTF-8 JSON") from None
    if size > MAX_DOCUMENT_BYTES:
        raise InvalidState("Workspace must not exceed 1 MiB of compact UTF-8 JSON")
    return serialized


def _timestamp(value, field):
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])", value):
            raise ValueError
        return datetime.fromisoformat(value)
    except ValueError:
        raise InvalidState(f"{field} must be an ISO timestamp with a timezone") from None


def validate_progress(value):
    if type(value) is not int or not 0 <= value <= 100:
        raise InvalidState("Progress must be 0–100")
    return value


def _execution(activity):
    started = _timestamp(activity["startedAt"], "Activity startedAt") if activity.get("startedAt") is not None else None
    completed = _timestamp(activity["completedAt"], "Activity completedAt") if activity.get("completedAt") is not None else None
    tracking = _timestamp(activity["blockerTrackingSince"], "Activity blockerTrackingSince") if activity.get("blockerTrackingSince") is not None else None
    if completed and (activity["progress"] != 100 or (started and completed < started)):
        raise InvalidState("Completion requires 100% progress and cannot precede Started")
    if tracking and (not started or tracking < started or (completed and tracking > completed)):
        raise InvalidState("Invalid blocker tracking period")
    intervals = activity.get("blockerIntervals", [])
    if not isinstance(intervals, list) or len(intervals) > 1000:
        raise InvalidState("Invalid blocker intervals (maximum 1000)")
    last_ends = {}
    for interval in intervals:
        if not isinstance(interval, dict) or set(interval) != {"issueId", "title", "startedAt", "endedAt"}:
            raise InvalidState("Invalid blocker interval fields")
        issue_id = _text(interval["issueId"], "Blocker interval issue ID", 80, True)
        if interval["issueId"] != issue_id:
            raise InvalidState("Invalid blocker interval issue ID")
        _text(interval["title"], "Blocker interval title", 160, True)
        start = _timestamp(interval["startedAt"], "Blocker interval start")
        end = _timestamp(interval["endedAt"], "Blocker interval end") if interval["endedAt"] is not None else None
        if not tracking or start < tracking or (end and end < start) or (completed and (not end or end > completed)):
            raise InvalidState("Invalid blocker interval chronology")
        if issue_id in last_ends and (last_ends[issue_id] is None or start < last_ends[issue_id]):
            raise InvalidState("Overlapping intervals for the same blocker")
        last_ends[issue_id] = end


def _items(document, key, maximum=500):
    items = document.get(key)
    if not isinstance(items, list) or len(items) > maximum:
        raise InvalidState(f"Invalid {key}")
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise InvalidState(f"Invalid {key} item")
        item_id = _text(item.get("id"), f"{key} ID", 80, True)
        if item_id != item["id"]:
            raise InvalidState(f"{key} ID must not contain leading or trailing whitespace")
        if item_id in seen:
            raise InvalidState(f"Duplicate {key} ID: {item_id}")
        seen.add(item_id)
    return items, seen


def _dependencies(items, label, same_stream=False):
    indexed = {item["id"]: item for item in items}
    for item in items:
        predecessor = item.get("dependsOn")
        if predecessor is not None:
            if not isinstance(predecessor, str) or predecessor not in indexed or predecessor == item["id"]:
                raise InvalidState(f"Invalid {label} dependency")
            if same_stream and indexed[predecessor]["streamId"] != item["streamId"]:
                raise InvalidState("Activity dependencies must stay within the same stream")
    resolved = set()
    for item in items:
        chain = set()
        current = item["id"]
        while current is not None and current not in resolved:
            if current in chain:
                raise InvalidState(f"Cyclic {label} dependency")
            chain.add(current)
            current = indexed[current].get("dependsOn")
        resolved.update(chain)


def _validate_plan(plan):
    required = {"id", "name", "description", "streams", "activityTypes", "activities", "issues"}
    if not required <= set(plan) or not set(plan) <= required | {"deadline"}:
        raise InvalidState("Invalid plan fields")
    _text(plan.get("name"), "plan name", 160, True)
    _text(plan.get("description"), "plan description", 12000)
    if plan.get("deadline") is not None:
        _calendar_date(plan["deadline"], "Plan deadline")
    streams, stream_ids = _items(plan, "streams")
    types, type_ids = _items(plan, "activityTypes")
    activities, activity_ids = _items(plan, "activities")
    issues, issue_ids = _items(plan, "issues")
    for stream in streams:
        if not {"id", "name", "description"} <= set(stream) or not set(stream) <= {"id", "name", "description", "dependsOn"}:
            raise InvalidState("Invalid stream fields")
        _text(stream.get("name"), "stream name", 100, True)
        _text(stream.get("description"), "stream description")
    for activity_type in types:
        _text(activity_type.get("name"), "activity type", 80, True)
        color = activity_type.get("color")
        if not isinstance(color, str) or len(color) != 7 or color[0] != "#" or any(character not in "0123456789abcdefABCDEF" for character in color[1:]):
            raise InvalidState("Invalid activity type color")
    for issue in issues:
        _text(issue.get("title"), "issue title", 160, True)
        _text(issue.get("description"), "issue description")
        if issue.get("scope") not in ("ALL", "STREAMS", "ACTIVITIES"):
            raise InvalidState("Issue scope must be ALL, STREAMS or ACTIVITIES")
        targets = issue.get("streamIds")
        if not isinstance(targets, list) or any(not isinstance(target, str) for target in targets) or len(targets) != len(set(targets)) or any(target not in stream_ids for target in targets):
            raise InvalidState("Issue refers to an invalid stream")
        if (issue["scope"] != "STREAMS" and targets) or (issue["scope"] == "STREAMS" and not targets):
            raise InvalidState("Select ALL or at least one affected stream")
        selected = issue.get("activityIds", [])
        if not isinstance(selected, list) or any(not isinstance(target, str) for target in selected) or len(selected) != len(set(selected)) or any(target not in activity_ids for target in selected):
            raise InvalidState("Issue refers to an invalid activity")
        if (issue["scope"] != "ACTIVITIES" and selected) or (issue["scope"] == "ACTIVITIES" and "activityIds" not in issue):
            raise InvalidState("Select activities only for ACTIVITIES scope")
        _url(issue.get("jiraUrl"), "issue Jira URL")
        if type(issue.get("open")) is not bool or type(issue.get("blocker")) is not bool or type(issue.get("descriptionIncomplete")) is not bool:
            raise InvalidState("Invalid issue flags")
        resolved_at = issue.get("resolvedAt")
        if resolved_at is not None:
            try:
                if not isinstance(resolved_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", resolved_at):
                    raise ValueError
                datetime.fromisoformat(resolved_at)
            except ValueError:
                raise InvalidState("Issue resolvedAt must be an ISO timestamp with a timezone") from None
        _calendar_date(issue.get("discovered"), "Issue discovery date")
    for activity in activities:
        if "started" in activity or "done" in activity:
            raise InvalidState("Started/Done are activity command actions, not workspace fields")
        _text(activity.get("name"), "activity name", 160, True)
        _text(activity.get("status"), "activity status", 1000)
        _url(activity.get("jiraUrl"), "activity Jira URL")
        if not isinstance(activity.get("streamId"), str) or not isinstance(activity.get("typeId"), str) or activity["streamId"] not in stream_ids or activity["typeId"] not in type_ids:
            raise InvalidState("Activity refers to a missing stream or type in its plan")
        _calendar_date(activity.get("start"), "Activity start date")
        if type(activity.get("durationDays")) is not int or not 1 <= activity["durationDays"] <= 365:
            raise InvalidState("Duration must be 1–365 full planned days")
        if type(activity.get("includeWeekends", False)) is not bool:
            raise InvalidState("includeWeekends must be a boolean")
        validate_progress(activity.get("progress"))
        _execution(activity)
        blockers = activity.get("issueIds")
        if not isinstance(blockers, list) or any(not isinstance(issue_id, str) for issue_id in blockers) or len(blockers) != len(set(blockers)) or any(issue_id not in issue_ids for issue_id in blockers):
            raise InvalidState("Activity refers to an invalid issue in its plan")
    _dependencies(streams, "stream")
    _dependencies(activities, "activity", same_stream=True)
    populated_streams = {activity["streamId"] for activity in activities}
    if any(stream.get("dependsOn") is not None and stream["dependsOn"] not in populated_streams for stream in streams):
        raise InvalidState("A predecessor stream must contain at least one activity")


def validate(document):
    if not isinstance(document, dict) or set(document) != {"schemaVersion", "revision", "plans"}:
        raise InvalidState("Invalid workspace. Expected schemaVersion, revision and plans.")
    if type(document["schemaVersion"]) is not int or document["schemaVersion"] != SCHEMA_VERSION:
        raise InvalidState("Unsupported workspace schema version")
    if type(document["revision"]) is not int or document["revision"] < 0:
        raise InvalidState("Invalid revision")
    plans, _ = _items(document, "plans", maximum=100)
    for plan in plans:
        _validate_plan(plan)
    _serialize(document)
    return document


def _connect():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute("CREATE TABLE IF NOT EXISTS planner (id INTEGER PRIMARY KEY CHECK(id = 1), document TEXT NOT NULL)")
    return connection


def read():
    with _connect() as connection:
        row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
        if row is None:
            seed = json.loads((ROOT / "seed.json").read_text(encoding="utf-8"))
            validate(seed)
            connection.execute("INSERT OR IGNORE INTO planner (id, document) VALUES (1, ?)", (_serialize(seed),))
            row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
    document = json.loads(row[0])
    validate(document)
    return document


def read_revision():
    with _connect() as connection:
        row = connection.execute("SELECT json_extract(document, '$.revision') FROM planner WHERE id = 1").fetchone()
    if row is None or type(row[0]) is not int or row[0] < 0:
        raise InvalidState("Planner revision is unavailable")
    return row[0]


def _resolution_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _record_resolutions(document, current):
    saved = deepcopy(document)
    previous_issues = {(plan["id"], issue["id"]): issue for plan in current["plans"] for issue in plan["issues"]}
    timestamp = None
    for plan in saved["plans"]:
        for issue in plan["issues"]:
            previous = previous_issues.get((plan["id"], issue["id"]))
            if issue["open"]:
                issue.pop("resolvedAt", None)
            elif previous is not None and previous["open"]:
                if timestamp is None:
                    timestamp = _resolution_timestamp()
                issue["resolvedAt"] = timestamp
            elif previous is not None and previous.get("resolvedAt") is not None:
                issue["resolvedAt"] = previous["resolvedAt"]
    return saved


def write(document, execution_actions=None):
    validate(document)
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
        if row is None:
            raise InvalidState("Planner has not been initialized")
        current = json.loads(row[0])
        validate(current)
        if document["revision"] != current["revision"]:
            raise RevisionConflict("Workspace changed in another session. Reload and try again.")
        timestamp = None

        def execution_timestamp():
            nonlocal timestamp
            if timestamp is None:
                timestamp = _resolution_timestamp()
            return timestamp

        try:
            saved = record_execution(_record_resolutions(document, current), current, execution_actions or {}, execution_timestamp)
        except ValueError as error:
            raise InvalidState(str(error)) from None
        saved["revision"] = current["revision"] + 1
        validate(saved)
        connection.execute("UPDATE planner SET document = ? WHERE id = 1", (_serialize(saved),))
    return saved


def replace_explicitly(document):
    validate(document)
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
        revision = json.loads(row[0])["revision"] + 1 if row else 0
        saved = {**_record_resolutions(document, {"plans": []}), "revision": revision}
        connection.execute("INSERT OR REPLACE INTO planner (id, document) VALUES (1, ?)", (_serialize(saved),))
    return saved
