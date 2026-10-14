import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import planner_commands
import planner_store


class DeadlineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        planner_store.read()
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())

    def tearDown(self):
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def test_optional_deadline_does_not_rewrite_legacy_plans(self):
        saved = planner_store.write(self.example)
        self.assertNotIn("deadline", saved["plans"][0])
        self.assertEqual(planner_store.read(), saved)
        self.assertEqual(planner_store.read_revision(), saved["revision"])

    def test_deadline_persists_and_clears_through_scoped_commands(self):
        created = planner_commands.create_plan("deadline", "Deadline plan", "", 0, "2026-10-30")
        self.assertEqual(created["plan"]["deadline"], "2026-10-30")
        updated = planner_commands.update_plan("deadline", {"description": "Changed"}, 1)
        self.assertEqual(updated["plan"]["deadline"], "2026-10-30")
        cleared = planner_commands.update_plan("deadline", {"deadline": None}, 2)
        self.assertIsNone(cleared["plan"]["deadline"])
        self.assertEqual(planner_store.read()["plans"][0], cleared["plan"])

    def test_invalid_deadlines_fail_without_writes(self):
        before = planner_store.read()
        for value in ("", "20261030", "2026-02-30", "2026-10-30T00:00:00Z", 123, False, [], {}):
            with self.subTest(value=value):
                document = deepcopy(self.example)
                document["plans"][0]["deadline"] = value
                with self.assertRaises(planner_store.InvalidState):
                    planner_store.write(document)
                self.assertEqual(planner_store.read(), before)

    def test_deadline_is_independent_of_activity_edits_and_revision_checks(self):
        self.example["plans"][0]["deadline"] = "2026-10-30"
        saved = planner_store.write(self.example)
        planner_commands.update_plan_item("example-plan", "activities", "example", {"start": "2026-11-10"}, saved["revision"])
        self.assertEqual(planner_store.read()["plans"][0]["deadline"], "2026-10-30")
        with self.assertRaises(planner_store.RevisionConflict):
            planner_commands.update_plan("example-plan", {"deadline": None}, saved["revision"])


if __name__ == "__main__":
    unittest.main()
