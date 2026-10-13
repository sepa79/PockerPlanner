"""Responsibility: HTTP and static delivery for the planner. Must not: own planner state or validation. Contract: docs/ARCHITECTURE.md#contract."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from planner_store import InvalidState, RevisionConflict, read, write
from pockethive_auth import AuthError, access, login, require_editor


WEB = Path(__file__).resolve().parent / "web"
STATIC = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/auth.js": ("auth.js", "text/javascript"), "/progress.js": ("progress.js", "text/javascript"), "/style.css": ("style.css", "text/css"), "/brand.css": ("brand.css", "text/css"), "/pocketplanner-logo.svg": ("pocketplanner-logo.svg", "image/svg+xml"), "/pocketplanner-mark.svg": ("pocketplanner-mark.svg", "image/svg+xml"), "/example-plan.json": ("example-plan.json", "application/json")}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status, document):
        self._send(status, json.dumps(document).encode("utf-8"))

    def do_GET(self):
        try:
            if self.path == "/api/state":
                return self._json(200, read())
            if self.path == "/api/session":
                return self._json(200, access(self.headers.get("Authorization")))
            if self.path == "/health":
                read()
                return self._json(200, {"status": "ok"})
            if self.path in STATIC:
                filename, content_type = STATIC[self.path]
                return self._send(200, (WEB / filename).read_bytes(), content_type)
            self._json(404, {"error": "Not found"})
        except AuthError as error:
            self._json(error.status, {"error": str(error)})
        except Exception:
            self._json(500, {"error": "Unable to read planner"})

    def _document(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 1024 * 1024:
            raise InvalidState("Request size must be 1 byte–1 MB")
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        if self.path != "/api/session/login":
            return self._json(404, {"error": "Not found"})
        try:
            self._json(200, login(self._document()))
        except AuthError as error:
            self._json(error.status, {"error": str(error)})
        except (InvalidState, ValueError) as error:
            self._json(400, {"error": str(error)})
        except Exception:
            self._json(500, {"error": "Unable to sign in"})

    def do_PUT(self):
        if self.path != "/api/state":
            return self._json(404, {"error": "Not found"})
        try:
            require_editor(self.headers.get("Authorization"))
            document = self._document()
            self._json(200, write(document))
        except AuthError as error:
            self._json(error.status, {"error": str(error)})
        except (InvalidState, ValueError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
        except RevisionConflict as error:
            self._json(409, {"error": str(error)})
        except Exception:
            self._json(500, {"error": "Unable to save planner"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
