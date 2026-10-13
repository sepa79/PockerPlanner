import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import planner_store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())

    def tearDown(self):
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def test_empty_start_import_and_restart_preserve_edits(self):
        self.assertEqual(planner_store.read(), {"schemaVersion": 1, "revision": 0, "plans": []})
        saved = planner_store.write(self.example)
        self.assertEqual(saved["revision"], 1)
        saved["plans"][0]["activities"][0]["progress"] = 90
        saved = planner_store.write(saved)
        self.assertEqual(saved["revision"], 2)
        self.assertEqual(planner_store.read(), saved)
        with self.assertRaises(planner_store.RevisionConflict):
            planner_store.write(self.example)

    def test_plan_isolation_and_unique_plan_ids(self):
        planner_store.read()
        second = deepcopy(self.example["plans"][0])
        second["id"] = "second"
        self.example["plans"].append(second)
        saved = planner_store.write(self.example)
        saved["plans"][1]["activities"][0]["progress"] = 60
        saved = planner_store.write(saved)
        self.assertEqual(saved["plans"][0]["activities"][0]["progress"], 0)
        self.assertEqual(saved["plans"][1]["activities"][0]["progress"], 60)
        saved["plans"][1]["id"] = saved["plans"][0]["id"]
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(saved)

    def test_invalid_import_does_not_change_workspace(self):
        original = planner_store.read()
        for field, value in [("streamId", []), ("issueIds", [{}]), ("issueIds", ["missing"]), ("jiraUrl", "javascript:alert(1)")]:
            document = deepcopy(self.example)
            document["plans"][0]["activities"][0][field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(planner_store.InvalidState):
                    planner_store.write(document)
                self.assertEqual(planner_store.read(), original)
        unsupported = deepcopy(self.example)
        unsupported["schemaVersion"] = 99
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(unsupported)

    def test_explicit_replacement_of_legacy_database(self):
        planner_store.read()
        legacy = {"revision": 8, "streams": [], "activityTypes": [], "activities": [], "issues": []}
        with sqlite3.connect(planner_store.DATABASE) as connection:
            connection.execute("UPDATE planner SET document = ? WHERE id = 1", (json.dumps(legacy),))
        with self.assertRaises(planner_store.InvalidState):
            planner_store.read()
        planner_store.replace_explicitly(self.example)
        self.assertEqual(planner_store.read()["revision"], 9)
        self.assertEqual(planner_store.read()["plans"], self.example["plans"])

    def test_blocker_scopes_are_explicit_and_plan_local(self):
        original = planner_store.read()
        issue = {"id": "blocker", "title": "Connectivity", "description": "", "scope": "STREAMS", "streamIds": ["demo"], "blocker": True, "discovered": "2026-01-01", "open": True, "descriptionIncomplete": False, "jiraUrl": ""}
        document = deepcopy(self.example)
        document["plans"][0]["issues"] = [issue]
        document["plans"][0]["activities"][0]["issueIds"] = ["blocker"]
        invalid = deepcopy(document)
        invalid["plans"][0]["issues"][0]["streamIds"] = ["missing"]
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(invalid)
        invalid = deepcopy(document)
        invalid["plans"][0]["issues"][0]["scope"] = "ALL"
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(invalid)
        self.assertEqual(planner_store.read(), original)
        saved = planner_store.write(document)
        self.assertEqual(saved["plans"][0]["issues"][0]["streamIds"], ["demo"])


if __name__ == "__main__":
    unittest.main()
