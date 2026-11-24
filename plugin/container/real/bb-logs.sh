#!/bin/sh
# Runs inside the container, when a real run or a pi run has failed (run.sh calls it before it
# copies the artefacts out): bb's own logs go beside the run's artefacts, so that a bb that did
# not start, or that failed under the run, can be read afterwards. Until this, only bb.out (what
# bb-app printed) left the container, and it names the directory without showing it.
#
#   bb-logs.sh [<bb's log directory> [<the run's out directory>]]
#
# It first says what the directory holds, every entry with its kind and size. Then it copies the
# LOGS only: the regular files directly in it whose name ends in `.log`, each cut to its last 2000
# lines and to 1 MB at most. Anything else there (a directory, a link, a file of another name) is
# listed and left where it is. Nothing outside that directory is read: not bb's data (its
# database, its keys), not the pi agent directory, no login.
set -eu
LOGS=${1:-$HOME/bbdata/logs}
OUT=${2:-/home/node/out/real}/bb-logs
LINES=2000
BYTES=1048576
[ -d "$LOGS" ] || { echo "bb logs: there is no $LOGS: bb wrote no log"; exit 0; }
echo "bb logs: $LOGS holds:"
find "$LOGS" -mindepth 1 -maxdepth 1 -printf '%y %s %f\n' | sort -k3 | while read -r kind size name; do
  case "$kind $name" in
    'f '*.log) echo "  $name, $size bytes" ;;
    *) echo "  $name, $size bytes, kind $kind: not a log, left out" ;;
  esac
done
mkdir -p "$OUT"
find "$LOGS" -mindepth 1 -maxdepth 1 -type f -name '*.log' | sort | while read -r file; do
  tail -n "$LINES" "$file" | tail -c "$BYTES" > "$OUT/$(basename "$file")"
done
echo "bb logs: the last $LINES lines of each log (1 MB at most) are in the artefacts, under bb-logs/"
