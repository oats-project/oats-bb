#!/bin/sh
# A command that one of bb's plugins adds to its CLI (`bb concurrency-limit …`, of a plugin bb
# bundles), run once bb has it:
#
#   bb-plugin-command.sh <seconds> <bb arguments…>
#
# bb's CLI knows such a command only once the plugin that adds it is loaded, and bb loads its
# plugins after it starts: a bb with a machine connected can still answer "unknown command" for a
# few seconds. So the command is tried again until it answers, for <seconds> at most; then its
# output is printed and the exit code is 0. When it never answers, the last error is printed with
# what was waited for, and the exit code is 1. BB names another bb (the test's).
set -eu
SECONDS_MOST=${1:-}
case $SECONDS_MOST in
  '' | *[!0-9]*)
    echo "usage: bb-plugin-command.sh <seconds> <bb arguments…>" >&2
    exit 2
    ;;
esac
shift
BB=${BB:-bb}
started=$(date +%s)
while :; do
  if output=$("$BB" "$@" 2>&1); then
    printf '%s\n' "$output"
    exit 0
  fi
  if [ $(($(date +%s) - started)) -ge "$SECONDS_MOST" ]; then
    printf '%s\n' "$output" >&2
    echo "bb-plugin-command: \`bb $*\` did not answer within $SECONDS_MOST s: a command one of bb's plugins adds, so that plugin is not loaded (bb plugin list)" >&2
    exit 1
  fi
  sleep 0.5
done
