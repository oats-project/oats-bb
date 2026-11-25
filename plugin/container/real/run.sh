#!/bin/sh
# The real run: the plugin against a real OATS kernel and the bb session provider, in one container.
# Runs on the host and does everything else in the container (README.md beside this file):
#
#   plugin/container/real/run.sh
#
#   KERNEL_NPM                 the OATS release to install from npm (default below: the one the
#                              fixtures were recorded at); KERNEL_INTEGRITY is its tarball's
#                              integrity, checked before the install (another version: set it too,
#                              or empty for no check)
#   KERNEL_NPM= KERNEL_REPO=<a clone of the OATS repository> KERNEL_REF=<commit>
#                              an unreleased kernel instead: the commit's tree, packed in the container
#   REQUIRE_REAL_FLOOR=0       let the run lower the provider's floor for the kernel under test,
#                              inside the container (a trial); by default such a run fails
#   UPDATE_FIXTURES=1          copy the recorded answers over plugin/test/fixtures/ afterwards
#   REAL_PI=1                  the pi run instead (pi/README.md; `ci.sh pi`): the same container and
#                              setup and the same kernel, with pi, its OATS bridge and a mock model
#                              for it, and pi/scenario.mjs in place of scenario.mjs. Its artefacts
#                              go to real/pi/out/; it records no fixture.
#   KEEP=1, NAME, IMAGE, DOCKER_RUN_ARGS   as container/ci.sh
#
# The provider is this checkout's own (oats-package/, as committed at HEAD). This checkout (and the
# kernel's clone, where one is named) is only read (`git archive`): the trees go into the container
# through tar. The container gets 2 CPUs and 6 GB, no mount, no port, no Docker socket and nothing
# of the host's home. `ci.sh all` runs it after the unit and live tests (`ci.sh real` alone).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(dirname "$(dirname "$HERE")")
REPOSITORY=$(dirname "$PLUGIN")
# Unset: the release the run pins (the plugin's floor). Set and empty: a tree from KERNEL_REPO.
# The pi run (REAL_PI=1) is on the same kernel: one pin for both.
REAL_PI=${REAL_PI:-0}
[ "$REAL_PI" != 1 ] || [ "${UPDATE_FIXTURES:-0}" != 1 ] || { echo "real: the pi run records no fixture: UPDATE_FIXTURES is the main run's" >&2; exit 2; }
KERNEL_NPM=${KERNEL_NPM-0.70.5}
if [ "$KERNEL_NPM" = 0.70.5 ]; then
  KERNEL_INTEGRITY=${KERNEL_INTEGRITY-sha512-vpIdpZixk1FGGeH5Vkvr/8gltddBaajc3EU40GpbI/dnYnMeIBFq110wtKrUH5aXOU4LXbc9sqHZbl68wuiKUw==}
fi
KERNEL_INTEGRITY=${KERNEL_INTEGRITY:-}
REQUIRE_REAL_FLOOR=${REQUIRE_REAL_FLOOR:-1}
IMAGE=${IMAGE:-bb-plugin-oats-test}
NAME=${NAME:-bb-plugin-oats-real-$$}
OUT=$HERE/out
[ "$REAL_PI" != 1 ] || OUT=$HERE/pi/out
# Whose artefacts a directory holds. The first to run in a checkout owns `out/`; a run by another
# (a reviewer attached to an author's tree: another OATS instance, or ARTEFACTS_OWNER) leaves it as
# it is and writes to `out.<owner>/` beside it, so that nobody's images are deleted under them.
OWNER=${ARTEFACTS_OWNER:-${OATS_INSTANCE:-$(id -un 2> /dev/null || id -u)}}
OWNER=$(printf '%s' "$OWNER" | tr -c 'A-Za-z0-9._-' '_')
if [ -f "$OUT/.owner" ] && [ "$(cat "$OUT/.owner")" != "$OWNER" ]; then
  echo "real: $OUT holds the artefacts of $(cat "$OUT/.owner"); this run's go to $OUT.$OWNER"
  OUT=$OUT.$OWNER
fi
# The directory is claimed now, before the run: a run by another that starts beside this one sees
# whose it is. (An out/ from before this rule has no owner: the next run takes it.)
mkdir -p "$OUT"
printf '%s\n' "$OWNER" > "$OUT/.owner"
if [ -n "$KERNEL_NPM" ]; then
  KERNEL_OID="npm:@awebai/oats@$KERNEL_NPM"
else
  : "${KERNEL_REPO:?KERNEL_NPM is empty: set KERNEL_REPO to a clone of the OATS repository, and KERNEL_REF to the commit to run}"
  : "${KERNEL_REF:?KERNEL_NPM is empty: set KERNEL_REF to the kernel commit to run}"
  KERNEL_OID=$(git -C "$KERNEL_REPO" rev-parse --verify "$KERNEL_REF^{commit}")
fi
# The provider under test is the committed one: its commit is the last that changed oats-package/.
[ -z "$(git -C "$REPOSITORY" status --porcelain -- oats-package)" ] || { echo "real: oats-package/ has uncommitted changes: commit them, the run takes the provider from HEAD" >&2; exit 2; }
PROVIDER_OID=$(git -C "$REPOSITORY" log -1 --format=%H HEAD -- oats-package)
[ -n "$PROVIDER_OID" ] || { echo "real: this checkout has no committed oats-package/" >&2; exit 2; }

docker build -q -t "$IMAGE" "$PLUGIN/container" > /dev/null
# shellcheck disable=SC2086 # DOCKER_RUN_ARGS is a list of arguments
MACHINE_NAME=${MACHINE_NAME:-falcon}
# The machine has a name, as a person's has: bb names its machine by the host's, and the plugin
# shows a machine by the name bb gives it (the images would else show a container id).
docker run -d --name "$NAME" --hostname "$MACHINE_NAME" -e "MACHINE_NAME=$MACHINE_NAME" --init --cpus 2 --memory 6g -e BB_TELEMETRY=false ${DOCKER_RUN_ARGS:-} "$IMAGE" sleep infinity > /dev/null
cleanup() {
  status=$?
  # A failed run keeps bb's own logs too (bb-logs.sh): a bb that did not start says why only there.
  [ "$status" = 0 ] || docker exec -u node "$NAME" sh /home/node/plugin/container/real/bb-logs.sh || echo "real: bb's logs could not be copied"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  docker cp "$NAME:/home/node/out/real/." "$OUT/" > /dev/null 2>&1 || echo "real: no artefacts to copy out"
  rm -rf "$OUT/.chromium"
  printf '%s\n' "$OWNER" > "$OUT/.owner"
  if [ "${KEEP:-0}" = 1 ]; then echo "real: container $NAME kept"; else docker rm -f "$NAME" > /dev/null; fi
  exit $status
}
trap cleanup EXIT

BB_VERSION=
[ ! -f "$PLUGIN/../bb-version" ] || BB_VERSION=$(tr -d '[:space:]' < "$PLUGIN/../bb-version")
# OATS_PI_INTEGRITY, PI_VERSION and PI_INTEGRITY (the pi run's, pi/README.md) are passed by name: only when set
# here, so that one left unset keeps pi/setup.sh's default.
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" -e "KERNEL_NPM=$KERNEL_NPM" -e "KERNEL_INTEGRITY=$KERNEL_INTEGRITY" -e "REQUIRE_REAL_FLOOR=$REQUIRE_REAL_FLOOR" -e "REAL_PI=$REAL_PI" -e OATS_PI_INTEGRITY -e PI_VERSION -e PI_INTEGRITY -w /home/node/plugin "$NAME" "$@"; }
run mkdir -p /home/node/real/kernel /home/node/real/provider /home/node/out/real
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude './container/out.*' --exclude ./container/real/out --exclude './container/real/out.*' --exclude ./container/real/pi/out --exclude './container/real/pi/out.*' .) | docker exec -i -u node "$NAME" tar -x -C /home/node/plugin
[ -n "$KERNEL_NPM" ] || git -C "$KERNEL_REPO" archive "$KERNEL_OID" | docker exec -i -u node "$NAME" tar -x -C /home/node/real/kernel
git -C "$REPOSITORY" archive HEAD oats-package | docker exec -i -u node "$NAME" tar -x -C /home/node/real/provider
printf '{"kernel":"%s","provider":"%s"}\n' "$KERNEL_OID" "$PROVIDER_OID" | docker exec -i -u node "$NAME" sh -c 'cat > /home/node/real/refs.json'

run bash container/real/setup.sh
# The pi run records no fixture: its own scenario, and nothing more.
# After the run too: nothing in it made bb fetch its build toolchain (../no-toolchain-fetch.sh).
if [ "$REAL_PI" = 1 ]; then
  run node container/real/pi/scenario.mjs
  run sh container/no-toolchain-fetch.sh
  exit
fi
run node container/real/scenario.mjs
run sh container/no-toolchain-fetch.sh
if [ "${UPDATE_FIXTURES:-0}" = 1 ]; then
  docker cp "$NAME:/home/node/out/real/fixtures/." "$PLUGIN/test/fixtures/" > /dev/null
  echo "real: the recorded answers are in $PLUGIN/test/fixtures/ (git diff shows what changed)"
fi
