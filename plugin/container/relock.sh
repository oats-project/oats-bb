#!/bin/sh
# Writes a tool's lock again: plugin/container/locks/<tool>/package-lock.json, from the package.json
# beside it (locks/README.md). Run it on the host after the tool's version moved in that
# package.json, then commit both files:
#
#   plugin/container/relock.sh <tool>
#
# npm runs in a container of the tests' image, with their limits and no mount: the package.json
# goes in on its standard input and the lock comes back on its standard output. npm resolves the
# tree ONCE, here (`npm install --package-lock-only`: nothing is installed, no script of a package
# runs); a run of the checks then installs exactly what the lock names (`npm ci`).
set -eu
TOOL=${1:?usage: plugin/container/relock.sh <tool>   (a directory of plugin/container/locks/)}
HERE=$(cd "$(dirname "$0")" && pwd)
LOCK=$HERE/locks/$TOOL
[ -f "$LOCK/package.json" ] || { echo "relock: there is no $LOCK/package.json" >&2; exit 2; }
IMAGE=${IMAGE:-bb-plugin-oats-test}
docker build -q -t "$IMAGE" "$HERE" > /dev/null
docker run --rm -i --cpus 2 --memory 6g "$IMAGE" sh -c '
  set -eu
  mkdir /tmp/relock && cd /tmp/relock && cat > package.json
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund >&2
  cat package-lock.json' < "$LOCK/package.json" > "$LOCK/package-lock.json.new"
mv "$LOCK/package-lock.json.new" "$LOCK/package-lock.json"
echo "relock: $LOCK/package-lock.json names $(grep -c '"integrity"' "$LOCK/package-lock.json") packages; commit it with its package.json"
