#!/bin/sh
# Runs inside the pi kernel-run container, as node (kernel/pi-run.mjs calls it): the OATS
# kernel the image installed from npm, this provider as a package, a throwaway workspace
# and one deployment whose two souls run on bb, one on pi and one on Claude Code.
#
#   $RUN/provider   this repository's tree (copied from /repo)
#
# No messaging: this run is for what the kernel does with a provider home's session (the
# launch, the input, a lost session's resume and its count, the stop and the retire).
set -eu
RUN=${RUN:-/home/node/pi-kernel-run}
BB_VERSION=$(bb --version)
# Where the container's bb is (test/contract/rig.mjs: not on bb's default ports), as the
# rig's shell names it for bb's CLI; the deployment names it to the provider below: its
# server, its host daemon's port, and the daemon's address on that port. The address is
# written too because the kernel hands the provider the manifest's default for `daemon`
# (bb's default port) where a deployment sets none, and the provider refuses a
# hostDaemonPort beside a `daemon` on another port (E_BACKEND_SETTINGS; seen under kernel
# 0.70.5 and under awebai/oats main de3b4f61, 2026-11-25).
: "${BB_SERVER_URL:?} ${BB_HOST_DAEMON_PORT:?}"
FRAMEWORK=${FRAMEWORK:-v1.28.0}
commit() { git -c user.name=kernel-run -c user.email=kernel-run@example.invalid commit -q "$@"; }

KERNEL_VERSION=$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
oats version --json | grep -q '"session-providers"' || { echo "pi-kernel-run: this kernel does not list the feature session-providers" >&2; exit 1; }

echo "== the provider, as it ships"
cd "$RUN/provider"
rm -rf .git
git init -q -b main
# Where the provider's floor refuses the kernel the image pins (a floor raised to an OATS
# release the image does not hold yet), the trial floor of the README ("A trial against an
# unreleased kernel"), as kernel/setup.sh does.
FLOOR=$(node -pe 'JSON.parse(require("fs").readFileSync("oats-package/oats-package.json", "utf8")).compatibility.oats')
if ! node -e 'const [floor,version]=process.argv.slice(1),m=/^>=(\d+)\.(\d+)\.(\d+)$/.exec(floor);if(!m)process.exit(1);const v=version.split(/[.-]/).map(Number);for(let i=0;i<3;i++){if(v[i]>+m[i+1])process.exit(0);if(v[i]<+m[i+1])process.exit(1)}process.exit(0)' "$FLOOR" "$KERNEL_VERSION"; then
  for manifest in oats-package/oats-package.json oats-package/capabilities/oats-bb/oats.json; do
    node -e 'const fs=require("fs"),[f,v]=process.argv.slice(1),m=JSON.parse(fs.readFileSync(f,"utf8"));m.compatibility.oats=">="+v;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$manifest" "$KERNEL_VERSION"
  done
  echo "pi-kernel-run: trial floor >=$KERNEL_VERSION in place of $FLOOR"
fi
git add -A
commit -m "the provider's tree under test"
SHIPPED=$(git rev-parse HEAD)
rm -rf "$RUN/oats-bb.git"
git clone -q --bare . "$RUN/oats-bb.git"

echo "== one deployment: a soul on pi, a soul on Claude Code"
WORKSPACE=$RUN/src/harnesses
rm -rf "$RUN/ws" "$WORKSPACE" "$RUN/deploy"
mkdir -p "$RUN/ws/souls/piworker" "$RUN/ws/souls/claudeworker" "$RUN/src" "$RUN/deploy"
cd "$RUN/ws"
git init -q -b main
printf '%s\n' 'schemaVersion: 2' 'name: harnesses' 'members:' "  - file://$WORKSPACE" 'packages:' "  oats.framework: $FRAMEWORK" "  oats.bb: git:file://$RUN/oats-bb.git@$SHIPPED" \
  'defaults:' '  capabilities:' '    oats.core: { from: package }' '    oats.bb: { from: package }' '  knowledge: none' '  messaging: none' '  tasks: none' > oats-workspace.yaml
printf '%s\n' 'schemaVersion: 2' "workspace: file://$WORKSPACE" > oats-membership.yaml
soul() { # soul <name> <harness> <model>
  printf '%s\n' 'schemaVersion: 2' "name: $1" "description: \"A soul of the provider's pi run against a real kernel.\"" 'work: directory' 'knowledge: none' "launch: { harness: $2, model: $3 }" > "souls/$1/soul.yaml"
  printf '# %s\n\nDo what TASK.md says, then stop.\n' "$1" > "souls/$1/AGENTS.md"
}
soul piworker pi mock/echo
soul claudeworker claude claude-opus-5-5
git add -A
commit -m "the pi kernel run's workspace"
git clone -q --bare . "$WORKSPACE"
cd "$RUN/deploy"
oats onboard "$RUN/deploy" --workspace "file://$WORKSPACE" > /dev/null
# bb's pi configuration is the container's own ~/.pi/agent (the image installed @awebai/oats-pi there).
printf '%s\n' 'settings:' '  oats.bb:' '    trust: container' "    version: $BB_VERSION" "    dataDir: $HOME/bbdata" "    server: $BB_SERVER_URL" "    hostDaemonPort: $BB_HOST_DAEMON_PORT" "    daemon: http://127.0.0.1:$BB_HOST_DAEMON_PORT" "    piAgentDir: $HOME/.pi/agent" \
  'launch-configs:' '  pi-full:' '    harness: pi' '    yolo: true' '    default: true' '  claude-full:' '    harness: claude' '    yolo: true' '    default: true' >> oats-local.yaml
oats sync --dir "$RUN/deploy" > /dev/null
echo "pi-kernel-run: kernel $KERNEL_VERSION, provider $SHIPPED, bb $BB_VERSION, pi $(pi --version)"
