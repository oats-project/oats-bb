#!/bin/bash
# Runs inside the container, as node, for the pi run only (../setup.sh calls it when REAL_PI=1,
# after the kernel is installed and before bb starts; README.md beside this file). What a
# deployment must have for pi agents on bb, and a mock model in place of a login:
#   pi, on the PATH bb's server and oats run with;
#   the OATS bridge for pi (@awebai/oats-pi) AT THE KERNEL'S OWN VERSION, in the pi configuration
#     bb's server runs with: here the user's own, ~/.pi/agent, which is also the provider's
#     default for settings.oats.bb.piAgentDir. Its tarball's integrity is checked first;
#   and NOT the aweb extension for pi (@awebai/pi) in that configuration;
#   the provider `mock` of that configuration (models.json) and its endpoint (mock-openai.mjs);
#   one extension of the run's own, whose tool opens a dialog of pi (ask-dialog.ts).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REAL=${REAL:-/home/node/real}
OUT=${OUT:-/home/node/out/real}
# The version the bb session provider is checked against (the provider's README, "pi").
PI_VERSION=${PI_VERSION:-1.5.2}
PI_MOCK_PORT=9998
PI_AGENT_DIR=$HOME/.pi/agent
KERNEL_VERSION=$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
# The bridge is released with its kernel and tested only at that version: never another.
OATS_PI_VERSION=$KERNEL_VERSION
if [ "$OATS_PI_VERSION" = 0.70.3 ]; then
  OATS_PI_INTEGRITY=${OATS_PI_INTEGRITY-sha512-Th+Vv//U65HSdeY1hfp1x0a2pqlP81Y1zl16NE32JV73RSX18E8yXQVrs04H/G2f1jWB+2XEWS6MKH7WzBfT8g==}
fi
OATS_PI_INTEGRITY=${OATS_PI_INTEGRITY:-}

echo "== pi $PI_VERSION"
[ "$(pi --version 2>/dev/null)" = "$PI_VERSION" ] || npm install -g --no-audit --no-fund "@earendil-works/pi-coding-agent@$PI_VERSION"
[ "$(pi --version 2>/dev/null)" = "$PI_VERSION" ] || { echo "pi setup: pi $PI_VERSION could not be installed" >&2; exit 1; }

echo "== the OATS bridge for pi, @awebai/oats-pi@$OATS_PI_VERSION, in bb's pi configuration ($PI_AGENT_DIR)"
mkdir -p "$PI_AGENT_DIR/extensions" "$REAL/mock"
if ! grep -qs "\"npm:@awebai/oats-pi@$OATS_PI_VERSION\"" "$PI_AGENT_DIR/settings.json"; then
  # What the registry says of the tarball pi is about to install, kept (bridge.json) and checked.
  (cd "$REAL" && npm pack "@awebai/oats-pi@$OATS_PI_VERSION" --json > "$OUT/bridge.json") || { echo "pi setup: @awebai/oats-pi@$OATS_PI_VERSION is not on npm: the bridge is released with its kernel (a kernel that is on no release has none)" >&2; exit 1; }
  BRIDGE_INTEGRITY=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[0].integrity' "$OUT/bridge.json")
  echo "bridge tarball: @awebai/oats-pi@$OATS_PI_VERSION, integrity $BRIDGE_INTEGRITY"
  [ -z "$OATS_PI_INTEGRITY" ] || [ "$BRIDGE_INTEGRITY" = "$OATS_PI_INTEGRITY" ] || { echo "pi setup: the tarball of @awebai/oats-pi@$OATS_PI_VERSION is not the one expected (OATS_PI_INTEGRITY $OATS_PI_INTEGRITY)" >&2; exit 1; }
  pi install "npm:@awebai/oats-pi@$OATS_PI_VERSION"
fi
PACKAGES=$(node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).packages ?? [])' "$PI_AGENT_DIR/settings.json")
case "$PACKAGES" in *@awebai/pi@* | *'@awebai/pi"'*) echo "pi setup: bb's pi configuration lists @awebai/pi ($PACKAGES): the provider refuses a pi launch there" >&2; exit 1 ;; esac

# The mock model: the provider `mock`, model `echo` (a launch names it `mock/echo`).
printf '{ "providers": { "mock": { "baseUrl": "http://127.0.0.1:%s/v1", "api": "openai-completions", "apiKey": "placeholder-not-a-key", "models": [ { "id": "echo", "name": "Echo (mock)", "reasoning": false, "input": ["text"], "contextWindow": 200000, "maxTokens": 4096, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } } ] } } }\n' "$PI_MOCK_PORT" > "$PI_AGENT_DIR/models.json"
install -m 0644 "$HERE/ask-dialog.ts" "$PI_AGENT_DIR/extensions/ask-dialog.ts"
if ! [ -f "$REAL/pi-mock.pid" ] || ! kill -0 "$(cat "$REAL/pi-mock.pid")" 2> /dev/null; then
  setsid node "$HERE/mock-openai.mjs" "$REAL/mock" "$PI_MOCK_PORT" > "$OUT/pi-mock.out" 2>&1 < /dev/null &
  echo $! > "$REAL/pi-mock.pid"
fi
echo "pi setup: pi $(pi --version), bb's pi configuration lists $PACKAGES"
