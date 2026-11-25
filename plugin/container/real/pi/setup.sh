#!/bin/bash
# Runs inside the container, as node, for the pi run only (../setup.sh calls it when REAL_PI=1,
# after the kernel is installed and before bb starts; README.md beside this file). What a
# deployment must have for pi agents on bb, and a mock model in place of a login:
#   pi, on the PATH bb's server and oats run with;
#   the OATS bridge for pi (@awebai/oats-pi) AT THE KERNEL'S OWN VERSION, in the pi configuration
#     bb's server runs with: here the user's own, ~/.pi/agent, which is also the provider's
#     default for settings.oats.bb.piAgentDir. Its tarball's integrity is checked first, and
#     what pi then installs is compared with that tarball;
#   and NOT the aweb extension for pi (@awebai/pi) in that configuration;
#   the provider `mock` of that configuration (models.json) and its endpoint (mock-openai.mjs);
#   one extension of the run's own, whose tool opens a dialog of pi (ask-dialog.ts).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REAL=${REAL:-/home/node/real}
OUT=${OUT:-/home/node/out/real}
# The version the bb session provider is checked against (the provider's README, "pi").
PI_VERSION=${PI_VERSION:-1.5.2}
# pi's own tarball, as the kernel's and the bridge's: its integrity, for that version (another
# version: PI_INTEGRITY with it, or none for no check).
if [ "$PI_VERSION" = 1.5.2 ]; then
  PI_INTEGRITY=${PI_INTEGRITY-sha512-mUWI04rqF1Vd/m1q+Ps1XeWsTXEVvRUnsmRa83I3Dzua0Tx5bYS93imeqtIfrXf7PkkaR6ERz+AuQhIJlom5yA==}
fi
PI_INTEGRITY=${PI_INTEGRITY:-}
PI_MOCK_PORT=9998
PI_AGENT_DIR=$HOME/.pi/agent
KERNEL_VERSION=$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
# The bridge is released with its kernel and tested only at that version: never another.
OATS_PI_VERSION=$KERNEL_VERSION
if [ "$OATS_PI_VERSION" = 0.70.5 ]; then
  OATS_PI_INTEGRITY=${OATS_PI_INTEGRITY-sha512-ZimaoOJ962iWNkbKLtA49SeEmvEBviSOs58q1sM7XNpm943SqEbJaCvfwK0kSqIUUJLFhLaW6M7zvFc9a3ourw==}
fi
OATS_PI_INTEGRITY=${OATS_PI_INTEGRITY:-}

echo "== pi $PI_VERSION"
# pi comes from its committed lock (../../locks/pi, ../../locked-install.sh): its own tarball AND
# every package under it, each at the version and with the integrity the lock names. Nothing is
# resolved at run time: pi's tarball was pinned before, its tree was not, and a dependency npm did
# not serve yet (published two minutes before) failed the check on main.
PI_LOCK=$HERE/../../locks/pi/package-lock.json
# What the lock says of pi's own tarball: kept (pi.json), and held against the version and the
# integrity this run asks for. A lock that is not for them fails the setup, loudly, before anything
# is installed: the lock is written again with `plugin/container/relock.sh pi` (../../locks/README.md).
node -e '
  const lock = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const { version, resolved, integrity } = lock.packages["node_modules/@earendil-works/pi-coding-agent"];
  console.log(JSON.stringify({ id: `@earendil-works/pi-coding-agent@${version}`, version, resolved, integrity, packages: Object.keys(lock.packages).length - 1 }));
' "$PI_LOCK" > "$OUT/pi.json"
PI_LOCKED_VERSION=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$OUT/pi.json")
PI_LOCKED_INTEGRITY=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).integrity' "$OUT/pi.json")
echo "pi tarball: @earendil-works/pi-coding-agent@$PI_LOCKED_VERSION, integrity $PI_LOCKED_INTEGRITY, and $(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).packages - 1' "$OUT/pi.json") packages under it, all from the lock"
[ "$PI_LOCKED_VERSION" = "$PI_VERSION" ] || { echo "pi setup: the lock is for pi $PI_LOCKED_VERSION, and this run asks for $PI_VERSION (PI_VERSION): write the lock again, plugin/container/relock.sh pi" >&2; exit 1; }
[ -z "$PI_INTEGRITY" ] || [ "$PI_LOCKED_INTEGRITY" = "$PI_INTEGRITY" ] || { echo "pi setup: the tarball of @earendil-works/pi-coding-agent@$PI_VERSION is not the one expected (PI_INTEGRITY $PI_INTEGRITY)" >&2; exit 1; }
[ "$(pi --version 2>/dev/null)" = "$PI_VERSION" ] || sh "$HERE/../../locked-install.sh" pi
[ "$(pi --version 2>/dev/null)" = "$PI_VERSION" ] || { echo "pi setup: pi $PI_VERSION could not be installed" >&2; exit 1; }
# pi finds fd and ripgrep on the PATH (the image holds them), so it will not fetch them by itself.
sh "$HERE/../../no-pi-tools-fetch.sh"

echo "== the OATS bridge for pi, @awebai/oats-pi@$OATS_PI_VERSION, in bb's pi configuration ($PI_AGENT_DIR)"
mkdir -p "$PI_AGENT_DIR/extensions" "$REAL/mock"
if ! grep -qs "\"npm:@awebai/oats-pi@$OATS_PI_VERSION\"" "$PI_AGENT_DIR/settings.json"; then
  # What the registry says of the tarball pi is about to install, kept (bridge.json) and checked.
  (cd "$REAL" && npm pack "@awebai/oats-pi@$OATS_PI_VERSION" --json > "$OUT/bridge.json") || { echo "pi setup: @awebai/oats-pi@$OATS_PI_VERSION is not on npm: the bridge is released with its kernel (a kernel that is on no release has none)" >&2; exit 1; }
  BRIDGE_INTEGRITY=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[0].integrity' "$OUT/bridge.json")
  echo "bridge tarball: @awebai/oats-pi@$OATS_PI_VERSION, integrity $BRIDGE_INTEGRITY"
  [ -z "$OATS_PI_INTEGRITY" ] || [ "$BRIDGE_INTEGRITY" = "$OATS_PI_INTEGRITY" ] || { echo "pi setup: the tarball of @awebai/oats-pi@$OATS_PI_VERSION is not the one expected (OATS_PI_INTEGRITY $OATS_PI_INTEGRITY)" >&2; exit 1; }
  pi install "npm:@awebai/oats-pi@$OATS_PI_VERSION"
  # pi fetches the package itself (the provider knows the bridge by its npm name only, so the
  # checked file cannot be what is installed): what it installed is compared, file by file, with
  # the tarball that was checked.
  INSTALLED=$(find "$PI_AGENT_DIR" -type d -path '*/node_modules/@awebai/oats-pi' | head -1)
  [ -n "$INSTALLED" ] || { echo "pi setup: pi installed no @awebai/oats-pi under $PI_AGENT_DIR" >&2; exit 1; }
  rm -rf "$REAL/bridge" && mkdir -p "$REAL/bridge"
  tar -xzf "$REAL/$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[0].filename' "$OUT/bridge.json")" -C "$REAL/bridge"
  diff -r "$REAL/bridge/package" "$INSTALLED" || { echo "pi setup: the @awebai/oats-pi pi installed ($INSTALLED) is not the tarball that was checked" >&2; exit 1; }
  echo "bridge installed: $INSTALLED, the same files as the checked tarball"
fi
PACKAGES=$(node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).packages ?? [])' "$PI_AGENT_DIR/settings.json")
case "$PACKAGES" in *@awebai/pi@* | *'@awebai/pi"'*) echo "pi setup: bb's pi configuration lists @awebai/pi ($PACKAGES): the provider refuses a pi launch there" >&2; exit 1 ;; esac

# The mock model: the provider `mock`, model `echo` (a launch names it `mock/echo`). And a second
# model that is only LISTED, never run: `nested/echo2`, an id that holds a slash, so that bb lists
# `mock/nested/echo2`: its bare id is `nested/echo2`, and `echo2` is no model's (the Restart
# dialog's hold, step P4b: a bare id is the id minus its provider, never what an id ends in).
printf '{ "providers": { "mock": { "baseUrl": "http://127.0.0.1:%s/v1", "api": "openai-completions", "apiKey": "placeholder-not-a-key", "models": [ { "id": "echo", "name": "Echo (mock)", "reasoning": false, "input": ["text"], "contextWindow": 200000, "maxTokens": 4096, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }, { "id": "nested/echo2", "name": "Echo 2 (mock, listed only)", "reasoning": false, "input": ["text"], "contextWindow": 200000, "maxTokens": 4096, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } } ] } } }\n' "$PI_MOCK_PORT" > "$PI_AGENT_DIR/models.json"
install -m 0644 "$HERE/ask-dialog.ts" "$PI_AGENT_DIR/extensions/ask-dialog.ts"
if ! [ -f "$REAL/pi-mock.pid" ] || ! kill -0 "$(cat "$REAL/pi-mock.pid")" 2> /dev/null; then
  setsid node "$HERE/mock-openai.mjs" "$REAL/mock" "$PI_MOCK_PORT" > "$OUT/pi-mock.out" 2>&1 < /dev/null &
  echo $! > "$REAL/pi-mock.pid"
fi
echo "pi setup: pi $(pi --version), bb's pi configuration lists $PACKAGES"
