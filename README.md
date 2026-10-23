# PocketPlanner

![PocketPlanner · simple test plan](frontend/public/pocketplanner-logo.svg)

A compact calendar test planner: separate plans, editable streams and activities,
shared blockers, deadlines, read-only What if forecasts and JSON import/export.
Plan, Execution and Mixed views keep planning facts separate from PocketHive runs.

**Operators:** [Local Docker / Portainer](#docker-and-portainer) · [HiveForge](docs/HIVEFORGE.md)

**Agents:** [Working rules](AGENTS.md) · [Planner MCP](docs/MCP.md) · [Architecture and data contract](docs/ARCHITECTURE.md)

## Stack and status

Java 21/Spring Boot, SQLite and React 19/TypeScript/Vite. The actual shared PH
packages own UI shell/theme and browser device authentication; shared JVM clients
connect to PH Auth. One JAR serves the UI, API, SSE and MCP; one container runs one
application replica. Node and Maven are build tools, not runtime services.

Release **0.2.3** contains the Java/React implementation. The local release image
is `pocketplanner-local:0.2.3`; it has not been published to GHCR. An older
published image does not contain this release. Use a local build or an explicitly
verified published source/image reference available to the deployment host.

Current verification passes **219 frontend tests, 621 Java tests** (including
five packaged-application integration cases) and **14 deployment configuration
checks**. The release qualification covers an isolated final-image volume,
browser editing, conflicts, auth, recreation and changing ports. Real PH
acceptance uses only owned synthetic plans and a WireMock-only swarm; it does
not exercise a payment system or mutate operational Redis.

See [release verification](docs/RELEASE_VERIFICATION.md) for the exact image,
current test evidence, PH integration result and remaining acceptance limits.
Known Spring dependency findings and their applicability assessment remain
documented in [security review](docs/SECURITY_REVIEW.md); this is not a clean-scan
claim. Registry publication, remote HF deployment and operational JSON
switch-over are separate actions.

`VERSION` owns the version shown in the top bar, `/api/info` and MCP.
`-dev` identifies unreleased work. New changes belong under Unreleased in the
[changelog](CHANGELOG.md).

Shared frontend archives are pinned to PH source `2dd092f9` and content hashes.
JVM auth is independently pinned to source `e98de7ac` with artifact coordinate
`0.15.38-e98de7ac-authhttp-fd82f5c6cc75`. Packaging verifies resolved artifact
integrity; normal builds do not require sibling repositories.

## Docker and Portainer

For an isolated local installation, use a separate Compose project and empty volume:

```sh
docker compose -p pocketplanner-qa -f compose.local.yaml up -d --build
```

Open `http://localhost:8765/#/plan`, or set `POCKETPLANNER_PORT` to a free local
port before starting. Stop on a port or storage conflict; do not replace an existing deployment or
reuse its volume for testing. The Dockerfile builds/tests React with Node 22 and
the Java application with Maven/Java 21, then runs a non-root Java 21 JRE as
UID/GID 10001. Its `/health` check uses curl. UI/API/MCP share container port 8765.

For Portainer:

1. Build a local image on the chosen Docker host, or choose a verified published
   Java/React image available to every node that may run the stack.
2. Open **Stacks → Add stack → Web editor** and paste [compose.yaml](compose.yaml).
3. Set `POCKETPLANNER_IMAGE` to that exact image reference. Select a free published
   port and persistent storage; do not point a test stack at an operational volume.
4. Optionally set `POCKETHIVE_AUTH_BASE_URL` to the PH ingress plus `/auth-service`.
   It must be reachable from the app container. Leave it empty for public viewing only.
   Public PH verification/logout links require HTTPS or loopback HTTP by default;
   use `POCKETHIVE_ALLOW_REMOTE_HTTP=true` only for an approved remote HTTP issuer.
5. Deploy, check `/health`, and open `http(s)://<planner-host>:<port>/#/plan`.
6. When an import is explicitly wanted, sign in as PH **local-admin** and use
   **Data → Import JSON**. Import replaces the entire workspace after confirmation.

New installations start empty. The source and image contain no operational plan
data. SQLite lives at `/data/planner.sqlite3` on a persistent volume: local Compose
uses `planner_java_data`, while the Portainer Compose uses `planner_data`, each
prefixed by its Compose project. The new local volume name avoids implicitly
opening an older installation's store; it does not transfer its data.
Keep one application replica. A local volume belongs to its Docker host;
Swarm requires explicit node placement or appropriate shared storage. Never run
two Planner processes against the same working database, remove its volume during
an update, or copy/export operational data as a deployment test.

### Shared PH sign-in

Viewing is public. Every editing request freshly verifies an active PH
**local-admin** identity; missing auth configuration means read-only operation,
not a local admin bypass. PP stores no accounts/passwords and does not trust
unverified token claims.

**Sign in** opens a PH confirmation tab using its registered
`pocketplanner-device` client. Confirm access there; the original PP tab finishes
sign-in automatically. PP needs **no `/auth/callback`, preview-port registration
or manual login-port update** when its own address changes. PH's advertised
confirmation address must still be reachable from the user's browser. Backend
connectivity and browser connectivity are separate checks.

PP and PH obtain distinct tokens from the same PH identity owner. A linked PH
journal uses PH's own session flow and the central browser session, not a token
in the journal URL. See [SSO and journal navigation](docs/POCKETHIVE_INTEGRATION.md#browser-single-sign-on).
Use HTTPS outside trusted local development; PH DEV login is not production auth.

## Plans and daily use

- **Plans:** maintain name, description and an optional independent deadline;
  choose the active plan in the header. Streams, types, activities and issues
  belong to that plan. There are no parallel/sequential flags or resource engine.
- **Schedule:** durations are full estimated working days, never remaining time.
  Saturday/Sunday stay grey inside one continuous task frame. An activity's
  **Include weekends** opt-in counts calendar days instead. Independent tasks can
  drag; weekday-only weekend drops snap forward to Monday.
- **Dependencies:** an activity may follow another in the same stream; a stream
  may follow another stream. Successors follow on the next eligible day. Cycles,
  missing predecessors and invalid membership fail explicitly. Automatically
  scheduled tasks cannot drag independently; move or unlink their predecessor.
- **Progress:** Started, percentage slider/numeric field, and Done remain manual.
  Both buttons are reversible and actual dates/times can be corrected. Undoing
  Done asks for the correct percentage below 100, rather than guessing. Undoing
  Started resets progress, both dates and recorded blocker history. Changes are
  staged until Save; Cancel discards them.
- **Timing:** details distinguish full estimate, projected finish, actual elapsed
  time, recorded blocking already included in elapsed time, and forecast blocker
  delay. Approximate remaining effort uses full estimate × remaining %. Missing
  actual evidence stays **Not recorded**. Ambiguous local-time corrections require
  an explicit time occurrence when the recorded UTC offset cannot be retained.
- **Streams:** collapse/expand while retaining progress and a named summary frame.
  Progress is the rounded equal-weight mean of every activity in the stream;
  an empty stream shows `—`. Collapse is presentation state, not a saved edit.
- **Issues:** Blocker and scope labels are read-only; open the title to edit.
  Active/History filters and Close/Reopen retain links and show resolution time.
  **Incomplete** is only a missing-description reminder. Unlinking an issue in an
  Activity also narrows its real scope, preserving all other assignments.
- **Blocking:** affected unfinished rows pulse red. When every unfinished activity
  is blocked, **BLOCKED!** requires acknowledgement or **Show me the blockers**.
  Neither resolves the issue. Reduced-motion presentation is supported.
- **Jira:** optional ordinary HTTPS ticket links only. No API, ticket polling,
  Jira authentication, status synchronization or inferred completion.

### Live updates and What if

Saved UI, import and MCP changes notify other sessions through `/api/events` SSE.
The header indicates Live, Update waiting or unavailable updates. Editors, drags
and pending saves defer refreshes without silently rebasing drafts. A stale save
is rejected, the editor closes, and canonical data reloads; reopen details and
reapply only the intended change. Reconnection catches up automatically.
Proxies must pass unbuffered long-lived SSE; no WebSocket upgrade is needed.

Normal Plan includes active blocking through today inclusive, with work resuming
no earlier than the next eligible day. Closed/recorded blocking retains known
delays. Saved starts and full estimates are not rewritten by forecasting.

**What if?** selects one active blocker and an assumed inclusive end using a
calendar and ±1 day buttons. It changes only that blocker's end in the same
timeline: one frame per task, grey excluded weekends, red pauses, anchored names.
In-progress work extends using approximate remaining effort; dependants follow,
while completed/unrelated work stays fixed. Finish, delay and deadline margin/
overrun update immediately. Nothing is saved; **Return to plan** clears it.

### JSON import/export

**Data → Export JSON** downloads the full workspace as compact UTF-8 JSON with
exported revision zero. Its filename uses the selected plan name, with unsafe
filename characters normalized; an empty workspace uses `pocketplanner-plan.json`.
Selection changes the filename, **not** which plans are exported.

**Import JSON** explicitly replaces the workspace after confirmation, using the
current revision and canonical server validation. Files and final saved documents
are bounded to one MiB. Invalid/conflicting imports leave saved state unchanged.
Import restores supplied Started/Done dates, issue resolutions and blocker history
for existing IDs too, without inventing lifecycle events. It uses a dedicated
import action; ordinary editing does not gain permission to rewrite those facts.
There is no automatic schema conversion, database migration or offline replacement
CLI. Do not export/import operational data unless the operator asks for it.

```json
{"schemaVersion":1,"revision":0,"plans":[]}
```

Plan/item fields, lifecycle actions and reference/size rules are defined by
[the data contract](docs/ARCHITECTURE.md#data-contract), implemented by the Java
validator/store/commands. IDs are stable, plan-local and literal; dates are exact
`YYYY-MM-DD`. No operational sample is bundled into the public UI.
The optional [example workspace](examples/example-plan.json) is authored synthetic
JSON in the repository, not an automatically imported plan or public runtime asset.

## PocketHive execution

PP is the planning master. PH selects **Plan → Stream → Activity**, persists the
stable plan reference in `testPlan` and appends Activity tags to exact runs.
One run may serve several Activities; one Activity may have several runs.
Associations never imply an active phase or alter manual percentage, Started/Done,
estimates or blockers.

The rail selects **Plan / Execution / Mixed**, with contextual menus. Execution
uses expandable **Stream → Activity → run** rows, explicit history and fresh
generator TPS. Mixed attaches current runs without duplicate task bars.
Click a run for workers, exact journal and Start/Stop workload. PH permissions,
not PP editing rights, authorize control. Stop requires confirmation; acceptance
stays pending until the exact correlated PH outcome. An uncertain submission can
retry only with the same idempotency key. Missing/stale observations are explicit
and disable controls, never imply Running or zero TPS.

Set a stable `POCKETPLANNER_INSTANCE_ID`, backend-reachable `POCKETHIVE_BASE_URL`,
browser-reachable `POCKETHIVE_PUBLIC_URL` and the shared auth owner. PH Orchestrator
uses `POCKETHIVE_PLANNER_BASE_URL` pointing to PP. PH must implement the matching
[integration contract](docs/POCKETHIVE_INTEGRATION.md); do not assume a published
PH release contains local integration work. URLs are operator inputs, not guessed
from laptop names or arbitrary forwarded request headers.

The [DataProvider design](docs/DATAPROVIDER.md), [first-stage plan](docs/LIVE_DATASET_STAGE1.md)
and [simple Redis contract](docs/DATASET_LIFECYCLE_CONTRACT.md) remain separate
work. Shared SUT/DataSet selection, full-record field preservation and future
usage diagnostics do not require checkout states or rebuilding PH's existing
pop/process/push loop. Empty pools leave generators waiting; recovery is operator
cleanup and repopulation from producer inventory. No PP DataSet processing,
mix control, requirement-document references, journal-start evidence or Rovo
automation is implemented by this migration.

## MCP for agents

The official Java MCP SDK serves Streamable HTTP at `/mcp` on the same listener
as the website. Public reads need no token. Mutations require a freshly verified
PH local-admin bearer session and the latest `expected_revision`. No separate
MCP container, password, database, deletion or bulk-import tool is introduced.

Remote MCP needs explicit `POCKETPLANNER_MCP_ALLOWED_HOSTS` values for the Planner
server's actual host/port, not the client laptops. Browser clients additionally
need trusted `POCKETPLANNER_MCP_ALLOWED_ORIGINS`; native clients normally omit
Origin. Neither setting enables CORS or replaces authentication. See
[tools, examples and agent safety](docs/MCP.md).

## Build and verification

For the existing local PH stack, `compose.local.yaml:compose.ph.local.yaml`
attaches Planner to `POCKETHIVE_NETWORK_NAME`. Configure its server-side PH/auth
URLs through the official Docker ingress and `POCKETHIVE_PUBLIC_URL` for browser
links. The local working stack uses PH `http://localhost:8088`, Planner
`http://localhost:8765` and PocketData `http://localhost:8785`; a desktop preview
may forward these to its own temporary browser port without changing login config.

Docker builds from this repository alone. For a local JAR build, install Node 22+,
Java 21 and Maven, then run:

```sh
bash scripts/build-java.sh
qa_dir=$(mktemp -d)
TESTPLANNER_DB="$qa_dir/planner.sqlite3" PORT=8766 \
POCKETHIVE_AUTH_BASE_URL=http://localhost:8088/auth-service \
java -jar backend/target/pocketplanner.jar
```

Open `http://localhost:8766/#/plan`. A standalone JAR requires an explicit absolute
`TESTPLANNER_DB`; its default bind is loopback. Docker explicitly sets
`BIND_ADDRESS=0.0.0.0` and `/data/planner.sqlite3`. For frontend iteration, start
the JAR on 8766 and run `npm --prefix frontend run dev` (its API proxy targets it).
Shared dependencies are checked-in build artifacts with integrity checks, not
runtime links to sibling repositories: [UI inputs](frontend/vendor/README.md)
and `backend/vendor/maven/SHA256SUMS`. Refresh shared behavior at its PH owner,
not by patching installed packages or copying another auth client.

The image build passes **219 frontend and 621 Java tests**. An additional
**14 deployment configuration tests** cover Compose and HF/Ansible rendering;
they do not deploy to the lab. Isolated Compose browser checks pass UI/auth/live/
conflicts/reversible timing and volume persistence after container recreation,
including UID 10001, read-only root, dropped capabilities and no Python/Node runtime.

```sh
POCKETPLANNER_TEST_PLAYWRIGHT=/path/to/playwright \
POCKETPLANNER_TEST_BROWSER=/path/to/chrome \
POCKETPLANNER_TEST_PH_AUTH=http://localhost:8088/auth-service \
node tests/react-planner.browser.cjs
```

That browser regression starts an isolated JAR/database, uses real PH device
sign-in and controls only an owned synthetic PH fixture. It never uses a working
plan. Set `POCKETPLANNER_TEST_CONTAINER_IMAGE` to the built Java image to run it
against isolated Compose instead; `POCKETPLANNER_TEST_PH_NETWORK` selects the
existing QA PH network. The fixture owns its project and empty volume and removes
them afterwards. Run `node --test tests/deployment.test.cjs` for rendering checks.
MCP tests use the official Java SDK and the same commands/store as REST; see
[MCP verification](docs/MCP.md#verification). The separate
[`tests/pockethive-live.browser.cjs`](tests/pockethive-live.browser.cjs) acceptance
uses a real local PH stack and a dedicated synthetic Planner: creation, picker,
multiple Activity associations, journal HTTP 200, central sign-in reuse and actual
Start/Stop all pass. Its exact owned swarm is removed afterwards. See the
[fixture setup and safeguards](docs/POCKETHIVE_INTEGRATION.md#verification-scope).
Desktop forwarding is not verified. Rebuild refreshed bases and audit the actual
resulting image; a passing test or npm audit is not a security certificate.

[HiveForge deployment](docs/HIVEFORGE.md) owns remote lifecycle instructions.
No lab action, operational data movement or publication is authorized by these
local build/check instructions.

## License

PocketPlanner uses **GPL-3.0-or-later**, the same license as PocketHive.
See [LICENSE](LICENSE). Third-party dependencies retain their own licenses.
