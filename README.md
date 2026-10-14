# PocketPlanner

![PocketPlanner · simple test plan](web/pocketplanner-logo.svg)

A compact calendar test planner with separate plans, descriptions, editable streams and activities, shared blockers, plain Jira links, and JSON import/export. The interface uses the PocketHive Press Set palette.

**For operators:** [Portainer](#portainer) · [HiveForge deployment playbook](docs/HIVEFORGE.md)

**For agents:** [Working rules](AGENTS.md) · [Update plans through MCP](docs/MCP.md)

Python 3.12, SQLite, Starlette/Uvicorn, the official MCP Python SDK, and plain JavaScript. One container, one application replica, no Jira-sized workflow engine.

## Portainer

The release image is `ghcr.io/sepa79/pocketplanner:v0.2.0`, built for amd64 and arm64 by GitHub Actions. It is public and can be pulled without a registry login.

1. Open **Stacks → Add stack → Web editor**.
2. Paste [compose.yaml](compose.yaml).
3. For editing, add `POCKETHIVE_AUTH_BASE_URL`: your PocketHive public ingress plus `/auth-service`, without a trailing slash. Omit it for view-only operation.
4. Deploy and open `http://<docker-host>:8765`.
5. When auth is configured, sign in as PocketHive **local-admin**, open **Data**, and import your workspace JSON.

New installations start empty. The repository and application image contain no operational plan data. SQLite is stored in the `planner_data` Docker volume. Restarting or updating the container preserves it. Keep one application replica. A local Docker volume belongs to its host; if using Swarm, pin the service to the node that owns the volume or configure shared storage.

The app provides public read-only views. PocketHive resolves every editing request; only an active `local-admin` identity may mutate or import. Without `POCKETHIVE_AUTH_BASE_URL`, the app remains read-only. The current login uses PocketHive's existing DEV login endpoint; no accounts or passwords are maintained by PocketPlanner.

Use the application in a trusted development/lab environment; PocketHive DEV login is not production authentication. The container scan reported Debian package vulnerabilities without available distro fixes at scan time. Package updates and removal of runtime pip do not mean the image is vulnerability-free.

## Plans and JSON

Use **Plans** to create a plan and maintain its name and testing-approach description. Select a plan from the header. Streams, activity types, activities, and issues belong to the selected plan.

**Data → Export JSON** downloads all plans and their descriptions as compact JSON, without size-increasing indentation. **Import JSON** replaces the workspace after confirmation. The one-MiB file and saved-document limits remain enforced. Invalid imports leave the saved workspace unchanged. [Example JSON](web/example-plan.json) contains generic sample data only.

The import format is:
```json
{"schemaVersion": 1, "revision": 0, "plans": []}
```
Each plan has `id`, `name`, `description`, `streams`, `activityTypes`, `activities`, and `issues`. IDs are scoped within their plan. The file's revision is replaced with the current server revision at import. The canonical validation contract lives in `planner_store.py`.

IDs cannot have leading/trailing whitespace; dates must be exact `YYYY-MM-DD` calendar dates. Saved workspaces are limited to one MiB of compact UTF-8 JSON. The same limit protects browser, MCP, and offline imports; rejected changes leave existing data unchanged.

If another session or agent edits the workspace before your save, your change is rejected and the editor closes. The latest data loads, with a notice that your edit was not saved. Reopen the activity, issue or plan to review current values and reapply only your intended change; the old draft is never automatically replayed.

While an update is being saved, the editor shows **Saving…** and temporarily disables its controls, including Cancel, Close and Escape. Wait for the response before starting the next edit; a late response cannot close a different draft. Controls become available again after success or failure. Activity status/description accepts up to 1,000 characters; stream/issue descriptions remain at 2,000 and plan descriptions at 12,000.

Click activities to view details; local-admin can edit them and drag their bars. Durations are full planned **working days** by default, never remaining time. Saturday/Sunday remain visible but free on the timeline. Tick **Include weekends** inside an activity to count all calendar days instead. For example, three days starting Friday occupy Friday, Monday and Tuesday; with the checkbox enabled they occupy Friday, Saturday and Sunday. A weekday-only weekend start begins work on Monday, and dropping its bar on a weekend snaps forward to Monday. End dates and overdue indicators follow that same rule. Existing saved starts, durations and progress are not rewritten. Dates awaiting confirmation have dashed outlines. The cyan line marks today.

Activity progress has a synchronized 0–100 slider and numeric input with native stepper arrows. **Done** sets the draft progress to 100%; **Save** persists it, while **Cancel** discards it. All progress controls remain disabled for view-only users.

Choose **Depends on · activity** in activity details to follow another activity in the same stream. **Depends on · stream** in stream details starts that stream after all its predecessor's activities finish. Starts follow automatically on the next eligible day, respecting **Include weekends**; independent activities in a dependent stream retain their calendar spacing. Moving a predecessor cascades to its successors. Auto-scheduled starts and bars cannot move independently: move the predecessor or clear the dependency. Cycles are rejected. Confirmation becomes pending again when an upstream edit changes a confirmed effective start. Timeline names indent at each activity-dependency level, without moving bars or percentage columns. Dependencies do not infer completion from progress or launch tests.

Click a stream name or its arrow on the timeline to collapse or expand its activities, including in view-only mode. The header always shows overall progress: the rounded, equal-weight average of all activities in that stream, not just the visible date range. Empty streams show `—`. Collapsed streams retain named summary segments on actual scheduled days, leaving gaps and excluded weekends free. Expansion state is local to each plan during the current page visit and does not change saved plan data.

Issues show noninteractive **Blocker / Issue** and **ALL / selected streams / selected activities** labels. Click the issue title to open its details and edit the blocker flag or scope. Unchecking an issue in Activity removes that activity from the issue itself: ALL or stream-wide scopes become explicit lists of the other affected activities. Those other activities remain blocked. An empty activity selection affects nothing. Open blockers tint and slowly pulse affected unfinished activities and their stream headers red. The cartoon **BLOCKED!** entry warning appears only when every unfinished activity is blocked; it can be acknowledged or opened directly in the blockers view. Acknowledgement does not resolve an issue.

The Issues list defaults to **Active**; select **History** for closed issues. The blocker filter works within either view. In issue details, **Close issue** or **Reopen issue** saves your current edits and changes the issue state. Closing a blocker removes its blocking effect without deleting links or changing other blockers. **Incomplete**, beside the description, is only a reminder that details are missing; flagged issues show an `incomplete` label in the list. It does not affect dates, progress, or blocker status.

Closing an issue records `resolvedAt` automatically on the server. History and issue details display that time in your browser's timezone. Editing a closed issue preserves it; reopening clears it and a later closure records a new time. Older/imported closed issues without a recorded date show **Not recorded**. JSON can include a timezone-aware `resolvedAt` for newly imported historical issues; the app never guesses their closure date.

## MCP for agents

The source includes a built-in **Streamable HTTP** endpoint at `/mcp`, on the same port as the website. It lets an agent read plans and make scoped edits to plan descriptions, streams, activity types, activities, and issues. There is no separate MCP container, database, or agent-only admin password.

Reads are view-only by default. Every mutation requires a PocketHive **local-admin** bearer token and the latest `expected_revision`; stale writes fail instead of overwriting a teammate's edits. IDs remain stable, issue closure timestamps belong to the store, and MCP exposes no delete or whole-workspace replacement tool.

For remote access, configure `POCKETPLANNER_MCP_ALLOWED_HOSTS` with the actual hostname/IP and port. MCP accepts localhost only by default and rejects untrusted Host/Origin headers. Use HTTPS outside a trusted development network. Connection setup, tools, examples, and agent safety rules are in [MCP.md](docs/MCP.md).

Rovo and PocketHive execution integration are future work: no automatic Jira updates, ticket polling, scenario launches, or status-to-progress guesses are implemented. An eventual connector can supply evidence to these same scoped commands without becoming a second database or bypassing auth.

## Local development

Use Python 3.12+ and install the pinned application dependencies:
```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
POCKETHIVE_AUTH_BASE_URL=https://<your-ingress>/auth-service .venv/bin/python server.py
```

Or build locally:
```sh
POCKETHIVE_AUTH_BASE_URL=https://<your-ingress>/auth-service docker compose -f compose.local.yaml up -d --build
```

Open `http://localhost:8765`. `TESTPLANNER_DB` selects the SQLite file for non-container runs. `PORT` selects the HTTP port.

For an explicitly requested offline replacement or migration, stop the app and run:
```sh
TESTPLANNER_DB=/data/planner.sqlite3 python3 import_workspace.py /path/to/workspace.json
```
The command validates and replaces the workspace. The server does not silently migrate legacy single-plan databases.

## HiveForge

[HiveForge setup](docs/HIVEFORGE.md) describes the repository manifest, supported Swarm profile, required runtime values, and durable storage. Lifecycle actions go through HiveForge MCP. No PocketHive execution integration is implemented yet.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -v
node --check web/app.js
node --check web/auth.js
node --check web/progress.js
node --check web/schedule.js
node --check tests/progress-editor.browser.js
node --check tests/issue-editor.browser.js
node --check tests/weekends.browser.js
node --check tests/conflicts-import.browser.js
node --check tests/editor-pending.browser.js
node --check tests/dependencies-issues.browser.js
node --test tests/*.test.cjs
```

GitHub Actions runs checks and publishes images on `main` and version tags. Builds publish `latest` and a full commit-SHA tag; version-tag builds also publish the matching `vX.Y.Z` image tag and OCI version label. Publication jobs are serialized. The container health endpoint is `/health`. Architectural ownership and HTTP contracts are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

The MCP tests exercise real SDK protocol handling, tool discovery, scoped edits, PocketHive permissions, stale revisions, validation, issue lifecycle, and Host/Origin/body-size protection. Browser regressions run separately against isolated databases, not your working plan.

`tests/progress-editor.browser.js` is a Playwright browser regression function for an isolated server with an empty temporary database and working PocketHive auth. Navigate the test browser to that server before invoking it with the page. It refuses to run against a workspace with existing plans. It checks progress editing, validation, persistence after reload, view-only controls, named collapsed bars, and mobile layout.

`tests/weekends.browser.js` uses the same isolated-server contract to check weekday gaps, weekend opt-in, legacy omission, summary segments, progress fill, overdue dates, editing, drag snapping, new-activity defaults, persistence and view-only controls. `tests/schedule.test.cjs` covers UTC/DST arithmetic, leap/year boundaries, clipping and the full 365-day duration.

`tests/conflicts-import.browser.js` uses an empty isolated database to check stale editor/drag rejection, safe reopening, closed-form guards, concurrent issue closure, removal of the selected plan, and an actual compact export/import round trip near the UTF-8 byte limit. It also checks malformed/oversized import rejection without changing saved state.

`tests/editor-pending.browser.js` delays real QA responses to check the pending-edit lock, duplicate-submit/close/Escape guards, success/error recovery, deletion/lifecycle actions, and the 1,000-character activity description boundary without reducing other description limits.

`tests/issue-editor.browser.js` uses the same isolated-server precondition and checks Close/Reopen, validation, Save/Cancel, persistence, blocker scope, incomplete labels, Active/History filtering, the full-block warning action, creation, and view-only/mobile behavior.

`tests/dependencies-issues.browser.js` checks real activity/stream dependency editing, date previews, weekend gaps, cascading root dragging, confirmation invalidation, reload persistence, bidirectional issue assignment, precise blocker labels, partial blocking, view-only controls and mobile layout. Python and calendar tests also reject missing/cyclic/cross-stream dependencies and invalid issue targets without changing saved state.
