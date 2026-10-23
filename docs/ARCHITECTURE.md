# PocketPlanner architecture

## Runtime and scope

PocketPlanner uses Java 21/Spring Boot with SQLite and React 19/TypeScript/Vite.
One JAR serves the classpath UI, REST, SSE, MCP and PH adapters. The root Dockerfile
builds the actual shared npm/Maven artifacts and runs only a non-root Java JRE;
there is no Node runtime server, Python proxy, callback handler or compatibility
backend. A standalone JAR requires an explicit absolute `TESTPLANNER_DB`.
The container sets `/data/planner.sqlite3`, port 8765 and bind address 0.0.0.0.

The [unification plan](POCKET_FAMILY_UNIFICATION.md) tracks staged acceptance.
The local image build passes 219 frontend and 621 Java tests, with 14 additional
deployment configuration tests. Isolated Compose browser/save/recreation checks
pass. Real local PH acceptance verifies Plan/Stream/Activity selection on CREATE,
a second linked Activity, journal data HTTP 200 using the exact-run link and
central sign-in, and actual Start/Stop from PP. Canonical planning state and
revision stay unchanged. Only an owned synthetic swarm targets local WireMock;
the payment system and Redis are not mutated. Desktop forwarded-preview
login/restart remains unverified.
Version 0.2.3 is qualified as a local Java/React release; see
[release verification](RELEASE_VERIFICATION.md) for exact image and acceptance
evidence. Registry publication, remote deployment and operational-data transfer
are separate actions. Build locally or choose an explicitly verified published
Java image; do not treat an older published tag as this implementation.

`backend/` is the sole backend implementation; `frontend/` is the product UI.
Test mutations use synthetic temporary databases, never the working Planner
database. No two implementations or application replicas may share a working store.

The Java core has one owner for each responsibility:

- `WorkspaceJson`: bounded UTF-8 JSON decoding/encoding, with no scalar coercion,
  duplicate keys, trailing documents, malformed Unicode or non-finite numbers.
- `WorkspaceValidator`: schema, collection limits and plan-local references;
  `WorkspaceValues`, `WorkspaceDependencies` and `ActivityExecutionValidator`
  provide its focused scalar, graph and recorded-history validation units.
- `WorkspaceCommands`: scoped edits; `PlanCollection` declares their editable
  fields. Commands delegate validation and save through the same store.
- `WorkspaceStore`: the only SQLite boundary. Every save locks with BEGIN
  IMMEDIATE, compares the persisted revision, composes factual changes with one
  injected transaction instant, validates the final byte size and commits once.
  Callers must supply an explicit database path; there is no working-path default.
- `IssueAssignments`, `IssueResolutions` and `ExecutionRecorder`: compose issue
  scopes, close/reopen dates and Started/Done/blocker history in the private save
  draft. They have no clock, database, authentication or calendar calculation.
- `PlannerConfiguration`: compose one store/validator/command service and require
  an explicit absolute `TESTPLANNER_DB`; no working-directory database default.
- `WorkspaceController`, `SessionController` and `MetadataController`: map HTTP
  operations to their existing owners. `JsonRequests` bounds body reads before
  calling `WorkspaceJson`; no alternate persisted-document mapper is introduced.
- `PhAuthClients`: construct the actual shared PH JVM clients from one fixed
  `POCKETHIVE_AUTH_BASE_URL`. `PlannerAccess` owns fresh identity-to-edit policy;
  `DeviceSessionService` adapts strict requests without storing OAuth state or
  polling. Vendored checksummed Maven artifacts are build inputs, not copied HTTP
  implementations or runtime dependencies on sibling checkouts. A prepare-package
  gate verifies the actual resolved shared JAR/POM digests against those inputs,
  rejecting stale same-version Maven cache entries even with tests skipped.
- `RevisionFeed`: one committed-revision observer; each `RevisionSubscription`
  retains at most one latest notification. `RevisionStreams` bounds lazy SSE
  writers to 128 with no executor task queue; `RevisionStream` owns one connection.
  `RevisionStreamMvc` releases the sender only after MVC initializes its emitter,
  avoiding an unbounded startup send buffer. None of these units saves plans.
- `ApiErrors` and `SecurityHeaders`: safe status/error mapping and no-store/CSP
  headers, including JSON failures for SSE-only Accept requests. Normal disconnected
  async responses are not rewritten as server-error payloads.
- `VersionInfo`: the application's sole VERSION resource projection.
- The `mcp` package maps the official Java SDK's stateless Streamable HTTP tools
  to `WorkspaceCommands` and fresh `PlannerAccess` decisions. Its HTTP boundary
  owns request bounds and explicit Host/Origin checks, not protocol framing,
  persisted state, identity sessions or an alternate command implementation.
- `PlannerCatalogue` and `PlannerReferences`: project one store snapshot and the
  exact instance-scoped Plan/Activity identities. `LinkedRuns` joins PH's saved
  associations without persisting execution state or substituting newer runs.
- `PhApiClient`: bounded single-attempt calls to the configured PH ingress, using
  the maintained HTTP client with redirects/retries disabled. Its PH JSON boundary
  has an eight-MiB response limit, separate from the one-MiB workspace contract.
- `RuntimeProjection` and `RuntimeObservations`: safe worker/runtime fields and
  exact-run joins with PH-owned permissions. No worker configuration or credentials
  are projected and no planning facts are inferred.
- `RunControls`: exact linked Start/Stop admission and correlation-specific
  operation reads. PH remains the permission and outcome authority; uncertain
  responses never trigger automatic retries. `IntegrationController` maps HTTP
  requests after the shared fresh-session check, never the Planner-editor policy.

JSON trees deliberately preserve omitted fields, explicit nulls, timestamp
spellings and supported extension fields; strict value validation owns their
meaning. No DTO default silently adds fields to an imported document. The
language-neutral cases in `tests/contracts/` run against the Java owners using
authored synthetic data only. Java-specific tests additionally use
temporary SQLite files, concurrent independent connections and fresh JVM
processes. The authored empty `seed.json` and `VERSION` remain resource inputs.
The JAR serves the supported REST planning endpoints, metadata, shared device
sessions, SSE, MCP, PH integration adapters and built React UI. It has no redirect
callback, alternate UI or proxy to another product runtime. Experiments must not
point it at a working SQLite file.

Optional Jira links use Java's standard URI parser: HTTPS, a host, no embedded
credentials and a valid port. Spaces must be percent-encoded. No Jira API is called.

### HTTP/session boundary

Public reads remain `GET /api/state`, `/api/info`, `/health` and `/api/events`.
`PUT /api/state` handles ordinary workspace saves; `PUT /api/state/import` handles
explicit historical replacement through the same store. `PUT /api/activities`
delegates to the scoped editor command. No alternate import/export state owner or
implicit upsert exists. All writes freshly verify PH identity before reading the body.
Their original 400/401/403/409/503 semantics and final-document byte limit remain.
HTTP reads export canonical JSON; browser filename/revision presentation belongs
to React's Data view, not another backend endpoint.

The session API consumes `pocketplanner-device` through `auth-client`:

- `GET /api/session` returns only safe user display fields, canEdit and configured.
- `POST /api/session/device/start` accepts `{}` and returns the RFC device response.
- `POST /api/session/device/poll` accepts exactly `{deviceCode: string}`; pending,
  slow-down and other recognized OAuth errors retain safe error codes.
- `POST /api/session/logout` accepts `{}` and a browser bearer token, revokes it
  through PH and returns PH's validated central logout URL. A failure is not
  reported as a completed logout. The imported shared browser library owns polling,
  local token storage and PH confirmation-tab behavior in the React consumer.

Empty auth configuration permits anonymous viewing only. Supplied tokens fail
closed when identity cannot be freshly verified; there is no local admin bypass.
Shared transport retains its time/size bounds and rejects redirects. No request
code, token, identity session or PH runtime observation is persisted in SQLite.
The standalone JAR binds to loopback by default; `PORT` and `BIND_ADDRESS` are explicit
listener settings, never redirect/callback settings. No CORS policy is enabled.

### MCP and PocketHive boundary

`/mcp` implements the seven scoped tools documented in `MCP.md`
through the official Java SDK. HTTP authorization is request-scoped, including
when a client reuses its connection. Initialization or a previous admin call never
grants a later request permission. HTTP and MCP share one commands/store boundary;
a successful tool mutation is visible to REST readers and the same revision feed.
The transport limits request bytes before SDK decoding; malformed domain inputs,
revision conflicts and denied authorization remain explicit tool errors.

`/api/integration/catalogue`, `/runs`, `/execution`, `/control` and
`/operation` preserve the existing integration contract below. Each requires an
active freshly verified PH session, not Planner local-admin. `POCKETPLANNER_INSTANCE_ID`,
`POCKETHIVE_BASE_URL` and `POCKETHIVE_PUBLIC_URL` remain explicit operator settings;
missing integration configuration does not disable ordinary planning or silently
fall back to another instance. Control admission forwards the same user's token
and idempotency key to PH for the exact linked run. Acceptance is not completion;
the operation endpoint checks swarm, run and correlation identity. No integration
code writes SQLite, edits manual progress or calls CREATE/Remove.

### React ownership

`frontend/` uses React 19/TypeScript/Vite and actual packaged PH dependencies:
`@pockethive/ui` owns shell/header/rail/tokens, and `@pockethive/browser-auth` owns
device confirmation, polling, token storage and shared logout. Product CSS styles
calendar/editors/runtime content, not a copied shared shell. No product code
implements OAuth, reads tokens or patches an installed common library.

- `App` composes navigation, selected plan, interactions and shared identity.
  It owns the issue status/blocker filters so they survive changes of tab, view
  mode and selected plan. The explicit Show me the blockers action selects active
  blockers, not historical issues. A newly created plan becomes selected only after its
  save succeeds; Cancel, rejected saves and conflicts never select an unsaved
  plan. The calendar retains the 7/14/21/28-day ranges.
- `api/plannerApi` is the typed JSON transport boundary; its fetch is supplied by
  shared auth. It owns no product authorization or persisted state.
- `hooks/useWorkspace` owns one canonical frontend snapshot, revision notifications,
  draft/drag deferral and commit/conflict reload. It never silently rebases drafts.
- `domain/schedule` and `domain/progress` are the sole calendar/forecast and mean
  progress calculation owners. React components render their results. Java does
  not reproduce the forecast engine. `domain/execution` owns editor draft intent
  and local-time resolution, not persisted lifecycle/history composition.
- `EditorActivity` sends explicit editable fields/actions to the scoped command;
  server-owned facts never return as a second authority. `EditorDetails` handles
  other collection drafts; `Dialog` owns dismissal and pending-save locks.
  The Activity timing preview passes its current issue selection to the calendar
  predicate only for the edited Activity; all other Activities retain canonical
  scope membership. Linking/unlinking updates the preview immediately, without
  mutating issue scopes, recorded history or persisted state. The server remains
  the sole owner of assignment composition on Save.
  Recorded blocking is not undone by unlinking: the calendar retains closed
  intervals and counts ongoing recorded intervals through the reference day,
  matching their closure on Save without writing new history in the browser.
- `runtime/useExecution` owns bounded, context-isolated observation polling;
  `runtime/useRunCommand` owns exact-run, same-key command/outcome state. Rows and
  the retained side panel render these owners, never write planning facts.
- `views/DataView` exports canonical workspace JSON with a selected-plan filename
  and confirms explicit replacement imports. Production data is not test input.

`FrontendController` serves the built entry and `FrontendResources` exposes only
classpath assets/brand files on the same Java listener. Unknown API paths remain
404; there is no callback route or Python bridge. Node is a build dependency,
not a runtime server. `scripts/build-java.sh` builds/tests React before clean JAR
verification. The Docker build runs React and Java verification before creating
the JRE-only runtime. Compose/HiveForge keep one replica and the same durable
`/data` mount; no database conversion, copying or automatic import is part of
packaging. Container verification uses its own synthetic volume. Real PH journal
data retrieval is verified separately; desktop-private forwarding remains an
open acceptance gate.

## Data contract

`GET /api/state` returns `{schemaVersion: 1, revision, plans}`. Each plan has required `id`, `name`, `description`, `streams`, `activityTypes`, `activities`, and `issues`. The description holds up to 12,000 characters. Streams have `id`, `name`, and `description`, with optional `dependsOn` (an existing predecessor stream ID or null). There are no parallel/sequential flags or fixed resource limits.

Plans accept optional `deadline`, an exact ISO calendar date or null. Absence/null means no target; reads do not rewrite existing plans. It is independent of the calculated finish, unchanged by Activity edits and hypothetical schedules. UI Plan details and scoped MCP create/update commands use the same validation and revision owner. Clearing saves null.

An activity has required `id`, `name`, `streamId`, `typeId`, `start`, `durationDays`, `progress`, `status`, `issueIds`, and `jiraUrl`, plus optional boolean `includeWeekends`. False or omission means Monday–Friday; true includes all calendar days. Duration is the full estimate of scheduled days, 1–365, never remaining time. The inclusive planned end is the last scheduled day. Weekend starts without opt-in begin on Monday, retaining the authored date. No public holidays are inferred. Progress is an integer 0–100. Jira URLs are empty or HTTPS links; no Jira API is called.

Activities also accept optional `dependsOn` (an existing activity ID within the same stream or null). The calendar owner resolves finish-to-start dependencies: a successor starts on the next eligible day after its predecessor's full planned work, not its remaining work. Stream successors follow the last scheduled day of all predecessor-stream activities. Independent roots in a dependent stream shift as a group, preserving their normalized calendar-start offsets, with each root snapping forward over weekends if required; internal activity dependencies then resolve normally. Self references, cycles, cross-stream activity dependencies, missing targets and empty predecessor streams are rejected. Missing/null dependencies preserve manual scheduling. Authored starts are retained as fallback dates; effective schedules are derived projections, not persisted rewrites. Progress does not affect the authored estimate schedule; interrupted-work forecasts use approximate remaining effort.

Activity types have `id`, `name`, and a hexadecimal color. Issues have `id`, `title`, `description`, `scope`, `streamIds`, `blocker`, `discovered`, `open`, `descriptionIncomplete`, and `jiraUrl`, with optional `activityIds`. Scope is explicitly `ALL` with empty target lists, `STREAMS` with at least one existing stream ID and no activity targets, or `ACTIVITIES` with an explicit list of existing activity IDs and no stream targets. An empty ACTIVITIES list means no affected activities. An open blocker affects its scope; this remains the single authority for blocking and list counts. Activity `issueIds` are retained links and, when explicitly edited through a scoped activity command, specify the desired actual assignments. The command updates affected issues atomically: unlinking one activity from ALL/STREAMS narrows the issue to ACTIVITIES for the remaining currently affected activities. Other assignments, lifecycle flags and timestamps are preserved. Newly created activities follow ALL/STREAMS scopes unless explicitly excluded; narrowed ACTIVITIES scopes target only their explicit IDs. The activity editor shows actual scope membership, never stale context links. A raw workspace replacement uses its explicit issue scopes without inferring assignment changes from issueIds. References resolve within their plan; duplicate IDs within one collection fail.

Issues can also have `resolvedAt`, a timezone-aware ISO timestamp or null. Absence/null means the resolution time was not recorded, not that the issue is still open. The store stamps UTC time on a saved open-to-closed transition, preserves a recorded time while the issue remains closed, and clears it on reopening. Timestamps are scoped by plan and issue ID. Newly imported closed issues retain supplied valid historical timestamps; missing dates remain unknown. Explicit replacement imports historical state rather than inventing lifecycle events. No read-time migration or guessed dates are used.

`PUT /api/state` requires a verified editor and the full versioned workspace. Matching revisions save atomically and increment the revision; stale revisions return 409. Invalid input returns 400. Anonymous writes return 401, non-editor writes return 403, and an unavailable auth owner denies authenticated writes with 503. Mutation success is the canonical saved document returned by the store.

`PUT /api/activities` uses the same permissions, size limit, store and revision guarantees for the activity editor. Its body is `{planId, activityId, item, expectedRevision}`; activityId is null for explicit creation or the unchanged existing item ID for an update. It composes the activity edit and requested issue assignments through `WorkspaceCommands` and returns the full canonical workspace. No implicit upsert is allowed. Other editor/drag operations retain the workspace endpoint; explicit JSON import uses `/api/state/import`. Deleting a predecessor with remaining dependants is rejected; deleting an activity removes its explicit ACTIVITIES issue targets in the same save.

On a browser revision conflict, the editor closes before the latest workspace is loaded. Its unsaved draft is discarded with an explicit notice; users must reopen details and review/reapply the intended change. Closed editor forms cannot submit or delete. The browser never reuses stale form values with a refreshed revision, including when the edited item or plan was removed by another session. Drag conflicts reload canonical state without replaying the move.

The browser permits one pending mutation at a time. While its response and any conflict reload are pending, editor fields/buttons are disabled, Save displays Saving…, Escape/Cancel/Close cannot dismiss the editor, and opening another editor, resubmitting, deleting, dragging or importing is blocked. The outgoing form data is captured before controls are disabled. A finally block restores the exact prior disabled states on success, HTTP errors, malformed responses and network errors. Other browser sessions and MCP remain independent; server revision/auth checks still enforce concurrent writes. No request cancellation or draft replay is implied by this interaction lock.

Editor dialogs also close when a primary pointer press and click both occur outside their border bounds. Interior/border clicks and text-selection drags starting inside do not dismiss them or activate background controls. Editor dismissal discards the draft like Cancel and remains disabled while a mutation/conflict reload is pending. The full-block warning deliberately keeps its explicit Acknowledged/Show me the blockers requirement; neither backdrop nor Escape bypasses it.

JSON import uses `PUT /api/state/import` with the same full versioned workspace contract. It replaces all plans only after explicit confirmation. The UI replaces the file revision with the current workspace revision, using the same pending-mutation lock, conflict reload and canonical response owner as ordinary saves. The sole store compares this revision inside `BEGIN IMMEDIATE`, then validates and commits exactly once with an incremented revision. Stale imports return 409 without mutation or automatic retry. Explicit imports restore or remove valid supplied Started/Done dates, blocker tracking/history and issue resolution dates even for existing IDs, without composing new lifecycle events. Ordinary saves retain their factual-edit restrictions. Size/reference/chronology checks and final revision byte limits still apply. No obsolete schemas, implicit format migration or alternate writer are accepted. Operational import files are outside the public source and image.

Browser exports use compact UTF-8 JSON, without indentation, and reset only the exported revision to zero. This keeps valid exports within the existing one-MiB file/request limit rather than inflating them with whitespace. Import still applies canonical validation and final saved-size checks; it does not bypass revision growth or server-owned metadata limits.

Export filenames use the selected plan's trimmed name with filename-invalid characters replaced by hyphens, trailing dots/spaces removed and reserved Windows device names prefixed with an underscore. Empty/sanitized-empty names use the explicit generic filename `pocketplanner-plan.json`. Selection changes naming only: the content remains the full workspace, with all plans and no saved-state mutation.

Calendar dates must be exactly ASCII `YYYY-MM-DD` and valid calendar dates; compact and ISO-week forms are rejected rather than normalized. Every persisted ID is literal and must have no leading/trailing whitespace. Referenced IDs are compared literally; there is no trimming during persistence or lookup.

The store owns a shared one-MiB document limit measured as compact UTF-8 JSON bytes, not character count. It validates incoming documents and checks the final serialized state after server-owned timestamps and revision increments, before SQLite commit. HTTP imports/saves and MCP share this boundary. Oversized edits leave saved state and revision unchanged. Transport request limits use that same constant; a small scoped MCP command cannot grow the saved workspace past the full-document limit.

## Activity execution timing

Optional `startedAt` and `completedAt` are timezone-aware ISO timestamps. Scoped Started/Done actions default to the server's current time; explicit scoped date corrections can supply either timestamp, including through MCP. Corrections cannot be in the future and completion cannot precede the start. Ordinary workspace saves cannot rewrite existing execution facts. Explicit JSON import can restore or remove validated historical facts for both new and existing IDs under the same revision check. Missing timestamps mean Not recorded, never percentages or planned/discovery dates.

The execution editor compares actual instants, not local clock labels: unchanged dates retain their original timezone-aware timestamps, including the repeated hour when daylight saving ends. Repeated local times expose an earlier/later UTC-offset selector. A correction on the same local date retains the recorded offset if it remains a valid occurrence; otherwise the user must explicitly choose, without guessing a seasonal offset. Validation, preview and the submitted ISO timestamp share the same occurrence resolver, including half-hour clock changes. Selecting another occurrence can change the timestamp without changing the clock label. Ordinary and automatically staged dates hide the selector. Automatically staged Started/Done dates share one prospective save time in validation and preview, independent of click order; only their action flags are sent and the store stamps both atomically. Explicit corrections still undergo chronology, future-time and nonexistent-local-time checks.

Actions `started`/`done` are optional boolean inputs, never saved fields; omission leaves the lifecycle intent unchanged. Done requires 100%; a saved progress transition to 100 also records completion. A progress decrease clears completion, retaining the start. Explicit `done: false` requires a human-supplied progress below 100%, never an invented percentage. Explicit `started: false` resets progress to zero and removes both timestamps and all recorded tracking/interval facts, preserving planned dates, estimates and issue assignments. Contradictory reset/date/Done combinations fail atomically. The UI requests these changes only on Save; Cancel, conflicts and rejected validation never rewrite facts.

Corrections retain only observed blocking within the corrected actual period. Backdating a start never invents earlier intervals. Moving a start forward clips tracking and spans; moving completion earlier clips or drops later spans. A corrected completion before tracking began leaves blocking Not recorded. Extending completion never stretches old intervals. The store supplies the single timestamp validator to the execution owner and validates the resulting chronology before committing.

Optional `blockerTrackingSince` and `blockerIntervals` record blocking observed during saves after a recorded start. Each span has historical `issueId`, `title`, `startedAt`, `endedAt` (null while active). The shared issue-scope predicate opens/closes spans when blocking begins/ends, scope changes, assignments are removed, issues are deleted or the Activity completes. History remains after issue deletion and does not imply a live assignment. Maximum 1000 spans per Activity, with validated chronology. No retroactive inference from discovery dates. Every transport uses this composition inside the revision-checked store transaction; recorded fields are not MCP-editable.

Actual duration is elapsed calendar time from Started to Done, or now for unfinished work. Missing facts produce Not recorded. Recorded blocking is the clipped union of spans, counting overlapping blockers once; it is already included in elapsed time and never added again. Labels state tracking coverage. Full working/calendar-day estimates, approximate remaining scheduled days and actual elapsed time are distinct.

Activity details additionally show Blocker delay: the positive calendar-day finish difference between the blocker-aware forecast and the same forecast with blocking interruptions removed, retaining progress and dependencies. The calendar owner returns this per-Activity projection, including inherited predecessor delays and without adding overlapping issues independently. It is estimated finish slip, not the elapsed duration of a blockage or a substitute for missing recorded facts; it is never added to actual elapsed time. Duration has adjacent −/+ buttons around its single numeric input. Buttons step one full planned day, preserve the 1–365 integer limits and invalid drafts, update the preview immediately and never save without Save. Viewer and pending-save locks also cover these buttons.

## Normal blocker-aware forecast

In a continuous frame, paused days take precedence over weekend-only gaps. A paused excluded weekend carries both pause classification and a weekend marker: the red pause color takes precedence over grey weekend coloring for Activities and collapsed Streams, without changing scheduled effort or progress. Extending a blocker from Friday through Saturday/Sunday visibly extends that pause even if work still resumes Monday.

A recorded Started anchors remaining work to the actual start/reference day rather than a later authored start. Actual Activity/Stream predecessor constraints still apply; unchanged full estimates remain available separately. Stream frames aggregate each member's available work after its own pauses: a day is paused only when no member can work and at least one member is paused within its frame. Independent work, opted-in weekends and recorded completed ranges therefore remain visible despite another member's blocker; summary progress uses available scheduled days.

Recorded completion does not switch summary progress to the elapsed calendar span. The calendar owner counts the union of available scheduled and actual-range days, excluding each member's own pauses, non-working weekends and idle gaps. Overlapping members count once and opted-in weekends count as work. Range arithmetic keeps long actual histories bounded rather than allocating one entry per elapsed day; clipping preserves the full-frame progress position.

`domain/schedule.forecast` derives the normal timeline from authored starts/full estimates, issue scopes and blocking history. Every affected open blocker lasts through the supplied reference calendar day inclusive; predicted resumption is no earlier than the following day, snapping over excluded weekends. Recorded resolution/start/completion timestamps map to the viewer's local calendar, consistently with today's line and actual-time labels; calendar-string arithmetic remains UTC to avoid daylight-saving day-length errors. Known ended Activity blocking intervals are retained even after unlinking/deletion. No missing resolution date is guessed. Overlapping intervals are combined as calendar constraints, never added as independent delay totals. Existing dependency and approximate remaining-effort rules are shared with What if. Completed tasks with a recorded completion use that actual end and the known actual start; without completion facts they retain the estimate frame. Known completed pause annotations do not move completion. Long actual frames are evaluated only within the visible calendar window, not expanded into unbounded day arrays.

The forecast is not persisted. Authored estimates remain the reference for overdue checks and estimate details. Editors preview the same derived dependency/blocker dates; actual elapsed/blocked time still uses server timestamps and interval unions, not these whole-day assumptions. Normal and What if forecasts call the same engine: an optional `{issueId, endDate}` changes only one open blocker's inclusive end, without adding already-counted delays again. A calendar-day rollover refreshes the derived schedule when drafts, saves and drags are unlocked, recalculating a valid assumption or explicitly rejecting a date now in the past. It never rebases a draft. Persisted revisions remain unchanged.

## Authentication

`POCKETHIVE_AUTH_BASE_URL` explicitly selects the PocketHive auth service through its public ingress, including `/auth-service`. No protocol/provider fallback is used. Every authenticated mutation resolves the bearer token at `GET /api/auth/me`; active username `local-admin` is the editor policy. PocketPlanner has no user or password database and does not decode or trust unverified token claims.

`POCKETHIVE_ALLOW_REMOTE_HTTP` is `false` by default: public verification and
logout addresses returned by PH must use HTTPS or loopback HTTP. Set it to
`true` only for an explicitly approved remote HTTP issuer. PP passes that
permission to the shared client; it never infers permission from a URL.
The server-side auth base may remain an internal HTTP ingress independently.

Authentication requests never follow HTTP redirects, including same-origin redirects. An unexpected redirect fails closed with 503 before sending a bearer token or login body to a redirect target. Configure the canonical auth ingress directly, including the intended HTTP/HTTPS scheme and path.

`GET /api/session` returns the access projection. PH Auth's registered
`pocketplanner-device` client uses callback-free device authorization. The actual
shared `@pockethive/browser-auth` library owns opening PH's confirmation tab,
bounded polling, tab-local token/session storage and sign-out. Planner supplies
its product storage key, `POCKETPLANNER_AUTH_SESSION`, and consumes the library's
authenticated fetch; product code neither reads tokens nor implements OAuth.

`POST /api/session/device/start`, `/device/poll` and `/logout` adapt requests
through the shared JVM device client. There is no `/auth/callback`, code exchange,
PP callback registry entry or port-specific return URL. Restarting a PP preview
on another port requires no PH callback reconfiguration. PH's configured public
confirmation URL must still be browser-reachable; internal service reachability
alone is not proof. UI controls mirror permissions; fresh server access checks
remain authoritative. Tokens never enter SQLite, URLs or source. See the
[browser SSO contract](POCKETHIVE_INTEGRATION.md#browser-single-sign-on).

Read-only access is the default, including when auth is not configured. The PocketHive DEV login is intended for the same trusted development environment as PocketHive; production identity changes must be implemented at its owner and adapted explicitly here.

## Application version

`VERSION` contains the running application version, including an explicit `-dev` suffix for pending work. `VersionInfo` fails startup for a missing/invalid value. Public `GET /api/info` returns `{name, version}` without reading or changing the workspace. MCP initialization reports the same version. The browser displays this metadata as a muted top-bar label; a metadata-fetch error shows Version unavailable rather than an invented version, without preventing access to the plan. Image publication uses VERSION for its OCI version label and rejects release tags that do not match `v` plus that value. The OCI revision label remains the source commit SHA. `CHANGELOG.md` keeps pending changes under Unreleased until an explicitly requested release.

## Presentation and deployment

`GET /api/events` is a public, read-only SSE stream under the same viewing policy as workspace reads. `revision` events carry `{revision}`; `unavailable` events indicate an observation failure without exposing diagnostics. One observer reads committed SQLite revisions every 0.5 seconds, including UI saves, explicit imports and MCP commands. Each subscriber has a one-item latest-notification queue, at most 128 streams are accepted, and comment heartbeats are sent every 15 seconds. Reconnects receive the latest observation, not an event history. The stream sets `X-Accel-Buffering: no` and no-store headers; ingress must allow unbuffered long-lived responses. Disconnects release subscriptions. Application shutdown bounds graceful HTTP draining.

Browsers fetch canonical state after a newer revision, ignoring duplicates and snapshots older than a newer local save. Editor-open, drag and pending-save locks defer refreshes; editor revisions remain attached to their drafts. Closing/finishing resumes refresh. Existing stale-save conflict handling remains unchanged. View selection, filters, calendar placement and collapse state are preserved where valid. Offline/error states are visible; browser reconnection and failed-snapshot retry recover missed changes. No credentials travel through the event stream.

What if is a local, read-only assumption for one active blocker's actual scope. The panel contains only a blocker selector and Assumed blocker end, with a calendar and adjacent ±1 day controls. End defaults to today and must be today through 365 calendar days ahead, inclusive; blocking includes the selected day, with resumption on the following eligible day. Discovery/start of blocking, scope and every other blocker stay unchanged. The same single timeline shows the resulting forecast; there are no parallel comparison lanes or duplicate task frames. Completed tasks and unrelated work remain fixed. Not-started affected work moves after resolution, with Activity/Stream dependencies cascading and weekend settings respected. In-progress work retains its known actual start or estimate anchor and past planned work; future effort is approximated as ceil(full estimate × (100 − progress) / 100) scheduled days. Saved Started at 0% also counts as in progress. Percentage-to-effort is approximate, not execution evidence. One continuous frame contains solid grey non-working weekends and red blocker/waiting sections, without letters or hatching; names stay anchored to the frame's start. Controls update immediately without a Preview button; Return to plan clears the assumption. Drag is disabled while a valid assumption is displayed; nothing is saved. New revisions recalculate against canonical state while preserving the selected blocker/date; a closed/removed blocker requires an explicit new selection rather than silently choosing another. Summary delay and deadline margin/overrun use calendar days. Journal evidence for recorded Activity starts remains deferred.

The same Java process serves HTTP, the website and `/mcp` Streamable HTTP.
Backend dependencies belong to `backend/pom.xml`; frontend inputs belong to its
package manifest/lockfile. The official Java MCP SDK owns discovery, negotiation,
tool schemas and stateless servlet framing. Stateless transport never retains a
client identity or permission between requests.

MCP reads follow the public view-only policy. Every mutating call resolves the bearer header through the same fresh `PlannerAccess` owner as HTTP writes. No token is accepted as a tool argument or persisted. Scoped commands require an integer `expected_revision`, read a plan by stable ID, compose only the specified edit, and save through `WorkspaceStore`; its transaction rejects a racing HTTP or MCP writer. Patchable fields belong to the command contract, while persisted-data validation stays in the store. IDs, collections, and `resolvedAt` cannot be patched. Create rejects existing IDs instead of silently upserting. No MCP deletion or bulk replacement tool is exposed.

MCP uses a one-megabyte request limit. Host/Origin checks remain enabled with localhost defaults; remote addresses and browser origins require explicit `POCKETPLANNER_MCP_ALLOWED_HOSTS` and `POCKETPLANNER_MCP_ALLOWED_ORIGINS`. This is a trusted-environment bearer integration, not a new OAuth issuer or an unattended service-account system. TLS and a future Rovo credential/approval contract must be provided explicitly, not inferred.

The viewport contains bounded Plan, Issues, Streams, Types, Data, and Plans panels. Calendar windows are 7/14/21/28 days with explicit navigation. Plan selection and calendar placement communicate timing. There is no resource scheduling engine.

Timeline stream headers toggle their activity groups using keyboard-accessible buttons with expanded state and controlled group IDs. Overall progress remains visible when collapsed and includes every activity in the stream, independent of the calendar window. Activity bars use one continuous calendar frame; excluded weekends are grey and blocker/waiting periods red. Enabled working weekends keep the Activity's color. Activity and Stream names stay at the frame's start, not a future work segment. Progress fills scheduled work, not those gaps. Collapsed streams retain one frame with the stream name, grey excluded weekends and marked pauses. Their work/progress projection uses the union of scheduled days and preserves explicit weekend work. Summary fill uses aggregate progress across that union, not an execution-history claim. Empty streams have no summary bar or numeric percentage. Dragging an independent activity frame moves the whole activity, keeps the full duration and weekend option, recalculates dependent schedules. Auto-scheduled activities instead have read-only projected starts and cannot drag independently; clear the dependency or move the predecessor. Dependency arrows and tooltips identify auto-scheduled activities/streams. Weekday-only drops on Saturday/Sunday snap forward to Monday; opted-in activities can start on weekends. Collapse state is presentation-only, scoped to each plan for the current page visit; viewers can toggle it without auth or workspace writes.

Activity details show reversible Started, a synchronized 0–100 slider, native numeric stepper and reversible Done in one row. Active states expose editable Actual start/finish local date-time inputs. Unedited automatic dates are stamped by the server on Save; explicit corrections are converted from the viewer's local calendar to timezone-aware ISO timestamps. Invalid/future/nonexistent local times and reversed dates block Save. Undoing Done clears completion and asks for progress below 100%, retaining the start. Undoing Started stages the zero-progress/full-execution reset. Save persists, Cancel discards. Viewers and pending saves cannot change these controls. Full estimate/planned finish, projected finish/approximate remaining work, actual elapsed calendar days and recorded blocking are separate values. Projection includes normal known blocking; What if changes the selected blocker's expected end. Recorded completion frames cannot be dragged to alter factual timing.

Timeline activity names indent by their activity-dependency depth within the stream; siblings share a level and chained successors indent further. Indentation is bounded to keep narrow labels readable and affects neither row order nor dates, bars, percentage alignment or saved state. Stream-level dependencies alone do not indent activity names.

Activity status/description is limited to 1,000 characters in the store and uses maxlength=1000 in the editor. Stream and issue descriptions keep their 2,000-character limits; plan descriptions keep 12,000. Browser maxlength counts UTF-16 code units, so non-BMP text can reach the browser limit sooner than the server's Unicode code-point count; browser input never exceeds the server limit.

Issue lifecycle actions explicitly close or reopen an issue and submit the validated current form through the existing mutation contract. Save and the normal Enter shortcut retain the current lifecycle state; Cancel discards unsaved edits. An explicit lifecycle action supplies its target in the validated issue draft; the canonical persisted status remains the boolean `open`. The lifecycle button is not the default submit action, so Enter cannot inadvertently close or reopen an issue. Viewers cannot submit lifecycle actions. The Issues list defaults to Active and can show History; the blocker classification filter works within either status view. The full-block warning's blockers action always selects Active. `descriptionIncomplete` is informational only: its checkbox sits beside Description and adds an `incomplete` list label, without changing dates, progress, or blocker scope/effect.

List blocker classification and affected-stream scope are noninteractive labels. Only the issue title opens its details; blocker and scope changes are made inside that editor. Closed issues show their resolution date/time in the list and details, formatted in the browser's local timezone with the saved timestamp available in the tooltip. Older closed records without timestamps show Not recorded.

Blocked unfinished activity rows pulse red; stream headers pulse when at least one unfinished activity is blocked. Only when every unfinished activity of the active plan is blocked does entry display the animated `BLOCKED!` dialog. Acknowledgement is local to the current page/plan visit and does not resolve issues. The blockers action dismisses the dialog and filters Issues to open blockers. Reduced-motion mode uses a static warning and tint.

The actual `@pockethive/ui/styles.css` package owns shared shell tokens,
typography and responsive layout. `frontend/src/product.css` owns only Planner
content such as calendar frames, editors and blocker warnings; runtime rows have
their focused stylesheet. Do not copy the shared token/shell engine. Brand assets
follow the PocketHive Press Set; authored activity-type colors remain editable data.

The PocketPlanner wordmark uses the same typography declaration as the PocketHive and HiveForge source logos: Inter, Segoe UI, Arial, sans-serif; weight 800 at 76px for the name and weight 500 at 26px for the subtitle. The approved `simple test plan` subtitle spans the full name width. `frontend/public/pocketplanner-topbar.svg` is the compact header asset without a subtitle; `frontend/public/pocketplanner-logo.svg` retains the full large-logo variant for README/documentation; `frontend/public/pocketplanner-mark.svg` is the favicon.

Full-logo mark height and text placement follow the PH/HF coordinate proportions:
name at (260,148), subtitle 34 units below. SVG text fitting adjusts spacing only,
never glyph width; the compact asset uses the same undistorted wordmark.

SQLite has one workspace writer and survives container updates through mounted storage. Deploy one replica. HiveForge renders a Swarm stack and owns its execution; durable state lives outside replace-managed artifacts. Plans keep stable IDs for the implemented PocketHive association contract.

The [PocketHive integration contract](POCKETHIVE_INTEGRATION.md) covers many-to-many run associations, live Plan/Execution/Mixed projections and exact-run Start/Stop. The [live DataSet design](DATAPROVIDER.md), agreed on 2026-10-17, uses existing PH Redis list IO: Providers remember created accounts/cards outside Redis and add records live; Executor generators pop suitable records, and Post Processor routes reusable records to the configured next list. Empty source lists leave generators waiting with their swarms running.

The [Redis contract](DATASET_LIFECYCLE_CONTRACT.md) keeps existing list IO without additional record states, a new return protocol or mandatory per-record identifiers. A DataSet is a named group of Redis lists; additional reserved keys hold its common field names/types and planned per-swarm insert/take observations. Scenarios require subsets and return full records with unused fields intact. Usage timestamps are diagnostics, not current-membership or ownership guarantees. Optional recordId-to-swarm tracking is deferred. Recovery is an operator procedure: stop affected work/publication, clean affected queues, clear the DataSet namespace, restore format/data from producer inventory and resume. It does not recreate SUT resources, reconstruct partial state or promise lossless/exactly-once recovery.

The planned [separate SUT/DataSet tool](DATAPROVIDER.md#global-sut-and-dataset-selection) manages shared definitions, not Scenario Manager or PP. Select SUT first, then one of its DataSets. PH executes with the resolved configuration and PP remains the planning/control owner; neither owns a competing editable catalogue. Providers or external scripts can create/populate a DataSet and publish its Redis format metadata without a registration API. Tool selection/configuration and IO usage observations require future integration, separately from the existing Redis record loop. No tool, selector, metadata writer or tracking implementation is delivered here.

PP owns planning and additional authorized control with bounded observations, never record processing or a card database. The [first-stage plan](LIVE_DATASET_STAGE1.md) covers scenario configuration, Provider preparation, later PP views/control and qualification. No runtime module, API, persisted schema or recovery automation is added here. Active-phase selection, journal-start evidence and requirement-document references remain deferred. Percentages and Started/Done stay operator-controlled.

The Dockerfile builds React using Node 22 and tests/packages Java using Maven
with Java 21, then copies only the application JAR into a Temurin 21 JRE image.
Runtime UID/GID is 10001, the writable persistent path is `/data`, and curl checks
`/health`. Container policies may make the root filesystem read-only with
writable `/tmp`; SQLite still needs its mounted data directory. Build caches,
source, test fixtures and npm/Maven tooling are not runtime services.
Rebuild refreshed base images and scan the actual resulting image. A build pass
or dependency audit does not imply all image vulnerabilities are fixed.
