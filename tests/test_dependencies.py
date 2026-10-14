import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

import planner_commands
import planner_store
from server import create_app


class DependencyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = patch("planner_store.DATABASE", Path(self.directory.name) / "planner.sqlite3")
        self.database.start()
        planner_store.read()
        self.document = json.loads((planner_store.ROOT / "web/example-plan.json").read_text())
        plan = self.document["plans"][0]
        plan["streams"].append({"id": "next", "name": "Next stream", "description": ""})
        activity = plan["activities"][0]
        plan["activities"].extend([{**activity, "id": "second"}, {**activity, "id": "next-task", "streamId": "next"}])

    def tearDown(self):
        self.database.stop()
        self.directory.cleanup()

    def test_dependencies_are_optional_plan_local_and_persisted(self):
        plan = self.document["plans"][0]
        plan["activities"][1]["dependsOn"] = "example"
        plan["streams"][1]["dependsOn"] = "demo"
        saved = planner_store.write(self.document)
        self.assertEqual(planner_store.read(), saved)
        self.assertNotIn("dependsOn", saved["plans"][0]["activities"][0])

    def test_invalid_self_missing_cross_stream_and_cyclic_dependencies_roll_back(self):
        before = planner_store.read()
        for collection, item_index, predecessor in [("streams", 0, "demo"), ("streams", 0, "missing"), ("activities", 0, "example"), ("activities", 0, "missing"), ("activities", 0, "next-task"), ("activities", 0, False), ("activities", 0, "")]:
            with self.subTest(collection=collection, predecessor=predecessor):
                document = deepcopy(self.document)
                document["plans"][0][collection][item_index]["dependsOn"] = predecessor
                with self.assertRaises(planner_store.InvalidState):
                    planner_store.write(document)
                self.assertEqual(planner_store.read(), before)
        for collection in ("streams", "activities"):
            document = deepcopy(self.document)
            items = document["plans"][0][collection]
            items[0]["dependsOn"] = items[1]["id"]
            items[1]["dependsOn"] = items[0]["id"]
            with self.assertRaisesRegex(planner_store.InvalidState, "Cyclic"):
                planner_store.write(document)
            self.assertEqual(planner_store.read(), before)

    def test_empty_predecessor_and_referenced_deletions_are_rejected(self):
        document = deepcopy(self.document)
        plan = document["plans"][0]
        plan["activities"] = plan["activities"][:2]
        plan["streams"][0]["dependsOn"] = "next"
        with self.assertRaisesRegex(planner_store.InvalidState, "at least one activity"):
            planner_store.write(document)
        plan["streams"][0]["dependsOn"] = None
        plan["activities"][1]["dependsOn"] = "example"
        saved = planner_store.write(document)
        deleted = deepcopy(saved)
        deleted["plans"][0]["activities"].pop(0)
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(deleted)
        self.assertEqual(planner_store.read(), saved)

    def test_activity_unlink_changes_all_scope_without_changing_other_issues(self):
        plan = self.document["plans"][0]
        issue = plan["issues"][0]
        issue.update(scope="ALL", streamIds=[], blocker=True)
        plan["issues"].append({**issue, "id": "other", "scope": "STREAMS", "streamIds": ["next"]})
        plan["activities"][0]["issueIds"] = []
        saved = planner_store.write(self.document)
        previous_issue = deepcopy(saved["plans"][0]["issues"][1])
        result = planner_commands.update_plan_item("example-plan", "activities", "example", {"issueIds": []}, saved["revision"])
        issue = result["plan"]["issues"][0]
        self.assertEqual(issue["scope"], "ACTIVITIES")
        self.assertEqual(issue["streamIds"], [])
        self.assertEqual(issue["activityIds"], ["second", "next-task"])
        self.assertEqual(result["plan"]["issues"][1], previous_issue)
        self.assertTrue(issue["open"] and issue["blocker"])
        self.assertEqual(planner_store.read()["revision"], saved["revision"] + 1)

    def test_link_unlink_last_target_and_target_validation(self):
        plan = self.document["plans"][0]
        issue = plan["issues"][0]
        issue.update(scope="ACTIVITIES", streamIds=[], activityIds=["example"], blocker=True)
        saved = planner_store.write(self.document)
        unlinked = planner_commands.update_plan_item("example-plan", "activities", "example", {"issueIds": []}, saved["revision"])
        self.assertEqual(unlinked["plan"]["issues"][0]["activityIds"], [])
        linked = planner_commands.update_plan_item("example-plan", "activities", "second", {"issueIds": ["example-issue"]}, unlinked["revision"])
        self.assertEqual(linked["plan"]["issues"][0]["activityIds"], ["second"])
        before = planner_store.read()
        for targets in (["missing"], ["second", "second"], [False], None):
            with self.subTest(targets=targets):
                invalid = deepcopy(before)
                invalid["plans"][0]["issues"][0]["activityIds"] = targets
                with self.assertRaises(planner_store.InvalidState):
                    planner_store.write(invalid)
                self.assertEqual(planner_store.read(), before)

    def test_http_activity_command_auth_conflicts_creation_and_atomic_scope(self):
        plan = self.document["plans"][0]
        plan["issues"][0].update(scope="ALL", streamIds=[], blocker=True)
        saved = planner_store.write(self.document)
        payload = {"planId": "example-plan", "activityId": "example", "item": {**saved["plans"][0]["activities"][0], "issueIds": [], "dependsOn": "second"}, "expectedRevision": saved["revision"]}
        with TestClient(create_app()) as client:
            self.assertEqual(client.put("/api/activities", json=payload).status_code, 401)
            with patch("pockethive_auth._request", return_value={"username": "local-viewer", "active": True}):
                self.assertEqual(client.put("/api/activities", json=payload, headers={"Authorization": "Bearer synthetic"}).status_code, 403)
            with patch("pockethive_auth._request", return_value={"username": "local-admin", "active": True}):
                headers = {"Authorization": "Bearer synthetic"}
                response = client.put("/api/activities", json=payload, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result["plans"][0]["issues"][0]["activityIds"], ["second", "next-task"])
                self.assertEqual(result["plans"][0]["activities"][0]["dependsOn"], "second")
                self.assertEqual(client.put("/api/activities", json=payload, headers=headers).status_code, 409)
                self.assertEqual(planner_store.read(), result)
                payload["expectedRevision"] = result["revision"]
                payload["item"]["dependsOn"] = "next-task"
                self.assertEqual(client.put("/api/activities", json=payload, headers=headers).status_code, 400)
                self.assertEqual(planner_store.read(), result)
                payload.update(activityId=None, expectedRevision=result["revision"], item={**payload["item"], "id": "new", "dependsOn": None})
                created = client.put("/api/activities", json=payload, headers=headers)
                self.assertEqual(created.status_code, 200, created.text)
                self.assertEqual(created.json()["plans"][0]["activities"][-1]["id"], "new")


if __name__ == "__main__":
    unittest.main()
