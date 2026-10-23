# Local dependency and image review

Updated: 2026-10-23. Local release qualification, not a security certification.

## Release 0.2.3 — 2026-10-23

Trivy 0.76.0 scanned the exact final linux/amd64 image using vulnerability and
Java databases freshly downloaded for this release. The image was built with
freshly pulled base images and refreshed runtime OS packages; it is not a retag
of the older deployment candidate.

- Image: `pocketplanner-local:0.2.3`.
- Image ID: `sha256:5bc8fbc219085c180b595059bc8030d1b71d427ff5a3596d9520aec73a0519a8`.
- Runtime manifest: `sha256:f100561142426c7e4b125287c50e8f4743eda2918d74dbeee68ec2f6951885a1`.
- Java: 2 scanner-rated Critical, 0 High; the two previously recorded Spring MVC advisories below.
- Ubuntu: 0 Critical/High, 27 Medium, 16 Low.
- Exact-image report: `/tmp/pp-release-0.2.3-20261023/image-scan-final.json`.
- Final npm audit: 0 advisories; report `/tmp/pp-release-0.2.3-20261023/npm-audit-final.json`.

The fresh npm audit initially found two Moderate development-tool entries through
`@vitest/mocker`. Vitest and its override were updated from 4.1.11 to 4.1.12,
with an explicit lockfile refresh and all 219 frontend tests passing. This fixes
[manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
and [Windows backslash traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp).
Vitest is a build/test dependency, not part of the JRE runtime.

The remaining Spring findings have not been suppressed or represented as fixed.
The reviewed application has no XsltView, implicit MVC view rendering or SSE
view fragments; revision events contain typed JSON. The applicability assessment
in the advisory table below still holds for this release. Dependency remediation
requires a separately tested platform upgrade; reassess if affected MVC features
are introduced. This release is not vulnerability-free.

See [release verification](RELEASE_VERIFICATION.md) for final-image browser/auth,
restart and PH integration evidence. This qualification does not publish an
image, update an existing deployment or move operational plan data.

## Local deployment candidate 2026-10-21

Trivy 0.76.0 and a freshly downloaded vulnerability/Java database scanned the
actual local deployment candidate. The scanner executable was downloaded from
the official release and verified against its published checksum file.

- Image: `pocketplanner-local:0.2.3-dev-ready-20261021`, linux/amd64.
- ID: `sha256:866aa9d5eaf7226e66841c137ce56315cb0b9e100c42503c709abdb2e99e077c`.
- Java findings: 2 scanner-rated Critical, 0 High.
- Ubuntu findings: 0 Critical/High, 27 Medium, 16 Low.
- Local report: `/tmp/pp-local-finish/security/image-scan.json`.
- Frontend locked dependency installation reports zero npm advisories.

The Java findings remain CVE-2026-47884 and CVE-2026-47890 in Spring MVC 6.2.19.
The upstream advisories linked below were rechecked on 2026-10-21. The current
application still serves static React and explicit JSON endpoints, without
XsltView, implicit MVC view rendering or SSE view fragments. Revision SSE uses
typed JSON. The affected features are absent in the reviewed configuration; this
is an applicability assessment, not a patched-version or clean-scan claim.
There is no suppression or blanket waiver. A separately tested Spring 7/Boot 4
upgrade remains the OSS dependency-remediation route; reassess this analysis if
MVC views or SSE fragments are added.

The same exact image passes the actual Compose/browser regression with a fresh
synthetic volume, UID/GID 10001, read-only root, dropped capabilities and
no-new-privileges. Recreating the test container and changing its published port
preserves its synthetic history and central PH login. PH Auth/UI are real; the
runtime-control adapter is synthetic and this pass starts no real swarm.
Existing application containers, operational data and Redis remain unchanged.

## Scope and remediation

Reviewed the pending blocker-selection preview and confirmed-import fixes with
their regression coverage; no further actionable issue was found in that bounded
pass. Targeted tests cover 37 frontend, 316 core Java and 12 HTTP cases. The rebuilt
application also passes its full 211 frontend and 615 Java tests.

Patch-compatible dependency updates retain Java 21 / Boot 3.5.16: Jackson BOM
2.21.7, Tomcat 10.1.60, Apache HttpClient 5.6.3 / HttpCore 5.4.3 and Log4j BOM
2.25.5. The runtime remains non-root and its OS packages were refreshed. No
suppression file, compatibility backend or automatic major-framework upgrade was
introduced. The locked frontend npm graph reports zero advisories.

## Historical exact image scan 2026-10-19

Trivy 0.76.0 with its 2026-10-19 vulnerability database scanned the actual local
image, not just a Maven manifest:

- Image: `pocketplanner-local:dev`
- ID: `sha256:6a3a4704f32b7039f339332e1448566496ba006933d7c1c470702d38672a5231`
- Java findings: 2 scanner-rated Critical, 0 High.
- Ubuntu 22.04 package findings: 0 Critical/High, 27 Medium, 32 Low.
- Local report: `/tmp/pocket-family-security-review/pp-final-image.json`.

The two remaining Java entries concern `spring-webmvc` 6.2.19. They are not
silently suppressed or claimed fixed:

| Advisory | Upstream severity and required feature | Current applicability assessment |
| --- | --- | --- |
| [CVE-2026-47884](https://spring.io/security/cve-2026-47884/) | Medium; XsltView with implicit view rendering through a catch-all mapping | No XsltView, view resolver or implicit MVC view rendering is configured; the application serves static React and explicit API responses. The documented vulnerable feature is absent. |
| [CVE-2026-47890](https://spring.io/security/cve-2026-47890/) | Low; rendering view fragments through SSE with attacker-controlled data | Planner SSE sends typed JSON revision notifications, not MVC view fragments. The documented vulnerable feature is absent. |

These are code/configuration-based applicability assessments, not a claim that
the dependency is patched. Upstream lists 7.0.9 as the OSS fix and 6.2.20 as
enterprise-only. Moving to Spring 7 / Boot 4 requires a separately tested major
upgrade; it is not hidden inside this change. Reassess if MVC views or SSE
fragments are introduced. OS Medium/Low findings also remain open.

## Boundaries

The scan does not establish the absence of vulnerabilities, independently audit
all JRE code, qualify production identity infrastructure or replace penetration
testing. Native local UI/auth tests are distinct from the desktop application's
unreachable private forwarded preview. No operational plan data was exported,
copied or mutated for this review. Release 0.2.3 and its tag are local; no push,
registry publication or lab deployment occurred.
