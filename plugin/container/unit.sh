#!/bin/sh
# Runs inside the container: the typecheck, the unit tests (vitest and one shell test of the real
# run's recipe) and the plugin build.
set -eu
cd "$(dirname "$0")/.."
echo "== typecheck"
npx tsc --noEmit
echo "== unit tests"
npx vitest run
echo "== the real run's wait for a bb plugin's command"
sh container/real/bb-plugin-command.test.sh
if [ -f app.tsx ]; then
  echo "== build"
  npx bb plugin build
else
  echo "== build: skipped, app.tsx is not in this tree yet (the live tests build the backend)"
fi
