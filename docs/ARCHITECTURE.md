# PockerPlanner architecture

## Ownership

- `planner_store.py` owns the versioned workspace contract, validation, SQLite state, revision checks, and explicit replacements.
- `pockethive_auth.py` owns the outbound PocketHive authentication adapter and the local-admin editing policy. PocketHive remains the identity owner.
- `server.py` owns HTTP transport and calls the state and access owners.
- `web/auth.js` consumes the existing PocketHive browser session contract and the server's access projection. It does not grant editing rights.
- `web/app.js` owns interaction and read-only projections of the active plan. The named empty-plan view is a presentation for an empty workspace, not persisted domain data.
- `web/brand.css` owns PocketHive Press Set presentation tokens; `seed.json` owns the empty initial workspace.
- `import_workspace.py` dispatches an explicit operator-requested replacement to the store owner.

## Data contract

`GET /api/state` returns `{schemaVersion: 1, revision, plans}`. Each plan has required `id`, `name`, `description`, `streams`, `activityTypes`, `activities`, and `issues`. The description holds up to 12,000 characters. Streams have `id`, `name`, and `description`. There are no parallel/sequential flags or fixed resource limits.

An activity has required `id`, `name`, `streamId`, `typeId`, `start`, `durationDays`, `progress`, `status`, `issueIds`, `dateConfirmed`, and `jiraUrl`. Duration is full planned calendar time, 1–365 days, with inclusive end date. Progress is 0–100. Dates use ISO calendar strings. Jira URLs are empty or HTTPS links; no Jira API is called.

Activity types have `id`, `name`, and a hexadecimal color. Issues have `id`, `title`, `description`, `scope`, `discovered`, `open`, `descriptionIncomplete`, and `jiraUrl`. References resolve within their plan; duplicate IDs within one collection fail.

`PUT /api/state` requires a verified editor and the full versioned workspace. Matching revisions save atomically and increment the revision; stale revisions return 409. Invalid input returns 400. Anonymous writes return 401, non-editor writes return 403, and an unavailable auth owner denies authenticated writes with 503. Mutation success is the canonical saved document returned by the store.

JSON import uses the same versioned contract and mutation endpoint. It replaces all plans only after explicit confirmation. The UI sets the imported revision to the current workspace revision; it does not accept obsolete schemas or migrate formats implicitly. Operational import files are outside the public source and image.

## Authentication

`POCKETHIVE_AUTH_BASE_URL` explicitly selects the PocketHive auth service through its public ingress, including `/auth-service`. No protocol/provider fallback is used. Every authenticated mutation resolves the bearer token at `GET /api/auth/me`; active username `local-admin` is the editor policy. PockerPlanner has no user or password database and does not decode or trust unverified token claims.

`GET /api/session` returns the access projection. `POST /api/session/login` delegates `{username}` to the existing PocketHive `POST /api/auth/dev/login` flow. The browser uses the canonical `PH_UI_V2_AUTH_SESSION` session-storage key and attaches its bearer token. UI controls mirror permissions; the server enforces them independently. Tokens are not persisted in SQLite or source.

Read-only access is the default, including when auth is not configured. The PocketHive DEV login is intended for the same trusted development environment as PocketHive; production identity changes must be implemented at its owner and adapted explicitly here.

## Presentation and deployment

The viewport contains bounded Plan, Issues, Streams, Types, Data, and Plans panels. Calendar windows are 7/14/21/28 days with explicit navigation. Plan selection and calendar placement communicate timing. There is no resource scheduling engine.

The PocketHive Press Set uses ink `#080b16`, panel `#111626`, paper `#f7f8ff`, honey `#ffc107`, cyan `#36dfff`, violet `#b49aff`, muted `#a8b2c8`, and Arial typography. Authored type colors remain editable data.

SQLite has one workspace writer and survives container updates through mounted storage. Deploy one replica. HiveForge renders a Swarm stack and owns its execution; durable state lives outside replace-managed artifacts. Plans keep stable IDs to support a future, separately contracted PocketHive execution integration.
