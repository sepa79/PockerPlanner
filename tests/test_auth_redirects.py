import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

import planner_store
import pockethive_auth
from server import create_app


class AuthRedirectTests(unittest.TestCase):
    def setUp(self):
        self.owner_requests = []
        self.destination_requests = []
        owner_requests = self.owner_requests
        destination_requests = self.destination_requests

        class Destination(BaseHTTPRequestHandler):
            def do_GET(self):
                destination_requests.append(dict(self.headers))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"username":"local-admin","active":true}')

            def do_POST(self):
                self.do_GET()

            def log_message(self, *arguments):
                pass

        class Owner(BaseHTTPRequestHandler):
            def respond(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                owner_requests.append({"path": self.path, "method": self.command, "authorization": self.headers.get("Authorization"), "body": body})
                if self.server.redirect_code and self.path != "/redirect-target":
                    self.send_response(self.server.redirect_code)
                    self.send_header("Location", self.server.redirect_target)
                    self.end_headers()
                    return
                document = {"tokenType": "Bearer", "accessToken": "synthetic-admin"} if self.command == "POST" else {"username": "local-admin", "active": True}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(document).encode())

            def do_GET(self):
                self.respond()

            def do_POST(self):
                self.respond()

            def log_message(self, *arguments):
                pass

        self.destination = ThreadingHTTPServer(("127.0.0.1", 0), Destination)
        self.owner = ThreadingHTTPServer(("127.0.0.1", 0), Owner)
        self.owner.redirect_code = 0
        self.owner.redirect_target = f"http://127.0.0.1:{self.destination.server_port}/foreign-owner"
        self.threads = []
        for server in (self.owner, self.destination):
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            thread.start()
            self.threads.append(thread)
        self.auth_base = patch("pockethive_auth.AUTH_BASE", f"http://127.0.0.1:{self.owner.server_port}")
        self.auth_base.start()

    def tearDown(self):
        self.auth_base.stop()
        for server in (self.owner, self.destination):
            server.shutdown()
            server.server_close()
        for thread in self.threads:
            thread.join()

    def test_canonical_owner_login_and_verification_still_work(self):
        session = pockethive_auth.login({"username": "local-admin"})
        self.assertEqual(session["accessToken"], "synthetic-admin")
        self.assertEqual([request["method"] for request in self.owner_requests], ["POST", "GET"])
        self.assertEqual(self.owner_requests[1]["authorization"], "Bearer synthetic-admin")
        self.assertEqual(self.destination_requests, [])

    def test_get_and_post_redirects_never_forward_credentials(self):
        for status in (301, 302, 303, 307, 308):
            self.owner.redirect_code = status
            for same_origin in (False, True):
                self.owner.redirect_target = f"http://127.0.0.1:{self.owner.server_port}/redirect-target" if same_origin else f"http://127.0.0.1:{self.destination.server_port}/foreign-owner"
                for document in (None, {"username": "local-admin"}):
                    with self.subTest(status=status, same_origin=same_origin, document=document):
                        before = len(self.owner_requests)
                        with self.assertRaises(pockethive_auth.AuthError) as rejected:
                            pockethive_auth._request("/api/auth/me" if document is None else "/api/auth/dev/login", "Bearer synthetic-admin", document)
                        self.assertEqual(rejected.exception.status, 503)
                        self.assertIn("redirect", str(rejected.exception))
                        self.assertEqual(len(self.owner_requests), before + 1)
                        self.assertNotEqual(self.owner_requests[-1]["path"], "/redirect-target")
                        self.assertEqual(self.destination_requests, [])

    def test_redirect_cannot_grant_editing_or_change_saved_state(self):
        self.owner.redirect_code = 302
        with tempfile.TemporaryDirectory() as directory:
            with patch("planner_store.DATABASE", Path(directory) / "planner.sqlite3"):
                before = planner_store.read()
                with TestClient(create_app(), base_url="http://localhost") as client:
                    response = client.put("/api/state", headers={"Authorization": "Bearer synthetic-admin"}, json={**before, "plans": []})
                    self.assertEqual(response.status_code, 503)
                self.assertEqual(planner_store.read(), before)
        self.assertEqual(self.destination_requests, [])


if __name__ == "__main__":
    unittest.main()
