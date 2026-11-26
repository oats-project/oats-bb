#!/bin/sh
# Runs inside the container, as node, in the plugin's directory: installs bb at the pinned version
# and the plugin's dependencies. Inside the container so that the installs run under
# its CPU and memory limits and never touch the host.
. "$(dirname "$0")/guard.sh" || exit 97 # refuses outside the checks' container, before anything is touched (and where the guard itself is not beside it)
set -eu
cd "$(dirname "$0")/.."
# The version: the repository's pin when ci.sh read one (BB_VERSION, from bb-version at the
# repository's root), else the plugin's own. They must agree: `npm ci` installs package.json's
# bb-app, which the unit tests and the build use, and the live tests use the one installed from
# its lock (below).
PACKAGE_BB_VERSION=$(node -p 'require("./package.json").devDependencies["bb-app"]')
BB_VERSION=${BB_VERSION:-$PACKAGE_BB_VERSION}
if [ "$BB_VERSION" != "$PACKAGE_BB_VERSION" ]; then
  echo "setup: the repository pins bb $BB_VERSION (bb-version) and plugin/package.json pins bb-app $PACKAGE_BB_VERSION: make them equal" >&2
  exit 1
fi
# bb-app comes from its committed lock (locks/bb-app, locked-install.sh; locks/README.md): bb-app
# itself and every package under it at the version and with the integrity the lock names. Nothing
# is resolved at run time: `npm install -g bb-app@<version>` resolved bb-app's dependencies anew
# at every run, five of them by a range. The lock must be the lock of the pinned version.
LOCKED_BB_VERSION=$(node -p 'require("./container/locks/bb-app/package.json").dependencies["bb-app"]')
if [ "$BB_VERSION" != "$LOCKED_BB_VERSION" ]; then
  echo "setup: the repository pins bb $BB_VERSION and container/locks/bb-app is the lock of bb-app $LOCKED_BB_VERSION: write the lock again (plugin/container/relock.sh bb-app)" >&2
  exit 1
fi
if [ "$(bb --version 2>/dev/null || true)" != "$BB_VERSION" ]; then
  sh container/locked-install.sh bb-app
fi
[ "$(bb --version 2>/dev/null || true)" = "$BB_VERSION" ] || { echo "setup: bb-app $BB_VERSION could not be installed from its lock" >&2; exit 1; }
npm ci
echo "setup: bb-app $(bb --version), plugin SDK $(node -p 'JSON.parse(require("fs").readFileSync("node_modules/@get-bb/plugin-sdk/package.json", "utf8")).version')"
