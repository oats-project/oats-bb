#!/bin/sh
# Runs only at the build of the contract images (test/contract/*/Dockerfile): NEVER by hand on a person's machine: it replaces its tools' commands in the user's global npm bin with links into this tree.
# Runs at the build of a contract image, as node: installs the image's tools from its committed
# lock (test/contract/locks/<image>/: a package.json that names each package at an exact version,
# and the package-lock.json npm wrote for it; README.md here), and puts the tools' commands on the
# PATH. The same shape as the plugin's checks (plugin/container/locked-install.sh).
#
# `npm ci` installs exactly what the lock names, every package at its version and with its
# integrity checked: nothing is resolved when an image is built, so a version published upstream
# a minute ago, or one the registry does not serve yet, cannot change or fail a run. An install is
# given five minutes and tried three times: for the network, which is all that is left to fail.
# The tree stays here, beside the lock (the Dockerfile copies both into ~/tools), not in npm's
# global directory: a global install takes no lock.
set -eu
DEST=$(cd "$(dirname "$0")" && pwd)
BIN=${NPM_CONFIG_PREFIX:-$HOME/.npm-global}/bin
[ -f "$DEST/package.json" ] && [ -f "$DEST/package-lock.json" ] || { echo "locked install: $DEST has no package.json with its package-lock.json" >&2; exit 2; }
mkdir -p "$BIN"
installed=0
for attempt in 1 2 3; do
  if (cd "$DEST" && timeout 300 npm ci --no-audit --no-fund); then installed=1; break; fi
  echo "locked install: the install did not finish (attempt $attempt of 3)" >&2
done
[ "$installed" = 1 ] || { echo "locked install: the tree of $DEST/package-lock.json could not be installed" >&2; exit 1; }
# The tools' own commands, by their manifests (the lock's `tools`; not every command of the tree).
node -e '
  const { readFileSync, rmSync, symlinkSync } = require("fs");
  const { join, resolve } = require("path");
  const [dest, bin] = process.argv.slice(1);
  const lock = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
  if (!Array.isArray(lock.tools) || lock.tools.length === 0 || lock.tools.some((name) => typeof (lock.dependencies ?? {})[name] !== "string")) throw new Error("a lock names its tools, packages of its dependencies");
  for (const name of lock.tools) {
    const home = join(dest, "node_modules", name);
    const manifest = JSON.parse(readFileSync(join(home, "package.json"), "utf8"));
    if (manifest.version !== lock.dependencies[name]) throw new Error(`${name} is ${manifest.version} in the tree, and the lock asks for ${lock.dependencies[name]}`);
    const commands = typeof manifest.bin === "string" ? { [name.split("/").pop()]: manifest.bin } : (manifest.bin ?? {});
    for (const [command, file] of Object.entries(commands)) {
      rmSync(join(bin, command), { force: true });
      symlinkSync(resolve(home, file), join(bin, command));
    }
    console.log(`locked install: ${name}@${manifest.version} from its lock, in ${dest}; on the PATH: ${Object.keys(commands).join(", ") || "no command"}`);
  }
' "$DEST" "$BIN"
