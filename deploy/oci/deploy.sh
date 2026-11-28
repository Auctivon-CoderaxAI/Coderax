#!/bin/sh
# Rebuild and start the OCI stack with the deployed source revision stamped into
# the image. `/api/config` reports it as `buildInfo.commit`, which is the value
# the release gates compare against the served Worker revision; an image built
# without it is reported as unverified instead of being assumed current.
#
# Usage: sh deploy/oci/deploy.sh
# Overrides: CODERAX_SOURCE_COMMIT, CODERAX_SOURCE_BRANCH, CODERAX_BUILD_DATE
set -eu

cd "$(dirname "$0")"

commit=${CODERAX_SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || true)}
case "$commit" in
  '' | *[!0-9a-fA-F]*)
    echo 'A source commit is required: check out the reviewed revision, or set CODERAX_SOURCE_COMMIT.' >&2
    exit 1
    ;;
esac
[ "${#commit}" -eq 40 ] || {
  echo "The source commit must be the full 40-character SHA; got ${#commit} characters." >&2
  exit 1
}

branch=${CODERAX_SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}
case "$branch" in
  HEAD | '') branch='' ;;
  *[[:space:]]*)
    echo 'The source branch must not contain whitespace.' >&2
    exit 1
    ;;
esac

BUILD_COMMIT=$commit
BUILD_BRANCH=$branch
BUILD_DATE=${CODERAX_BUILD_DATE:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}
export BUILD_COMMIT BUILD_BRANCH BUILD_DATE

printf 'Stamping the image with commit %s (branch %s, built %s).\n' \
  "$BUILD_COMMIT" "${BUILD_BRANCH:-(detached)}" "$BUILD_DATE"

docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up -d --build --wait

# Confirm the running API reports the revision just stamped. The direct origin
# requires the proxy secret Caddy expects; it is read from origin.env and never
# printed.
if [ ! -f origin.env ]; then
  echo 'origin.env is missing; skipping the buildInfo confirmation.' >&2
  exit 0
fi
. ./origin.env
if [ -z "${CODERAX_API_HOST:-}" ] || [ -z "${CODERAX_PROXY_SECRET:-}" ]; then
  echo 'origin.env has no API host or proxy secret; skipping the buildInfo confirmation.' >&2
  exit 0
fi
config=$(curl -fsS -H "X-Coderax-Proxy-Secret: $CODERAX_PROXY_SECRET" "https://$CODERAX_API_HOST/api/config")
case "$config" in
  *"\"commit\":\"$BUILD_COMMIT\""*)
    printf 'Confirmed: /api/config reports buildInfo.commit %s.\n' "$BUILD_COMMIT"
    ;;
  *)
    echo 'FAILED: /api/config does not report the stamped commit; the release gate will treat this deployment as unverified.' >&2
    exit 1
    ;;
esac
