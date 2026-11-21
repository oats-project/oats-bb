#!/bin/sh
# The real run: the plugin against a real OATS kernel and the bb session provider, in one container.
# Runs on the host and does everything else in the container (README.md beside this file):
#
#   KERNEL_REPO=<a clone of the OATS repository> plugin/container/real/run.sh
#
#   KERNEL_REF                 the kernel commit to run (default below: the one the fixtures were recorded at)
#   KERNEL_NPM=<version>       install the kernel from npm (@awebai/oats@<version>) instead; KERNEL_REPO is not read
#   REQUIRE_REAL_FLOOR=1       fail instead of lowering the provider's floor for the kernel under test
#   UPDATE_FIXTURES=1          copy the recorded answers over plugin/test/fixtures/ afterwards
#   KEEP=1, NAME, IMAGE, DOCKER_RUN_ARGS   as container/ci.sh
#
# The provider is this checkout's own (oats-package/, as committed at HEAD). The kernel's clone and
# this checkout are only read (`git archive`): the trees go into the container through tar. The
# container gets 2 CPUs and 6 GB, no mount, no port, no Docker socket and nothing of the host's home.
# Not part of `ci.sh all`: CI has no kernel with session providers (README.md, "Why CI does not run it").
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(dirname "$(dirname "$HERE")")
REPOSITORY=$(dirname "$PLUGIN")
KERNEL_REF=${KERNEL_REF:-da296359e97eb435f6de561947ef2fdda92c927c}
IMAGE=${IMAGE:-bb-plugin-oats-test}
NAME=${NAME:-bb-plugin-oats-real-$$}
OUT=$HERE/out
KERNEL_NPM=${KERNEL_NPM:-}
if [ -n "$KERNEL_NPM" ]; then
  KERNEL_OID="npm:@awebai/oats@$KERNEL_NPM"
else
  : "${KERNEL_REPO:?set KERNEL_NPM to an OATS release on npm, or KERNEL_REPO to a clone of the OATS repository that holds $KERNEL_REF}"
  KERNEL_OID=$(git -C "$KERNEL_REPO" rev-parse --verify "$KERNEL_REF^{commit}")
fi
# The provider under test is the committed one: its commit is the last that changed oats-package/.
[ -z "$(git -C "$REPOSITORY" status --porcelain -- oats-package)" ] || { echo "real: oats-package/ has uncommitted changes: commit them, the run takes the provider from HEAD" >&2; exit 2; }
PROVIDER_OID=$(git -C "$REPOSITORY" log -1 --format=%H HEAD -- oats-package)
[ -n "$PROVIDER_OID" ] || { echo "real: this checkout has no committed oats-package/" >&2; exit 2; }

docker build -q -t "$IMAGE" "$PLUGIN/container" > /dev/null
# shellcheck disable=SC2086 # DOCKER_RUN_ARGS is a list of arguments
docker run -d --name "$NAME" --init --cpus 2 --memory 6g -e BB_TELEMETRY=false ${DOCKER_RUN_ARGS:-} "$IMAGE" sleep infinity > /dev/null
cleanup() {
  status=$?
  rm -rf "$OUT"
  mkdir -p "$OUT"
  docker cp "$NAME:/home/node/out/real/." "$OUT/" > /dev/null 2>&1 || echo "real: no artefacts to copy out"
  rm -rf "$OUT/.chromium"
  if [ "${KEEP:-0}" = 1 ]; then echo "real: container $NAME kept"; else docker rm -f "$NAME" > /dev/null; fi
  exit $status
}
trap cleanup EXIT

BB_VERSION=
[ ! -f "$PLUGIN/../bb-version" ] || BB_VERSION=$(tr -d '[:space:]' < "$PLUGIN/../bb-version")
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" -e "KERNEL_NPM=$KERNEL_NPM" -e "REQUIRE_REAL_FLOOR=${REQUIRE_REAL_FLOOR:-0}" -w /home/node/plugin "$NAME" "$@"; }
run mkdir -p /home/node/real/kernel /home/node/real/provider /home/node/out/real
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude ./container/real/out .) | docker exec -i -u node "$NAME" tar -x -C /home/node/plugin
[ -n "$KERNEL_NPM" ] || git -C "$KERNEL_REPO" archive "$KERNEL_OID" | docker exec -i -u node "$NAME" tar -x -C /home/node/real/kernel
git -C "$REPOSITORY" archive HEAD oats-package | docker exec -i -u node "$NAME" tar -x -C /home/node/real/provider
printf '{"kernel":"%s","provider":"%s"}\n' "$KERNEL_OID" "$PROVIDER_OID" | docker exec -i -u node "$NAME" sh -c 'cat > /home/node/real/refs.json'

run bash container/real/setup.sh
run node container/real/scenario.mjs
if [ "${UPDATE_FIXTURES:-0}" = 1 ]; then
  docker cp "$NAME:/home/node/out/real/fixtures/." "$PLUGIN/test/fixtures/" > /dev/null
  echo "real: the recorded answers are in $PLUGIN/test/fixtures/ (git diff shows what changed)"
fi
