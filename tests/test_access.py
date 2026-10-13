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
        for filename in ("pocketplanner-logo.svg", "pocketplanner-mark.svg"):
            with self.subTest(filename=filename):
                response = self.client.get("/" + filename)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "image/svg+xml")
                self.assertEqual(response.content, (WEB / filename).read_bytes())

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
