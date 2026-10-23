# PH / PocketData portable templates

Local contract approved by the human on 2026-10-20. Planner's plan data, auth and
execution associations are outside this implementation; no PP runtime is changed.

The authoritative contract lives in the selected PH source at
`docs/contracts/portable-http-templates.md`; ownership is recorded in its
`docs/architecture/runtime-responsibilities.md`. PocketData consumes checksummed
local Maven artifacts, never a forked reader or a runtime sibling checkout.

One independently portable call declares `portable-v1`, capabilities, canonical
HTTP request and response interpretation. Its inputs separate record data,
parameters and endpoint binding. The PH HTTP Sequence and PD Population adapters
use the same parser, compiler/render profile, JSON/XML selectors and SOAP owner.

This is not a shared workflow engine. PD keeps its finite loop, response audit,
durable final CSV before Redis, Stop and no automatic retry. PH owns WorkItem
history, execution and outcome. WorkItem envelopes retain opaque payload strings;
issue #529 and PR #528 cryptography remain separate.

JSON/XML are selected explicitly. Required selectors reject missing/null or
malformed data rather than making valid empty input. Existing PH payload views
remain named optional projections backed by the same strict document owner.
Portable templates do not inherit their different payload/vars meanings.

The initial profile admits text/output expressions and explicit functions, not
eval, sequence, Java methods, workflow conditionals/loops or imports. The real
Pebble compiler AST enforces admission; no source regex/token scanner is used.
Unknown capabilities, unsafe step retry policies and unsupported syntax fail
before auth/HTTP effects. Unicode, escaping and parser limits are shared behavior.

See PocketData `docs/POPULATION.md` for recipe authoring and durable-output
semantics. Code/component test results and deployed-ingress acceptance are
separate evidence; neither an older green test report nor an unbuilt source
checkout proves the currently running stack supports the new profile.

Local ownership/review findings and exact test evidence are recorded separately
in [the implementation review](PORTABLE_TEMPLATES_REVIEW.md).
