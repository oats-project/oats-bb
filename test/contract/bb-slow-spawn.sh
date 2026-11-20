#!/bin/sh
# Contract test "killed launch" only. Stands for a launch whose caller dies while bb is
# still answering the spawn: the real bb makes the thread, then this shim holds its answer
# back, so the provider is still inside its launch when the test kills it.
if [ "$1 $2" = "thread spawn" ]; then
  out=$(bb "$@")
  status=$?
  : > "$HOME/slow-spawn-made"
  sleep 120
  printf '%s\n' "$out"
  exit $status
fi
exec bb "$@"
