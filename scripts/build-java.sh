#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
npm --prefix "$root/frontend" ci
npm --prefix "$root/frontend" test
npm --prefix "$root/frontend" run build
mvn -B -f "$root/backend/pom.xml" clean verify
