#!/bin/sh
# Records the Automations fixtures from a real kernel, in a container of its own (README.md in
# the directory above says what each file is):
#
#   plugin/test/fixtures/automations/record/record.sh
#
# It is the real run's container and setup (container/real/setup.sh: bb-app at the repository's
# pin, OATS from npm, the bb session provider of this checkout, Claude Code on the mock model),
# then record.mjs instead of the real run's scenario. The answers come out to record/out/ (ignored
# by git); UPDATE_FIXTURES=1 copies them over plugin/test/fixtures/automations/.
#   KERNEL_NPM, KERNEL_INTEGRITY, KEEP, NAME, IMAGE, DOCKER_RUN_ARGS   as container/real/run.sh
# The container gets 2 CPUs and 6 GB, no mount, no port, no Docker socket and nothing of the
# host's home. A recording takes about twelve minutes.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(cd "$HERE/../../../.." && pwd)
REPOSITORY=$(dirname "$PLUGIN")
KERNEL_NPM=${KERNEL_NPM:-0.70.0}
if [ "$KERNEL_NPM" = 0.70.0 ]; then
  KERNEL_INTEGRITY=${KERNEL_INTEGRITY-sha512-DeVGFZi1ev2ClxF3p/UV0OBc4XwAWuLjEckJ56rz7UVCg8deavPAOHPjeIuyIvg5l4g52rzRBtoe3aVsxQrxrQ==}
fi
KERNEL_INTEGRITY=${KERNEL_INTEGRITY:-}
IMAGE=${IMAGE:-bb-plugin-oats-test}
NAME=${NAME:-bb-plugin-oats-automations-$$}
OUT=$HERE/out
[ -z "$(git -C "$REPOSITORY" status --porcelain -- oats-package)" ] || { echo "record: oats-package/ has uncommitted changes: commit them, the provider is taken from HEAD" >&2; exit 2; }
PROVIDER_OID=$(git -C "$REPOSITORY" log -1 --format=%H HEAD -- oats-package)

docker build -q -t "$IMAGE" "$PLUGIN/container" > /dev/null
# shellcheck disable=SC2086 # DOCKER_RUN_ARGS is a list of arguments
docker run -d --name "$NAME" --init --cpus 2 --memory 6g -e BB_TELEMETRY=false ${DOCKER_RUN_ARGS:-} "$IMAGE" sleep infinity > /dev/null
cleanup() {
  status=$?
  rm -rf "$OUT"
  mkdir -p "$OUT"
  docker cp "$NAME:/home/node/out/automations/." "$OUT/" > /dev/null 2>&1 || echo "record: no answers to copy out"
  if [ "${KEEP:-0}" = 1 ]; then echo "record: container $NAME kept"; else docker rm -f "$NAME" > /dev/null; fi
  exit $status
}
trap cleanup EXIT

BB_VERSION=
[ ! -f "$REPOSITORY/bb-version" ] || BB_VERSION=$(tr -d '[:space:]' < "$REPOSITORY/bb-version")
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" -e "KERNEL_NPM=$KERNEL_NPM" -e "KERNEL_INTEGRITY=$KERNEL_INTEGRITY" -e REQUIRE_REAL_FLOOR=1 -w /home/node/plugin "$NAME" "$@"; }
run mkdir -p /home/node/real/provider /home/node/out/real /home/node/out/automations
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude ./container/real/out --exclude ./test/fixtures/automations/record/out .) | docker exec -i -u node "$NAME" tar -x -C /home/node/plugin
git -C "$REPOSITORY" archive HEAD oats-package | docker exec -i -u node "$NAME" tar -x -C /home/node/real/provider
printf '{"kernel":"npm:@awebai/oats@%s","provider":"%s"}\n' "$KERNEL_NPM" "$PROVIDER_OID" | docker exec -i -u node "$NAME" sh -c 'cat > /home/node/real/refs.json'

run bash container/real/setup.sh
run node test/fixtures/automations/record/record.mjs
echo "record: bb-app $BB_VERSION, OATS $KERNEL_NPM, the provider at $PROVIDER_OID"
if [ "${UPDATE_FIXTURES:-0}" = 1 ]; then
  docker cp "$NAME:/home/node/out/automations/." "$PLUGIN/test/fixtures/automations/" > /dev/null
  echo "record: the answers are in $PLUGIN/test/fixtures/automations/ (git diff shows what changed)"
fi
