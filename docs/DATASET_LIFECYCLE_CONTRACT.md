# DataSet record circulation in Redis

Agreed direction, updated 2026-10-18. Documentation only; no implementation or deployment.
This describes the existing Redis list loop used for [the live DataSet](DATAPROVIDER.md),
not a new PH record-management subsystem.

## Storage and responsibility

A DataSet is a named group of Redis lists on the configured connection. Its name
and SUT are encoded in the list namespace; swarms use the resolved input/output
lists. The planned [separate SUT/DataSet tool](DATAPROVIDER.md#global-sut-and-dataset-selection)
manages shared definitions and selection: SUT first, then one of its DataSets.
PH and PP consume the selected definitions, not independently editable catalogues.

PH runs the scenarios and their existing Redis IO. PP owns the plan, run
associations and additional control, not card/account storage or record processing.
This loop requires no new PH core API, WorkItem fields, adapter protocol or database.
Planned selection/validation and IO usage observations are separate configuration/
diagnostic concerns, not implemented capabilities or a new list pop/push protocol.

DataSets can be created when needed by Providers or external scripts using the
same convention, without a mandatory registration API call. Producers remember
the accounts/cards they created independently of Redis, with the data needed to
refill lists and restore their format description. That inventory survives a
Redis reset; its persistence belongs to the producer, not a new inventory service.

## Redis names and metadata

Use one convention shared by the tool, PH IO and external scripts. List names
carry the SUT and DataSet group. Additional metadata uses separate reserved keys,
never fake data records that an Executor could pop as a card/account.

Illustrative layout, not an implemented or final wire format:

| Redis key | Purpose |
| --- | --- |
| `<sut>:<dataset>:data:<list>` | Existing Redis list of reusable records |
| `<sut>:<dataset>:meta:format` | Shared field list with names, meanings and types |
| `<sut>:<dataset>:meta:usage:<swarmId>` | Per-swarm usage observations, such as `lastInsertAt` and `lastTakeAt` |

Choose exact key spelling, identifier escaping and metadata encoding once before
implementation. Data and metadata namespaces must stay distinct. An external
producer publishes the same format description; the tool reads that canonical
Redis description rather than storing another independently editable schema.

The format key can describe a DataSet even while its data lists are empty. Creating
and describing an empty DataSet does not require a placeholder card/account.

Planned PH input/output adapters record timestamps of successful inserts/takes
for each swarm and the lists it uses. Include the observed runId when available
to distinguish successive runs of the same swarm. Update observations after the
successful data operation; they are diagnostics, not part of a transaction/lock
protocol. Missing or stale observations remain unknown. A last-access timestamp
does not prove current membership or that a swarm is still running; PH runtime
status remains authoritative for that. External writers may add equivalent producer
observations without inventing a PH swarm identity.

Record circulation does not depend on metadata-write acknowledgement. A failed
usage update should be reported as a diagnostic failure, not trigger replay of
the successful insert/take or SUT transaction. No heartbeat service or exact
in-flight inventory is required.

## Shared record fields

The DataSet defines the common field names, meanings and types used by its Providers,
Executors and templates. A Scenario declares only the subset it needs. All required
fields must be available with compatible meanings/types; the record may contain
additional fields used by other Scenarios. Compatibility does not require identical
field sets, and extra fields are not validation errors merely because one Scenario
does not use them. Concrete names/formats belong to the DataSet's record definition.

Generating a request from a subset must not reduce the reusable record to that
subset. Return the complete reusable record, retaining unused fields and their
values. Do not replace it with the request/response body or filter out fields unknown
to the current test. Different transaction Scenarios can therefore consume the same
DataSet without losing data needed by the next Executor.

This is a shared data/template convention, not a new record wrapper, translation
service or per-record state machine.

## Normal loop

```text
Provider -> Redis input list
                    |
             Executor generator
                    |
             SUT transaction
                    |
             Post Processor
                    |
          same list / another configured list
```

1. A Provider or external producer creates/prepares data, remembers the created
   resources and adds records to Redis, including while Executors are running.
2. The Executor generator pops a record from its configured source list using the
   current PH Redis input. A successful pop removes that list entry; another
   consumer of the same list cannot pop that entry too.
3. The existing pipeline uses the record to perform the transaction.
4. Post Processor routes the reusable record to the same or another configured
   Redis list according to the scenario and outcome. Preserve the complete reusable
   record, including fields unused by this test, rather than replacing it with a
   request/response body or a projection of the required subset.

Customer, customer-scoped Product Class and enabled Streams are properties of the
scenario data. Configure sources and routing so Executors consume suitable records.
A record usable by several Streams can circulate through shared lists; do not
publish independent copies merely because several swarms use it.

When the available source lists are empty, the generator waits for data as it does
today. The swarm keeps running and consumes records when they become available.
An empty list is normal waiting, not a Redis failure or a recovery trigger.

During normal operation, Providers add newly prepared records. Replaying the whole
inventory into populated lists is not live top-up: it can duplicate records already
circulating. Full repopulation follows clearing the affected lists.

## Failures

Keep the existing PH/scenario error handling. A worker failure can leave a popped
record out of circulation; recovery does not try to find or restore each such record.
A transaction timeout or lost response does not prove that the SUT did nothing.
Do not add automatic transaction replay as part of DataSet recovery.

There are no additional per-record lifecycle states, ownership tracking, guarded
return protocol or duplicate-return guarantee in the current scope. Redis list
pop/push remains the current mechanism. Usage observations are not ownership state.

## Optional future record tracking

Only if record-level tracking becomes useful later, records may carry a recordId.
An input could then mark recordId -> swarmId in a separate Redis map/list, and a
return could clear that observation. This is deferred, not a required field or a
current implementation task. It does not imply leases, automatic return, locks,
per-record recovery or exactly-once guarantees. Any future semantics need a separate
decision; they must not be smuggled into the current simple loop.

## Recovery and repopulation

Recovery is an operator procedure:

1. Stop affected swarm work and Provider publication.
2. The operator handles cleanup of affected swarm queues and remaining work.
3. Clear the affected DataSet namespace in Redis, including old usage observations.
   Keep producer inventory and unrelated Redis data intact.
4. Providers/external producers restore the format metadata and refill the cleared
   lists from their inventory, preserving account/card identities and scenario
   data. Do not create those resources again in the SUT.
5. Check the refill and resume the swarms.

No partial-state repair, per-message reconciliation or automated empty-queue gate.
If old work remains, it may still reach the SUT; queue cleanup is the operator's
responsibility, not a new recovery subsystem. A cleanup API may be added later.

Repopulation restores the input data, not payment history, balances or SUT state.
It does not undo previous transactions or guarantee lossless/exactly-once execution.

## Checks for the selected scenarios

With isolated synthetic data, check the current pop/transaction/return loop,
live additions, source selection, preservation of the complete reusable record and
empty-list waiting followed by resumed consumption. Include two Scenarios using
different subsets: extra fields remain unchanged on return, while missing required
fields or incompatible types fail compatibility checks. Exercise worker failure, transaction
timeout and operator clear/refill recovery. Provider inventory must survive the
reset, and refill must not call SUT account/card creation again. Also check a DataSet
created by an external script, data/metadata separation, format restoration after
reset and diagnostic-only IO observations. A failed usage-metadata write must not
repeat a successful data operation. Optional record tracking is outside acceptance.

These are planned scenario checks, not new PH core functionality or tests executed
by this documentation update. PP percentages and Started/Done remain manual.
