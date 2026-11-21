#!/bin/sh
# Runs inside the kernel-run container, as node (kernel-run.mjs calls it): a real OATS
# kernel, this provider as a package, a throwaway workspace and a deployment, in $RUN.
#
#   $RUN/kernel     the kernel's tree at the commit under test (put there by kernel-run.mjs)
#   $RUN/provider   this repository's tree (copied from /repo)
#
# Two provider packages are made from that tree, each a local git repository:
#   oats-bb.git        the provider as it ships;
#   oats-bb-trial.git  TRIAL ONLY, never pushed: the same tree, with its `session` verbs
#                      taken by the tests' entry (the sandboxed modes on) and each request
#                      the kernel sends kept in $RUN/requests. It exists to see a sandboxed
#                      launch made by a real kernel, which the shipped command refuses.
# Where the provider's compatibility floor refuses the kernel under test (an unreleased
# kernel), both get the trial floor of the README ("A trial against an unreleased kernel").
set -eu
RUN=${RUN:-/home/node/kernel-run}
BB_VERSION=$(bb --version)
FRAMEWORK=${FRAMEWORK:-v1.28.0}
commit() { git -c user.name=kernel-run -c user.email=kernel-run@example.invalid commit -q "$@"; }

echo "== the kernel, packed from $RUN/kernel"
(cd "$RUN/kernel" && npm pack --ignore-scripts --pack-destination "$RUN" > /dev/null)
npm install -g --no-audit --no-fund "$RUN"/awebai-oats-*.tgz > /dev/null
KERNEL_VERSION=$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
oats version --json | grep -q '"session-providers"' || { echo "kernel-run: this kernel does not list the feature session-providers" >&2; exit 1; }

echo "== the provider, as it ships and as the trial"
cd "$RUN/provider"
rm -rf .git
git init -q -b main
FLOOR=$(node -pe 'JSON.parse(require("fs").readFileSync("oats-package/oats-package.json", "utf8")).compatibility.oats')
if ! node -e 'const [floor,version]=process.argv.slice(1),m=/^>=(\d+)\.(\d+)\.(\d+)$/.exec(floor);if(!m)process.exit(1);const v=version.split(/[.-]/).map(Number);for(let i=0;i<3;i++){if(v[i]>+m[i+1])process.exit(0);if(v[i]<+m[i+1])process.exit(1)}process.exit(0)' "$FLOOR" "$KERNEL_VERSION"; then
  for manifest in oats-package/oats-package.json oats-package/capabilities/oats-bb/oats.json; do
    node -e 'const fs=require("fs"),[f,v]=process.argv.slice(1),m=JSON.parse(fs.readFileSync(f,"utf8"));m.compatibility.oats=">="+v;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$manifest" "$KERNEL_VERSION"
  done
  echo "trial floor >=$KERNEL_VERSION in place of $FLOOR"
fi
git add -A
commit -m "the provider's tree under test"
SHIPPED=$(git rev-parse HEAD)
rm -rf "$RUN/oats-bb.git"
git clone -q --bare . "$RUN/oats-bb.git"

# The trial: `session <verb>` goes to the tests' entry, with the request kept.
BIN=oats-package/capabilities/oats-bb/bin
git mv "$BIN/oats-bb.mjs" "$BIN/oats-bb-shipped.mjs"
mkdir -p oats-package/capabilities/oats-bb/trial
cp test/fixtures/sandboxed-bin.mjs oats-package/capabilities/oats-bb/trial/sandboxed-bin.mjs
sed -i 's#"../../oats-package/capabilities/oats-bb/lib/#"../lib/#' oats-package/capabilities/oats-bb/trial/sandboxed-bin.mjs
cp test/contract/kernel/trial-bin.mjs "$BIN/oats-bb.mjs"
chmod 755 "$BIN/oats-bb.mjs"
git add -A
commit -m "TRIAL ONLY, never pushed: session verbs through the tests' entry, requests kept"
TRIAL=$(git rev-parse HEAD)
rm -rf "$RUN/oats-bb-trial.git"
git clone -q --bare . "$RUN/oats-bb-trial.git"
git checkout -q "$SHIPPED"

# deployment <name> <provider repository> <provider commit> <yolo>
deployment() {
  WORKSPACE=$RUN/src/$1
  rm -rf "$RUN/ws-$1" "$WORKSPACE" "$RUN/$1"
  mkdir -p "$RUN/ws-$1/souls/worker" "$RUN/ws-$1/souls/clerk" "$RUN/src" "$RUN/$1"
  cd "$RUN/ws-$1"
  git init -q -b main
  printf '%s\n' 'schemaVersion: 2' "name: $1" 'members:' "  - file://$WORKSPACE" 'packages:' "  oats.framework: $FRAMEWORK" "  oats.bb: git:file://$2@$3" \
    'defaults:' '  capabilities:' '    oats.core: { from: package }' '    oats.bb: { from: package }' '  knowledge: none' '  messaging: none' '  tasks: none' > oats-workspace.yaml
  printf '%s\n' 'schemaVersion: 2' "workspace: file://$WORKSPACE" > oats-membership.yaml
  for soul in worker:worktree clerk:directory; do
    name=${soul%%:*}
    printf '%s\n' 'schemaVersion: 2' "name: $name" "description: \"A soul of the provider's run against a real kernel.\"" "work: ${soul##*:}" 'knowledge: none' 'launch: { harness: claude, model: claude-opus-5-5 }' > "souls/$name/soul.yaml"
    printf '# %s\n\nDo what TASK.md says, then stop.\n' "$name" > "souls/$name/AGENTS.md"
  done
  git add -A
  commit -m "the kernel run's workspace"
  git clone -q --bare . "$WORKSPACE"
  cd "$RUN/$1"
  oats onboard "$RUN/$1" --workspace "file://$WORKSPACE" > /dev/null
  printf '%s\n' 'settings:' '  oats.bb:' '    trust: container' "    version: $BB_VERSION" "    dataDir: $HOME/bbdata" 'launch-configs:' '  claude:' '    harness: claude' "    yolo: $4" '    default: true' >> oats-local.yaml
  git clone -q "$WORKSPACE" "$RUN/$1/$1"
  oats sync --dir "$RUN/$1" > /dev/null
}
echo "== two deployments: the provider as it ships (full mode), and the trial (sandboxed)"
deployment shipped "$RUN/oats-bb.git" "$SHIPPED" true
deployment trial "$RUN/oats-bb-trial.git" "$TRIAL" false
(cd "$RUN/shipped" && oats bb doctor 2>&1) | tee "$RUN/doctor.txt"
grep -q '^bb session provider: ready' "$RUN/doctor.txt" || { echo "kernel-run: the bb session provider is not ready" >&2; exit 1; }
echo "kernel-run: kernel $KERNEL_VERSION, provider $SHIPPED, trial $TRIAL, bb $BB_VERSION"
