import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

import planner_store
import planner_commands
from pockethive_auth import AuthError
from server import create_app


class McpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        planner_store.read()
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())
        self.client = TestClient(create_app(), base_url="http://localhost")
        self.client.__enter__()
        self.headers = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def rpc(self, method, params=None, token=None, headers=None):
        request_headers = {**self.headers, **(headers or {})}
        if token:
            request_headers["Authorization"] = "Bearer " + token
        return self.client.post("/mcp", headers=request_headers, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})

    def call(self, name, arguments=None, token=None):
        response = self.rpc("tools/call", {"name": name, "arguments": arguments or {}}, token)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["result"]

    def identity(self, path, authorization=None, document=None):
        if authorization == "Bearer admin-token":
            return {"username": "local-admin", "active": True}
        if authorization == "Bearer viewer-token":
            return {"username": "local-viewer", "active": True}
        raise AuthError("Invalid PocketHive session", 401)

    def assert_failure(self, result, code):
        self.assertTrue(result["isError"], result)
        self.assertIn(code, result["content"][0]["text"])

    def test_initialize_discovery_and_public_read(self):
        response = self.rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "regression", "version": "1.0"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["serverInfo"]["name"], "PocketPlanner")
        self.assertNotIn("mcp-session-id", response.headers)
        tools = self.rpc("tools/list").json()["result"]["tools"]
        self.assertEqual({tool["name"] for tool in tools}, {"get_access", "list_plans", "get_plan", "create_plan", "update_plan", "create_plan_item", "update_plan_item"})
        for tool in tools:
            self.assertNotIn("context", tool["inputSchema"]["properties"])
            self.assertNotIn("token", tool["inputSchema"]["properties"])
        self.assertEqual(self.call("list_plans")["structuredContent"], {"revision": 0, "plans": []})
        self.assert_failure(self.call("get_plan", {"plan_id": "missing"}), "INVALID_INPUT")
        with patch("pockethive_auth.AUTH_BASE", ""):
            self.assertEqual(self.call("get_access")["structuredContent"], {"user": None, "canEdit": False, "configured": False})

    def test_each_mutation_requires_a_fresh_verified_editor(self):
        arguments = {"plan_id": "new", "name": "New", "description": "", "expected_revision": 0}
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.assert_failure(self.call("create_plan", arguments), "AUTH_401")
            self.assert_failure(self.call("create_plan", arguments, "viewer-token"), "AUTH_403")
            self.assert_failure(self.call("create_plan", arguments, "forged-token"), "AUTH_401")
            created = self.call("create_plan", arguments, "admin-token")["structuredContent"]
            self.assertEqual(created["revision"], 1)
            self.assertTrue(self.call("get_access", token="admin-token")["structuredContent"]["canEdit"])
            self.assertFalse(self.call("get_access", token="viewer-token")["structuredContent"]["canEdit"])
            self.assert_failure(self.call("update_plan", {"plan_id": "new", "changes": {"description": "Denied"}, "expected_revision": 1}), "AUTH_401")
        with patch("pockethive_auth._request", side_effect=AuthError("Unavailable", 503)):
            self.assert_failure(self.call("update_plan", {"plan_id": "new", "changes": {"description": "Denied"}, "expected_revision": 1}, "admin-token"), "AUTH_503")
        with patch("pockethive_auth._request", return_value={"username": "local-admin", "active": False}):
            self.assert_failure(self.call("update_plan", {"plan_id": "new", "changes": {"description": "Denied"}, "expected_revision": 1}, "admin-token"), "AUTH_401")
        self.assertEqual(planner_store.read()["plans"][0]["description"], "")

    def test_scoped_edits_conflicts_validation_and_issue_lifecycle(self):
        other = deepcopy(self.example["plans"][0])
        other["id"] = "other"
        self.example["plans"].append(other)
        planner_store.write(self.example)
        with patch("pockethive_auth._request", side_effect=self.identity):
            updated = self.call("update_plan_item", {"plan_id": "example-plan", "collection": "activities", "item_id": "example", "changes": {"progress": 65, "start": "2026-02-10"}, "expected_revision": 1}, "admin-token")["structuredContent"]
            self.assertEqual(updated["revision"], 2)
            self.assertEqual(updated["plan"]["activities"][0]["progress"], 65)
            self.assertEqual(planner_store.read()["plans"][1], other)
            unchanged = planner_store.read()
            rejected = [
                ({"progress": 66}, 1, "REVISION_CONFLICT"),
                ({"progress": 101}, 2, "INVALID_INPUT"),
                ({"progress": True}, 2, "INVALID_INPUT"),
                ({"streamId": "missing"}, 2, "INVALID_INPUT"),
                ({"id": "replacement"}, 2, "INVALID_INPUT"),
                ({"jiraUrl": "http://insecure.example.com"}, 2, "INVALID_INPUT"),
                ({"unknown": "ignored?"}, 2, "INVALID_INPUT"),
            ]
            for changes, revision, code in rejected:
                with self.subTest(changes=changes, revision=revision):
                    self.assert_failure(self.call("update_plan_item", {"plan_id": "example-plan", "collection": "activities", "item_id": "example", "changes": changes, "expected_revision": revision}, "admin-token"), code)
                    self.assertEqual(planner_store.read(), unchanged)
            closed = self.call("update_plan_item", {"plan_id": "example-plan", "collection": "issues", "item_id": "example-issue", "changes": {"open": False}, "expected_revision": 2}, "admin-token")["structuredContent"]
            self.assertTrue(closed["plan"]["issues"][0]["resolvedAt"].endswith("Z"))
            self.assert_failure(self.call("update_plan_item", {"plan_id": "example-plan", "collection": "issues", "item_id": "example-issue", "changes": {"resolvedAt": "2020-01-01T00:00:00Z"}, "expected_revision": 3}, "admin-token"), "INVALID_INPUT")
            reopened = self.call("update_plan_item", {"plan_id": "example-plan", "collection": "issues", "item_id": "example-issue", "changes": {"open": True}, "expected_revision": 3}, "admin-token")["structuredContent"]
            self.assertNotIn("resolvedAt", reopened["plan"]["issues"][0])

    def test_create_items_requires_complete_valid_data_and_never_upserts(self):
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.call("create_plan", {"plan_id": "new", "name": "New", "description": "", "expected_revision": 0}, "admin-token")
            for collection, item in [("streams", {"id": "stream", "name": "Stream", "description": ""}), ("activityTypes", {"id": "type", "name": "Type", "color": "#ffc107"})]:
                revision = planner_store.read()["revision"]
                created = self.call("create_plan_item", {"plan_id": "new", "collection": collection, "item": item, "expected_revision": revision}, "admin-token")
                self.assertFalse(created.get("isError", False), created)
                self.assert_failure(self.call("create_plan_item", {"plan_id": "new", "collection": collection, "item": item, "expected_revision": revision + 1}, "admin-token"), "INVALID_INPUT")
            before = planner_store.read()
            self.assert_failure(self.call("create_plan_item", {"plan_id": "new", "collection": "activities", "item": {"id": "incomplete", "name": "Incomplete"}, "expected_revision": before["revision"]}, "admin-token"), "INVALID_INPUT")
            self.assertEqual(planner_store.read(), before)

            self.assert_failure(self.call("update_plan", {"plan_id": "new", "changes": {"description": "Bad revision"}, "expected_revision": True}, "admin-token"), "validation")
            self.assertEqual(planner_store.read(), before)

    def test_a_racing_browser_write_is_not_overwritten(self):
        planner_store.write(self.example)
        store_write = planner_store.write

        def competing_write(document):
            browser = planner_store.read()
            browser["plans"][0]["activities"][0]["progress"] = 80
            store_write(browser)
            return store_write(document)

        with patch("planner_commands.write", side_effect=competing_write):
            with self.assertRaises(planner_store.RevisionConflict):
                planner_commands.update_plan_item("example-plan", "activities", "example", {"progress": 20}, 1)
        self.assertEqual(planner_store.read()["revision"], 2)
        self.assertEqual(planner_store.read()["plans"][0]["activities"][0]["progress"], 80)

    def test_weekend_option_is_editable_through_mcp_and_validated(self):
        planner_store.write(self.example)
        with patch("pockethive_auth._request", side_effect=self.identity):
            arguments = {"plan_id": "example-plan", "collection": "activities", "item_id": "example", "changes": {"includeWeekends": True}, "expected_revision": 1}
            self.assert_failure(self.call("update_plan_item", arguments), "AUTH_401")
            updated = self.call("update_plan_item", arguments, "admin-token")["structuredContent"]
            self.assertEqual(updated["revision"], 2)
            self.assertIs(updated["plan"]["activities"][0]["includeWeekends"], True)
            self.assertEqual(updated["plan"]["activities"][0]["durationDays"], 2)
            before = planner_store.read()
            self.assert_failure(self.call("update_plan_item", {**arguments, "changes": {"includeWeekends": "true"}, "expected_revision": 2}, "admin-token"), "INVALID_INPUT")
            self.assertEqual(planner_store.read(), before)

    def test_scoped_edits_cannot_bypass_workspace_validation_or_size(self):
        planner_store.write(self.example)
        before = planner_store.read()
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.assert_failure(self.call("update_plan_item", {"plan_id": "example-plan", "collection": "activities", "item_id": "example", "changes": {"start": "2026-W42-2"}, "expected_revision": before["revision"]}, "admin-token"), "INVALID_INPUT")
            self.assert_failure(self.call("create_plan_item", {"plan_id": "example-plan", "collection": "streams", "item": {"id": "stream ", "name": "Stream", "description": ""}, "expected_revision": before["revision"]}, "admin-token"), "INVALID_INPUT")
            with patch("planner_store.MAX_DOCUMENT_BYTES", 4096):
                self.assert_failure(self.call("create_plan", {"plan_id": "oversized", "name": "Oversized", "description": "x" * 4000, "expected_revision": before["revision"]}, "admin-token"), "INVALID_INPUT")
            self.assertEqual(planner_store.read(), before)

    def test_host_origin_size_and_malformed_request_protection(self):
        self.assertEqual(self.rpc("tools/list", headers={"Host": "evil.example"}).status_code, 421)
        self.assertEqual(self.rpc("tools/list", headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.client.post("/mcp", headers=self.headers, content=b"x" * (1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.client.post("/mcp", headers=self.headers, content="not-json").status_code, 400)
        with patch.dict(os.environ, {"POCKERPLANNER_MCP_ALLOWED_HOSTS": "planner.example.com:8765", "POCKERPLANNER_MCP_ALLOWED_ORIGINS": "https://trusted.example.com"}):
            with TestClient(create_app(), base_url="http://planner.example.com:8765") as remote:
                response = remote.post("/mcp", headers={**self.headers, "Origin": "https://trusted.example.com"}, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
                self.assertEqual(response.status_code, 200, response.text)
        with patch.dict(os.environ, {"POCKERPLANNER_MCP_ALLOWED_HOSTS": "*"}):
            with self.assertRaises(ValueError):
                create_app()


if __name__ == "__main__":
    unittest.main()
