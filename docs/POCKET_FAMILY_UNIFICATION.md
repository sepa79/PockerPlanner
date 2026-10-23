# Pocket family stack unification plan

## Local release 0.2.3 — 2026-10-23

PocketPlanner's Java/React implementation is qualified as local release 0.2.3.
Current exact-image, browser/auth/restart, real-PH integration and security
evidence is in [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). The dated
development stages below remain historical implementation evidence. Registry
publication, ARM64 qualification, remote deployment and operational JSON
switch-over are separate actions; the local release does not implement deferred
DataProvider, requirements-document or Rovo features.

Date: 2026-10-19. Status: reviewed; first local implementation slices started.
No operational export, release or remote deployment is authorized by this plan.

## Review and implementation boundaries

Review found two required corrections: the auth mechanism was an unresolved gate,
and unrelated work was unnecessarily serialized behind that gate. The human has
approved PH-tab confirmation with automatic completion in the original app. Prove
callback-free OAuth device authorization using PH's existing authorization store;
do not build another token issuer or redirect allowlist. Existing browser flows
remain explicit consumers until their cut-over, never a runtime fallback.

Parallel lanes have disjoint ownership: shared React shell in PH packages/UI;
PocketData Redis deployment/configuration; PP language-neutral synthetic contract
fixtures; and PH auth protocol in the auth service/shared contract. No lane owns
another lane's state, calculation or validation. Promote apps to a new shared
dependency only after the dependency's acceptance gate passes.

Each lane must identify concrete owners before coding, declare Responsibility,
Must not and Contract on production classes, search for competing implementations,
and remove displaced implementations at cut-over. Controllers only map HTTP;
repositories own persistence; services own commands/policy; renderers own markup.
No giant shared service, mixed transport/domain class or dual state writer is an
acceptable migration shortcut.

## Target and scope

Review and first-slice evidence: [unification review](POCKET_FAMILY_UNIFICATION_REVIEW.md).
The migration is in progress, not complete. PH consumes the first shared React
shell slice; PocketData uses PH Redis. The combined local Docker build and real
PH-ingress shell/device-grant browser proof pass. PocketData now consumes shared
JVM identity/device clients and shared React UI/browser auth; its local Docker and
native browser/CSV/restart checks pass. Desktop forwarding and PH workload Redis
qualification remain separate gates, not inferred from those checks.
PocketPlanner now builds and runs locally as one Java/React container. Its
displaced Python/plain-JavaScript source and tests have been removed. No working
data was transferred, and no competing writer was attached to an operational store.

PocketHive, PocketPlanner and PocketData remain separate applications with one PH
identity owner and reusable implementation libraries. A shared stack does not mean
one backend process, one product database or common product permissions.

| Area | Target |
| --- | --- |
| PocketPlanner and PocketData backend | Java 21, Spring Boot, Maven; align the tested dependency baseline with PH |
| Pocket frontend | React 19, TypeScript, Vite, React Router and one shared shell/component package |
| Identity | PH Auth; one shared browser integration and JVM identity client; separate registered product clients |
| Planner persistence | SQLite on its own persistent volume; one workspace writer with revision checks |
| DataSet live records and metadata | The Redis used by the selected PH environment; no bundled PocketData Redis |
| PocketData durable inventory | SUT definitions and CSV inventory on its persistent volume, independent of Redis |
| Packaging | Each application deployable independently through Docker Compose/HiveForge |

HiveForge and HiveMind keep Node backends and independent auth. HiveWatch keeps its
own auth. The shared frontend base should allow those tools to adopt it later, but
their frontend rewrites and auth changes are not part of this first migration.

No legacy endpoints, alternate state writers, compatibility layers, fallback auth
providers, checkout states or speculative DataSet recovery machinery are added.
No template population runner or new PH execution functionality is included.

## Shared code and owners

- Use PH's existing `common/auth-contracts` and `common/auth-client` as the JVM
  identity boundary. Add genuinely missing browser operations there rather than
  maintaining separate protocol clients in PP and PocketData. Audit timeouts,
  response bounds, no-redirect behavior, revocation and error handling before reuse;
  adopting the library must not discard protections already present in either app.
- Add a small `@pockethive/ui` package under PH's existing `packages` workspace.
  It owns tokens, typography, shell, header/version, collapsible rail, contextual
  navigation, buttons, dialogs, notifications and common loading/error states.
  Product menus/content arrive as typed inputs; no Planner or DataSet state lives
  in the shell. The separate `@pockethive/browser-auth` package owns browser
  protocol/transaction behavior, not product permissions or theme. Import CSS once
  from the UI package; stop copying app CSS.
- PH remains the browser-registration/token/session owner. Shared client code
  consumes its contracts; it is not another issuer. PP/PocketData retain the active
  `local-admin` editor policy; PH keeps its existing permission checks.
- PP's Java application owns plan validation, commands, SQLite transactions and
  lifecycle timestamps. HTTP and MCP call the same command/store layer.
- The Planner calendar/forecast engine becomes one tested TypeScript module in
  the Planner frontend. Do not reproduce its calculations in React components or
  reimplement them in Java just because the backend changes language.
- Reuse PH's `request-templates` contracts when population work is actually
  implemented. Their availability justifies the JVM direction, not an extra
  template-runner implementation in this migration.

Dependencies must build from declared, versioned artifacts/lockfiles. Establish
local Maven/npm packaging and container build inputs first; do not require runtime
access to sibling working directories. A later library publication needs separate
approval. Do not create another common repository or a general platform framework.

## Stage 1 Auth proof before migration

Resolve the current auth problem before rewriting either application. Backend
connectivity to a fixed PH ingress and browser login/return routing are distinct.
Changing Python to Java does not repair the browser return path.

1. Document the actual local/browser/container paths and deployed HTTPS topology.
2. Select and document one supported login/return mechanism at the PH auth owner.
   The requirement is login from the current UI after restarting its local preview,
   without a human copying a newly allocated preview port into PH configuration.
3. Do not present another hardcoded preview callback as the solution. Do not infer
   arbitrary callbacks from Host/forwarded headers, add unrestricted wildcards or
   weaken production redirect/CSRF/PKCE rules to make a local demonstration pass.
4. Validate callback-free device authorization in a minimal end-to-end slice before
   switching app consumers. PH owns the short-lived authorization and consent;
   the app polls through its backend. The human approved the confirmation UX.
   Use the official server grant implementation, not a custom handoff protocol.
   Browser-client redirect security and existing product permissions stay intact.

Acceptance: real browser login and logout on two successive preview origins after
restarting the preview, no manual auth reconfiguration, preserved destination view,
shared PH sign-in across tools, distinct product tokens, viewer denial, revoked/
expired session denial and clear PH-outage behavior. Test the real desktop/browser
forwarding path, not only WSL localhost or a test-only transport bridge.

## Stage 2 Shared frontend and identity foundation

1. Extract the shell/components from PH into `@pockethive/ui`; use React/TypeScript
   implementations and shared tokens, not copies of the entire PP stylesheet.
2. Make PH consume the extracted shell first so it is a real common owner rather
   than a parallel theme. Preserve PH's screens and domain behavior.
3. Integrate the proven browser-auth mechanism and the audited JVM client, keeping
   app-specific navigation, client IDs and permissions explicit.
4. Add component and browser checks for rail expansion, contextual navigation,
   dialog close/Escape/backdrop behavior, notifications, focus, narrow viewports,
   auth restoration and error presentation.
5. Define local package builds, lockfiles and Docker build inputs. Do not publish
   packages, images or releases in this stage.

Acceptance: a shared-shell change is consumed by PH and the PocketData pilot without
editing duplicate CSS/components. There is one implementation of browser auth.

## Stage 3 PocketData pilot and PH Redis

PocketData is the smaller pilot: its Java backend already exists.

1. Replace its plain JavaScript UI with React/TypeScript and the shared shell.
   Preserve SUT selection, DataSet format views, inventory, CSV validation/import
   and existing backend access checks. Remove the old frontend from the active build.
2. Replace the bespoke identity adapter with the shared client integration while
   retaining one authoritative permission decision per request.
3. Require the selected PH Redis endpoint and explicit connection/network settings.
   Remove the Redis service, default Redis URL and Redis volume definition from
   PocketData's normal stack. Isolated test Redis fixtures remain permitted.
4. Verify Redis reachability from the app container and the PH worker environment,
   including authentication/TLS where configured. A URL naming another unrelated
   Redis is not sufficient proof of a shared DataSet.
5. Keep the established namespace, metadata and field-preservation contract. Do
   not add new record ownership states or change PH's pop/process/push circulation.
6. Leave existing unrelated Redis keys and the old PocketData Redis volume intact.
   Do not copy its contents or delete that volume as an implicit migration step.
   Refill the chosen PH Redis from explicit CSV/inventory inputs when requested.

Acceptance: an isolated synthetic namespace is visible to PocketData and a PH-side
consumer on the same Redis. Validate CSV save-before-publication, extra fields,
restart persistence, denied viewer access, empty lists and explicit Redis outage
errors. The working application no longer starts its own Redis.

## Stage 4 PocketPlanner Java backend

1. Catalogue the current API/MCP behavior and turn existing tests into executable
   contract cases for the new implementation. Preserve supported semantics rather
   than adding old/new protocol branches.
2. Implement typed validation, plan/item commands and the single SQLite writer.
   Keep revision-conflict rejection and lifecycle composition in one transaction.
   No automatic schema-guessing, database conversion or parallel Python writer.
3. Implement REST, JSON import/export, application version metadata and SSE revision
   notifications. UI and MCP mutations must invalidate the same canonical state.
4. Implement scoped MCP tools with the official Java SDK. Preserve request-scoped
   PH authorization, expected revisions, size bounds and Host/Origin restrictions.
5. Port the existing PH catalogue/run/runtime adapters. Keep stable instance/plan/
   stream/activity identities, `testPlan`, Activity tags, exact run references and
   correlation-specific command outcomes. Never retry CREATE when only association
   failed, and never infer manual progress/Started/Done from PH execution.
6. Use the common auth integration. Keep each product's permissions at its owner.
7. Replace the Python runtime/build/dependencies/tests after the Java acceptance
   suite passes. Keep one supported backend, not a permanent sidecar or shim.

Acceptance: HTTP and MCP exercise the same command/store behavior; concurrent saves
return conflicts without lost updates; JSON round-trip preserves IDs and lifecycle
history; restart preserves the saved workspace; PH references/control keep their
existing permission and exact-run guarantees.

### Local stage 4 progress — core, HTTP/session, MCP and PH adapters

The Java 21 module in `backend/` implements strict value/reference validation,
scoped plan/item commands and SQLite persistence, with separate issue-assignment,
issue-resolution and execution-fact composers. The one store owns the transaction,
revision check, injected time and final one-MiB check. The domain core remains
transport-independent. Spring composition now exposes planning REST, VERSION,
health, shared PH device sessions and bounded SSE around those same owners.

The eight shared JSON cases / 22 steps pass against the Java implementation as
well as the current owner. Additional tests cover atomic rejection, independent
concurrent writers, server-owned history and actual JVM process restart. Only
temporary synthetic databases are used. This completes the first core slice of
items 1–2. HTTP tests additionally cover anonymous/viewer denial, fresh admin
checks, revoked/inactive sessions, auth outages/redirects, strict bounded bodies,
competing HTTP writes and two real SSE clients. The runnable jar is tested from an
unrelated temporary working directory and restarted with the same synthetic file.

Device/session transport uses the actual common JVM artifacts. A separate native
browser smoke test can confirm the real PH grant and central session reuse across
two fresh Planner ports without callbacks; it does not claim a finished Planner
frontend or the desktop application's private forwarding path.

The candidate now also exposes the seven existing scoped tools through the official
Java SDK and stateless servlet transport. Every mutation uses fresh request-local
PH authorization and the same command/store transaction as REST. Stable catalogue
references, linked exact runs, bounded PH observations and Start/Stop/outcome
adapters are ported without another execution store or inferred progress. PH owns
runtime authorization and outcomes; redirects and automatic retries are disabled.

The combined clean build passes 605 unit/HTTP tests and four packaged-process
integration tests, including the real servlet in the standalone jar. These use
synthetic identity/run fixtures and temporary SQLite, not operational swarms/data.

At completion of stage 4, Docker/HF/UI were unchanged and the JAR was isolated.
Stages 5–6 below subsequently moved the active build to Java/React and removed
the displaced runtime, without exporting or moving any working plan.

## Stage 5 PocketPlanner React frontend

1. Move the calendar, progress, execution-editor and What-if logic into typed
   product modules, retaining the current regression cases and one calculation owner.
2. Implement the UI on the shared shell: Plan/Execution/Mixed, contextual menus,
   expandable stream/activity/run rows, Gantt drag, editors and swarm panel.
3. Preserve working-day/weekend behavior, dependencies, continuous frames, blocker
   intervals, forecast/deadline comparison and What-if assumptions without saving
   projected dates. Progress and Started/Done remain operator-maintained and reversible.
4. Preserve multi-session updates: defer refresh while editing/dragging/saving,
   reject stale saves and retain valid filters, collapse state and calendar position.
5. Remove the old plain-JavaScript UI and copied shared styles from the active build.

Acceptance: browser regressions cover the complete planning/editing and runtime
paths, with desktop/mobile inspection and real shared login. No application feature
is considered preserved merely because the new screen looks similar.

### Local stage 5 progress — React candidate

The candidate imports the actual shared PH UI and browser-auth packages from
versioned-content local archives and the npm lockfile. React owns product routes
and views, not another auth or shell implementation. Plan/Execution/Mixed retain
contextual menus and expandable Stream/Activity/run rows. Typed calendar and
progress ports retain their regression cases, with 30,600 comparisons against the
current engine. Editors preserve scoped saves, explicit lifecycle actions,
local-time ambiguity handling and server-owned issue/history composition.

The Java jar now includes the built React assets on its API listener. Build with
Node 22+, Java 21 and Maven:

```sh
bash scripts/build-java.sh
TESTPLANNER_DB=/tmp/planner-candidate/planner.sqlite3 PORT=8766 \
POCKETHIVE_AUTH_BASE_URL=http://localhost:8089/auth-service \
java -jar backend/target/pocketplanner.jar
```

Create the chosen temporary directory first. This starts an empty, isolated
candidate at `http://localhost:8766/#/plan`; it is not a data migration. Optional
PH execution requires explicit stable instance and PH base/public URL settings
from the integration contract. For frontend iteration, start that Java candidate
and run `npm --prefix frontend run dev`; its API proxy targets port 8766. Device
confirmation needs no callback/preview-port registration.

`tests/react-planner.browser.cjs` is the real-browser candidate acceptance script.
It starts its own empty temporary SQLite/JAR and uses real local PH device auth;
run controls target only an owned synthetic PH fixture. Set
`POCKETPLANNER_TEST_PLAYWRIGHT` to an installed Playwright module,
`POCKETPLANNER_TEST_BROWSER` to Chrome and `POCKETPLANNER_TEST_PH_AUTH` to the local
PH ingress ending in `/auth-service`. `POCKETPLANNER_TEST_ARTIFACTS` optionally
retains screenshots outside the temporary database directory. No working plan
export, replacement or real-swarm control is performed.

Stage 6 below switches the normal Docker/Compose/HF build inputs to Java/React.
No release, remote deployment or operational-data movement is included here.

Verified locally: 197 frontend tests, 30,600 calendar parity comparisons and 610
Java tests (605 unit/HTTP plus five packaged-process tests). The real-browser
script passes shared PH sign-in, second-tab central-session reuse, isolated JSON
import/export, duration/progress and reversible actual-date edits, anonymous
read-only access, live updates and stale-save rejection, issue scope/history,
collection CRUD, drag, single-frame What-if, runtime controls/outage locking,
desktop/mobile rendering and persistence after restarting on another app port.
Synthetic runtime commands do not change Planner facts. Browser page errors: zero.
The frontend npm audit reports zero advisories; this is not a complete security
certification. The later container check below verifies actual PH journal
authorization, not successful journal data retrieval or private desktop forwarding.

## Stage 6 Switch over and verify deployment

1. Use synthetic isolated stores for all mutation, concurrency and restart tests.
2. At the operator-approved switch-over, use the supported JSON export/import to
   move the minimal working plan. Do not copy operational databases or create
   automatic backups, migrations or dual writers. Compare stable IDs and contents.
3. Rebuild each app independently with its declared common artifacts. Update Compose,
   health checks, persistent paths, ingress, auth configuration and HF deployment
   instructions. No runtime Node requirement is introduced by a frontend build.
4. Prove normal startup and container recreation, volume persistence, multi-user
   edits, auth and dependency outages, real preview restart and exact PH journal
   navigation. Verify supported ingress paths rather than direct backend ports.
5. Review input validation, XSS, untrusted document/CSV content, token leakage,
   access checks, dependency vulnerabilities and container privileges.
6. Update architecture, data/API/MCP/auth/deployment docs, agent instructions and
   Unreleased changelogs. Remove instructions for retired runtimes and copied UI.

Acceptance: no legacy runtime or private PocketData Redis starts; JSON data remains
correct; the shared UI/auth are actual imported dependencies; all declared tests
pass and remaining gaps are explicit. Work remains local with development versions
until the human separately requests publication, a release or lab deployment.

### Local stage 6 progress — container and source cut-over

The default Dockerfile now builds/tests the shared-library React frontend with
Node 22 and the Java application with Maven/Java 21. The final image contains only
the JRE application and curl health probe, running as UID/GID 10001. Build context
is an explicit source/artifact allowlist; working data, credentials and local
build outputs are not sent to Docker. Compose and HF templates set the explicit
listener/database path, one replica, stop-first changes, dropped capabilities,
read-only root and executable temporary storage for SQLite's native library.

The full 211 frontend / 615 Java tests pass inside the image build. Ten additional
tests render actual Ansible/HF configuration and validate Swarm/Compose. The
synthetic browser suite also passes against the actual local Compose image:
fresh project-specific volume, non-root/readonly/capability checks, manual edits,
scope/history/CRUD, drag, What-if, two-session conflicts/live updates, controlled
PH fixture commands, mobile and persistence after container removal/recreation
on a different port. Only that test's own volume is removed on completion.

Real local PH acceptance now verifies CREATE with Plan/Stream/Activity selection,
a second Activity association, actual Start/Stop from PP and unchanged canonical
planning facts/revision. The owned swarm targets only local WireMock; no payment
system or Redis mutation is involved. The actual PP journal link opens PH,
preserves the exact swarm/run and obtains PH's own bearer token using the existing
central login, without username entry or token in navigation. The real journal
data request returns HTTP 200. Nine focused PH integration tests also pass.
The private desktop forwarded URL was not reachable from native WSL/Windows HTTP probes, so
forwarded-preview login/restart remains a separate browser acceptance gate. Do
not add a relay, callback wildcard or Origin bypass to make that check pass.

Source cut-over removes displaced Python/runtime dependencies, plain-JavaScript
UI and their superseded tests; it does not preserve a compatibility backend.
The authored sample now lives in `examples/example-plan.json`; initial state is
still empty. A local Java Compose preview uses a new `planner_java_data` volume,
never an existing project volume. Existing lab data/deployments are untouched.
Root Compose requires an explicitly selected Java image; publication and remote
HF lifecycle actions are not authorized by this local verification. Switching an
existing operational deployment still needs an explicit JSON import decision.

## Execution order and gates

The local follow-up now proves real PD/PH Redis circulation and bounded
JSON/SOAP population against local mocks. See the dated
[review evidence](POCKET_FAMILY_UNIFICATION_REVIEW.md) and
[security review](SECURITY_REVIEW.md) for remaining gates. These checks do not
qualify real payment requests, 24-hour load, a remote deployment or a release.

Auth proof → shared foundation → PocketData pilot/shared PH Redis → PP Java backend
→ PP React frontend → full acceptance and switch-over.

The shell, Redis configuration and contract-fixture lanes may run in parallel with
the auth proof. Do not promote two full app rewrites before the shared foundation
is proven. SQLite replacement, distributed deployment, HF/HM/HW rewrites,
large-scale/continuous Provider production, Rovo and new execution features remain
separate tasks. The bounded PocketData HTTP/SOAP population runner is now locally
implemented and qualified against mock services, not a production Provider swarm.
