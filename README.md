# PocketPlanner

![PocketPlanner · simple test plan](web/pocketplanner-logo.svg)

A compact calendar test planner with separate plans, descriptions, editable streams and activities, shared blockers, plain Jira links, and JSON import/export. The interface uses the PocketHive Press Set palette. Concurrency is expressed by task placement on the timeline.

## Portainer

The application image is `ghcr.io/sepa79/pockerplanner:latest`, built for amd64 and arm64 by GitHub Actions.

1. Open **Stacks → Add stack → Web editor**.
2. Paste [compose.yaml](compose.yaml).
3. Add the `POCKETHIVE_AUTH_BASE_URL` environment value: your PocketHive public ingress plus `/auth-service`, without a trailing slash.
4. Deploy and open `http://<docker-host>:8765`.
5. Sign in as PocketHive **local-admin**, open **Data**, and import your workspace JSON.

New installations start empty. The repository and application image contain no operational plan data. SQLite is stored in the `planner_data` Docker volume. Restarting or updating the container preserves it. Keep one application replica. A local Docker volume belongs to its host; if using Swarm, pin the service to the node that owns the volume or configure shared storage.

The app provides public read-only views. PocketHive resolves every editing request; only an active `local-admin` identity may mutate or import. Without `POCKETHIVE_AUTH_BASE_URL`, the app remains read-only. The current login uses PocketHive's existing DEV login endpoint; no accounts or passwords are maintained by PockerPlanner.

## Plans and JSON

Use **Plans** to create a plan and maintain its name and testing-approach description. Select a plan from the header. Streams, activity types, activities, and issues belong to the selected plan.

**Data → Export JSON** downloads all plans and their descriptions. **Import JSON** replaces the workspace after confirmation. Invalid imports leave the saved workspace unchanged. [Example JSON](web/example-plan.json) contains generic sample data only.

The import format is:
```json
{"schemaVersion": 1, "revision": 0, "plans": []}
```
Each plan has `id`, `name`, `description`, `streams`, `activityTypes`, `activities`, and `issues`. IDs are scoped within their plan. The file's revision is replaced with the current server revision at import. The canonical validation contract lives in `planner_store.py`.

Click activities to view details; local-admin can edit them and drag their bars. Durations are full planned calendar days, with inclusive end dates. Dates awaiting confirmation have dashed outlines. The cyan line marks today.

Activity progress has a synchronized 0–100 slider and numeric input with native stepper arrows. **Done** sets the draft progress to 100%; **Save** persists it, while **Cancel** discards it. All progress controls remain disabled for view-only users.

Click a stream name or its arrow on the timeline to collapse or expand its activities, including in view-only mode. The header always shows overall progress: the rounded, equal-weight average of all activities in that stream, not just the visible date range. Empty streams show `—`. Collapsed streams retain a named summary bar from the first start to the last end, including any gaps. Expansion state is local to each plan during the current page visit and does not change saved plan data.

Issues show noninteractive **Blocker / Issue** and **ALL / selected streams** labels. Click the issue title to open its details and edit the blocker flag or scope. Open blockers tint and slowly pulse their affected streams red. A fully blocked plan displays the cartoon **BLOCKED!** entry warning, which can be acknowledged or opened directly in the blockers view. Acknowledgement does not resolve an issue.

The Issues list defaults to **Active**; select **History** for closed issues. The blocker filter works within either view. In issue details, **Close issue** or **Reopen issue** saves your current edits and changes the issue state. Closing a blocker removes its blocking effect without deleting links or changing other blockers. **Incomplete**, beside the description, is only a reminder that details are missing; flagged issues show an `incomplete` label in the list. It does not affect dates, progress, or blocker status.

Closing an issue records `resolvedAt` automatically on the server. History and issue details display that time in your browser's timezone. Editing a closed issue preserves it; reopening clears it and a later closure records a new time. Older/imported closed issues without a recorded date show **Not recorded**. JSON can include a timezone-aware `resolvedAt` for newly imported historical issues; the app never guesses their closure date.

## Local development

Python 3.12+ is sufficient; no application dependencies need installation:
```sh
POCKETHIVE_AUTH_BASE_URL=https://<your-ingress>/auth-service python3 server.py
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
python3 -m unittest discover -s tests -v
node --check web/app.js
node --check web/auth.js
node --check web/progress.js
node --check tests/progress-editor.browser.js
node --check tests/issue-editor.browser.js
node --test tests/*.test.cjs
```

GitHub Actions runs checks and publishes the image on `main`. The container health endpoint is `/health`. Architectural ownership and HTTP contracts are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

`tests/progress-editor.browser.js` is a Playwright browser regression function for an isolated server with an empty temporary database and working PocketHive auth. Navigate the test browser to that server before invoking it with the page. It refuses to run against a workspace with existing plans. It checks progress editing, validation, persistence after reload, view-only controls, named collapsed bars, and mobile layout.

`tests/issue-editor.browser.js` uses the same isolated-server precondition and checks Close/Reopen, validation, Save/Cancel, persistence, blocker scope, incomplete labels, Active/History filtering, the full-block warning action, creation, and view-only/mobile behavior.
