#!/bin/sh
# Runs on the host (a developer's machine or a CI runner) and does everything else in a container:
#   container/ci.sh [all|unit|live|real]   (default: all)
# The container gets 2 CPUs and 6 GB, no mount, no port, no Docker socket and nothing of the host's
# home: the checkout is copied in with tar, and the artefacts (test output, logs, screenshots) are
# copied out to container/out/ (or, when that holds another's artefacts, container/out.<owner>/:
# see OWNER below). bb runs sovereign: no account, BB_TELEMETRY=false, loopback only.
#   KEEP=1            leave the container running afterwards, to work in it (docker exec -it …)
#   NAME=<name>       the container's name (default: bb-plugin-oats-ci-<pid>)
#   DOCKER_RUN_ARGS   extra arguments for docker run (for example "--dns 1.1.1.1")
# The bb version is the repository's pin: the one line of bb-version at the repository's root when
# that file exists, else devDependencies["bb-app"] of the plugin's package.json (setup.sh).
# `real` is the run against a real OATS kernel and the bb session provider, in a container of its
# own (real/run.sh, real/README.md; its artefacts go to container/real/out/); `all` ends with it.
set -eu
STAGE=${1:-all}
HERE=$(cd "$(dirname "$0")" && pwd)
case "$STAGE" in
  all | unit | live) ;;
  real) exec sh "$HERE/real/run.sh" ;;
  *)
    echo "usage: container/ci.sh [all|unit|live|real]" >&2
    exit 2
    ;;
esac
PLUGIN=$(dirname "$HERE")
IMAGE=${IMAGE:-bb-plugin-oats-test}
NAME=${NAME:-bb-plugin-oats-ci-$$}
OUT=$HERE/out
# Whose artefacts a directory holds. The first to run in a checkout owns `out/`; a run by another
# (a reviewer attached to an author's tree: another OATS instance, or ARTEFACTS_OWNER) leaves it as
# it is and writes to `out.<owner>/` beside it, so that nobody's images are deleted under them.
OWNER=${ARTEFACTS_OWNER:-${OATS_INSTANCE:-$(id -un 2> /dev/null || id -u)}}
OWNER=$(printf '%s' "$OWNER" | tr -c 'A-Za-z0-9._-' '_')
if [ -f "$OUT/.owner" ] && [ "$(cat "$OUT/.owner")" != "$OWNER" ]; then
  echo "ci: $OUT holds the artefacts of $(cat "$OUT/.owner"); this run's go to $OUT.$OWNER"
  OUT=$OUT.$OWNER
fi
# The directory is claimed now, before the run: a run by another that starts beside this one sees
# whose it is. (An out/ from before this rule has no owner: the next run takes it.)
mkdir -p "$OUT"
printf '%s\n' "$OWNER" > "$OUT/.owner"

docker build -q -t "$IMAGE" "$HERE" > /dev/null
# shellcheck disable=SC2086 # DOCKER_RUN_ARGS is a list of arguments
MACHINE_NAME=${MACHINE_NAME:-falcon}
# The machine has a name, as a person's has: bb names its machine by the host's, and the plugin
# shows a machine by the name bb gives it (the images would else show a container id).
docker run -d --name "$NAME" --hostname "$MACHINE_NAME" -e "MACHINE_NAME=$MACHINE_NAME" --init --cpus 2 --memory 6g -e BB_TELEMETRY=false ${DOCKER_RUN_ARGS:-} "$IMAGE" sleep infinity > /dev/null
cleanup() {
  status=$?
  rm -rf "$OUT"
  mkdir -p "$OUT"
  docker cp "$NAME:/home/node/out/." "$OUT/" > /dev/null 2>&1 || echo "ci: no artefacts to copy out"
  printf '%s\n' "$OWNER" > "$OUT/.owner"
  if [ "${KEEP:-0}" = 1 ]; then echo "ci: container $NAME kept"; else docker rm -f "$NAME" > /dev/null; fi
  exit $status
}
trap cleanup EXIT

BB_VERSION=
if [ -f "$PLUGIN/../bb-version" ]; then
  BB_VERSION=$(tr -d '[:space:]' < "$PLUGIN/../bb-version")
  [ -n "$BB_VERSION" ] || { echo "ci: $PLUGIN/../bb-version is empty" >&2; exit 2; }
fi
# LOCAL_STATUS=<path to an `oats status --json` answer> (by hand only; `live`): the live run draws
# only the stage "local-roster" from that file. It is copied into the container's /tmp, never into
# the tree, and nothing of it is printed but counts (container/README.md).
LOCAL_ENV=
if [ -n "${LOCAL_STATUS:-}" ]; then
  docker cp "$LOCAL_STATUS" "$NAME:/tmp/local-status.json" > /dev/null
  docker exec -u root "$NAME" chown node /tmp/local-status.json
  LOCAL_ENV="-e LIVE_UI_STATUS_FILE=/tmp/local-status.json"
fi
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" $LOCAL_ENV -w /home/node/plugin "$NAME" "$@"; }
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude './container/out.*' --exclude ./container/real/out --exclude './container/real/out.*' .) | docker exec -i -u node "$NAME" tar -x -C /home/node/plugin
# The provider's two manifests, beside the plugin as they are in the repository: a unit test holds
# the plugin's OATS floor against theirs (test/kernel-compat.test.ts).
(cd "$PLUGIN/.." && tar -c oats-package/oats-package.json oats-package/capabilities/oats-bb/oats.json) | docker exec -i -u node "$NAME" tar -x -C /home/node
run mkdir -p /home/node/out
run sh container/setup.sh
case "$STAGE" in
  unit) run sh container/unit.sh ;;
  live) run bash container/live.sh ;;
  all)
    run sh container/unit.sh
    run bash container/live.sh
    ;;
esac
# The real run has a container of its own: this one goes first (its artefacts are copied out now).
if [ "$STAGE" = all ]; then
  trap - EXIT
  (cleanup) || exit $?
  NAME="$NAME-real" sh "$HERE/real/run.sh"
fi
