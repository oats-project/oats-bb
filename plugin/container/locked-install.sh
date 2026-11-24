#!/bin/sh
# Runs inside the container: installs a tool from its committed lock, plugin/container/locks/<tool>/
# (a package.json that names the tool's package at an exact version, and with it only what the tool
# would fetch from npm by itself; and the package-lock.json npm wrote for it: locks/README.md), and
# puts the tool's commands on the PATH.
#
#   locked-install.sh <tool>
#
# `npm ci` installs exactly what the lock names, every package at its version and with its
# integrity checked: nothing is resolved at run time, so a version published upstream a minute
# ago, or one the registry does not serve yet, cannot change or fail a run. An install is given
# five minutes and tried three times: for the network, which is all that is left to fail. (A fetch
# from the registry was seen to stall for an hour with nothing moving.)
# The tree goes to $TOOLS/<tool> (default ~/tools/<tool>), not into npm's global directory: a
# global install takes no lock.
set -eu
TOOL=${1:?usage: locked-install.sh <tool>   (a directory of plugin/container/locks/)}
HERE=$(cd "$(dirname "$0")" && pwd)
LOCK=$HERE/locks/$TOOL
DEST=${TOOLS:-$HOME/tools}/$TOOL
BIN=${NPM_CONFIG_PREFIX:-$HOME/.npm-global}/bin
[ -f "$LOCK/package.json" ] && [ -f "$LOCK/package-lock.json" ] || { echo "locked install: $LOCK has no package.json with its package-lock.json" >&2; exit 2; }
# The package the lock is for (its `tool`): the one whose commands go on the PATH.
PACKAGE=$(node -pe 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (typeof m.tool !== "string" || typeof (m.dependencies ?? {})[m.tool] !== "string") throw new Error("a lock names its tool, a package of its dependencies"); m.tool' "$LOCK/package.json")
mkdir -p "$DEST" "$BIN"
cp "$LOCK/package.json" "$LOCK/package-lock.json" "$DEST/"
installed=0
for attempt in 1 2 3; do
  if (cd "$DEST" && timeout 300 npm ci --no-audit --no-fund); then installed=1; break; fi
  echo "locked install: the install of $TOOL did not finish (attempt $attempt of 3)" >&2
done
[ "$installed" = 1 ] || { echo "locked install: $TOOL could not be installed from its lock" >&2; exit 1; }
# The tool's own commands, by its manifest (not every command of its tree).
node -e '
  const { readFileSync, rmSync, symlinkSync } = require("fs");
  const { join, resolve } = require("path");
  const [dest, name, bin] = process.argv.slice(1);
  const home = join(dest, "node_modules", name);
  const manifest = JSON.parse(readFileSync(join(home, "package.json"), "utf8"));
  const commands = typeof manifest.bin === "string" ? { [name.split("/").pop()]: manifest.bin } : (manifest.bin ?? {});
  for (const [command, file] of Object.entries(commands)) {
    rmSync(join(bin, command), { force: true });
    symlinkSync(resolve(home, file), join(bin, command));
  }
  console.log(`locked install: ${name}@${manifest.version} from its lock, in ${dest}; on the PATH: ${Object.keys(commands).join(", ") || "no command"}`);
' "$DEST" "$PACKAGE" "$BIN"
