# Pocket family unification review and first slice

Date: 2026-10-19. Reviewed the local plan and existing dirty PH/PP/PocketData working
trees; no release or remote deployment. Verdict: proceed after the two corrections
below, with explicit dependency gates and disjoint implementation ownership.

## Current local follow-up — 2026-10-19

The sections below retain the staged evidence; they do not describe multiple
current runtime implementations. Java/React is now the sole local PP runtime.

- Re-reviewed pending blocker-selection preview and explicit confirmed JSON
  import fixes: no new actionable finding. Targeted regressions pass, followed by
  the rebuilt 211 frontend / 615 Java suites.
- Updated vulnerable dependencies in PP/PD within the existing platform and
  scanned the exact images. Both retain two conditional Spring advisories plus
  OS Medium/Low findings; see [security review](SECURITY_REVIEW.md). No silent
  suppression or clean-scan claim.
- Verified actual PD → existing PH Redis DB0 → real PH generator/request-builder/
  processor/postprocessor → output-list circulation, including live import into
  an initially empty pool, three mock HTTP 200 transactions, leading zeroes and
  extra fields. All writes use uniquely owned synthetic resources; no shared
  service restart or operational data copy.
- PocketData now executes finite PH-template recipes with JSON and SOAP 1.1/1.2.
  HTTP-200 Fault and Stop retain response CSV, prevent later steps/retries, and
  never publish partial records. Restart retains CSV without resuming jobs.
- Shared PH confirmation works after a genuine application restart and a changed
  native port. Stored historical PH journals can return 404; do not call that a
  verified journal read. Exact-run data acceptance is recorded separately from
  central sign-in and workspace persistence.
- A new uniquely owned PH run targeting local WireMock returns exact journal
  HTTP 200 with 12 events before and after PP recreation on native ports
  32798 → 32799. Central login, same SQLite volume/revision and independent PH
  authorization survive. The old PP-linked journal remains 404; PH correctly
  rejects a new foreign-QA-catalogue link with 409. No master configuration or
  primary plan is rewritten to hide this remaining linked-data acceptance gap.

The primary local apps were recreated from the tested images on ports 8765/8785,
retaining their existing volumes and explicit PH connections. No release, lab
deployment, plan export/import or automatic operational data transfer occurred.
The desktop-private forwarded port remains independently unverified.

## Findings and decisions

1. The original auth gate specified an outcome but no proven mechanism. A language
   migration cannot fix preview callback routing. The human approved confirmation
   in a PH tab; the first proof uses Spring's device authorization grant with PH's
   existing token/consent stores. No callback wildcard or new token issuer.
2. Serializing shell extraction, Redis wiring and synthetic contract fixtures
   behind auth blocked independent useful work. Those lanes can run concurrently;
   application cut-over still depends on proven shared modules. Do not build two
   independent copies of auth/UI while waiting for those modules.
3. The existing JVM identity client required audit before adoption: its reusable
   contract did not prove bounded responses or rejection of redirects. The next
   slice adds those protections at the shared HTTP owner, rather than retaining
   the independent PocketData HTTP/PKCE client.
4. The application must not silently follow whichever `redis` alias is visible on
   multiple networks. Select the PH Redis endpoint/database and network explicitly;
   preserve durable CSV and do not copy/delete old live-record data implicitly.

## Owners and implementation units

| Responsibility | Sole owner or focused units | Must not own |
| --- | --- | --- |
| Shared layout/theme | PH `packages/ui`: AppShell, AppHeader, NavigationRail, NavigationItem; CSS Modules and tokens | Auth, routes, product state or permission decisions |
| PH composition | Existing PH AppShell, SideNav, TopBar adapters | A second shared layout/theme implementation |
| First-party registrations | BrowserOAuthClients; PocketHiveDeviceAuth names the device contract | User credentials, consent state or token issuance |
| Device HTTP decoding/authentication | DeviceClientAuthenticationConverter / Provider; classification delegates to the registration owner | Another registration list, OAuth state or user permission inference |
| Device presentation | DeviceConfirmationController / PageRenderer | Consent validation or token mutation |
| OAuth state | Existing Spring authorization/consent stores and token pipeline | Product editing policy |
| Auth configuration | AuthServiceOAuthProperties, validated by OAuth composition | Alternate per-adapter endpoint/TTL defaults |
| Shared JVM auth HTTP | AuthServiceRestClients / AuthServiceRequestFactory / BoundedAuthResponse | Redirects, response draining after rejection, unbounded bodies or raw production-client injection |
| Typed client protocol | AuthServiceClient identity operations; DeviceAuthClient device operations | Product permissions, token storage or a polling loop |
| Shared browser auth | packages/browser-auth controller, protocol adapter, poller and tab/storage owners | Theme, product access policy or PH grant state |
| PocketData access | AuthService, using freshly verified shared-client identity | OAuth protocol or transport implementation |
| DataSet connection and operations | Existing PocketData RedisDatasets; Compose supplies one explicit PH endpoint | Private normal-stack Redis, record ownership states or recovery orchestration |
| Future Java parity data | Synthetic JSON fixtures; current tests invoke the existing commands/store | A second validator or lifecycle algorithm |
| Planner persisted state | Java WorkspaceStore on the isolated local Java volume after the verified cut-over | A second writer or implicit operational data conversion |

Each new runtime component declares Responsibility/Must not/Contract. New protocol
types remain in separate files. Controllers map and delegate; renderers escape;
registration and token state have different, documented owners. Device client-kind
selection is centralized rather than repeated in the provider and page controller.

## Review passes

- Plan: corrections above applied; target remains separate apps and one shared base.
- Style/structure: per-component/type files, scoped shared CSS and linked contracts.
- Conciseness: standard server grant; no custom token broker, callback relay,
  checkout state, compatibility backend or automatic data migration.
- Security: exact browser scope/resource, no secret in navigation, consent/CSRF,
  current-user identity, code expiry/denial/reuse checks and unchanged permissions.
  App-side polling and full logout now pass through PocketData's real native
  ingress; actual desktop preview restart remains a separate acceptance gap.
- Libraries: reuse Spring Authorization Server and React; no custom OAuth protocol
  engine or new runtime dependency added by this slice. React is deduplicated.
- Maintainability: shared shell contains no product state. PH adapters supply slots
  and menu selections. The typed package replaces extracted styles rather than
  creating another theme authority. Domain widgets/auth adoption are still pending.

## Verified first-slice evidence

- PH Auth: six device-grant tests plus existing SSO/auth regressions. Start/pending,
  PH confirmation, both registered tools, current identity, invalid client/scope/
  resource, cross-client polling, no refresh token, consumed code, expiry, denial
  and confirmation CSRF. Real browser completed confirmation through the official
  local PH ingress for both tool clients with one central login and no callback.
- The selected Spring version does not enforce server-side polling throttling.
  Consumers must obey the RFC interval and handle slow_down; no stronger guarantee
  is claimed. This proof is not a completed product-side login implementation.
- Shared UI: 5 component tests; PH UI: 128 tests; typecheck and production build
  pass after merge. Extraction removes PH's old shell/token styles. React/ReactDOM
  resolve to one consumer runtime. Browser shell inspection includes theme,
  navigation collapse and persisted state. The final combined Docker build and
  official-ingress browser check also passed: one header/main, no page errors or
  horizontal overflow, rail state restored after reload, both device clients
  confirmed in PH and returned usable identity tokens. Product-side login is
  deliberately not claimed by this server-grant test.
- PP: 8 new language-neutral cases / 22 steps; 32 selected store/execution/contract
  tests pass. Only temporary SQLite and synthetic authored JSON are used.
- PocketData: normal Compose starts only the app, requires the PH Redis endpoint
  and explicit networks. The app container receives PONG from pockethive-redis-1;
  its old private Redis is stopped, with its volume retained and no records copied.
  PH workload/Provider qualification against that endpoint is not yet performed.
  All 25 PocketData tests passed with a separate synthetic Redis; none skipped.

## PocketData/shared auth cut-over evidence

- PocketData now consumes the real shared React shell and separate browser-auth
  module. The old static JS/copied CSS and PKCE callback/exchange routes are removed.
  Docker builds use integrity-pinned npm archives and checksummed local JVM
  artifacts, not a runtime dependency on sibling working directories.
- The common JVM client rejects redirects, coercion/malformed identity, oversized
  bodies and response-time overruns. Rejected JDK body streams are closed/cancelled
  directly, never drained by Spring's response close operation. Production uses
  only the configured URI/deadline constructor; the MCP owner-auth consumer was
  transferred too. Raw RestClient injection is library-test-only.
- 29 PocketData backend tests pass with the isolated Redis, 28 product frontend
  tests and 55 shared browser-auth tests pass. Typechecking, production builds and
  clean frontend installs pass; npm audits report zero findings for those graphs.
- The affected JVM reactor also passes: 262 MCP tests (7 new owner-auth cases),
  18 auth-client tests including oversized-stream cancellation, 28 auth-contract
  tests and 42 swarm-model tests; no failures, errors or skips. This checks the
  production MCP consumer of the shared client, not just the PocketData pilot.
- Real browser on PocketData 8785 → official PH ingress 8089 proves original-tab
  device sign-in, current admin/viewer policy, reload restoration, distinct tokens,
  shared central session, revocation and callback-free central sign-out. No
  operational mutations. Native widths 1366 and 390 have one header/main and no
  page overflow; screenshots inspected.
- The real sign-in/viewer/sign-out check also passes through two successive native
  loopback proxies with distinct random ports and no auth reconfiguration. This
  verifies callback independence, not the desktop application's private proxy.
- An isolated app/Redis/synthetic identity fixture proves SUT/DataSet creation,
  CSV publication/download, extra-field/identifier preservation, modal dismissal
  and reload. Restarting that Java process with its synthetic inventory directory
  retains catalogue, CSV inventory and Redis count. Fixtures stopped afterwards.

## Planner Java core evidence — first slice

- The first slice compiled a Java 21 domain/persistence jar only, before adding
  the candidate HTTP application below. It introduced no operational DB default,
  copied auth implementation or Docker switch.
- The shared synthetic eight-case / 22-step contract executes against Java and
  the current store. Strict scalar/reference/history checks, scoped commands and
  final byte-limit validation are delegated to explicit owners, not controllers.
- SQLite BEGIN IMMEDIATE plus persisted revision comparison rejects one of two
  independent concurrent writers without losing the committed edit. Lifecycle
  timestamps and issue scopes are composed before the same final commit.
- An actual child JVM writes synthetic Started/Done/blocker history and exits;
  a fresh child JVM verifies the saved revision and facts. No operational database
  or exported plan is read. The final core suite has 338 passing Java tests;
  the current application's 114 Python tests and 9 Node test files also pass,
  without failures or skips. This is core parity, not yet HTTP/MCP/auth/UI parity.
- A bounded integration review found no further actionable issues after moving
  canonical decoding before commit; its regression proves that a final document
  exceeding the decoder's number boundary cannot be committed and then fail its
  response/readback. The caller's draft is never the persisted mutable object.
- Jira links use the standard Java URI parser with an HTTPS host, no credentials
  and a valid port. No custom emulation of permissive Python parsing remains;
  malformed links fail explicitly and spaces must be percent-encoded.

## Java HTTP, shared auth and live evidence

- Spring Boot composes the same store/commands with no default database path.
  Public reads, authenticated workspace/activity saves, metadata and health pass
  real random-port HTTP tests. Fresh identity checks enforce active local-admin;
  viewer, malformed/revoked/inactive tokens, upstream redirects and outages fail
  closed. Responses never expose upstream diagnostics or persisted credentials.
- Device/session endpoints consume the actual PH JVM artifacts and shared DTOs,
  not a copied protocol client. Strict tests cover request fields, bounds, RFC
  response names, missing interval, pending/slow-down errors and failed revocation.
- Two real HTTP SSE clients observe committed HTTP and same-store replacement
  revisions. Focused tests cover latest-only delivery, lazy bounded writers,
  initialization gating, 128-client capacity, heartbeats, disconnect/shutdown and
  observation failure/recovery. SSE-only clients still receive safe JSON 503
  failures; ordinary disconnected responses are not rewritten as HTTP 500.
- Packaged-application tests launch `java -jar` from unrelated temporary working
  directories. A restart preserves factual start/completion/blocker history;
  missing explicit database fails startup and missing auth remains read-only.
- The optional native-browser smoke passed against the real PH ingress: device
  confirmation, admin mutation on synthetic data, viewer denial, independent
  tokens, central PH session reuse and revoked-token denial. Restarting the Java
  app on a second ephemeral port preserved data and login without PH callback
  reconfiguration. This does not verify the future Planner React login button or
  the desktop's private forwarding path. Test processes/data are removed.
- An independent Maven repository resolved the shared artifacts from this
  project's checked file repository. Public dependencies were supplied from a
  read-only Maven cache; no sibling source tree was needed. The build additionally
  checks resolved shared JAR/POM digests so a stale same-version cache cannot
  silently replace the declared vendor inputs, including when tests are skipped.
- Integration review found and fixed that cached-artifact reproducibility gap.
  No further auth/HTTP or bounded-stream findings remain after the focused review.
- Final clean verification passes 495 unit/HTTP tests and 3 packaged-process
  integration tests, with no failures or skips. Existing runtime regressions also
  pass: 114 Python and 84 Node cases. The native real-PH browser smoke passed again
  on the final candidate. A deliberately altered valid JAR in a separate Maven
  cache fails packaging with tests skipped; restoring the declared JAR succeeds.

## Java MCP and exact PH adapter slice

- The official Java SDK owns stateless servlet transport and client negotiation;
  Planner's seven scoped tools only adapt the existing commands/store and fresh
  request-local access policy. There is no extra writer, token cache, replacement
  tool or MCP execution control.
- The PH port preserves the existing instance/Plan reference and complete SHA-256
  Activity tag, with Python-generated golden vectors including Unicode and escaped
  control characters. Renaming or changing Stream membership does not change identity.
- Sixty-nine focused PH tests pass: one-snapshot catalogue reads, exact historical
  run links, unresolved references, the 5,000-row cap, strict JSON, fixed ingress,
  no redirects/retries, dropped-response handling, eight-MiB bounds, five-second
  total streaming deadline and cancellation. No custom HTTP/TLS/framing parser is
  introduced; the maintained Apache client owns that protocol boundary.
- Runtime and HTTP checks prove that viewer sessions may use PH-granted runtime
  permissions without obtaining Planner editing rights. Historical runs cannot
  borrow a replacement's state or controls; an operation with another run or
  correlation fails explicitly. Controls and outages leave canonical planning
  state and revision unchanged. Worker configuration is not projected.
- Sixteen MCP tests pass through the real official Java client/servlet and focused
  boundary checks. They cover initialization/version/tool schemas, reused-client
  identity changes and concurrent caller isolation, denied writes, exact scalars,
  scoped lifecycle/issue edits, HTTP/MCP write conflicts, browser SSE invalidation,
  Host/Origin/duplicate-header rejection and request/final-workspace byte limits.
  SDK transport failures suppress internal stack/cause diagnostics without changing
  protocol ownership or the shared application JSON mapper.
- The final clean combined build passes 605 unit/HTTP tests plus four packaged
  process integration tests, with no failures or skips. The standalone jar accepts
  MCP initialization/discovery and restarts with its synthetic workspace intact.
  Existing runtime regressions remain green: 114 Python and 84 Node cases.
- The existing official Python MCP client also discovers all seven tools and
  agrees with REST on an isolated empty packaged server, without mutations or a
  Python runtime bridge. The final jar's native-browser smoke against real PH
  again proves device confirmation, central session reuse, admin/viewer policy,
  independent tokens, revocation and persistence/login across a changed local
  port. Test processes and synthetic databases are removed. This is not a test of
  real swarm control, the future Planner React UI or desktop-private forwarding.
- This slice does not switch the working runtime, serve the future React UI,
  copy/export operational plans, control a real swarm or publish a release.

## Java/React local integration review

The subsequent migration slices replace the earlier Python/plain-JavaScript
runtime with the sole Java/React implementation. The image build passes 197
frontend and 610 Java tests, and ten deployment configuration tests pass. These
supersede the earlier implementation's test counts, not its working data.

Two P2 findings were reported in this review:

1. `frontend/src/views/DataView.tsx:33` routes explicit JSON replacement through
   ordinary workspace writes. `WorkspaceStore.write` calls the lifecycle recorder,
   which rejects changed `startedAt`/`completedAt` on existing Activity IDs. A valid
   saved workspace with different lifecycle facts cannot be restored through the
   advertised import. A fix needs explicit import intent, revision conflict checks
   and the same sole store owner; normal edits must not bypass factual controls.
2. `frontend/src/components/EditorActivity.tsx:35` changes draft Activity issue IDs
   but does not apply the pending assignment change to the issue scopes used by
   `forecast`. Unlinking the sole blocker leaves the timing preview delayed even
   though saving correctly narrows the issue and removes that delay. The preview
   must evaluate pending links without duplicating the persisted scope composer.

Finding 2 is now fixed locally: the calendar predicate reads pending issue
membership for only the edited Activity. Canonical issue scopes and recorded
history are not rewritten by a preview, and dependencies retain other Activities'
assignments. Regression tests reproduce the original failure and cover all three
scopes, relinking, adding an out-of-scope link, overlapping blockers, predecessor
effects, retained closed/ongoing history and Cancel. The frontend suite now passes 205 tests.
The rebuilt image also passes 610 Java tests. Real-browser Compose regression
confirms immediate unlink/relink preview, Cancel without a revision change,
manual lifecycle controls and synthetic-volume restart persistence, with no page
errors or operational mutations. The local primary preview uses the rebuilt
image and its existing volume; no release or publication was performed.
Finding 1 is now fixed locally as well: explicit `/api/state/import` delegates to
the sole store's historical replacement operation. Revision comparison now lives
inside the shared SQLite transaction boundary for both ordinary saves and imports;
there is no unconditional replacement path. The UI's dedicated import intent
uses the existing mutation lock, conflict reload and canonical snapshot owner.
Ordinary saves still reject execution-fact rewrites. Focused tests cover supplied
and removed historical facts, imported issue resolutions and blocker intervals,
reference/chronology/byte limits, denied/revoked identity, auth failure, concurrent
import/save and import/import races, live invalidation and no retry after conflict.
The frontend suite now passes 211 tests; focused Java store/HTTP/live tests pass
29 cases, and the complete image build passes 615 Java tests. Real-browser Compose
acceptance exports synthetic historical facts, imports changed dates for existing
IDs, restores the original export and verifies exact history/resolution retention.
Invalid chronology leaves canonical state unchanged, and the restored facts
survive container recreation and a port change. No page errors or operational
mutations; no operational workspace is imported by these checks. The primary
local preview uses this image with its unchanged volume; nothing is published.

Test infrastructure findings were corrected: the synthetic Compose base omitted
new mock services, and PH's runtime-root configuration did not match its host
bind source. Configuration tests now check the actual isolated volume definitions,
runtime-root agreement and explicit Planner base URL selection.

Real PH was built/started through scoped `build-hive.sh` service selection, without
global bee cleanup. `tests/pockethive-live.browser.cjs` then passed against a
dedicated synthetic Planner and actual PH UI/Auth/Orchestrator/journal:

- PH creation picker selects Plan/Stream/Activity and persists testPlan/tag.
- The same run receives a second Activity association.
- The exact PP journal anchor opens PH without another credential entry and loads
  real journal data with HTTP 200 under PH's own authorization.
- PP controls the actual swarm through Start and confirmed Stop, while the entire
  canonical planning workspace and revision remain unchanged.
- No browser page errors; the exact owned QA swarm is removed through PH.

The scenario is `artemis-rest` against `wiremock-local`, not a payment-system
target, and performs no Redis mutation. Nine focused PH catalogue/association
tests also pass. After acceptance, PH points back to the primary local Java
Planner and the separate QA Planner is stopped. No operational workspace was
exported, replaced or copied; no existing Redis or volume was cleared.

## Local deployment readiness refresh — 2026-10-21

- Removed the shared-artifact coordinate collision: source `2dd092f9` now uses
  explicit local JVM coordinates `0.15.38-2dd092f9`. The refresh replaces old
  generated snapshots; packaging still checks all resolved JAR/POM digests and
  refuses a different same-version cache entry. Browser auth is repackaged from
  the same PH owner; the shared UI archive is unchanged. No PH implementation,
  auth permission or Planner state owner was duplicated or changed.
- Clean source and Docker builds pass 211 frontend and 615 Java tests. All ten
  actual Compose/Ansible/Swarm configuration checks pass. The version remains
  `0.2.3-dev`; no commit, push, tag, registry publication or deployment occurred.
- Real-browser regressions pass for the standalone JAR and the exact final
  Compose image. They cover historical import, draft blockers, Started/Done and
  progress reversal, live edits/conflicts, drag, views, controlled runtime
  commands, mobile rendering, restart persistence and changed-port SSO. Both
  report zero page errors and use only synthetic isolated databases.
- The separate real-PH device/session check also passes admin writes, viewer
  denial, independent tokens, token revocation and changed-port login without
  changing PH auth configuration. It creates only its own temporary workspace.
- The PH journal handoff check now follows its explicit device-confirmation
  gate and listens before opening the tab. It still requires central-session
  reuse without a username prompt, PH's independent bearer and the exact run
  URL. This pass starts only real PH UI/Auth; the absent Orchestrator returns 502
  for journal data. It is not a new full-runtime or successful journal-data proof.
- Initial failed attempts remain in `/tmp/pp-local-finish*`: the checksum guard
  rejected mismatched old Maven cache entries; the old journal helper expected
  immediate hydration without the current confirmation gate; one standalone
  browser run rejected invalid blocker chronology while wall-clock stepping was
  visible in local build timestamps. The unchanged lifecycle assertions pass in
  the isolated final-container check and subsequent standalone rerun. No product
  retry, guessed timestamp or relaxed chronology validation was introduced.
- Six-pass review: scope is local packaging/qualification; production ownership
  and file boundaries stay unchanged; no fallback/runtime layer or new library
  is added; authorization remains at PH and PlannerAccess; existing dependency
  owners are reused; explicit source/digest/version records make the build and
  remaining limits readable. Structural documentation tests were not added.
- Fresh exact-image vulnerability results are in `SECURITY_REVIEW.md`, including
  the two unchanged Spring dependency findings and current applicability limits.
  Evidence is in `/tmp/pp-local-finish/`. Temporary projects/volumes belong only
  to the test; the original PP/PD/Redis containers and plan stores are untouched.

## Remaining work

Both reported P2 findings are resolved. Local release 0.2.3 is now qualified;
see [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md) for the current exact
image, tests, browser/restart, real-PH and security evidence. The earlier dated
development checks above do not identify the release artifact.

Registry publication, ARM64 qualification, operator-approved JSON switch-over,
remote deployment/desktop-preview-restart acceptance and remediation of the
remaining dependency advisories are separate actions. Real PH Provider/Executor
qualification against the selected Redis is not established by the local
WireMock test. No hidden protocol fallback or operational plan transfer was added.
