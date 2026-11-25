#!/bin/sh
# Runs inside the container, after bb has built or installed a plugin: fails when bb FETCHED its
# build toolchain from npm.
#
# To build a plugin bb needs four packages at versions of its own (esbuild, @tailwindcss/node,
# @tailwindcss/oxide, tailwindcss). When they do not resolve, at exactly those versions, from
# bb-app's own module path, bb installs them itself with its bundled npm and NO lock, into
# `<its data directory>/plugins/toolchain-<versions>` (the command line's build: `~/.bb/plugins/`):
# the packages under them are then resolved that minute. The checks give bb those four from a lock
# instead (locks/bb-app for the installed bb, plugin/package.json's devDependencies for the
# plugin's own bb: locks/README.md), and this is the proof that it took them: no such directory
# exists. bb falls back to the fetch SILENTLY, so a bb whose pins moved without the locks is seen
# here, and by the unit test that holds the locks against bb's own pins.
set -eu
found=$(ls -d "$HOME/bbdata/plugins"/toolchain-* "$HOME/.bb/plugins"/toolchain-* 2> /dev/null || true)
if [ -n "$found" ]; then
  echo "bb FETCHED its build toolchain from npm at run time: $(echo "$found" | tr '\n' ' ')" >&2
  echo "its four pins are not the ones the locks hold: write them again for this bb (plugin/container/locks/README.md, \"When a pin moves\")" >&2
  exit 1
fi
echo "bb fetched no build toolchain: it built with the locked one"
