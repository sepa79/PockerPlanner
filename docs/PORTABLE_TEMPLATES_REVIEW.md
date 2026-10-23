# Portable templates: local implementation review

Date: 2026-10-20. This is evidence for the selected local PH integration worktree
and PocketData snapshots, not a release or a general audit of PocketHive.
The contract and architecture records remain authoritative in PH; this report
does not create another contract owner.

## Ownership and competing implementations

All PH paths below are relative to `/home/sepa/PocketHive-ph-ui`.

| Stable responsibility | Implementation and consumers | Boundary checked |
| --- | --- | --- |
| RESP-TEMPLATE-DATA | `common/template-data`: JsonDocumentReader/JsonViews, JsonPointerSelector, XmlDocumentReader/XPathSelector and explicit escaping | Pebble/SpEL, SDK, clearing, HTTP Sequence and PD delegate document interpretation. Optional projections have named null/original-text semantics; they do not contain another reader. |
| RESP-TEMPLATE-SOAP | `common/template-data`: SoapEnvelope/SoapVersion | Shared request headers and response envelope/version/Fault validation. No network or workflow owner is introduced. |
| RESP-PORTABLE-HTTP | `common/request-templates`: PortableHttpCallParser/PortableResponseExtractor; `common/templating`: PortableHttpBinding/PortableHttpRenderer | One authored call shape and response contract. PH file loading and PD recipe admission use these owners rather than parallel schemas. |
| RESP-TEMPLATE-RENDER | `common/templating`: PebbleTemplateRenderer with PortableTemplateRenderer and compiler visitor | The maintained Pebble compiler owns syntax. The visitor restricts its actual AST; no source scanner, trial execution, custom language parser or copied product engine. |
| RESP-WORK-TEMPLATE-CONTEXT | `common/worker-sdk`: WorkerTemplateContext | Existing message, invocation and Redis projections retain their distinct shapes. They delegate JSON decoding rather than claiming a second SSOT. |
| RESP-CLEARING-TEMPLATE-DATA | `clearing-export-service`: ClearingStepProjection | Read-only history projection; clearing selection, writes and outcomes remain separate. |
| RESP-HTTP-SEQUENCE-PORTABLE | `http-sequence-service`: HttpSequencePortableCalls | PH adaptation admits all selected calls before authentication/HTTP. The runner remains the journey/history writer. |
| RESP-HTTP-SEQUENCE-NATIVE-RESULTS | `http-sequence-service`: HttpSequenceNativeResults | Existing native extract/set projections stay distinct from portable extraction and delegate document decoding. |
| RESP-HTTP-SEQUENCE-HTTP-EXECUTION | `http-sequence-service`: ApacheHttpCallExecutor | Explicit no-retry/no-redirect portable transport. The interface fails closed when unsupported instead of falling back to native execution. |

PD's PopulationTemplates/PopulationResponses are thin shared-library adapters.
PopulationValidator owns product references and recipe preflight;
PopulationJobs/PopulationJob own the finite job. CsvInventory and its delegates
own durable response/final CSV output; RedisDatasets owns publication. These are
not alternate template/document owners. The actual constructor and call paths,
not merely class names or package locations, were checked during peer review.

## Six required passes

- Plan: approved portable-v1 is independently portable per call, not a common
  workflow engine. Separate record/params/endpoint binding, strict required
  selection, native PH views and opaque WorkItem transport have explicit tests.
  PR #528 cryptography and WorkItem issue #529 are excluded, not silently fixed.
- Style: new production types have separate files and responsibility contracts.
  SDK rendered/config values and HTTP transport values were extracted instead of
  adding public nested contract bags. Existing unrelated work was preserved.
- Conciseness: duplicate PD parsers and engine construction were removed. Shared
  libraries own interpretation; product adapters retain only product decisions.
  There is no format-guessing chain, old recipe converter or fallback runtime.
- Security: strict UTF-8/Unicode and JSON structure, bounded XML/XPath, disabled
  external XML resources, explicit escaping and fixed-origin paths/headers are
  covered. Portable rendering cannot invoke Java methods. PD auth is checked
  before decoding mutations; safe error codes do not expose response data.
  Portable HTTP execution does not automatically retry creation requests; PD jobs
  do not automatically resume after uncertainty. Existing PH broker-delivery
  semantics are not replaced with an exactly-once protocol.
- Libraries: reuse Jackson, JAXP, Pebble and Apache HTTP facilities. The added
  internal module centralizes data interpretation; it is not another transport,
  scripting framework or infrastructure service.
- Maintainability: stable architecture IDs, named projections, identical authored
  fixtures in both adapters and separate admission/render/response/transport
  tests document where behavior belongs. Additional files express these narrow
  owners, rather than reducing line count by recombining responsibilities.

## Findings closed by regression tests

Independent peer checks found numeric overflow/representation divergence and
unpaired-surrogate handling. The shared reader/binding/escaping paths now reject
invalid values consistently and preserve supported decimal values. Transport
review also closed silent invalid-UTF-8 replacement and loss of an explicitly
empty/whitespace-only portable request body. No retry-enabled native transport is
used as a portable fallback.

Fresh evidence:

- `/tmp/ph-portable-final-tests.log`: 479 selected reactor tests pass, none
  skipped, including 272 shared data tests and unchanged opaque WorkItem tests.
- `/tmp/ph-portable-transport-final-tests.log`: eight focused tests pass after
  the final transport fixes. These overlap the reactor selection and must not be
  added as eight entirely distinct tests.
- `/tmp/pd-portable-image.log`: self-contained Docker build, 72 UI tests and 130
  Java tests; zero failures, one explicitly gated isolated-Redis test skipped.
- `/tmp/pocketdata-portable-browser/evidence.json`: actual UI, shared PH login,
  JSON/SOAP11/SOAP12, Fault/Stop, CSV/Redis and changed-port restart pass. Nine
  mock calls, zero browser errors, owned-resource cleanup verified.
- `/tmp/ph-portable-soap-runtime.log` and
  `/tmp/pd-ph-soap-1792507045887-1948e483-As5JK6/evidence.json`: real PH
  validation/publication, CREATE/START, HTTP Sequence SOAP11/12 calls and
  HTTP-200 Fault through official ingress. Exactly one finite submission/request
  per case; actual taps/journal verify extraction, history and no retry/next
  step/output after Fault. Owned-resource cleanup passes for all three cases.

No full PH regression-suite, production payment API, large-scale/24-hour load or
remote deployment qualification is claimed. The exact current PD image has not
received a fresh vulnerability scan; its older scan and residual findings remain
identified as historical in PD `docs/SECURITY_REVIEW.md`.
