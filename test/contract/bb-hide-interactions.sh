#!/bin/sh
# Contract test T4 only. Stands for the window between the provider's read of a thread's
# pending interactions and its tell: the read answers "none", everything else is the real
# bb. So the provider tells a thread that does wait on a person, and bb queues the message.
if [ "$1 $2 $3" = "thread interactions list" ]; then
  echo '[]'
  exit 0
fi
exec bb "$@"
