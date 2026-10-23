# Live DataSet first stage

Updated: 2026-10-18. Documentation only; no implementation or deployment.
The [live DataSet model](DATAPROVIDER.md) defines PH execution and PP planning/control.
The [Redis circulation contract](DATASET_LIFECYCLE_CONTRACT.md) uses the current PH
list input/output loop. A separate tool will manage SUT/DataSet definitions;
PH/PP consume the selected configuration. Selection and simple IO usage observations
in Redis need integration, not a new record-management subsystem.

## First usable slice

Use one explicit test environment, the configured Redis lists, a producer (PH
Provider or external script) and at least two Executors on different transaction paths.
Keep background traffic
running while increasing load on the other path. Include one representative
scheduled background flow such as clearing or notifications.

Providers add records live. Executor generators pop suitable records, the existing
pipeline performs transactions, and Post Processor routes records back to the
configured lists. Empty lists leave generators waiting with their swarms running.
No new record-state machinery, Redis protocol or central database is required.

## Step 1 Select existing scenarios and lists

Choose the producer and Executor scenarios, Redis connection and source/destination
lists. Define Customer/Product Class/Stream mapping in their data,
source selection and routing. For planned catalogue selection, follow the
[global SUT/DataSet direction](DATAPROVIDER.md#global-sut-and-dataset-selection):
select SUT first, then one of its DataSets, and resolve that group into existing
settings, including template references and return destinations. The separate
tool owns definitions; Scenario Manager is not a second editable catalogue.
No per-record DataSet identifier is required by the Redis loop.

Agree the DataSet's common field names/meanings/types and each Scenario's required
subset. Store the field description in Redis metadata under the common naming
convention, separate from the data lists. Extra fields are allowed and must remain
in the reusable record after return. Check two Scenarios using different subsets
of the same DataSet, including one created externally without a registration call.

Confirm where the producer remembers created accounts/cards independently of
Redis and how it restores the format metadata and usable list records. This is
producer-specific work. Repopulation reads inventory without repeating SUT creation.

## Step 2 Exercise the current PH loop

1. A PH Provider or external script remembers created resources and publishes
   records and their Redis format description under the common convention.
2. Two Executors consume their configured shared or dedicated lists.
3. Post Processor routes reusable data to the correct next list under scenario policy.
4. Empty-list generators wait and consume again when records arrive.
5. Fail a worker or transaction and observe the existing scenario error handling.
6. Stop affected work/publication, let the operator clean affected swarm queues,
   clear the DataSet namespace and repopulate format/data from producer inventory
   before resuming. Old usage observations are not restored.

Normal publication adds new data; do not replay the entire inventory into lists
that still contain circulating records. Recovery does not reconstruct individual
lost records or transaction outcomes. Queue cleanup is manual; an API can follow
later. No duplicate-return guarantee or automatic failure reconciliation is required.

Planned input/output adapters leave simple per-swarm usage observations in Redis,
such as the last successful insert/take and observed run identity. These are
diagnostics, not current-membership proof or record ownership. Failure to update
usage metadata must not replay the data operation. Per-record tracking is deferred.

## Step 3 Present relationships and controls in PP

Use existing Plan/Stream/Activity and exact-run associations. Later execution rows
can show which Provider/Executor runs use the configured Redis lists and the
separate tool can show externally created DataSets. Shared data
does not imply a shared traffic mix. Show list availability and configuration/
runtime observations only where PH actually exposes them; missing values stay
unknown. Do not copy card payloads to PP or scan millions of records on refresh.

PP sends authorized high-level intent through supported PH controls, not Redis
commands. A future shared mix edit must show all affected exact runs, including
outside the selected Plan, and reject stale confirmation. Shared-source/mix
presentation and controls remain separate work, not prerequisites for the Redis loop.
Dates, issues, %, Started and Done remain operator-controlled.

## Step 4 Check cross-stream impact and scale

Start with small synthetic data covering several Customers/Product Classes and
single-/multi-Stream eligibility. Capture a baseline, add records live, spike one
path, observe other paths/background work, restore baseline and observe recovery.
Compare latency, throughput, errors and backlog over aligned windows and exact runs.

Then qualify the intended five Customers with roughly two to five Product Classes,
five to eight transaction swarms and several million records. These are profiles,
not hard-coded limits. Set actual TPS and environment limits before performance
claims. A 24-hour run at the agreed profile should include live additions, background
work and spike/recovery. Small-fixture success is not a scale/soak result.

## Acceptance boundary

Demonstrate the current list loop, suitable source/routing configuration, live
additions, empty-list waiting, subset compatibility with complete-record preservation
and producer-driven clear/refill recovery. Include external creation, metadata
separation/restoration and successful-data/failed-usage-write behavior. Redis reset
must not erase producer inventory or recreate accounts/cards in the SUT.
Runtime checks must leave PP planning facts unchanged.

No changes to PH core record lifecycle, WorkItem format or control-plane routing
are required for the basic Redis circulation contract. Tool integration, selection
and IO observations are planned extensions, not implemented capabilities. No new
record coordinator, mandatory recordId, lease/recovery service, automatic progress/
issue updates, Rovo integration or rename of PH scenarioId/templateId belongs here.
