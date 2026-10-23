# Live DataSet and continuous platform simulation

Agreed direction, updated 2026-10-18. PocketHive runs the simulation; PocketPlanner owns
the plan and additional control. The live DataSet and its record lifecycle are
the centre of execution, not a collection of otherwise independent swarms.
The record loop uses existing PH Redis IO. The additional PP grouping/control
described here and in the [first-stage delivery plan](LIVE_DATASET_STAGE1.md)
is not implemented by the existing run-link and execution-row integration. Global
SUT/DataSet selection and the shared field convention below are agreed direction,
not current runtime capabilities.

## Simulation goal

Simulate continuous 24/7 load across a large online-payments platform, including
transaction entry points and background processing such as clearing and
notifications. Maintain normal traffic while applying a spike or heavier load
to one path, and observe its effect on the other paths and their recovery.
Background tasks retain their own continuous or scheduled rhythm during the
experiment; they are not disabled to make the selected stream look healthy.

The concrete workload includes several million cards/accounts, five Customers
with roughly two to five Product Classes each, and five to eight transaction
swarms. These describe the use case, not hard-coded limits or a supplied TPS
target. Paths include ISO8583 variants such as MC, PCS, PROSA and CTAP, WEBAUTH,
and SOAP/Chopin. Protocol, transaction kind, Customer and Stream are separate
dimensions; a naming resemblance does not establish their identity or mapping.

## Global SUT and DataSet selection

Use global SUT identity rather than a competing environment definition inside each
scenario or PP. PocketHive's `docs/todo/global-sut-mocks-spec.md` (Global SUTs,
Shared Mocks and Continuous Plans) is related design context. The agreed direction
here places definition management in a separate SUT/DataSet tool, not Scenario
Manager. Its product name, storage of SUT definitions and integration API are not
selected here; this does not introduce another record-processing service.

The tool manages SUT definitions and presents their DataSets. PH consumes the
selected configuration and owns execution/low-level controls; PP owns planning
and additional control. Neither keeps an independently editable copy of the catalogue.
DataSet record format and usage metadata live with the lists in Redis under the
[naming convention](DATASET_LIFECYCLE_CONTRACT.md#redis-names-and-metadata), not in
a competing schema registry inside the tool.

Choose SUT first, then one of its DataSets; the picker does not offer DataSets from
another SUT. A DataSet is a named group of lists on the configured Redis connection,
not a separate execution service or per-record lifecycle. Several DataSets can
belong to one SUT. Providers and Executors use the same group to share data, without
a direct Provider-to-Executor link.

DataSets are created when needed. A PH Provider, an external script or another
producer can create/populate the lists and publish their format metadata using
the same convention. Neither a Provider swarm nor a tool/PH registration call is
a prerequisite for data creation. The tool can read a correctly named/described
DataSet created outside PH.

For the selected Scenario/profile, compatibility means the SUT supplies the required
endpoints and the DataSet supplies the required fields with the expected meanings/
types. Customer, Product Class and enabled-Stream selection still follows the data
and routing. Extra fields are allowed and preserved. See the
[shared record contract](DATASET_LIFECYCLE_CONTRACT.md#shared-record-fields).

The selected binding supplies consistent input lists, return destinations and
template parameters. Templates must use the selected binding rather than fixed
environment-specific list names; a different DataSet must not leave old destinations
inside a request template. Preserve the distinction between SUT settings, DataSet
settings and Scenario/profile behavior. This concerns catalogue resolution and
configuration at launch, not a new protocol for circulating records.

The selected SUT, Redis connection and DataSet name/prefix identify the group;
no additional identifier is required in each Redis record or WorkItem. PH selection,
validation and configuration integration remains planned work, separate from the
existing Redis pop/push loop. Planned IO adapters also publish simple usage
observations; they do not become a record-ownership protocol.

## Live record circulation

```text
PH Data Providers / external scripts
  | create/add cards and accounts, including while Executors are running
  v
Live DataSet in Redis
  | select eligible Customer / Product Class / Stream records
  v
Executors in PH -> transaction on the SUT
  | record context and execution outcome
  v
Post Processor in the execution pipeline
  | decide the record's next disposition
  +--> same Redis list / another configured Redis list
```

The DataSet is not sealed before all traffic can begin. New records can be added
without stopping consumers or rebuilding the whole DataSet. Existing records
circulate through transaction execution and postprocessing; this is neither a
read-only shared replay nor a one-use queue that simply discards each card.

A record belongs to a Customer and that Customer's Product Class and has explicit
Stream eligibility. Some records serve only one Stream, others several. Several
Executors can use the same logical pool without independently owning copies of
the underlying cards/accounts. The current list pop removes the entry until the
pipeline returns it. Sources and routing select suitable records; shared use does
not require new per-record ownership tracking.

Post Processor chooses the next pool/disposition from scenario policy and the
outcome using existing PH Redis output/routing. No PH core redesign is required
for this circulation. A DataSet is the relevant Redis lists on the configured
connection. Swarms use those resolved list settings; catalogue selection does not
add per-record lifecycle metadata. A transaction timeout is not proof that the
SUT did nothing.

Redis holds the live pool and its format/usage metadata. Producers, whether PH
Providers or external scripts, keep their own persistent inventory of created
accounts/cards independently of Redis and repopulate from it when needed.
Repopulation restores the format description as well as list records; old usage
observations are cleared, not reconstructed. It does not recreate resources in the SUT
or restore payment history. Inventory records resource identities and eligibility;
it is not a transaction history or proof that a timed-out payment failed.
This does not introduce another central database or prescribe how a Provider
or an external producer persists its resource inventory.

The [simple Redis circulation contract](DATASET_LIFECYCLE_CONTRACT.md) keeps the
existing list pop/transaction/push loop without additional lifecycle states or a
new return protocol. Empty lists leave the generator waiting as today. Normal
Provider publication adds newly prepared data, not a replay of the whole inventory
into populated lists. Recovery stops affected work/publication, leaves swarm queue
cleanup to the operator, clears the affected Redis lists and repopulates from
producer inventory before resuming. No partial-state reconstruction or automated
queue-empty gate is required. A cleanup API can follow later.

## Ownership

| Owner | Responsibility | Boundary |
| --- | --- | --- |
| PocketPlanner | Plans, Streams, Activities, deadlines, issues, operator progress and additional high-level control | Not the execution engine, a card database or a Redis client |
| Separate SUT/DataSet tool | Manage shared SUT definitions and DataSet presentation; read/write the canonical Redis format description | Not a second record store or an execution engine; external producers need not call it to create data |
| PocketHive | Swarm creation and lifecycle, low-level execution/configuration, existing Redis IO and observed outcomes | Does not independently own or infer the PP plan/calendar |
| Data Provider swarm | Prepare SUT data, remember created accounts/cards persistently and publish/repopulate Redis records | Not a separate service beside PH; rebuilding Redis does not create the SUT resources again |
| External producer/script | Create/populate a DataSet under the same naming/format convention and retain its resource inventory for repopulation | Does not require a PH swarm or recreate SUT resources during refill |
| Executor swarm | Select eligible records and execute its transaction pipeline | Does not decide reuse merely because intake popped a record |
| Post Processor | Route reusable records to the configured next Redis list under scenario policy | Not a new record-lifecycle manager |
| Existing PH Redis adapters | Execute configured list pop/push operations | No additional record states or per-record PP dependency |
| Planned input/output usage observations | Record successful per-swarm inserts/takes in Redis metadata | Not proof that a swarm is still active, a lock or a prerequisite for record circulation |

PP sends authorized runtime intent to PH and reads PH observations. PH owns admission,
configuration application and verified operation outcomes. PP editing permission
does not grant PH execution permission. Provider and Executor are roles of PH
swarms, not reasons to introduce another runtime manager.

## Data selection and mix

Data availability, Stream eligibility and traffic mix are separate facts. A shared
DataSet does not imply a shared mix. Each Executor can select different proportions
of Customer/Product Class records from the same pool; an explicitly shared mix
profile can instead affect several Executors. Both dedicated and shared DataSet
bindings are supported by the direction, without guessing membership from names.

Distinguish three changes:

- Provider changes add supply or alter how future records are prepared.
- Executor mix/rate changes alter subsequent selections or traffic, not card
  ownership, record attributes or other consumers' private profiles.
- Shared eligibility, routing or mix-profile changes can affect several runs.

A change must identify its exact configuration and complete affected-run set,
including consumers outside the current Plan/Stream and stopped bound consumers.
Use PH instance, swarmId and runId, not only a count or display name. Show current
versus proposed settings, configuration/binding revisions and observation freshness.
If membership or configuration changes before application, reject the stale
confirmation and request a fresh review; never silently broaden its impact.

Desired mix is not measured traffic. Uneven availability, in-flight work and
queues can delay its observed effect. Do not flush, rewrite or prematurely return
existing/in-flight records to force a new distribution. Effective-change boundaries,
unavailable requested groups and in-flight work are explicit contract decisions,
not a silent fallback to another Customer, Product Class, Stream or profile.

## Planning and runtime views

Keep Plan / Execution / Mixed and expandable Stream -> Activity -> exact-run rows.
Later DataSet details should show Provider/Executor bindings, pool health and
Customer/Product Class distribution without exposing millions of records in PP.
Shared entities displayed under several rows remain references to one PH owner.

A single long-lived Executor run can span Minimal, Background, Heavy and Spikes
as parameters change; an Activity can also use several runs. These are not forced
restarts or automatically inferred active phases. PP %, Started and Done remain
operator-controlled. Existing Activity tags are associations, not phase evidence.

PP needs bounded aggregates and links to authoritative PH/monitoring details:
list lengths, selection/return rates where exposed, unavailable groups, desired and
observed mix, and per-path throughput, latency, errors and backlog. List lengths
are availability, not the total created-card inventory; no new in-flight record
registry is required. Repeated views of the same shared list must not multiply its count.
Mark unavailable/stale observations explicitly; DataSet readiness is neither
business success nor Activity completion and does not automatically create issues.

To inspect cross-stream effects, retain the selected spike/change, exact runs and
observation interval alongside comparable background/baseline metrics. PP provides
the experiment context, not another metrics store or an assertion of causality
from timestamps alone. PH record processing must not wait for PP availability.

## Terminology and implementation boundary

Scenario/collection can describe the overall composition in design discussions.
No rename of existing PH scenarioId/templateId or new competing TestPlan entity
is approved here. Preserve exact run identity and the current PP/PH association
contract; settle composition naming and ownership before adding public fields.

Earlier PH Collections and Managed Dataset proposals are useful design input,
not constraints overriding this live circulating-data use case. The approved
direction is recorded here; detailed choices and acceptance gates are in
[stage one](LIVE_DATASET_STAGE1.md). No new runtime API, adapter, schema, UI control,
deployment, automatic phase transition or Rovo integration is delivered by this
documentation update.
