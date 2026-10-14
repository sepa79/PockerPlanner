import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import planner_commands
import planner_store


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        planner_store.read()
        self.fixture = json.loads((planner_store.ROOT / "web/example-plan.json").read_text())
        self.saved = planner_store.write(self.fixture)

    def tearDown(self):
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def edit(self, changes, timestamp="2026-10-14T10:00:00Z", collection="activities", item_id="example"):
        with patch("planner_store._resolution_timestamp", return_value=timestamp):
            result = planner_commands.update_plan_item("example-plan", collection, item_id, changes, self.saved["revision"])
        self.saved = planner_store.read()
        return result["plan"]["activities"][0]

    def test_percent_is_not_a_start_and_start_is_idempotent(self):
        item = self.edit({"progress": 50})
        self.assertNotIn("startedAt", item)
        item = self.edit({"started": True})
        self.assertEqual(item["startedAt"], "2026-10-14T10:00:00Z")
        self.assertNotIn("started", item)
        item = self.edit({"started": True}, "2026-10-15T10:00:00Z")
        self.assertEqual(item["startedAt"], "2026-10-14T10:00:00Z")
        self.assertEqual(planner_store.read(), self.saved)

    def test_done_stamps_completion_and_reopening_clears_only_completion(self):
        self.edit({"started": True})
        item = self.edit({"progress": 100, "done": True}, "2026-10-17T10:00:00Z")
        self.assertEqual(item["completedAt"], "2026-10-17T10:00:00Z")
        item = self.edit({"done": True}, "2026-10-18T10:00:00Z")
        self.assertEqual(item["completedAt"], "2026-10-17T10:00:00Z")
        item = self.edit({"progress": 80}, "2026-10-18T10:00:00Z")
        self.assertNotIn("completedAt", item)
        self.assertEqual(item["startedAt"], "2026-10-14T10:00:00Z")
        item = self.edit({"progress": 100}, "2026-10-19T10:00:00Z")
        self.assertEqual(item["completedAt"], "2026-10-19T10:00:00Z")

    def test_start_done_does_not_guess_an_earlier_start(self):
        item = self.edit({"progress": 100, "done": True})
        self.assertNotIn("startedAt", item)
        self.assertEqual(item["completedAt"], "2026-10-14T10:00:00Z")
        self.assertNotIn("blockerIntervals", item)

    def test_blocking_intervals_follow_scope_closure_reopening_and_completion(self):
        self.edit({"blocker": True}, collection="issues", item_id="example-issue")
        item = self.edit({"started": True})
        self.assertEqual(len(item["blockerIntervals"]), 1)
        self.assertIsNone(item["blockerIntervals"][0]["endedAt"])
        item = self.edit({"open": False}, "2026-10-15T10:00:00Z", "issues", "example-issue")
        self.assertEqual(item["blockerIntervals"][0]["endedAt"], "2026-10-15T10:00:00Z")
        item = self.edit({"open": True}, "2026-10-16T10:00:00Z", "issues", "example-issue")
        self.assertEqual(len(item["blockerIntervals"]), 2)
        item = self.edit({"issueIds": []}, "2026-10-17T10:00:00Z")
        self.assertEqual(item["blockerIntervals"][1]["endedAt"], "2026-10-17T10:00:00Z")
        self.edit({"issueIds": ["example-issue"]}, "2026-10-18T10:00:00Z")
        item = self.edit({"progress": 100, "done": True}, "2026-10-19T10:00:00Z")
        self.assertEqual(item["blockerIntervals"][2]["endedAt"], item["completedAt"])
        self.assertEqual(item["blockerTrackingSince"], item["startedAt"])

    def test_multiple_blockers_and_deletion_preserve_history_without_dangling_live_links(self):
        self.edit({"started": True})
        document = deepcopy(self.saved)
        issue = document["plans"][0]["issues"][0]
        issue["blocker"] = True
        document["plans"][0]["issues"].append({**issue, "id": "second"})
        with patch("planner_store._resolution_timestamp", return_value="2026-10-15T10:00:00Z"):
            self.saved = planner_store.write(document)
        self.assertEqual(len(self.saved["plans"][0]["activities"][0]["blockerIntervals"]), 2)
        document = deepcopy(self.saved)
        document["plans"][0]["issues"] = []
        document["plans"][0]["activities"][0]["issueIds"] = []
        with patch("planner_store._resolution_timestamp", return_value="2026-10-16T10:00:00Z"):
            self.saved = planner_store.write(document)
        intervals = self.saved["plans"][0]["activities"][0]["blockerIntervals"]
        self.assertTrue(all(interval["endedAt"] == "2026-10-16T10:00:00Z" for interval in intervals))
        self.assertEqual(intervals[0]["title"], "Example issue")

    def test_scoped_and_raw_changes_cannot_rewrite_server_owned_facts(self):
        self.edit({"started": True})
        before = deepcopy(self.saved)
        for changes in ({"startedAt": "2026-10-12T10:00:00Z"}, {"started": "yes"}, {"done": True}):
            with self.assertRaises(planner_store.InvalidState):
                self.edit(changes)
            self.assertEqual(planner_store.read(), before)
        changed = deepcopy(before)
        changed["plans"][0]["activities"][0]["startedAt"] = "2026-10-12T10:00:00Z"
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write(changed)
        self.assertEqual(planner_store.read(), before)
        with self.assertRaises(planner_store.RevisionConflict):
            planner_commands.update_plan_item("example-plan", "activities", "example", {"done": True, "progress": 100}, 0)
        self.assertEqual(planner_store.read(), before)

    def test_new_imported_records_preserve_supplied_facts_without_inventing_dates(self):
        document = deepcopy(self.saved)
        item = {**document["plans"][0]["activities"][0], "id": "historical", "progress": 100, "startedAt": "2026-10-01T09:00:00Z", "completedAt": "2026-10-05T10:00:00Z"}
        document["plans"][0]["activities"].append(item)
        document["plans"][0]["activities"].append({**item, "id": "undated", "startedAt": None, "completedAt": None})
        saved = planner_store.write(document)
        self.assertEqual(saved["plans"][0]["activities"][1], item)
        self.assertIsNone(saved["plans"][0]["activities"][2]["completedAt"])

    def test_execution_chronology_is_validated(self):
        for changes in ({"startedAt": "2026-10-14"}, {"progress": 100, "startedAt": "2026-10-15T09:00:00Z", "completedAt": "2026-10-14T09:00:00Z"}, {"startedAt": "2026-10-14T09:00:00Z", "blockerTrackingSince": "2026-10-13T09:00:00Z"}, {"blockerIntervals": [{}]}):
            document = deepcopy(self.saved)
            document["plans"][0]["activities"][0].update(changes)
            with self.assertRaises(planner_store.InvalidState):
                planner_store.validate(document)

    def test_recorded_metadata_size_is_checked_before_commit(self):
        size = len(json.dumps(self.saved, ensure_ascii=False, separators=(",", ":")).encode())
        before = deepcopy(self.saved)
        with patch("planner_store.MAX_DOCUMENT_BYTES", size + 10):
            with self.assertRaises(planner_store.InvalidState):
                self.edit({"started": True})
        self.assertEqual(planner_store.read(), before)

    def test_command_actions_cannot_be_imported_as_persisted_flags(self):
        for key in ("started", "done"):
            document = deepcopy(self.saved)
            document["plans"][0]["activities"][0][key] = True
            with self.assertRaises(planner_store.InvalidState):
                planner_store.write(document)
            self.assertEqual(planner_store.read(), self.saved)


if __name__ == "__main__":
    unittest.main()
