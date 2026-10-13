import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import planner_store


class ResolutionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())
        planner_store.read()

    def tearDown(self):
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def test_close_edit_reopen_and_close_again(self):
        saved = planner_store.write(self.example)
        saved["plans"][0]["issues"][0]["open"] = False
        original = deepcopy(saved)
        with patch("planner_store._resolution_timestamp", return_value="2026-10-13T19:45:00Z") as clock:
            saved = planner_store.write(saved)
            clock.assert_called_once()
        self.assertNotIn("resolvedAt", original["plans"][0]["issues"][0])
        self.assertEqual(saved["plans"][0]["issues"][0]["resolvedAt"], "2026-10-13T19:45:00Z")
        self.assertEqual(planner_store.read(), saved)
        saved["plans"][0]["issues"][0].pop("resolvedAt")
        saved["plans"][0]["issues"][0]["description"] = "Edited after closure"
        saved = planner_store.write(saved)
        self.assertEqual(saved["plans"][0]["issues"][0]["resolvedAt"], "2026-10-13T19:45:00Z")
        saved["plans"][0]["issues"][0]["resolvedAt"] = "2026-10-12T12:00:00Z"
        saved = planner_store.write(saved)
        self.assertEqual(saved["plans"][0]["issues"][0]["resolvedAt"], "2026-10-13T19:45:00Z")
        saved["plans"][0]["issues"][0]["open"] = True
        saved = planner_store.write(saved)
        self.assertNotIn("resolvedAt", saved["plans"][0]["issues"][0])
        saved["plans"][0]["issues"][0]["open"] = False
        with patch("planner_store._resolution_timestamp", return_value="2026-10-13T20:45:00Z"):
            saved = planner_store.write(saved)
        self.assertEqual(saved["plans"][0]["issues"][0]["resolvedAt"], "2026-10-13T20:45:00Z")

    def test_imported_closed_issues_keep_known_dates_without_guessing_unknown_dates(self):
        document = deepcopy(self.example)
        issue = document["plans"][0]["issues"][0]
        issue["open"] = False
        issue["resolvedAt"] = "2026-01-03T10:00:00+01:00"
        unknown = {**issue, "id": "unknown"}
        unknown.pop("resolvedAt")
        document["plans"][0]["issues"].append(unknown)
        with patch("planner_store._resolution_timestamp") as clock:
            saved = planner_store.write(document)
            clock.assert_not_called()
        self.assertEqual(saved["plans"][0]["issues"][0]["resolvedAt"], issue["resolvedAt"])
        self.assertNotIn("resolvedAt", saved["plans"][0]["issues"][1])
        saved["plans"][0]["issues"][1]["description"] = "An older closed issue"
        saved = planner_store.write(saved)
        self.assertNotIn("resolvedAt", saved["plans"][0]["issues"][1])
        with patch("planner_store._resolution_timestamp") as clock:
            saved = planner_store.replace_explicitly(document)
            clock.assert_not_called()
        self.assertEqual(saved["plans"], document["plans"])

    def test_timestamps_are_scoped_to_the_plan_and_share_a_batch_clock(self):
        document = deepcopy(self.example)
        second = deepcopy(document["plans"][0])
        second["id"] = "second"
        document["plans"].append(second)
        saved = planner_store.write(document)
        saved["plans"][0]["issues"][0]["open"] = False
        with patch("planner_store._resolution_timestamp", return_value="2026-10-13T19:45:00Z"):
            saved = planner_store.write(saved)
        self.assertNotIn("resolvedAt", saved["plans"][1]["issues"][0])
        saved["plans"][0]["issues"][0]["open"] = True
        saved = planner_store.write(saved)
        for plan in saved["plans"]:
            plan["issues"][0]["open"] = False
        with patch("planner_store._resolution_timestamp", return_value="2026-10-13T20:45:00Z") as clock:
            saved = planner_store.write(saved)
            clock.assert_called_once()
        self.assertTrue(all(plan["issues"][0]["resolvedAt"] == "2026-10-13T20:45:00Z" for plan in saved["plans"]))

    def test_invalid_resolution_dates_leave_saved_state_unchanged(self):
        saved = planner_store.write(self.example)
        invalid_values = [False, 42, "", "not a date", "2026-10-13", "2026-10-13T19:45:00", "2026-02-30T19:45:00Z", "2026-10-13T19:45:00+00:99", "2026-10-13T19:45:00+24:00"]
        for value in invalid_values:
            with self.subTest(value=value):
                document = deepcopy(saved)
                document["plans"][0]["issues"][0]["open"] = False
                document["plans"][0]["issues"][0]["resolvedAt"] = value
                with self.assertRaises(planner_store.InvalidState):
                    planner_store.write(document)
                self.assertEqual(planner_store.read(), saved)

    def test_stale_closure_does_not_record_a_timestamp(self):
        saved = planner_store.write(self.example)
        stale = deepcopy(self.example)
        stale["plans"][0]["issues"][0]["open"] = False
        with patch("planner_store._resolution_timestamp") as clock:
            with self.assertRaises(planner_store.RevisionConflict):
                planner_store.write(stale)
            clock.assert_not_called()
        self.assertEqual(planner_store.read(), saved)


if __name__ == "__main__":
    unittest.main()
