"""Responsibility: validate and persist the planner workspace. Must not: serve HTTP or resolve identity. Contract: docs/ARCHITECTURE.md#data-contract."""

import json
import os
import sqlite3
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("TESTPLANNER_DB", ROOT / "data" / "planner.sqlite3"))
SCHEMA_VERSION = 1


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


def _items(document, key, maximum=500):
    items = document.get(key)
    if not isinstance(items, list) or len(items) > maximum:
        raise InvalidState(f"Invalid {key}")
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise InvalidState(f"Invalid {key} item")
        item_id = _text(item.get("id"), f"{key} ID", 80, True)
        if item_id in seen:
            raise InvalidState(f"Duplicate {key} ID: {item_id}")
        seen.add(item_id)
    return items, seen


def _validate_plan(plan):
    if set(plan) != {"id", "name", "description", "streams", "activityTypes", "activities", "issues"}:
        raise InvalidState("Invalid plan fields")
    _text(plan.get("name"), "plan name", 160, True)
    _text(plan.get("description"), "plan description", 12000)
    streams, stream_ids = _items(plan, "streams")
    types, type_ids = _items(plan, "activityTypes")
    activities, _ = _items(plan, "activities")
    issues, issue_ids = _items(plan, "issues")
    for stream in streams:
        if set(stream) != {"id", "name", "description"}:
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
        if issue.get("scope") not in ("ALL", "STREAMS"):
            raise InvalidState("Issue scope must be ALL or STREAMS")
        targets = issue.get("streamIds")
        if not isinstance(targets, list) or any(not isinstance(target, str) for target in targets) or len(targets) != len(set(targets)) or any(target not in stream_ids for target in targets):
            raise InvalidState("Issue refers to an invalid stream")
        if (issue["scope"] == "ALL" and targets) or (issue["scope"] == "STREAMS" and not targets):
            raise InvalidState("Select ALL or at least one affected stream")
        _url(issue.get("jiraUrl"), "issue Jira URL")
        if type(issue.get("open")) is not bool or type(issue.get("blocker")) is not bool or type(issue.get("descriptionIncomplete")) is not bool:
            raise InvalidState("Invalid issue flags")
        try:
            date.fromisoformat(issue.get("discovered", ""))
        except (TypeError, ValueError):
            raise InvalidState("Invalid issue discovery date") from None
    for activity in activities:
        _text(activity.get("name"), "activity name", 160, True)
        _text(activity.get("status"), "activity status", 1000)
        _url(activity.get("jiraUrl"), "activity Jira URL")
        if not isinstance(activity.get("streamId"), str) or not isinstance(activity.get("typeId"), str) or activity["streamId"] not in stream_ids or activity["typeId"] not in type_ids:
            raise InvalidState("Activity refers to a missing stream or type in its plan")
        try:
            date.fromisoformat(activity.get("start", ""))
        except (TypeError, ValueError):
            raise InvalidState("Invalid activity start date") from None
        if type(activity.get("durationDays")) is not int or not 1 <= activity["durationDays"] <= 365:
            raise InvalidState("Duration must be 1–365 full calendar days")
        if type(activity.get("progress")) is not int or not 0 <= activity["progress"] <= 100:
            raise InvalidState("Progress must be 0–100")
        if type(activity.get("dateConfirmed")) is not bool:
            raise InvalidState("Invalid date confirmation flag")
        blockers = activity.get("issueIds")
        if not isinstance(blockers, list) or any(not isinstance(issue_id, str) for issue_id in blockers) or len(blockers) != len(set(blockers)) or any(issue_id not in issue_ids for issue_id in blockers):
            raise InvalidState("Activity refers to an invalid issue in its plan")


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
            connection.execute("INSERT OR IGNORE INTO planner (id, document) VALUES (1, ?)", (json.dumps(seed),))
            row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
    document = json.loads(row[0])
    validate(document)
    return document


def write(document):
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
        saved = {**document, "revision": current["revision"] + 1}
        connection.execute("UPDATE planner SET document = ? WHERE id = 1", (json.dumps(saved),))
    return saved


def replace_explicitly(document):
    validate(document)
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT document FROM planner WHERE id = 1").fetchone()
        revision = json.loads(row[0])["revision"] + 1 if row else 0
        saved = {**document, "revision": revision}
        connection.execute("INSERT OR REPLACE INTO planner (id, document) VALUES (1, ?)", (json.dumps(saved),))
    return saved
