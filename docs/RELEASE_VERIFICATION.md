# PocketPlanner 0.2.3 release verification

Date: 2026-10-23. Local release only. No GitHub/GHCR publication, remote deployment
or operational plan transfer was performed. The existing working PP/PD/PH
containers and data volumes were not replaced.

## Exact artifacts

| Artifact | Identity |
| --- | --- |
| Application / local Git tag | `0.2.3` / `v0.2.3` |
| Local linux/amd64 image | `pocketplanner-local:0.2.3` |
| Docker image ID | `sha256:5bc8fbc219085c180b595059bc8030d1b71d427ff5a3596d9520aec73a0519a8` |
| Runtime manifest | `sha256:f100561142426c7e4b125287c50e8f4743eda2918d74dbeee68ec2f6951885a1` |
| Runtime configuration | `sha256:a429da1d4f7a0d207ede8f68de1f6e612813c3e6dc8592b93d22764f0ccb0a35` |
| Extracted release JAR SHA-256 | `e25865666cd32e431651276fb1501c716bab53c4b77ac27447d635f7f1506d67` |

The local JAR is retained at
`/tmp/pp-release-0.2.3-20261023/pocketplanner-0.2.3.jar` and the ignored build
output `backend/target/pocketplanner.jar`. Its embedded VERSION is `0.2.3`.
The runtime was rebuilt with fresh base images and OS packages, not retagged from
the older development candidate. The final frontend dependency update changes
the test tool only; the final image was built and scanned after that update.

## Build and configuration

- 219 frontend tests pass on Vitest 4.1.12; TypeScript/Vite production build passes.
- 616 Java unit/HTTP cases and five packaged-application integration cases pass,
  with no failures/errors/skips. The image build verifies the resolved shared
  library hashes and the packaged JAR, not only source compilation.
- 14 deployment configuration cases pass for actual Compose and HF/Ansible/Swarm
  rendering. They do not deploy to a lab.
- An independent Docker build from `git checkout-index` also passes all frontend
  and Java checks. It contains only staged source, not working data or ignored
  build inputs; evidence is `source-build.log` in the release directory. Its
  separate `0.2.3-source-check` image is not the qualified release artifact and
  no byte-for-byte reproducible-build claim is made.
- JVM auth is independently pinned to PH source `e98de7ac` and artifact version
  `0.15.38-e98de7ac-authhttp-fd82f5c6cc75`. Frontend package provenance and hashes
  are documented in `frontend/vendor/README.md`; no sibling checkout is required
  by a normal build.

## Final-image browser acceptance

The Compose browser fixture used the exact release image, its own empty volume
and a unique project. It verified UID/GID 10001, read-only root, dropped
capabilities, no-new-privileges, persistent SQLite and absence of Python/Node
runtime executables. Actual PH Auth on the official 8088 ingress handled sign-in.

The pass covers 28-day ranges, pending blocker links and Cancel, import/export
with lifecycle history, planned-duration controls, manual Started/Done/corrections,
What if, view-only access, live changes/conflicts, issue scopes/history, selection
after new-plan save, CRUD, drag, runtime controls, stale-lock behavior and mobile
rendering. Container recreation and a changed published port preserve its own
synthetic workspace and reuse PH's central session. No browser page errors.

The What if check now verifies a changed assumed date and a full calendar week's
forecast effect: one day from Friday to Saturday can correctly leave the finish
unchanged because weekends are not working days. The product calculation was not
changed to satisfy the test.

Evidence: `/tmp/pp-release-0.2.3-20261023/browser-final.log` and `browser-final/`.
That pass uses a synthetic PH runtime adapter; its journal request against the
existing auth-only PH returns 502 and is not claimed as journal-data acceptance.
The independent real-PH pass below supplies that acceptance.

## Real PH integration

A separate project `pp-release-023-qa-20261023`, network and database/broker
volumes hosted real local PH services and the final PP image. Its own official
ingress was loopback 18088 and its own PP loopback 18774; the existing services
on 8088/8765/8785 remained untouched. Available local PH images were explicitly
pinned to their inspected image IDs in the temporary QA configuration. The older
container configuration digests were unavailable as runnable images and were
not silently treated as a working baseline.

The successful pass verifies:

- PP device sign-in, explicit PH device confirmation and central-session reuse;
- PH catalogue reads and Plan/Stream/Activity selection on real CREATE;
- stable `testPlan` / Activity tags and linking a second Activity to one run;
- the PP exact-run journal link, PH's independently obtained bearer session and
  actual journal data HTTP 200;
- actual Start/Stop through PP, confirmed by PH;
- unchanged canonical planning facts/revision and zero browser page errors.

Only swarm `pp-java-qa-1792766487419`, run
`1895c9cd-5c0e-4fdd-ac85-704fe5e4c03c`, was created by the successful pass.
Its authored Artemis REST lifecycle scenario targets local WireMock, without
payment-system traffic or Redis mutation. The exact owned swarm was removed
through PH after testing. The temporary stack and its own volumes were removed;
no cleanup targeted earlier stacks or operational data.

The test driver now follows PH's current explicit device confirmation and waits
for the authenticated session on Login, rather than expecting the old redirect.
PP/PH/journal confirmation checks share one test helper; product permissions and
authentication behavior were not relaxed.

Evidence: `/tmp/pp-release-0.2.3-20261023/real-ph-qualified.log`,
`real-ph-qualified/`, `ph-qa.yaml` and `qa-cleanup.log`.

The release JAR additionally passes real PH device/session checks for independent
tokens, admin write, viewer denial, revocation, synthetic-store persistence and
changed-port login: `device-auth-final.log` in the same evidence directory.

## Security and remaining limits

The final exact-image scan and npm audit are recorded in
[SECURITY_REVIEW.md](SECURITY_REVIEW.md#release-023--2026-10-23).
The newly reported Vitest development-tool advisories are fixed by 4.1.12 and
the final npm audit reports zero. Two known scanner-rated Critical Spring MVC
entries remain, with the reviewed affected features absent. Ubuntu has zero
Critical/High entries, 27 Medium and 16 Low. No suppression or clean-scan claim.

This local qualification is linux/amd64. ARM64 registry builds, remote HF/lab
deployment, production identity infrastructure and private desktop forwarded
preview restart remain separate checks. Operational switch-over uses only an
explicitly authorized JSON import; no working plan was copied into QA.
Publication to GitHub/GHCR requires a separate explicit push/publication request.
The untracked `ui-detail-1366.png` debug screenshot is excluded from the release.
