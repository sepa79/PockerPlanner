"""Responsibility: compose scoped planner edits. Persistence and data validation belong to planner_store."""

from copy import deepcopy
from typing import Literal

from planner_store import InvalidState, RevisionConflict, read, write

Collection = Literal["streams", "activityTypes", "activities", "issues"]
EDITABLE_FIELDS = {
    "streams": {"name", "description"},
    "activityTypes": {"name", "color"},
    "activities": {"name", "streamId", "typeId", "start", "durationDays", "includeWeekends", "progress", "status", "issueIds", "dateConfirmed", "jiraUrl"},
    "issues": {"title", "description", "scope", "streamIds", "blocker", "discovered", "open", "descriptionIncomplete", "jiraUrl"},
}


def _find(items, item_id, label):
    for item in items:
        if item["id"] == item_id:
            return item
    raise InvalidState(f"Unknown {label} ID: {item_id}")


def _current(expected_revision):
    if type(expected_revision) is not int or expected_revision < 0:
        raise InvalidState("expected_revision must be a nonnegative integer")
    document = read()
    if document["revision"] != expected_revision:
        raise RevisionConflict("Workspace changed. Read the plan again before applying the intended edit.")
    return document


def _fields(changes, allowed):
    if not isinstance(changes, dict) or not changes or not set(changes) <= allowed:
        raise InvalidState("Supply nonempty changes containing only editable fields")


def _save(document, plan_id):
    saved = write(document)
    return {"revision": saved["revision"], "plan": _find(saved["plans"], plan_id, "plan")}


def list_plans():
    document = read()
    return {"revision": document["revision"], "plans": [{"id": plan["id"], "name": plan["name"], "description": plan["description"]} for plan in document["plans"]]}


def get_plan(plan_id):
    document = read()
    return {"revision": document["revision"], "plan": _find(document["plans"], plan_id, "plan")}


def create_plan(plan_id, name, description, expected_revision):
    document = _current(expected_revision)
    if any(plan["id"] == plan_id for plan in document["plans"]):
        raise InvalidState(f"Plan already exists: {plan_id}")
    document["plans"].append({"id": plan_id, "name": name, "description": description, "streams": [], "activityTypes": [], "activities": [], "issues": []})
    return _save(document, plan_id)


def update_plan(plan_id, changes, expected_revision):
    _fields(changes, {"name", "description"})
    document = _current(expected_revision)
    _find(document["plans"], plan_id, "plan").update(deepcopy(changes))
    return _save(document, plan_id)


def create_plan_item(plan_id, collection, item, expected_revision):
    if collection not in EDITABLE_FIELDS:
        raise InvalidState("Unknown plan collection")
    _fields(item, EDITABLE_FIELDS[collection] | {"id"})
    if not isinstance(item.get("id"), str) or not item["id"].strip():
        raise InvalidState("Supply the new item ID")
    document = _current(expected_revision)
    items = _find(document["plans"], plan_id, "plan")[collection]
    if any(existing["id"] == item["id"] for existing in items):
        raise InvalidState(f"Item already exists: {item['id']}")
    items.append(deepcopy(item))
    return _save(document, plan_id)


def update_plan_item(plan_id, collection, item_id, changes, expected_revision):
    if collection not in EDITABLE_FIELDS:
        raise InvalidState("Unknown plan collection")
    _fields(changes, EDITABLE_FIELDS[collection])
    document = _current(expected_revision)
    plan = _find(document["plans"], plan_id, "plan")
    _find(plan[collection], item_id, collection).update(deepcopy(changes))
    return _save(document, plan_id)
