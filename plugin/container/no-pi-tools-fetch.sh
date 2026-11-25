#!/bin/sh
# Runs inside the container, in the pi run: fails when pi would fetch, or has fetched, the two
# tools it downloads by itself.
#
# pi looks for `fd` (or `fdfind`) and `rg` on the PATH when its interactive mode starts and when
# its `find` or `grep` tool runs; where one is missing it downloads the LATEST release from
# github.com into `<its agent directory>/bin` (pi 1.5.2, dist/utils/tools-manager.js). Whatever was
# released that minute would then run in a check. The image holds both, from the distribution
# (Dockerfile: fd-find, ripgrep), so pi finds them and fetches nothing. This asks pi's own code
# what it finds (`getToolPath`: no network). pi looks in its agent directory's `bin` BEFORE the
# PATH, so its answer tells the three cases apart: a command's name (found on the PATH: good), a
# path (a binary pi fetched before), nothing (pi would fetch it).
# The agent directory is the one pi itself takes (its own rule: ~/.pi/agent here).
set -eu
PI_HOME=$HOME/tools/pi/node_modules/@earendil-works/pi-coding-agent
[ -f "$PI_HOME/dist/utils/tools-manager.js" ] || { echo "pi's own tools: $PI_HOME/dist/utils/tools-manager.js is not there: pi changed where it finds its tools, read it again" >&2; exit 1; }
found=$(node -e '
  import(process.argv[1]).then((manager) => {
    const tools = { fd: manager.getToolPath("fd"), ripgrep: manager.getToolPath("rg") };
    console.log(Object.entries(tools).map(([name, tool]) => `${name}: ${tool ?? "NOT FOUND"}`).join(", "));
    const all = Object.values(tools);
    // A path is a binary in the agent directory, which pi put there; nothing is a tool pi would fetch.
    process.exit(all.some((tool) => typeof tool === "string" && tool.includes("/")) ? 3 : all.some((tool) => typeof tool !== "string") ? 2 : 0);
  }, (error) => { console.log(`pi could not be asked: ${error.message}`); process.exit(1); });
' "$PI_HOME/dist/utils/tools-manager.js") && status=0 || status=$?
case "$status" in
  0) echo "pi fetched no tool: it finds them on the PATH ($found)" ;;
  3)
    echo "pi FETCHED a tool by itself at run time ($found): a pi of this run did not find it on the PATH (the image holds fd-find and ripgrep: which pi ran with another PATH?)" >&2
    exit 1
    ;;
  2)
    echo "pi does not find fd and ripgrep on the PATH ($found): it would fetch their latest releases from github.com at run time. The image must hold them (plugin/container/Dockerfile: fd-find, ripgrep; plugin/container/locks/README.md)" >&2
    exit 1
    ;;
  *)
    echo "pi could not be asked what it finds: $found" >&2
    exit 1
    ;;
esac
