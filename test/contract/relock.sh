#!/bin/sh
# Writes a contract image's lock again, on the host, with npm in a container:
#
#   test/contract/relock.sh <image>     test/contract/locks/<image>/package-lock.json (claude, pi),
#                                       from the package.json beside it (locks/README.md): after a
#                                       version moved in that package.json, and before a release
#
# Then commit the lock with its package.json.
#
# npm runs in a container with no mount: the package.json goes in on its standard input and the
# lock comes back on its standard output. Nothing is installed and no script of a package runs
# (`npm install --package-lock-only --ignore-scripts`). The lock is resolved anew, from its
# package.json alone: that is the renewal, and a build of the image then installs exactly what
# the lock names (`npm ci`).
# The lock is written by npm 11 (RELOCK_NPM), not by the image's own npm: npm 10 drops the `libc`
# field of platform packages, and `npm ci` then also installs their musl builds
# (plugin/container/relock.sh, which writes the plugin's locks the same way).
set -eu
NAME=${1:?usage: test/contract/relock.sh <image>   (a directory of test/contract/locks/: claude, pi)}
HERE=$(cd "$(dirname "$0")" && pwd)
LOCK=$HERE/locks/$NAME
[ -f "$LOCK/package.json" ] || { echo "relock: there is no $LOCK/package.json" >&2; exit 2; }
IMAGE=${IMAGE:-node:22-bookworm}
RELOCK_NPM=${RELOCK_NPM:-11}
# A lock half written is never left beside the tree: a build would copy it into its image.
trap 'rm -f "$LOCK/package-lock.json.new"' EXIT
# shellcheck disable=SC2086 # DOCKER_RUN_ARGS is a list
docker run --rm -i --init --cpus 2 --memory 6g -e "RELOCK_NPM=$RELOCK_NPM" ${DOCKER_RUN_ARGS:-} "$IMAGE" sh -c '
  set -eu
  mkdir /tmp/relock && cd /tmp/relock && cat > package.json
  [ -s package.json ] || { echo "relock: package.json did not reach the container: nothing is written" >&2; exit 1; }
  npx --yes "npm@$RELOCK_NPM" install --package-lock-only --ignore-scripts --no-audit --no-fund >&2
  cat package-lock.json' < "$LOCK/package.json" > "$LOCK/package-lock.json.new"
mv "$LOCK/package-lock.json.new" "$LOCK/package-lock.json"
echo "relock: $LOCK/package-lock.json names $(grep -c '^    "node_modules/' "$LOCK/package-lock.json") packages; commit it with its package.json"
