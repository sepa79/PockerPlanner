#!/usr/bin/env bash
set -euo pipefail
fail() { printf 'Shared auth verification failed: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || fail 'Usage: verify-shared-auth.sh VERSION RESOLVED_CLASSPATH'
version="$1"
[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'An explicit artifact version is required.'
backend_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="$backend_root/vendor/maven"
[[ -f "$vendor/SHA256SUMS" ]] || fail 'The vendored SHA256SUMS manifest is missing.'
(cd "$vendor" && sha256sum --check --strict SHA256SUMS) || fail 'Vendored shared auth inputs are invalid.'
manifest="$(< "$vendor/SHA256SUMS")"$'\n'
IFS=: read -r -a classpath <<< "$2"
cache_root=''
for artifact in auth-client auth-contracts; do
  suffix="/io/pockethive/$artifact/$version/$artifact-$version.jar"
  [[ "$manifest" == *"  ${suffix#/}"$'\n'* ]] || fail "The manifest does not contain $artifact $version."
  matches=0
  resolved_root=''
  for entry in "${classpath[@]}"; do
    if [[ "$entry" == */io/pockethive/"$artifact"/* ]]; then
      [[ "$entry" == *"$suffix" ]] || fail "Unexpected resolved $artifact version: $entry"
      matches=$((matches + 1))
      resolved_root="${entry%"$suffix"}"
    fi
  done
  [[ "$matches" == 1 ]] || fail "Expected exactly one resolved $artifact $version JAR; found $matches."
  [[ -z "$cache_root" || "$cache_root" == "$resolved_root" ]] || fail 'Resolved auth artifacts use different Maven cache roots.'
  cache_root="$resolved_root"
done
[[ -d "$cache_root" ]] || fail 'The resolved Maven cache root is missing.'
(cd "$cache_root" && sha256sum --check --strict "$vendor/SHA256SUMS") || fail 'Resolved shared auth JAR/POM inputs do not match the vendored manifest.'
printf 'Resolved shared auth %s JAR/POM inputs match the vendored manifest.\n' "$version"
