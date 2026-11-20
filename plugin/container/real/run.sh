#!/bin/sh
# The real run: the plugin against a real OATS kernel and the bb session provider, in one container.
# Runs on the host and does everything else in the container (README.md beside this file):
#
#   KERNEL_REPO=<a clone of the OATS repository> PROVIDER_REPO=<a clone of oats-bb with the provider> \
#     plugin/container/real/run.sh
#
#   KERNEL_REF, PROVIDER_REF   the commits to run (defaults below: the ones the fixtures were recorded at)
#   UPDATE_FIXTURES=1          copy the recorded answers over plugin/test/fixtures/ afterwards
#   KEEP=1, NAME, IMAGE, DOCKER_RUN_ARGS   as container/ci.sh
#
# Both clones are only read (`git archive`): the trees go into the container through tar. The
# container gets 2 CPUs and 6 GB, no mount, no port, no Docker socket and nothing of the host's home.
# Not part of `ci.sh all`: CI has neither clone at these commits (README.md, "Why CI does not run it").
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(dirname "$(dirname "$HERE")")
KERNEL_REF=${KERNEL_REF:-5a9db77014443607131f1ed5def0867dd1597dc0}
PROVIDER_REF=${PROVIDER_REF:-37e9abaf83157cf0cdcfc09022ea0a701dee2a78}
IMAGE=${IMAGE:-bb-plugin-oats-test}
NAME=${NAME:-bb-plugin-oats-real-$$}
OUT=$HERE/out
: "${KERNEL_REPO:?set KERNEL_REPO to a clone of the OATS repository that holds $KERNEL_REF}"
: "${PROVIDER_REPO:?set PROVIDER_REPO to a clone of oats-bb that holds $PROVIDER_REF}"
KERNEL_OID=$(git -C "$KERNEL_REPO" rev-parse --verify "$KERNEL_REF^{commit}")
PROVIDER_OID=$(git -C "$PROVIDER_REPO" rev-parse --verify "$PROVIDER_REF^{commit}")

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
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" -w /home/node/plugin "$NAME" "$@"; }
run mkdir -p /home/node/real/kernel /home/node/real/provider /home/node/out/real
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude ./container/real/out .) | docker exec -i -u node "$NAME" tar -x -C /home/node/plugin
git -C "$KERNEL_REPO" archive "$KERNEL_OID" | docker exec -i -u node "$NAME" tar -x -C /home/node/real/kernel
git -C "$PROVIDER_REPO" archive "$PROVIDER_OID" | docker exec -i -u node "$NAME" tar -x -C /home/node/real/provider
printf '{"kernel":"%s","provider":"%s"}\n' "$KERNEL_OID" "$PROVIDER_OID" | docker exec -i -u node "$NAME" sh -c 'cat > /home/node/real/refs.json'

run bash container/real/setup.sh
run node container/real/scenario.mjs
if [ "${UPDATE_FIXTURES:-0}" = 1 ]; then
  docker cp "$NAME:/home/node/out/real/fixtures/." "$PLUGIN/test/fixtures/" > /dev/null
  echo "real: the recorded answers are in $PLUGIN/test/fixtures/ (git diff shows what changed)"
fi
