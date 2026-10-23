# Shared Pocket frontend inputs

These are actual locally packaged PH libraries, also consumed by PocketData.
The package contents own shell/theme and browser device authorization; this app
imports them rather than copying their implementations. They have not been
published to a registry. npm's lockfile records archive integrity.

The frontend inputs come from PH commit
`2dd092f9690854cc9dbcd7cc606eaa698f9ac1af`. JVM auth is refreshed independently
from PH source `e98de7ac`, using artifact coordinate
`0.15.38-e98de7ac-authhttp-fd82f5c6cc75` and the separate manifest at
`backend/vendor/maven/SHA256SUMS`. Updating snapshots is
explicit; do not disable the resolved-artifact checksum gate to reuse a different
same-version Maven cache entry.

| Input | SHA-256 |
| --- | --- |
| `pockethive-browser-auth-0.0.0-81d17d85adef.tgz` | `81d17d85adef5948ec244f69b48baaa297f2444327c46a32783248806c2ad037` |
| `pockethive-ui-0.0.0-62693417417a.tgz` | `62693417417a82ddfb8892e98417760f415f2fced9bf1c7cd9e30475a260cf20` |

Source owners are PH `packages/browser-auth` and `packages/ui`. To change a shared
behavior, change/test/package it there, then explicitly refresh these inputs and
the lockfile. Never patch installed library code or introduce a product fallback.
Normal installation/build uses only this repository, not sibling checkouts.
