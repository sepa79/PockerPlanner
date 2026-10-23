# PocketHive integration design

The first integration was introduced on PH branch `codex/pocketplanner-integration` and is included in local PP release 0.2.3. PocketPlanner is the master for planning. PH consumes its catalogue and owns run-to-Activity association metadata; PP reads those associations without a second persisted execution database. Actual Activity dates use the existing Planner lifecycle controls. Requirement documents, journal evidence on starts and agent execution automation remain deferred. Registry publication and remote deployment remain separate actions.

The Java/React implementation preserves the catalogue, linked-run, runtime and
exact-run control contract. Catalogue reads use the sole Java store; the actual
shared JVM client checks PH identity freshly. PH calls use an explicit fixed
ingress, five-second total exchange bound, eight-MiB response cap, no redirects
and no automatic retries. Runtime observations are never persisted as plan facts.

The local Docker image build passes 219 React and 621 Java tests; 14 deployment
configuration checks also pass. Isolated Compose browser/save/recreation checks
pass with real PH Auth and synthetic run controls. A separate real local PH test
verifies CREATE with Plan/Stream/Activity, a second Activity association, exact-run
journal data HTTP 200 without another credential entry, and actual Start/Stop
from PP. Canonical planning state and revision stay unchanged. Its owned swarm
targets only local WireMock, with no payment-system traffic or Redis mutation.
Desktop forwarded-preview login/restart remains unverified.
This implementation is included in local PP release 0.2.3; current qualification
is in [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). Registry publication,
PH upgrades and remote deployment remain separate actions.

## First integration: current contract

- PP `GET /api/integration/catalogue` requires an active PH session and returns `{schemaVersion:1, instanceId, revision, plans}`. Each plan contains `id`, `name`, `testPlan`, `streams:[{id,name}]`, and `activities:[{id,name,streamId,tag}]`. It projects one canonical workspace snapshot and never modifies it.
- Set a stable `POCKETPLANNER_INSTANCE_ID` (1–40 ASCII letters/digits/underscore/hyphen). `testPlan` is exactly `pp:<instanceId>:<literal plan ID>`. The Activity tag is `pp.activity:` followed by unpadded base64url of the full SHA-256 digest of compact UTF-8 JSON `[instanceId,planId,activityId]` (no ASCII escaping). It is 55 ASCII characters, even for 80-character Unicode IDs. Names and current Stream membership are not identities. Do not change instance ID when restarting or moving the same deployment.
- PH is configured with `POCKETHIVE_PLANNER_BASE_URL`, a fixed operator-controlled PP base URL. Its authenticated `/orchestrator/api/planner/catalogue` proxy forwards the caller's bearer session only to that destination and never follows redirects. There is no service credential granting editors extra PH access.
- PH validates a selection `{instanceId,revision,planId,streamId,activityId}` against the fresh PP catalogue; changed instance/revision returns 409, invalid membership 400. PH never accepts browser-supplied `testPlan` or tags as validated associations.
- PH `POST /orchestrator/api/planner/validate` preflights a creation selection. `GET/POST /orchestrator/api/planner/runs/{swarmId}/{runId}` reads/appends associations for that exact historical run. Read requires PH deployment-read permission; preflight/assignment requires deployment-management permission. PostgreSQL journal is required for run operations.
- On CREATE, selecting a plan is explicit and optional; an unplanned run is not a failed-integration fallback. With selection enabled, a failed preflight prevents CREATE. After acceptance, PH UI waits for the same canonical CREATE operation to succeed, then saves its exact run reference. Association failure is shown as partial success; **Retry association only** never repeats CREATE. Leaving the dialog does not undo an accepted command. Existing runs expose the same picker in their runtime snapshot so later phases append Activities without recreating the run.
- The PH metadata owner serializes appends and generic replacements under the same database row lock. It preserves notes and unrelated tags, adds each tag once, rejects a different existing testPlan and fails explicitly at 32 tags/64 UTF-16 units without discarding references. Generic metadata editing cannot invent, remove or change Planner-owned references. One run belongs to one Plan and can reference many Activities, including different Streams. An Activity can have many runs.
- PP `GET /api/integration/runs?planId=<id>` requires an active session, calls the configured `POCKETHIVE_BASE_URL` public ingress with that same session, and filters by the canonical plan reference and Activity tags. `POCKETHIVE_PUBLIC_URL` supplies browser journal links. Each link includes the exact swarm and run IDs; no latest-run substitution occurs. Deleted Activities remain unresolved references, not guessed matches. The PH 5,000-run listing cap is explicitly reported. No runtime status, progress or success is inferred from a journal summary.
- PP Activity/Stream/Plan details expose expandable **PocketHive runs**. Runs are loaded only on expansion; anonymous viewers cannot fetch protected PH data. A PH outage remains an explicit error and does not hide saved planning state or erase associations.
- Association does not imply Started, Done, percent changes, issue resolution, parameter updates or a new schedule. No operational data is copied for testing; use isolated PP and PostgreSQL databases.

### Plan / Execution / Mixed

The collapsible left rail offers three presentation modes and remains available
across tabs. Plan has the full planning menu; Execution has Swarms/Issues; Mixed
has Overview/Issues/Streams. Switching mode opens its main view, retaining plan,
calendar placement and Stream collapse; hidden tabs are excluded from keyboard
navigation and cannot remain selected. There is no extra row above the calendar.
Plan keeps the existing schedule and What if. Execution uses expandable rows:
Stream → Activity → exact runs, with observed PH state/load separate from manual
PP progress. Current runtimes include registered Stopped swarms; historical runs
are an explicit opt-in. Mixed keeps one frame per task and attaches current run
rows to that Activity. Collapsed Streams retain deduplicated run summaries. Mode,
calendar placement, history choice and row expansion are presentation state only.
A run shared by Activities appears as a labelled association under each Activity,
not multiple executions or proof of active phases. No phase is inferred from tags,
percentages, Started/Done or journal timestamps. Generator TPS sums only fresh
reported generator workers of that exact run; missing/stale values are unknown,
not zero, and processor/postprocessor throughput is not added again.

The agreed future extension is the [live DataSet model](DATAPROVIDER.md): PH
Provider swarms add Redis records live, Executors use eligible Customer/Product
Class data, and Post Processor decides its next disposition through shared PH
Redis adapters. Providers retain their created-resource inventory independently
of Redis and own repopulation. PP owns planning, bounded observations and additional
authorized control, not a separate provider service or record processing. A
shared DataSet does not imply a shared mix. Changes must show all affected exact
runs and reject stale configuration/binding confirmation. The
[first-stage plan](LIVE_DATASET_STAGE1.md) is documentation only; the existing run
association and execution-row integration does not implement this lifecycle.
The [simple Redis circulation contract](DATASET_LIFECYCLE_CONTRACT.md) describes
the current PH list pop/transaction/push loop and operator clear/refill recovery.
That loop requires no additional record states, new return protocol or per-record
DataSet identifier. Swarms already have their configured Redis sources/destinations.
The planned [SUT/DataSet selection](DATAPROVIDER.md#global-sut-and-dataset-selection)
uses definitions managed by a separate tool: choose SUT, then one of its DataSets.
PH consumes the binding rather than owning another editable catalogue. A DataSet
is a named Redis list group, creatable by PH Providers or external scripts without
a mandatory registration call. Format metadata in Redis defines common field
names/types; Scenarios require subsets and preserve unused fields on return.
Planned IO usage timestamps are observations, not record ownership or proof that
a swarm remains active. Optional recordId tracking is future work. No REST, MCP or
WorkItem fields are implemented here; PP planning facts and PH run identity stay unchanged.

`GET /api/integration/execution?planId=<id>` requires a verified PH session. It joins
the existing exact run references with `GET /orchestrator/api/swarms` and the caller's
`GET /orchestrator/api/access/swarms` projection. Only matching swarm AND run IDs
receive a runtime observation. Historical/unregistered runs have no current runtime;
errors and stale observations are explicit, not an empty list or a Running claim.
The browser polls every five seconds while a runtime view/panel is visible or a
lifecycle command is pending in the visible workspace;
failed refreshes retain visibly outdated data and disable commands.

The swarm side panel shows identity, linked Activities, observed/intended workload,
controller, health, observation time and reported worker TPS. It offers only Start
and Stop, not Create/Remove/config editing. PH remains the permission and lifecycle
owner. `POST /api/integration/control` accepts exactly `{planId,swarmId,runId,action,
idempotencyKey}`; action is start or stop. PP verifies the exact saved association
and forwards the caller's session to PH's exact-run lifecycle endpoint. PH rechecks
the run identity at canonical command admission. `GET /api/integration/operation`
requires planId, swarmId, runId and correlationId; it reads only that exact operation.
Acceptance is pending, not success: the panel follows PH's authoritative terminal
operation, supports retrying an uncertain submission with the same key, and never
automatically repeats a command with a new key. Stop requires explicit confirmation.
All runtime actions leave PP revision, %, Started/Done, estimates and issues unchanged.

### Local configuration

PP: `POCKETPLANNER_INSTANCE_ID`, `POCKETHIVE_AUTH_BASE_URL`, `POCKETHIVE_BASE_URL`, `POCKETHIVE_PUBLIC_URL`. PH Orchestrator: `POCKETHIVE_PLANNER_BASE_URL`.
Internal URLs must be reachable from the calling container, not just from a browser. Both applications use the same PH auth owner. Hostnames and ports are explicit, not inferred from laptop names or arbitrary request URLs. Only the configured PP instance is supported in this first integration.

### Browser single sign-on

`POCKETHIVE_ALLOW_REMOTE_HTTP` is `false` by default: public verification and
logout addresses returned by PH must use HTTPS or loopback HTTP. Set it to
`true` only for an explicitly approved remote HTTP issuer. PP passes that
permission to the shared client; it never infers permission from a URL.
The server-side auth base may remain an internal HTTP ingress independently.

PP uses PH Auth's registered `pocketplanner-device` client and the actual shared
`@pockethive/browser-auth` package. Sign in opens PH's device-confirmation tab;
after approval, bounded polling through PP's backend completes sign-in in the
original PP window. The shared JVM `auth-client` owns protocol transport. PP has
no local username/password form, callback endpoint, PKCE exchange, callback client
registration or browser-port return setting.

A PP preview can restart on another origin/port without editing PH callback
configuration. This does not eliminate network configuration: the fixed PH Auth
ingress must be reachable from the PP backend, and PH's advertised public
confirmation URL must be reachable from the browser. Do not derive trusted PH
destinations from arbitrary Host/forwarded headers or introduce wildcard
callbacks to repair connectivity. Keep developer-specific endpoints in ignored
local configuration, not committed source.

PP remains publicly view-only until Sign in is selected. It receives its own
bearer token from the PH identity owner; the shared library owns its tab-local
session and authenticated fetch. PP and PH do not copy tokens between products,
share an application credential store or place tokens in journal links.
Each application still enforces its own permissions. Fresh active local-admin
identity permits PP edits; PH separately authorizes journal reads/run control.

A linked PH journal preserves the exact path, swarm and run ID. PH owns its own
browser session/authorization flow: it waits for session restoration and, if
needed, uses PH Auth's central HttpOnly browser session. An existing central login
should avoid another username prompt, although device access confirmation remains
explicit. PH's own browser-client callback configuration remains PH's concern;
it is not a PP callback requirement. Test the actual linked anchor and returned
journal request with a bearer header, not just an anonymous page shell or a 200
HTML entry. An unreachable journal backend must be reported as an explicit gap,
not successful end-to-end journal verification.

Sign-out revokes the current PP token through the shared device client and
provides PH's validated central logout URL. Central sign-out remains CSRF
protected. Other already issued tool tokens retain their explicit validity
unless PH revokes them; this is not immediate global single sign-out. Expired
tokens can still be submitted for revocation without restoring an active identity.
No token, verifier, device code or user session is persisted in Planner SQLite.

### Verification scope

`tests/react-planner.browser.cjs` uses an isolated JAR/database, actual PH device
confirmation and owned synthetic PH observation/control responses. The earlier
local pass covers sign-in, central session reuse from another tab/PP port,
anonymous viewing, editor/live/conflict behavior, reversible manual timing,
desktop/mobile layout and restart persistence. The Java suite also covers bounded
PH requests, exact-run joins, correlation-specific outcomes and denied access.

The Compose mode (`POCKETPLANNER_TEST_CONTAINER_IMAGE`, with the selected existing
QA `POCKETPLANNER_TEST_PH_NETWORK`) also verifies non-root/read-only runtime,
health, capability drops and isolated volume persistence after recreation. Its
actual PP journal anchor opens PH, retains the exact swarm/run and sends a PH
bearer header without asking for credentials again.

`tests/pockethive-live.browser.cjs` separately verifies a real PH CREATE through
the UI picker, persisted testPlan/Activity tags, a second linked Activity, journal
data HTTP 200 and Start/Stop from PP. It compares the complete canonical workspace
before/after runtime operations and removes only its exact owned swarm through
PH. The scenario is `artemis-rest`, SUT `wiremock-local`; no payment-system target
or Redis writes are involved. Nine focused PH catalogue/association tests also
pass. This is not full PH regression or load/performance qualification.

For this acceptance, first build the local Java image. Start the QA stack from
the PH integration worktree using its canonical `build-hive.sh`, with explicit
service selection (never a full-stack cleanup):

```sh
COMPOSE_PROJECT_NAME=pp-ph-integration \
POCKETHIVE_COMPOSE_OVERRIDE=/absolute/path/to/TestPlanner/tests/compose.pockethive-integration.yaml \
POCKETHIVE_PLANNER_BASE_URL=http://planner:8765 \
POCKETPLANNER_IMAGE=pocketplanner-local:dev \
./build-hive.sh --quick --service orchestrator --service scenario-manager \
  --service network-proxy-manager --service wiremock --service tcp-mock-server \
  --service planner
```

The override isolates PostgreSQL, ClickHouse and broker volumes from earlier
local stacks; it does not clear Redis. One runtime-root anchor supplies both
service configuration and host bind mounts, including generated worker mounts.
Explicitly starting `planner` is required for this test; PH startup does not
implicitly depend on PP. Then, from this repository:

```sh
POCKETPLANNER_LIVE_QA_ORIGIN=http://localhost:8774 \
POCKETPLANNER_LIVE_PH_ORIGIN=http://localhost:8089 \
POCKETPLANNER_TEST_PLAYWRIGHT=/path/to/playwright \
POCKETPLANNER_TEST_BROWSER=/path/to/chrome \
POCKETPLANNER_TEST_ARTIFACTS=/tmp/pocketplanner-real-ph-qa \
node tests/pockethive-live.browser.cjs
```

These explicit loopback origins must point to the dedicated QA deployments.
The test refuses a workspace not matching its own synthetic fixture. Do not
point it at a working Planner. After testing, stop only the QA `planner` service
and use the same scoped PH startup to restore `POCKETHIVE_PLANNER_BASE_URL` to
the intended primary Planner's Docker-network URL. Do not remove other swarms,
clear shared Redis or delete existing volumes.

The desktop application's forwarded origin has not been verified. Target-system
load correctness and performance are outside these checks. Use only synthetic
plan/run fixtures and explicit QA volumes for mutations. Do not export/copy/
replace a working plan or present historical checks of removed implementations
as current acceptance.

## Ownership

PocketPlanner owns plans, streams, activities, their planned schedules and recorded actual start times. PocketHive owns scenario runtimes, run identity, parameter changes and execution evidence. The requirement-document application owns requirement content and its JSON exports; Planner stores document references, not another copy of the requirements.

The integration must preserve these owners and existing permissions. A Planner editing session does not grant permission to control PocketHive. Agents use the authorized APIs of each application; no direct database writes, shared credential store or authentication bypass is introduced.

## Scenario and run identity

- `scenarioId` identifies the scenario definition using `id` from `scenario.yaml`. The CREATE request calls this `templateId`; the journal records it as `scenarioId`. It is not the display name or a filesystem path, even when a bundle directory uses the same name.
- `swarmId` is the runtime swarm name used to address and control it, not a container ID.
- `runId` is the UUID assigned when a new swarm runtime is created. Stop/start of that existing swarm retains the run identity. Removing and creating another swarm produces a new run ID, even with the same swarm name. Retrying the same CREATE operation with its idempotency key is not a new run.

A scenario is not permanently assigned to an activity type. One long-lived run can serve several Activities as the operator changes parameters over time, and one Activity can use several runs. The relationship is many-to-many. A run reference includes the configured PH instance, swarm ID and run ID; scenario ID provides context, not the execution identity.

For example, a synthetic ten-day run may be used for Minimal, Background and Heavy without creating a new swarm for each Activity. This does not make every linked Activity ten days long or establish that all three ran simultaneously.

## Initial metadata mapping

Use the existing PH `testPlan` field for plan context and Activity tags for the initial association, rather than adding new PH metadata fields immediately. Tags identify concrete Activities by stable ID, not a type label such as `Heavy`. Stream membership is derived from each Activity within its selected plan.

Retain tags for previously associated Activities when another Activity uses the run. These tags mean "this run was used for these Activities", not "all these Activities are currently running". They do not record phase boundaries, parameter history, completion or results.

Outside the integration endpoint, PH still accepts free-text test-plan labels for unlinked runs. Planner references use the current contract above; renames and duplicate names never silently change associations.

The current PH tag normalizer truncates tags to 64 Java string code units and keeps at most 32 distinct tags. Planner IDs can have up to 80 characters before a tag prefix is added. The integration must validate the complete tag and total tag count before writing and reject unsupported mappings explicitly, never truncate IDs or remove unrelated tags to fit.

The generic run metadata endpoint replaces operator fields; Planner assignment instead uses the atomic append operation above. It never composes a blind read/replace of notes or unrelated tags. A stale generic edit that would remove a newly appended association fails, rather than overwriting it.

## Actual Activity start

Keep the existing planned start and dependency-derived schedule separate from **Started at**, the existing recorded actual start date and time. Schedule moves and run associations must not rewrite it.

An operator or authorized agent can record an Activity start. Later parameter changes, additional run associations and retries do not reset that start. A tag alone, a scenario launch or a configuration edit alone is not proof that the Activity began. Actual starts do not automatically change the planned duration, dependency schedule, percentage, blocker state or completion.

## Optional journal evidence

An actual-start record may include a reference to PH journal evidence. It remains valid without a reference, including for a manually recorded start.

The paginated PH journal currently exposes `eventId`, `timestamp`, `correlationId`, `swarmId` and `runId`. An evidence reference must also identify the configured PH instance; an event ID is not a global identity. Use the correlation ID and exact runtime context to find the relevant confirmed operation, not a guessed nearby event or a page cursor alone.

A successful parameter-change event can support an intentional transition to a new Activity. It must not cause every configuration change to start another Activity. The timestamp of sending or accepting a command is not the actual-start timestamp; even a successful configuration change can occur while workload processing is paused.

PH retention can remove older journal entries. Planner keeps its recorded start and association independently and shows unavailable evidence explicitly, without inventing a replacement event. Archive lookup, stable event addressing and an appropriate journal UI link remain implementation details to verify; no automatic pinning or journal copying is authorized by this design.

## Agent workflow

1. Resolve the intended PH instance and exact run, then select the Planner plan, stream and Activity using stable IDs. Read current state and obtain the permissions required by each application.
2. Submit the authorized parameter change to PH with an idempotency key. Retain the returned operation identity and correlation ID.
3. Wait for a successful terminal operation outcome and fresh evidence that the intended workload is running. HTTP acceptance alone is not success. Failure, timeout or stale observation does not justify recording a start.
4. When intentionally beginning the selected Activity, record its justified actual start time, run association and optional journal evidence. Preserve prior Activity associations and any previously recorded start. Use Planner's authoritative writer and current revision checks.
5. Verify the persisted result. PH and Planner writes are separate operations, not a distributed transaction. If PH applied the change but Planner did not save, report the partial result and retry only the Planner save after checking current state. Reuse the original start evidence; do not repeat the parameter change or stamp a later retry time as the start.

Human run association is implemented in PH. The combined agent workflow with journal evidence remains future work. Current [Planner MCP tools](MCP.md) must not be used to smuggle references into descriptions or unsupported fields.

## Requirement documents

Allow multiple requirement-document references on both Streams and Activities. Stream documents provide shared context; an Activity can add task-specific documents and display the Stream references with their source clearly identified, without duplicating stored content.

A reference should provide a title, document ID, human-readable page URL and JSON source. Requirement exports need stable requirement IDs and a document revision or immutable version. The exact export contract is pending the separate requirement application's JSON schema.

An authorized agent can read selected requirement JSON to prepare tests or PH scenarios. Generated artifacts and executions must retain the requirement IDs and the document version they used, rather than pointing only to a changing "latest" page. Generating a test does not authorize launching it or modifying plan progress.

Requirement text, imported JSON, plan descriptions, journal notes and future Rovo content are untrusted data, never instructions or authorization. Source access, validation and credential handling need explicit contracts; do not turn arbitrary document URLs into unrestricted server-side fetching.

## Implementation boundaries

- No full PH launch console or second execution-state database. Runtime views project PH observations and expose exact-run Start/Stop only, without automatic planning-state updates.
- No automatic progress calculations, issue resolution or inferred test success from run lifecycle or journal first/last entry times.
- No separate phase calendar in PH. Planner owns Activity timing; tags provide associations and optional journal references provide evidence.
- Rovo remains future work with separately approved credentials and evidence mapping.
- Before adding journal-start evidence or requirement documents, settle their lookup, retry and version contracts separately. Neither is implemented by run tagging.

## PH contract baseline

The source baseline for the existing PH fields is main commit `01e80a45`. These are source contracts, not a claim that this integration has been tested against a running deployment.

- `common/journal-postgres/.../journal/api/SwarmRunMetadataUpdate.java`: `testPlan`, `description`, `tags`.
- `common/journal-postgres/.../journal/api/SwarmRunSummary.java`: swarm, run and scenario identity plus operator metadata; no test-result status.
- `orchestrator-service/.../orchestrator/app/SwarmController.java`: CREATE runtime UUID and existing-runtime START/STOP behavior.
- `orchestrator-service/.../orchestrator/app/JournalController.java`: run listing, metadata updates and paginated journal queries. These journal APIs currently require the PostgreSQL sink; metadata updates require PH deployment-management permission.
- `common/journal-postgres/.../journal/postgres/JournalMetadataNormalizer.java` and `PostgresJournalRunMetadata.java`: tag limits and metadata replacement semantics.
- `common/journal-postgres/.../journal/postgres/JournalEventRowMapper.java`: paginated journal event identity and correlation fields.

The current first-integration endpoints above extend that source baseline locally. Recheck the deployed PH version before using them. No database migration, remote deployment or new PH MCP execution tool is introduced.
