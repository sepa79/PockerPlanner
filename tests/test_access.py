import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

import planner_store
import pockethive_auth
from server import create_app, WEB
from planner_version import APP_NAME, APP_VERSION


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        planner_store.read()
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())
        self.client = TestClient(create_app(), base_url="http://localhost")
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def request(self, method, path, document=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        response = self.client.request(method, path, json=document, headers=headers)
        return response.status_code, response.json()

    def identity(self, path, authorization=None, document=None):
        if authorization == "Bearer admin-token":
            return {"username": "local-admin", "displayName": "Admin", "active": True}
        if authorization == "Bearer viewer-token":
            return {"username": "local-viewer", "displayName": "Viewer", "active": True}
        raise pockethive_auth.AuthError("Invalid PocketHive session", 401)

    def test_anonymous_and_viewer_cannot_write_but_can_read(self):
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.assertEqual(self.request("GET", "/api/state")[0], 200)
            self.assertEqual(self.request("PUT", "/api/state", self.example)[0], 401)
            self.assertEqual(self.request("PUT", "/api/state", self.example, "viewer-token")[0], 403)
            self.assertEqual(self.request("PUT", "/api/state", self.example, "forged-admin-token")[0], 401)
            status, session = self.request("GET", "/api/session", token="viewer-token")
            self.assertEqual(status, 200)
            self.assertFalse(session["canEdit"])
            self.assertEqual(planner_store.read()["plans"], [])

    def test_public_brand_assets_are_served_as_svg(self):
        for filename in ("pocketplanner-logo.svg", "pocketplanner-topbar.svg", "pocketplanner-mark.svg"):
            with self.subTest(filename=filename):
                response = self.client.get("/" + filename)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "image/svg+xml")
                self.assertEqual(response.content, (WEB / filename).read_bytes())

    def test_public_application_info_uses_the_canonical_version_without_writes(self):
        before = planner_store.read()
        response = self.client.get("/api/info")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"name": APP_NAME, "version": APP_VERSION})
        self.assertEqual(APP_VERSION, (planner_store.ROOT / "VERSION").read_text().strip())
        self.assertEqual(planner_store.read(), before)

    def test_security_headers_allow_gantt_styles_but_not_inline_scripts(self):
        response = self.client.get("/")
        policy = response.headers["content-security-policy"]
        self.assertIn("script-src 'self';", policy)
        self.assertIn("style-src 'self' 'unsafe-inline';", policy)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", policy)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_verified_local_admin_can_import_and_validation_is_enforced(self):
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.assertEqual(self.request("PUT", "/api/state", self.example, "admin-token")[0], 200)
            self.assertEqual(self.request("PUT", "/api/state", self.example, "admin-token")[0], 409)
            invalid = {"schemaVersion": 99, "revision": 1, "plans": []}
            self.assertEqual(self.request("PUT", "/api/state", invalid, "admin-token")[0], 400)
            self.assertEqual(len(planner_store.read()["plans"]), 1)

    def test_auth_outage_and_inactive_identity_deny_writes(self):
        with patch("pockethive_auth._request", side_effect=pockethive_auth.AuthError("Unavailable", 503)):
            self.assertEqual(self.request("PUT", "/api/state", self.example, "admin-token")[0], 503)
        with patch("pockethive_auth._request", return_value={"username": "local-admin", "active": False}):
            self.assertEqual(self.request("PUT", "/api/state", self.example, "admin-token")[0], 401)
        self.assertEqual(planner_store.read()["plans"], [])

    def test_invalid_activity_progress_returns_400_without_saving(self):
        with patch("pockethive_auth._request", side_effect=self.identity):
            status, saved = self.request("PUT", "/api/state", self.example, "admin-token")
            self.assertEqual(status, 200)
            for progress in ("50", None, {}, [], True, 50.5, -1, 101):
                with self.subTest(progress=progress):
                    item = {**self.example["plans"][0]["activities"][0], "progress": progress}
                    body = {"planId": "example-plan", "activityId": "example", "item": item, "expectedRevision": saved["revision"]}
                    status, error = self.request("PUT", "/api/activities", body, "admin-token")
                    self.assertEqual(status, 400)
                    self.assertEqual(error["error"], "Progress must be 0–100")
                    self.assertEqual(planner_store.read(), saved)

    def test_activity_execution_actions_share_auth_revision_and_store_checks(self):
        with patch("pockethive_auth._request", side_effect=self.identity):
            self.assertEqual(self.request("PUT", "/api/state", self.example, "admin-token")[0], 200)
            item = {**self.example["plans"][0]["activities"][0], "started": True}
            body = {"planId": "example-plan", "activityId": "example", "item": item, "expectedRevision": 1}
            self.assertEqual(self.request("PUT", "/api/activities", body)[0], 401)
            self.assertEqual(self.request("PUT", "/api/activities", body, "viewer-token")[0], 403)
            status, saved = self.request("PUT", "/api/activities", body, "admin-token")
            self.assertEqual(status, 200)
            start = saved["plans"][0]["activities"][0]["startedAt"]
            self.assertTrue(start.endswith("Z"))
            self.assertEqual(self.request("PUT", "/api/activities", body, "admin-token")[0], 409)
            body["expectedRevision"] = saved["revision"]
            body["item"].update({"progress": 100, "done": True})
            status, saved = self.request("PUT", "/api/activities", body, "admin-token")
            self.assertEqual(status, 200)
            self.assertEqual(saved["plans"][0]["activities"][0]["startedAt"], start)
            self.assertTrue(saved["plans"][0]["activities"][0]["completedAt"].endswith("Z"))
        self.assertEqual(planner_store.read(), saved)

    def test_unconfigured_auth_keeps_the_application_view_only(self):
        with patch("pockethive_auth.AUTH_BASE", ""):
            self.assertEqual(self.request("GET", "/health")[0], 200)
            self.assertEqual(self.request("GET", "/api/state")[0], 200)
            status, session = self.request("GET", "/api/session")
            self.assertEqual(status, 200)
            self.assertEqual(session, {"user": None, "canEdit": False, "configured": False})
            self.assertEqual(self.request("POST", "/api/session/login", {"username": "local-admin"})[0], 503)
            self.assertEqual(self.request("PUT", "/api/state", self.example)[0], 401)
            self.assertEqual(self.request("PUT", "/api/state", self.example, "forged-admin-token")[0], 503)
            self.assertEqual(planner_store.read()["plans"], [])

    def test_noncanonical_dates_and_ids_are_rejected_at_the_api(self):
        before = planner_store.read()
        with patch("pockethive_auth._request", side_effect=self.identity):
            for collection, field, value in (("activities", "start", "20261013"), ("issues", "discovered", "2026-W42-2"), ("streams", "id", "demo ")):
                with self.subTest(collection=collection, field=field):
                    document = deepcopy(self.example)
                    document["plans"][0][collection][0][field] = value
                    self.assertEqual(self.request("PUT", "/api/state", document, "admin-token")[0], 400)
                    self.assertEqual(planner_store.read(), before)


if __name__ == "__main__":
    unittest.main()
