#!/bin/sh
# Runs inside the container, when a run has failed (real/run.sh and ci.sh call it before they copy
# the artefacts out): bb's own logs go beside the run's artefacts, so that a bb that did not start,
# or that failed under the run, can be read afterwards. Until this, only bb.out (what bb-app
# printed) left the container, and it names the directory without showing it.
#
#   bb-logs.sh [<bb's log directory> [<the run's out directory>]]
#
# It first says what the directory holds, every entry with its kind and size and what will be
# done with it. Only then it copies, of the regular files directly in it:
#   - the LOGS, those whose name ends in `.log`, each cut to its last 2000 lines and to 1 MB;
#   - bb's own CRASH REPORTS, `process-*.json` (one per uncaught error of a bb process: the
#     error's name, message, stack and code, the process's name and pid, when, and the runtime's
#     version, platform, architecture and executable), whole, and only those of 1 MB at most.
# Anything else there (a directory, a link, a file of another name, a report over 1 MB) is listed
# and left where it is. Nothing outside that directory is read: not bb's data (its database, its
# keys), not a plugin's own log file (bb keeps those under its plugins' directories), not the pi
# agent directory, no login. bb's logs name threads and environments by their ids, and carry the
# text of an error and what a plugin's worker printed on its standard error: what is kept is as
# private as the run's other artefacts.
# A file that cannot be read (bb rotated it away, or its mode) is said so and not kept: the script
# still ends 0, since it runs when the run has already failed.
set -eu
LOGS=${1:-$HOME/bbdata/logs}
OUT=${2:-/home/node/out/real}/bb-logs
LINES=2000
BYTES=1048576
[ -d "$LOGS" ] || { echo "bb logs: there is no $LOGS: bb wrote no log"; exit 0; }
# What an entry is: log, report (a crash report to keep), big (one over 1 MB) or other.
what() { # what <kind> <size> <name>
  case "$1 $3" in
    'f '*.log) echo log ;;
    'f process-'*.json) if [ "$2" -le "$BYTES" ]; then echo report; else echo big; fi ;;
    *) echo other ;;
  esac
}
entries() { find "$LOGS" -mindepth 1 -maxdepth 1 -printf '%y %s %f\n' | sort -k3; }
echo "bb logs: $LOGS holds:"
entries | while read -r kind size name; do
  case "$(what "$kind" "$size" "$name")" in
    log) echo "  $name, $size bytes: a log, its last $LINES lines are kept" ;;
    report) echo "  $name, $size bytes: a crash report of bb's, kept" ;;
    big) echo "  $name, $size bytes: a crash report of bb's over 1 MB, left out" ;;
    other) echo "  $name, $size bytes, kind $kind: neither a log nor a crash report, left out" ;;
  esac
done
mkdir -p "$OUT"
entries | while read -r kind size name; do
  case "$(what "$kind" "$size" "$name")" in
    log)
      # In two steps: a pipe would hide a first tail that could not read the file.
      if tail -n "$LINES" "$LOGS/$name" > "$OUT/$name.part" 2> /dev/null && tail -c "$BYTES" "$OUT/$name.part" > "$OUT/$name"; then
        rm -f "$OUT/$name.part"
      else
        rm -f "$OUT/$name.part" "$OUT/$name"
        echo "bb logs: $name could not be read: not kept"
      fi
      ;;
    report) cp "$LOGS/$name" "$OUT/$name" 2> /dev/null || { rm -f "$OUT/$name"; echo "bb logs: $name could not be read: not kept"; } ;;
  esac
done
echo "bb logs: what was kept is in the artefacts, under bb-logs/"
