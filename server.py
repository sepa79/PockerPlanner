"""Responsibility: HTTP and static delivery, including the MCP transport. State and identity belong to their owners."""

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from planner_mcp import create_mcp_server, transport_security
from planner_commands import save_activity
from planner_store import MAX_DOCUMENT_BYTES, InvalidState, RevisionConflict, read, write
from pockethive_auth import AuthError, access, login, require_editor

WEB = Path(__file__).resolve().parent / "web"
STATIC = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/auth.js": ("auth.js", "text/javascript"), "/progress.js": ("progress.js", "text/javascript"), "/schedule.js": ("schedule.js", "text/javascript"), "/style.css": ("style.css", "text/css"), "/brand.css": ("brand.css", "text/css"), "/pocketplanner-logo.svg": ("pocketplanner-logo.svg", "image/svg+xml"), "/pocketplanner-mark.svg": ("pocketplanner-mark.svg", "image/svg+xml"), "/example-plan.json": ("example-plan.json", "application/json")}
MAX_BODY_BYTES = MAX_DOCUMENT_BYTES


class ResponseHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        return response


async def _document(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise InvalidState("Request size must be 1 byte–1 MB")
        body.extend(chunk)
    if not body:
        raise InvalidState("Request size must be 1 byte–1 MB")
    try:
        return json.loads(body)
    except (ValueError, UnicodeError):
        raise InvalidState("Request must contain valid JSON") from None


async def state_endpoint(request):
    if request.method == "GET":
        return JSONResponse(await run_in_threadpool(read))
    await run_in_threadpool(require_editor, request.headers.get("authorization"))
    document = await _document(request)
    return JSONResponse(await run_in_threadpool(write, document))


async def session_endpoint(request):
    return JSONResponse(await run_in_threadpool(access, request.headers.get("authorization")))


async def activity_endpoint(request):
    await run_in_threadpool(require_editor, request.headers.get("authorization"))
    document = await _document(request)
    return JSONResponse(await run_in_threadpool(save_activity, document))


async def login_endpoint(request):
    document = await _document(request)
    return JSONResponse(await run_in_threadpool(login, document))


def health_endpoint(request):
    read()
    return JSONResponse({"status": "ok"})


def static_endpoint(request):
    filename, content_type = STATIC[request.url.path]
    return Response((WEB / filename).read_bytes(), media_type=content_type)


async def error_response(request, error):
    if isinstance(error, AuthError):
        return JSONResponse({"error": str(error)}, status_code=error.status)
    if isinstance(error, RevisionConflict):
        return JSONResponse({"error": str(error)}, status_code=409)
    if isinstance(error, InvalidState):
        return JSONResponse({"error": str(error)}, status_code=400)
    if isinstance(error, HTTPException):
        return JSONResponse({"error": error.detail}, status_code=error.status_code)
    logging.getLogger(__name__).error("Planner request failed", exc_info=error)
    return JSONResponse({"error": "Unable to serve planner"}, status_code=500)


def create_app():
    mcp_server = create_mcp_server()
    mcp_app = mcp_server.streamable_http_app(json_response=True, stateless_http=True, max_request_body_size=MAX_BODY_BYTES, transport_security=transport_security())

    @asynccontextmanager
    async def lifespan(application):
        async with mcp_server.session_manager.run():
            yield

    application = Starlette(
        routes=[
            Route("/api/state", state_endpoint, methods=["GET", "PUT"]),
            Route("/api/activities", activity_endpoint, methods=["PUT"]),
            Route("/api/session", session_endpoint, methods=["GET"]),
            Route("/api/session/login", login_endpoint, methods=["POST"]),
            Route("/health", health_endpoint),
            *[Route(path, static_endpoint) for path in STATIC],
            Mount("/", app=mcp_app),
        ],
        lifespan=lifespan,
        exception_handlers={AuthError: error_response, InvalidState: error_response, RevisionConflict: error_response, HTTPException: error_response, Exception: error_response},
    )
    application.add_middleware(ResponseHeaders)
    return application


app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8765")), proxy_headers=False)
