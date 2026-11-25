#!/bin/sh
# Runs inside the container, in the pi run: fails when pi would fetch, or has fetched, the two
# tools it downloads by itself.
#
# pi looks for `fd` (or `fdfind`) and `rg` on the PATH when its interactive mode starts and when
# its `find` or `grep` tool runs; where one is missing it downloads the LATEST release from
# github.com into `<its agent directory>/bin` (pi 1.5.2, dist/utils/tools-manager.js). Whatever was
# released that minute would then run in a check. The image holds both, from the distribution
# (Dockerfile: fd-find, ripgrep), so pi finds them and fetches nothing. This asks pi's own code
# what it finds (`getToolPath`: no network), and looks for a binary pi fetched.
#
#   no-pi-tools-fetch.sh [<pi's agent directory>]      (default ~/.pi/agent)
set -eu
AGENT_DIR=${1:-$HOME/.pi/agent}
PI_HOME=$HOME/tools/pi/node_modules/@earendil-works/pi-coding-agent
[ -f "$PI_HOME/dist/utils/tools-manager.js" ] || { echo "pi's own tools: $PI_HOME/dist/utils/tools-manager.js is not there: pi changed where it finds its tools, read it again" >&2; exit 1; }
found=$(node -e '
  import(process.argv[1]).then((manager) => {
    const fd = manager.getToolPath("fd");
    const rg = manager.getToolPath("rg");
    console.log(`fd: ${fd ?? "NOT FOUND"}, ripgrep: ${rg ?? "NOT FOUND"}`);
    // A name alone is a command on the PATH; a path is a binary in the agent directory, which pi put there.
    process.exit([fd, rg].every((tool) => typeof tool === "string" && !tool.includes("/")) ? 0 : 1);
  }, (error) => { console.log(`pi could not be asked: ${error.message}`); process.exit(1); });
' "$PI_HOME/dist/utils/tools-manager.js") || {
  echo "pi does not find fd and ripgrep on the PATH ($found): it would fetch their latest releases from github.com at run time. The image must hold them (plugin/container/Dockerfile: fd-find, ripgrep; plugin/container/locks/README.md)" >&2
  exit 1
}
fetched=$(ls "$AGENT_DIR/bin/fd" "$AGENT_DIR/bin/rg" 2> /dev/null || true)
if [ -n "$fetched" ]; then
  echo "pi FETCHED a tool by itself at run time: $(echo "$fetched" | tr '\n' ' ')" >&2
  exit 1
fi
echo "pi fetched no tool: it finds them on the PATH ($found)"
