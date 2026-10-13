# PockerPlanner

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

Issues have a **Blocker** toggle and an **ALL / selected streams** scope. Open blockers tint and slowly pulse their affected streams red. A fully blocked plan displays the cartoon **BLOCKED!** entry warning, which can be acknowledged or opened directly in the blockers view. Acknowledgement does not resolve an issue.

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
```

GitHub Actions runs checks and publishes the image on `main`. The container health endpoint is `/health`. Architectural ownership and HTTP contracts are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).
