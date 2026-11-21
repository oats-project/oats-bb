#!/bin/bash
# Runs inside the container, as node (run.sh calls it): everything the real run needs, in $REAL.
#   bb-app at the repository's pin and the plugin's dependencies (container/setup.sh)
#   Claude Code, and a mock model for it (mock-anthropic.mjs): no login, nothing spent
#   the OATS kernel, packed from the tree in $REAL/kernel with `npm pack --ignore-scripts`, or
#     with KERNEL_NPM=<version> the registry's tarball of @awebai/oats@<version>, its integrity checked
#   the bb session provider, from the tree in $REAL/provider, a workspace and a deployment (workspace.sh)
#   bb-app, started with the mock model's address and a placeholder key in its own environment
#   the plugin, installed from this checkout, with `oatsBin` set to the recording wrapper
set -euo pipefail
PLUGIN=$(cd "$(dirname "$0")/../.." && pwd)
REAL=${REAL:-/home/node/real}
OUT=${OUT:-/home/node/out/real}
CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION:-2.1.328}
MOCK_PORT=9999
mkdir -p "$REAL/mock" "$REAL/records" "$REAL/bin" "$OUT" "$HOME/.claude"
wait_until() { # wait_until <seconds> <command...>
  local deadline=$((SECONDS + $1)); shift
  until "$@"; do [ $SECONDS -lt $deadline ] || return 1; sleep 0.5; done
}

echo "== bb-app and the plugin's dependencies"
sh "$PLUGIN/container/setup.sh"

echo "== Claude Code $CLAUDE_CODE_VERSION"
# Its install downloads a native binary; where that download fails, `claude` is there and cannot
# run. So the version it prints is the check, and the install is tried again.
claude_ready() { [ "$(claude --version 2>/dev/null | cut -d' ' -f1)" = "$CLAUDE_CODE_VERSION" ]; }
for attempt in 1 2 3; do
  claude_ready && break
  npm install -g --force --no-audit --no-fund "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" || true
done
claude_ready || { echo "setup: Claude Code $CLAUDE_CODE_VERSION could not be installed" >&2; exit 1; }
# The mock model, for every Claude this user starts: the user settings of the Claude configuration
# bb's server runs with.
printf '{ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:%s" } }\n' "$MOCK_PORT" > "$HOME/.claude/settings.json"

KERNEL_NPM=${KERNEL_NPM:-}
if [ -n "$KERNEL_NPM" ]; then
  echo "== the kernel, from npm: @awebai/oats@$KERNEL_NPM"
  if ! command -v oats > /dev/null; then
    # The registry's tarball, fetched once: what npm says of it is kept (kernel.json), its
    # integrity is the one asked for, and that file is what is installed.
    (cd "$REAL" && npm pack "@awebai/oats@$KERNEL_NPM" --json > "$OUT/kernel.json")
    read_pack() { node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[0][process.argv[2]]' "$OUT/kernel.json" "$1"; }
    echo "kernel tarball: $(read_pack id), integrity $(read_pack integrity), gitHead $(npm view "@awebai/oats@$KERNEL_NPM" gitHead)"
    [ -z "${KERNEL_INTEGRITY:-}" ] || [ "$(read_pack integrity)" = "$KERNEL_INTEGRITY" ] || { echo "setup: the tarball of @awebai/oats@$KERNEL_NPM is not the one expected (KERNEL_INTEGRITY $KERNEL_INTEGRITY)" >&2; exit 1; }
    npm install -g --no-audit --no-fund "$REAL/$(read_pack filename)"
  fi
  [ "$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')" = "$KERNEL_NPM" ] || { echo "setup: the installed oats is not $KERNEL_NPM" >&2; exit 1; }
else
  echo "== the kernel, packed from $REAL/kernel"
  if ! command -v oats > /dev/null; then
    (cd "$REAL/kernel" && npm pack --ignore-scripts --pack-destination "$REAL" > /dev/null)
    npm install -g --no-audit --no-fund "$REAL"/awebai-oats-*.tgz
  fi
fi
oats version --json | grep -q '"session-providers"' || { echo "setup: this kernel does not list the feature session-providers" >&2; exit 1; }
echo "oats $(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')"

echo "== the mock model"
if ! [ -f "$REAL/mock.pid" ] || ! kill -0 "$(cat "$REAL/mock.pid")" 2> /dev/null; then
  setsid node "$PLUGIN/container/real/mock-anthropic.mjs" "$REAL/mock" "$MOCK_PORT" > "$OUT/mock.out" 2>&1 < /dev/null &
  echo $! > "$REAL/mock.pid"
fi

echo "== bb-app"
if ! bb machine list > /dev/null 2>&1; then
  # Sovereign: no account, no telemetry, loopback. The key is a placeholder: bb reports its
  # claude-code provider ready only when it has a credential, and the mock asks for none.
  env -i HOME="$HOME" USER=node BB_TELEMETRY=false PATH="$PATH" \
    ANTHROPIC_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_API_KEY=placeholder-not-a-key \
    setsid bb-app --data-dir "$HOME/bbdata" --server-bind-host 127.0.0.1 --no-in-app-updates > "$OUT/bb.out" 2>&1 < /dev/null &
  echo $! > "$REAL/bb.pid"
  wait_until 120 bb machine list --json > /dev/null 2>&1 || { echo "setup: bb did not start"; tail -20 "$OUT/bb.out"; exit 1; }
  wait_until 60 sh -c 'bb machine list 2>/dev/null | grep -q connected' || { echo "setup: no machine connected"; exit 1; }
fi

# bb's own limit stays: one running thread per processor (2 here); the run uses it (scenario.mjs, B1).
bb concurrency-limit status

echo "== the provider, the workspace and the deployment"
REAL="$REAL" BB_VERSION="$(bb --version)" sh "$PLUGIN/container/real/workspace.sh"
(cd "$REAL/deploy" && oats bb doctor 2>&1) | tee "$OUT/doctor.txt"
grep -q '^bb session provider: ready' "$OUT/doctor.txt" || { echo "setup: the bb session provider is not ready" >&2; exit 1; }

echo "== the recording wrapper and the plugin"
install -m 0755 "$PLUGIN/container/real/oats-record.mjs" "$REAL/bin/oats-record"
printf '{"oats":"%s","records":"%s","path":"%s"}\n' "$(command -v oats)" "$REAL/records" "$PATH" > "$REAL/bin/oats-record.json"
LIVE=$REAL/plugin-install
rm -rf "$LIVE"
mkdir -p "$LIVE"
(cd "$PLUGIN" && tar -c --exclude ./dist --exclude ./.git --exclude ./container/out .) | tar -x -C "$LIVE"
bb plugin remove oats --yes > /dev/null 2>&1 || true
(cd "$LIVE" && bb plugin install . --yes) > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
bb plugin list | grep -q '^oats@.* running' || { echo "setup: the plugin is not running" >&2; bb plugin list; exit 1; }
bb plugin config oats set deployment "$REAL/deploy" > /dev/null
bb plugin config oats set oatsBin "$REAL/bin/oats-record" > /dev/null
echo "setup: bb-app $(bb --version), $(claude --version), the plugin installed from $PLUGIN"
