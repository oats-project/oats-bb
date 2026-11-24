#!/bin/sh
# Writes a lock again, on the host, with npm in a container:
#
#   plugin/container/relock.sh <tool>     a tool's lock, plugin/container/locks/<tool>/package-lock.json,
#                                         from the package.json beside it (locks/README.md): after the
#                                         tool's version moved in that package.json, and before a release
#   plugin/container/relock.sh plugin     the plugin's own lock, plugin/package-lock.json, after
#                                         plugin/package.json changed (bb's build toolchain in its
#                                         dev dependencies: locks/README.md, "When a pin moves")
#
# Then commit the lock with its package.json.
#
# npm runs in a container of the tests' image, with their limits and no mount: what it reads goes in
# on its standard input and the lock comes back on its standard output. Nothing is installed and no
# script of a package runs (`npm install --package-lock-only --ignore-scripts`).
# A TOOL's lock is resolved anew, from its package.json alone: that is the renewal, and a run of
# the checks then installs exactly what the lock names (`npm ci`). The PLUGIN's lock is NOT
# resolved anew: the lock that is there goes in with the package.json, so that npm keeps every
# version it holds and adds only what package.json now asks for. (Resolved from package.json alone
# it would move every range of the plugin, and with it what a deployment installs.)
# The lock is written by npm 11 (RELOCK_NPM), not by the image's own npm: npm 10 drops the `libc`
# field of platform packages, and `npm ci` then also installs their musl builds
# (../../container/README.md, "Changing bb's version").
# IMAGE and DOCKER_RUN_ARGS are as container/ci.sh's.
set -eu
TOOL=${1:?usage: plugin/container/relock.sh <tool>|plugin   (a directory of plugin/container/locks/, or the plugin itself)}
HERE=$(cd "$(dirname "$0")" && pwd)
if [ "$TOOL" = plugin ]; then
  LOCK=$(dirname "$HERE")
  [ -f "$LOCK/package-lock.json" ] || { echo "relock: there is no $LOCK/package-lock.json to keep the versions of" >&2; exit 2; }
  FILES="package.json package-lock.json"
else
  LOCK=$HERE/locks/$TOOL
  FILES=package.json
fi
[ -f "$LOCK/package.json" ] || { echo "relock: there is no $LOCK/package.json" >&2; exit 2; }
IMAGE=${IMAGE:-bb-plugin-oats-test}
RELOCK_NPM=${RELOCK_NPM:-11}
# A lock half written is never left beside the tree: a run would copy it into its container.
trap 'rm -f "$LOCK/package-lock.json.new"' EXIT
docker build -q -t "$IMAGE" "$HERE" > /dev/null
# shellcheck disable=SC2086 # FILES and DOCKER_RUN_ARGS are lists
(cd "$LOCK" && tar -c $FILES) | docker run --rm -i --cpus 2 --memory 6g -e "RELOCK_NPM=$RELOCK_NPM" ${DOCKER_RUN_ARGS:-} "$IMAGE" sh -c '
  set -eu
  mkdir /tmp/relock && cd /tmp/relock && tar -x
  npx --yes "npm@$RELOCK_NPM" install --package-lock-only --ignore-scripts --no-audit --no-fund >&2
  cat package-lock.json' > "$LOCK/package-lock.json.new"
mv "$LOCK/package-lock.json.new" "$LOCK/package-lock.json"
echo "relock: $LOCK/package-lock.json names $(grep -c '^    "node_modules/' "$LOCK/package-lock.json") packages; commit it with its package.json"
