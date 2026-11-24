#!/bin/sh
# Runs inside the container, when a run has failed (real/run.sh and ci.sh call it before they copy
# the artefacts out): bb's own logs go beside the run's artefacts, so that a bb that did not start,
# or that failed under the run, can be read afterwards. Until this, only bb.out (what bb-app
# printed) left the container, and it names the directory without showing it.
#
#   bb-logs.sh [<bb's log directory> [<the run's out directory>]]
#
# It first says what the directory holds, every entry with its kind and size. Then it copies, of
# the regular files directly in it:
#   - the LOGS, those whose name ends in `.log`, each cut to its last 2000 lines and to 1 MB;
#   - bb's own CRASH REPORTS, `process-*.json` (one per uncaught error of a bb process: the
#     error's name, message, stack and code, the process's name and pid, when, and the runtime's
#     version, platform, architecture and executable), whole, and only those of 1 MB at most.
# Anything else there (a directory, a link, a file of another name, a report over 1 MB) is listed
# and left where it is. Nothing outside that directory is read: not bb's data (its database, its
# keys), not a plugin's own log (bb keeps those under its plugins' directories), not the pi agent
# directory, no login. bb's logs name threads and environments by their ids and carry the text of
# an error: what is kept is as private as the run's other artefacts.
set -eu
LOGS=${1:-$HOME/bbdata/logs}
OUT=${2:-/home/node/out/real}/bb-logs
LINES=2000
BYTES=1048576
[ -d "$LOGS" ] || { echo "bb logs: there is no $LOGS: bb wrote no log"; exit 0; }
mkdir -p "$OUT"
echo "bb logs: $LOGS holds:"
find "$LOGS" -mindepth 1 -maxdepth 1 -printf '%y %s %f\n' | sort -k3 | while read -r kind size name; do
  case "$kind $name" in
    'f '*.log)
      tail -n "$LINES" "$LOGS/$name" | tail -c "$BYTES" > "$OUT/$name"
      echo "  $name, $size bytes: a log, its last $LINES lines kept"
      ;;
    'f process-'*.json)
      if [ "$size" -le "$BYTES" ]; then
        cp "$LOGS/$name" "$OUT/$name"
        echo "  $name, $size bytes: a crash report of bb's, kept"
      else
        echo "  $name, $size bytes: a crash report of bb's over 1 MB, left out"
      fi
      ;;
    *) echo "  $name, $size bytes, kind $kind: neither a log nor a crash report, left out" ;;
  esac
done
echo "bb logs: what was kept is in the artefacts, under bb-logs/"
