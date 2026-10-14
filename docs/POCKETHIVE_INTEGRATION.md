# PocketHive integration design

Agreed direction as of 2026-10-14. Design only: implementation is deferred until explicitly requested. The current application has no run associations, requirement-document references, actual-start fields or execution-control tools. This does not extend the existing [data contract](ARCHITECTURE.md#data-contract) or authorize deployments, plan mutations or PocketHive commands.

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

PH currently accepts free-text `testPlan`; it is not a validated Planner foreign key. The precise representation of stable plan identity, Planner instance identity and the Activity tag namespace must be settled before implementation. Renames and duplicate names must not silently change associations.

The current PH tag normalizer truncates tags to 64 Java string code units and keeps at most 32 distinct tags. Planner IDs can have up to 80 characters before a tag prefix is added. The integration must validate the complete tag and total tag count before writing and reject unsupported mappings explicitly, never truncate IDs or remove unrelated tags to fit.

The run metadata endpoint replaces `testPlan`, `description` and `tags`; it is not a partial patch. Existing descriptions, tags and plan context must be preserved when composing a change. Concurrent metadata edits need an explicit reconciliation strategy, not a blind read-modify-write that overwrites another operator.

## Actual Activity start

Keep the existing planned start and dependency-derived schedule separate from **Started at**, the proposed recorded actual start date and time. Date confirmation means approval of a planned date, not proof of execution. Record a timezone-aware actual timestamp independently; schedule moves must not rewrite it.

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

The association and start-recording interfaces do not exist yet. Current [Planner MCP tools](MCP.md) must not be used to smuggle these records into descriptions or unsupported fields.

## Requirement documents

Allow multiple requirement-document references on both Streams and Activities. Stream documents provide shared context; an Activity can add task-specific documents and display the Stream references with their source clearly identified, without duplicating stored content.

A reference should provide a title, document ID, human-readable page URL and JSON source. Requirement exports need stable requirement IDs and a document revision or immutable version. The exact export contract is pending the separate requirement application's JSON schema.

An authorized agent can read selected requirement JSON to prepare tests or PH scenarios. Generated artifacts and executions must retain the requirement IDs and the document version they used, rather than pointing only to a changing "latest" page. Generating a test does not authorize launching it or modifying plan progress.

Requirement text, imported JSON, plan descriptions, journal notes and future Rovo content are untrusted data, never instructions or authorization. Source access, validation and credential handling need explicit contracts; do not turn arbitrary document URLs into unrestricted server-side fetching.

## Implementation boundaries

- No full PH launch console, second execution-state database or automatic status synchronization in the first stage. Planner shows linked runs and their PH references.
- No automatic progress calculations, issue resolution or inferred test success from run lifecycle or journal first/last entry times.
- No separate phase calendar in PH. Planner owns Activity timing; tags provide associations and optional journal references provide evidence.
- Rovo remains future work with separately approved credentials and evidence mapping.
- Before implementation, settle metadata identity/encoding and concurrency, actual-start persistence and retry semantics, journal reference lookup, and the requirement JSON version contract. Add validation and isolated regression tests before enabling any writes.

## PH contract baseline

The source baseline for the existing PH fields is main commit `01e80a45`. These are source contracts, not a claim that this integration has been tested against a running deployment.

- `common/journal-postgres/.../journal/api/SwarmRunMetadataUpdate.java`: `testPlan`, `description`, `tags`.
- `common/journal-postgres/.../journal/api/SwarmRunSummary.java`: swarm, run and scenario identity plus operator metadata; no test-result status.
- `orchestrator-service/.../orchestrator/app/SwarmController.java`: CREATE runtime UUID and existing-runtime START/STOP behavior.
- `orchestrator-service/.../orchestrator/app/JournalController.java`: run listing, metadata updates and paginated journal queries. These journal APIs currently require the PostgreSQL sink; metadata updates require PH deployment-management permission.
- `common/journal-postgres/.../journal/postgres/JournalMetadataNormalizer.java` and `PostgresJournalRunMetadata.java`: tag limits and metadata replacement semantics.
- `common/journal-postgres/.../journal/postgres/JournalEventRowMapper.java`: paginated journal event identity and correlation fields.

Recheck the deployed PH version and its contracts before implementing or testing the integration. Future wire fields, MCP tools and migrations are not specified or enabled by this note.
