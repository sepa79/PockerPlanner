# PocketPlanner architecture

## Ownership

- `planner_store.py` owns the versioned workspace contract, validation, SQLite state, revision checks, and explicit replacements.
- `pockethive_auth.py` owns the outbound PocketHive authentication adapter and the local-admin editing policy. PocketHive remains the identity owner.
- `server.py` owns HTTP transport and calls the state and access owners.
- `web/auth.js` consumes the existing PocketHive browser session contract and the server's access projection. It does not grant editing rights.
- `web/app.js` owns interaction and read-only projections of the active plan. The named empty-plan view is a presentation for an empty workspace, not persisted domain data.
- `web/progress.js` owns the shared overall-progress projection: rounded equal-weight mean of activity percentages, or no value for an empty collection.
- `web/brand.css` owns PocketHive Press Set presentation tokens; `seed.json` owns the empty initial workspace.
- `import_workspace.py` dispatches an explicit operator-requested replacement to the store owner.

## Data contract

`GET /api/state` returns `{schemaVersion: 1, revision, plans}`. Each plan has required `id`, `name`, `description`, `streams`, `activityTypes`, `activities`, and `issues`. The description holds up to 12,000 characters. Streams have `id`, `name`, and `description`. There are no parallel/sequential flags or fixed resource limits.

An activity has required `id`, `name`, `streamId`, `typeId`, `start`, `durationDays`, `progress`, `status`, `issueIds`, `dateConfirmed`, and `jiraUrl`. Duration is full planned calendar time, 1–365 days, with inclusive end date. Progress is 0–100. Dates use ISO calendar strings. Jira URLs are empty or HTTPS links; no Jira API is called.

Activity types have `id`, `name`, and a hexadecimal color. Issues have `id`, `title`, `description`, `scope`, `streamIds`, `blocker`, `discovered`, `open`, `descriptionIncomplete`, and `jiraUrl`. Scope is explicitly `ALL` with an empty target list, or `STREAMS` with at least one existing stream ID. An open blocker affects its scope. Activity `issueIds` are context links, not a second authority for blocker scope. References resolve within their plan; duplicate IDs within one collection fail.

Issues can also have `resolvedAt`, a timezone-aware ISO timestamp or null. Absence/null means the resolution time was not recorded, not that the issue is still open. The store stamps UTC time on a saved open-to-closed transition, preserves a recorded time while the issue remains closed, and clears it on reopening. Timestamps are scoped by plan and issue ID. Newly imported closed issues retain supplied valid historical timestamps; missing dates remain unknown. Explicit offline replacement imports historical state rather than inventing lifecycle events. No read-time migration or guessed dates are used.

`PUT /api/state` requires a verified editor and the full versioned workspace. Matching revisions save atomically and increment the revision; stale revisions return 409. Invalid input returns 400. Anonymous writes return 401, non-editor writes return 403, and an unavailable auth owner denies authenticated writes with 503. Mutation success is the canonical saved document returned by the store.

JSON import uses the same versioned contract and mutation endpoint. It replaces all plans only after explicit confirmation. The UI sets the imported revision to the current workspace revision; it does not accept obsolete schemas or migrate formats implicitly. Operational import files are outside the public source and image.

## Authentication

`POCKETHIVE_AUTH_BASE_URL` explicitly selects the PocketHive auth service through its public ingress, including `/auth-service`. No protocol/provider fallback is used. Every authenticated mutation resolves the bearer token at `GET /api/auth/me`; active username `local-admin` is the editor policy. PockerPlanner has no user or password database and does not decode or trust unverified token claims.

`GET /api/session` returns the access projection. `POST /api/session/login` delegates `{username}` to the existing PocketHive `POST /api/auth/dev/login` flow. The browser uses the canonical `PH_UI_V2_AUTH_SESSION` session-storage key and attaches its bearer token. UI controls mirror permissions; the server enforces them independently. Tokens are not persisted in SQLite or source.

Read-only access is the default, including when auth is not configured. The PocketHive DEV login is intended for the same trusted development environment as PocketHive; production identity changes must be implemented at its owner and adapted explicitly here.

## Presentation and deployment

The viewport contains bounded Plan, Issues, Streams, Types, Data, and Plans panels. Calendar windows are 7/14/21/28 days with explicit navigation. Plan selection and calendar placement communicate timing. There is no resource scheduling engine.

Timeline stream headers toggle their activity groups using keyboard-accessible buttons with expanded state and controlled group IDs. Overall progress remains visible when collapsed and includes every activity in the stream, independent of the calendar window. A collapsed summary bar is labelled with the stream name, covers the earliest start through the latest inclusive end including gaps, and displays the aggregate progress. Empty streams have no summary bar or numeric percentage. Collapse state is presentation-only, scoped to each plan for the current page visit; viewers can toggle it without auth or workspace writes.

The activity editor has a synchronized range slider and native numeric stepper for integer progress from 0 to 100. The numeric input is the sole submitted progress field. Invalid numeric drafts remain visible for normal form validation rather than being silently clamped. Done sets both draft controls to 100 without submitting or changing status text. Save uses the existing mutation contract; Cancel discards the draft. All three progress controls are disabled for viewers.

Issue lifecycle actions explicitly close or reopen an issue and submit the validated current form through the existing mutation contract. Save and the normal Enter shortcut retain the current lifecycle state; Cancel discards unsaved edits. An explicit lifecycle action supplies its target through the hidden open-state field during form submission; the canonical persisted status remains the boolean `open`. The lifecycle button is not the default submit action, so Enter cannot inadvertently close or reopen an issue. Viewers cannot submit lifecycle actions. The Issues list defaults to Active and can show History; the blocker classification filter works within either status view. The full-block warning's blockers action always selects Active. `descriptionIncomplete` is informational only: its checkbox sits beside Description and adds an `incomplete` list label, without changing dates, progress, or blocker scope/effect.

List blocker classification and affected-stream scope are noninteractive labels. Only the issue title opens its details; blocker and scope changes are made inside that editor. Closed issues show their resolution date/time in the list and details, formatted in the browser's local timezone with the saved timestamp available in the tooltip. Older closed records without timestamps show Not recorded.

Blocked stream rows pulse red. When all streams of the active plan are blocked, entry displays the animated `BLOCKED!` dialog. Acknowledgement is local to the current page/plan visit and does not resolve issues. The blockers action dismisses the dialog and filters Issues to open blockers. Reduced-motion mode uses a static warning and stream tint.

The PocketHive Press Set uses ink `#080b16`, panel `#111626`, paper `#f7f8ff`, honey `#ffc107`, cyan `#36dfff`, violet `#b49aff`, muted `#a8b2c8`, and Arial typography. Authored type colors remain editable data.

The PocketPlanner wordmark uses the same typography declaration as the PocketHive and HiveForge source logos: Inter, Segoe UI, Arial, sans-serif; weight 800 at 76px for the name and weight 500 at 26px for the subtitle. The approved `simple test plan` subtitle spans the full name width. `web/pocketplanner-logo.svg` is the header and large-logo asset; `web/pocketplanner-mark.svg` is the favicon. Repository, image, deployment, and internal API identifiers remain named PockerPlanner.

SQLite has one workspace writer and survives container updates through mounted storage. Deploy one replica. HiveForge renders a Swarm stack and owns its execution; durable state lives outside replace-managed artifacts. Plans keep stable IDs to support a future, separately contracted PocketHive execution integration.
