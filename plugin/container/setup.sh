#!/bin/sh
# Runs inside the container, as node, in the plugin's directory: installs bb at the pinned version
# and the plugin's dependencies. Inside the container so that the installs run under
# its CPU and memory limits and never touch the host.
set -eu
cd "$(dirname "$0")/.."
# The version: the repository's pin when ci.sh read one (BB_VERSION, from bb-version at the
# repository's root), else the plugin's own. They must agree: `npm ci` installs package.json's
# bb-app, which the unit tests and the build use, and the live tests use the global one.
PACKAGE_BB_VERSION=$(node -p 'require("./package.json").devDependencies["bb-app"]')
BB_VERSION=${BB_VERSION:-$PACKAGE_BB_VERSION}
if [ "$BB_VERSION" != "$PACKAGE_BB_VERSION" ]; then
  echo "setup: the repository pins bb $BB_VERSION (bb-version) and plugin/package.json pins bb-app $PACKAGE_BB_VERSION: make them equal" >&2
  exit 1
fi
if [ "$(bb --version 2>/dev/null || true)" != "$BB_VERSION" ]; then
  npm install -g "bb-app@$BB_VERSION"
fi
npm ci
echo "setup: bb-app $(bb --version), plugin SDK $(node -p 'JSON.parse(require("fs").readFileSync("node_modules/@get-bb/plugin-sdk/package.json", "utf8")).version')"
