import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import planner_commands
import planner_store


class ValidationLimitTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = patch("planner_store.DATABASE", Path(self.directory.name) / "planner.sqlite3")
        self.database.start()
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())
        planner_store.read()

    def tearDown(self):
        self.database.stop()
        self.directory.cleanup()

    def compact_size(self, document):
        return len(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def near_limit(self, remaining=0, revision=0):
        document = {"schemaVersion": 1, "revision": revision, "plans": []}
        for index in range(86):
            document["plans"].append({"id": f"plan-{index}", "name": "Synthetic plan", "description": "x" * 12000, "streams": [], "activityTypes": [], "activities": [], "issues": []})
        document["plans"].append({"id": "padding", "name": "Padding", "description": "", "streams": [], "activityTypes": [], "activities": [], "issues": []})
        padding = planner_store.MAX_DOCUMENT_BYTES - remaining - self.compact_size(document)
        self.assertTrue(0 <= padding <= 12000)
        document["plans"][-1]["description"] = "x" * padding
        self.assertEqual(self.compact_size(document), planner_store.MAX_DOCUMENT_BYTES - remaining)
        return document

    def test_dates_reject_noncanonical_formats_without_changing_state(self):
        before = planner_store.read()
        invalid_dates = ("20261013", "2026-W42-2", "2026-1-03", "2026-02-30", "2026-10-13T00:00:00Z", " 2026-10-13", "2026-10-13 ", "٢٠٢٦-10-13", "0000-01-01", None)
        for collection, field in (("activities", "start"), ("issues", "discovered")):
            for value in invalid_dates:
                with self.subTest(collection=collection, value=value):
                    document = deepcopy(self.example)
                    document["plans"][0][collection][0][field] = value
                    with self.assertRaises(planner_store.InvalidState):
                        planner_store.write(document)
                    self.assertEqual(planner_store.read(), before)
        valid = deepcopy(self.example)
        valid["plans"][0]["activities"][0]["start"] = "2028-02-29"
        valid["plans"][0]["issues"][0]["discovered"] = "2028-02-29"
        self.assertEqual(planner_store.write(valid)["plans"], valid["plans"])

    def test_ids_are_literal_and_never_silently_trimmed(self):
        before = planner_store.read()
        for collection in ("plans", "streams", "activityTypes", "activities", "issues"):
            for whitespace in (" ", "\t", "\n", "\u00a0"):
                for leading in (False, True):
                    with self.subTest(collection=collection, whitespace=repr(whitespace), leading=leading):
                        document = deepcopy(self.example)
                        item = document["plans"][0] if collection == "plans" else document["plans"][0][collection][0]
                        item["id"] = whitespace + item["id"] if leading else item["id"] + whitespace
                        with self.assertRaises(planner_store.InvalidState):
                            planner_store.write(document)
                        self.assertEqual(planner_store.read(), before)
        saved = planner_store.write(self.example)
        self.assertEqual(saved["plans"], self.example["plans"])

    def test_utf8_bytes_and_offline_replacement_share_the_limit(self):
        document = self.near_limit(remaining=1)
        document["plans"][-1]["description"] += "é"
        before = planner_store.read()
        self.assertEqual(self.compact_size(document), planner_store.MAX_DOCUMENT_BYTES + 1)
        for operation in (planner_store.validate, planner_store.write, planner_store.replace_explicitly):
            with self.subTest(operation=operation.__name__):
                with self.assertRaises(planner_store.InvalidState):
                    operation(document)
                self.assertEqual(planner_store.read(), before)

    def test_exact_limit_is_saved_and_scoped_growth_is_rejected(self):
        saved = planner_store.write(self.near_limit())
        self.assertEqual(self.compact_size(saved), planner_store.MAX_DOCUMENT_BYTES)
        with self.assertRaises(planner_store.InvalidState):
            planner_commands.create_plan("too-large", "Extra plan", "", saved["revision"])
        self.assertEqual(planner_store.read(), saved)
        trimmed = planner_commands.update_plan("padding", {"description": ""}, saved["revision"])
        self.assertEqual(trimmed["revision"], saved["revision"] + 1)

    def test_server_revision_growth_is_checked_before_commit(self):
        document = self.near_limit(revision=9)
        with patch("planner_store.DATABASE", Path(self.directory.name) / "rollover.sqlite3"):
            planner_store.replace_explicitly(document)
            for revision in range(9):
                document = planner_store.write(planner_store.read())
            self.assertEqual(document["revision"], 9)
            self.assertEqual(self.compact_size(document), planner_store.MAX_DOCUMENT_BYTES)
            with self.assertRaises(planner_store.InvalidState):
                planner_store.write(document)
            self.assertEqual(planner_store.read(), document)

    def test_server_resolution_metadata_is_checked_before_commit(self):
        limit = 4096
        original = deepcopy(self.example)
        original["plans"][0]["description"] = ""
        original["plans"][0]["description"] = "x" * (limit - self.compact_size(original))
        with patch("planner_store.MAX_DOCUMENT_BYTES", limit):
            saved = planner_store.write(original)
            saved["plans"][0]["issues"][0]["open"] = False
            saved["plans"][0]["description"] = saved["plans"][0]["description"][:-1]
            self.assertEqual(self.compact_size(saved), limit)
            before = planner_store.read()
            with self.assertRaises(planner_store.InvalidState):
                planner_store.write(saved)
            self.assertEqual(planner_store.read(), before)


if __name__ == "__main__":
    unittest.main()
