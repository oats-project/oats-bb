#!/bin/sh
# The test of bb-plugin-command.sh, with a bb of its own (no bb-app): a script that answers
# "unknown command" for its first N calls, as bb does while the plugin that adds the command is
# not loaded yet, and then answers. Run by container/unit.sh.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# fake bb: FAILS=<n> first calls fail as bb does; the calls are counted in $WORK/calls.
cat > "$WORK/bb" <<'FAKE'
#!/bin/sh
calls=$(cat "$COUNT" 2>/dev/null || echo 0)
calls=$((calls + 1))
echo "$calls" > "$COUNT"
if [ "$calls" -le "$FAILS" ]; then
  echo "error: unknown command '$1'" >&2
  exit 1
fi
echo "Concurrency limit: 2 (auto)"
FAKE
chmod +x "$WORK/bb"
failures=0
check() { # check <what> <command...>
  what=$1
  shift
  if "$@"; then echo "PASS $what"; else echo "FAIL $what"; failures=$((failures + 1)); fi
}
run() { # run <fails> <seconds>: the script's output in $WORK/out, its errors in $WORK/err, its exit code in $WORK/exit
  rm -f "$WORK/calls"
  set +e
  BB="$WORK/bb" COUNT="$WORK/calls" FAILS=$1 sh "$HERE/bb-plugin-command.sh" "$2" concurrency-limit status > "$WORK/out" 2> "$WORK/err"
  echo $? > "$WORK/exit"
  set -e
}

run 0 5
check "a command bb has answers at once: exit 0, its output, one call" \
  sh -c '[ "$(cat "$1/exit")" = 0 ] && [ "$(cat "$1/out")" = "Concurrency limit: 2 (auto)" ] && [ "$(cat "$1/calls")" = 1 ]' - "$WORK"

run 3 20
check "a command bb does not have yet is waited for: exit 0, its output, after the calls that failed" \
  sh -c '[ "$(cat "$1/exit")" = 0 ] && [ "$(cat "$1/out")" = "Concurrency limit: 2 (auto)" ] && [ "$(cat "$1/calls")" = 4 ] && [ ! -s "$1/err" ]' - "$WORK"

run 1000 2
check "a command that never comes fails after the limit: exit 1, bb's error and what was waited for, no output" \
  sh -c '[ "$(cat "$1/exit")" = 1 ] && [ ! -s "$1/out" ] && grep -q "unknown command .concurrency-limit." "$1/err" && grep -q "did not answer within 2 s" "$1/err"' - "$WORK"

[ "$failures" = 0 ] || { echo "bb-plugin-command: $failures check(s) failed"; exit 1; }
echo "bb-plugin-command: all checks passed"
