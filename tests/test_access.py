import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import planner_store
import pockethive_auth
from server import Handler


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        planner_store.read()
        self.example = json.loads((planner_store.ROOT / "web" / "example-plan.json").read_text())
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    def request(self, method, path, document=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        payload = json.dumps(document).encode() if document is not None else None
        try:
            with urlopen(Request(self.base + path, data=payload, method=method, headers=headers)) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

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


if __name__ == "__main__":
    unittest.main()
