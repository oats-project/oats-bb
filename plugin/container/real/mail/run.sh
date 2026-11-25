#!/bin/sh
# The mail part of the real run, on the host: aweb's local stack (four containers) and one client
# container, all removed at the end. BY HAND ONLY: it is in neither `ci.sh all` nor CI (README.md).
#   plugin/container/real/mail/run.sh
#   KEEP=1   leave the five containers running afterwards (to look, or to run inside.sh again)
#   AWEB_COMMIT, KERNEL_NPM, AW_NPM, AWEB_PROVIDER, CLAUDE_CODE_VERSION: the versions (README.md)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(cd "$HERE/../../.." && pwd)
OUT=$HERE/out
IMAGE=${IMAGE:-bb-plugin-oats-test}
export STACK_NAME=${STACK_NAME:-bb-mail-real}
CLIENT=${NAME:-$STACK_NAME-client}
AWEB_COMMIT=${AWEB_COMMIT:-6a460770f9cafc142b20473f11bcf3b49ce81395}
export AWEB_CHECKOUT=${AWEB_CHECKOUT:-$OUT/aweb}

echo "run: load $(cut -d' ' -f1-3 /proc/loadavg) (five containers: wait above 15, run nothing above 20)"
mkdir -p "$OUT"
if [ ! -d "$AWEB_CHECKOUT/.git" ]; then git clone -q --no-checkout https://github.com/awebai/aweb.git "$AWEB_CHECKOUT"; fi
git -C "$AWEB_CHECKOUT" checkout -q --detach "$AWEB_COMMIT"
[ "$(git -C "$AWEB_CHECKOUT" rev-parse HEAD)" = "$AWEB_COMMIT" ]

cleanup() {
  status=$?
  docker cp "$CLIENT:/home/node/out/." "$OUT/" > /dev/null 2>&1 || echo "run: no artefacts to copy out"
  if [ "${KEEP:-0}" = 1 ]; then
    echo "run: kept: $CLIENT and the stack $STACK_NAME (remove: docker rm -f $CLIENT; docker compose -f $HERE/compose.yml down -v)"
  else
    docker rm -f "$CLIENT" > /dev/null 2>&1 || true
    docker compose -f "$HERE/compose.yml" down -v > /dev/null 2>&1 || true
  fi
  exit $status
}
trap cleanup EXIT

docker compose -f "$HERE/compose.yml" up -d --build --wait
docker build -q -t "$IMAGE" "$PLUGIN/container" > /dev/null
# The client: the plugin's own test image, with the plugin's limits, in awid's network namespace.
docker rm -f "$CLIENT" > /dev/null 2>&1 || true
docker run -d --name "$CLIENT" --init --cpus 2 --memory 6g -e BB_TELEMETRY=false --network "container:$STACK_NAME-awid-1" "$IMAGE" sleep infinity > /dev/null
BB_VERSION=$(tr -d '[:space:]' < "$PLUGIN/../bb-version")
run() { docker exec -u node -e BB_TELEMETRY=false -e "BB_VERSION=$BB_VERSION" -e KERNEL_NPM -e AW_NPM -e AWEB_PROVIDER -e CLAUDE_CODE_VERSION -w /home/node/plugin "$CLIENT" "$@"; }
(cd "$PLUGIN" && tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out --exclude './container/out.*' --exclude ./container/real/out --exclude './container/real/out.*' --exclude ./container/real/mail/out --exclude ./container/real/pi/out .) | docker exec -i -u node "$CLIENT" tar -x -C /home/node/plugin
run mkdir -p /home/node/out
run sh container/setup.sh
run bash container/real/mail/inside.sh
