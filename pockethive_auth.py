"""Responsibility: resolve PocketHive identity and editor access. Must not: create accounts or persist tokens. Contract: docs/ARCHITECTURE.md#authentication."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

AUTH_BASE = os.environ.get("POCKETHIVE_AUTH_BASE_URL", "").rstrip("/")
EDITOR_USERNAME = "local-admin"


class AuthError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


class RejectAuthRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


AUTH_OPENER = build_opener(RejectAuthRedirects())


def _request(path, authorization=None, document=None):
    parsed = urlparse(AUTH_BASE)
    if parsed.scheme not in ("https", "http") or not parsed.netloc or parsed.username or parsed.password:
        raise AuthError("PocketHive authentication is not configured", 503)
    headers = {"Accept": "application/json"}
    if authorization:
        headers["Authorization"] = authorization
    payload = None
    if document is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(document).encode("utf-8")
    try:
        with AUTH_OPENER.open(Request(AUTH_BASE + path, data=payload, headers=headers), timeout=5) as response:
            return json.loads(response.read(1024 * 1024))
    except HTTPError as error:
        error.close()
        if 300 <= error.code < 400:
            raise AuthError("PocketHive authentication redirects are not allowed", 503) from None
        if error.code in (400, 401, 403):
            raise AuthError("PocketHive rejected the session or login", error.code) from None
        raise AuthError("PocketHive authentication is unavailable", 503) from None
    except (URLError, TimeoutError, ValueError):
        raise AuthError("PocketHive authentication is unavailable", 503) from None


def access(authorization):
    if not authorization:
        return {"user": None, "canEdit": False, "configured": bool(AUTH_BASE)}
    if not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise AuthError("A PocketHive bearer session is required", 401)
    user = _request("/api/auth/me", authorization=authorization)
    if not isinstance(user, dict) or user.get("active") is not True or not isinstance(user.get("username"), str):
        raise AuthError("Invalid or inactive PocketHive identity", 401)
    return {"user": {"username": user["username"], "displayName": user.get("displayName", user["username"])}, "canEdit": user["username"] == EDITOR_USERNAME, "configured": True}


def require_editor(authorization):
    identity = access(authorization)
    if not identity["canEdit"]:
        raise AuthError("Only PocketHive local-admin may edit plans", 403 if identity["user"] else 401)


def login(document):
    if not isinstance(document, dict) or set(document) != {"username"} or not isinstance(document["username"], str) or not document["username"].strip():
        raise AuthError("Enter a PocketHive username", 400)
    session = _request("/api/auth/dev/login", document={"username": document["username"].strip()})
    if not isinstance(session, dict) or session.get("tokenType") != "Bearer" or not isinstance(session.get("accessToken"), str):
        raise AuthError("Invalid PocketHive session response", 503)
    access("Bearer " + session["accessToken"])
    return session
