#!/bin/sh
# Runs inside the container (setup.sh calls it): a throwaway OATS workspace and deployment for the
# real run, in $REAL (default /home/node/real).
#   - the provider (oats.bb) as a local git repository made from the tree in $REAL/provider. Only
#     where its `compatibility.oats` floor refuses the kernel under test, one trial-only commit goes
#     on top that lowers the floor to the packed kernel's version (the provider's README, "A trial
#     against an unreleased kernel"). That commit exists only in this container. With
#     REQUIRE_REAL_FLOOR=1 none is made: a floor that refuses the kernel fails the run instead.
#   - a workspace repository with souls that have NO messaging capability: oats.core and oats.bb
#     only. Their names are the ones the plugin's fixtures use.
#   - the deployment $REAL/deploy, onboarded into that workspace, with the host's facts for bb
#     (`trust: container`, the pinned version) and NO launch configuration: nothing on the host
#     chooses bb's full mode, so a spawn launches in it only because it asks (`--yolo`: the
#     plugin's on every spawn, the scenario's own for the agents it makes on the command line).
. "$(dirname "$0")/../guard.sh" || exit 97 # refuses outside the checks' container, before anything is touched (and where the guard itself is not beside it)
set -eu
REAL=${REAL:-/home/node/real}
BB_VERSION=${BB_VERSION:-$(bb --version)}
KERNEL_VERSION=$(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
FRAMEWORK=${FRAMEWORK:-v1.26.0}
# Fixed author, committer and dates: the same trees give the same commit ids at every run, so the
# recorded answers that name them do not change from one run to the next.
commit() {
  GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z \
    git -c user.name=real-run -c user.email=real-run@example.invalid commit -q "$@"
}
WORKSPACE=$REAL/src/oats-real

# ---- the provider, with the trial-only floor where its own refuses the kernel
cd "$REAL/provider"
if [ ! -d .git ]; then
  git init -q -b main
  git add -A
  commit -m "the provider's tree under test"
  # The trial-only floor, only where the provider's own floor refuses the kernel under test.
  FLOOR=$(node -pe 'JSON.parse(require("fs").readFileSync("oats-package/oats-package.json", "utf8")).compatibility.oats')
  if node -e 'const [floor,version]=process.argv.slice(1),m=/^>=(\d+)\.(\d+)\.(\d+)$/.exec(floor);if(!m)process.exit(1);const v=version.split(/[.-]/).map(Number);for(let i=0;i<3;i++){if(v[i]>+m[i+1])process.exit(0);if(v[i]<+m[i+1])process.exit(1)}' "$FLOOR" "$KERNEL_VERSION"; then
    TRIAL="no trial commit: its own floor ($FLOOR) admits the kernel"
  else
    # The run a release waits on: the floor is the provider's own, or the run fails here.
    [ "${REQUIRE_REAL_FLOOR:-0}" != 1 ] || { echo "workspace: REQUIRE_REAL_FLOOR=1, and the provider's floor ($FLOOR) refuses kernel $KERNEL_VERSION: the floor is not lowered" >&2; exit 1; }
    for manifest in oats-package/oats-package.json oats-package/capabilities/oats-bb/oats.json; do
      node -e 'const fs=require("fs"),[f,v]=process.argv.slice(1),m=JSON.parse(fs.readFileSync(f,"utf8"));m.compatibility.oats=">="+v;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$manifest" "$KERNEL_VERSION"
    done
    git add -A
    commit -m "TRIAL ONLY, never pushed: compatibility.oats >=$KERNEL_VERSION (an unreleased kernel)"
    TRIAL="trial floor >=$KERNEL_VERSION in place of $FLOOR"
  fi
fi
TRIAL=${TRIAL:-$(git log -1 --format=%s)}
# A tree left by an earlier call: one commit is the provider's own tree, a second is a trial floor.
[ "${REQUIRE_REAL_FLOOR:-0}" != 1 ] || [ "$(git rev-list --count HEAD)" = 1 ] || { echo "workspace: REQUIRE_REAL_FLOOR=1, and the provider's tree here carries a trial-only commit ($TRIAL)" >&2; exit 1; }
PROVIDER_OID=$(git rev-parse HEAD)
rm -rf "$REAL/oats-bb.git"
git clone -q --bare "$REAL/provider" "$REAL/oats-bb.git"

# ---- the workspace
rm -rf "$REAL/ws" "$WORKSPACE"
mkdir -p "$REAL/ws" "$REAL/src"
cd "$REAL/ws"
git init -q -b main
cat > oats-workspace.yaml <<Y
schemaVersion: 2
name: bbreal
members:
  - file://$WORKSPACE
packages:
  oats.framework: $FRAMEWORK
  oats.bb: git:file://$REAL/oats-bb.git@$PROVIDER_OID
defaults:
  capabilities:
    oats.core: { from: package }
    oats.bb: { from: package }
  knowledge: none
  messaging: none
  tasks: none
Y
cat > oats-membership.yaml <<Y
schemaVersion: 2
workspace: file://$WORKSPACE
Y
soul() { # soul <name> <work mode> <description>
  mkdir -p "souls/$1"
  cat > "souls/$1/soul.yaml" <<Y
schemaVersion: 2
name: $1
description: "$3"
work: $2
knowledge: none
launch: { harness: claude, model: claude-opus-5-5 }
Y
  printf '# %s\n\nA soul of the real run of the OATS plugin for bb. Do what TASK.md says, then stop.\n' "$1" > "souls/$1/AGENTS.md"
}
soul oats-developer directory "OATS developer: builds and proves one spec."
soul oats-product-expert directory "OATS product expert: leads an effort."
soul oats-desktop-developer directory "OATS Desktop developer: builds the Desktop."
soul knowledge-harvester directory "Harvests what a team learned into its knowledge base."
soul oats-expert worktree "OATS expert: answers questions about OATS."
git add -A
commit -m "the real run's workspace"
git clone -q --bare . "$WORKSPACE"

# ---- the deployment
rm -rf "$REAL/deploy"
mkdir -p "$REAL/deploy"
cd "$REAL/deploy"
oats onboard "$REAL/deploy" --workspace "file://$WORKSPACE"
cat >> oats-local.yaml <<Y
settings:
  oats.bb:
    trust: container
    version: $BB_VERSION
Y
# The soul whose work is a worktree needs a clone of its member repository.
git clone -q "$WORKSPACE" "$REAL/deploy/oats-real"
oats sync --dir "$REAL/deploy"

# ---- a SECOND workspace and deployment, with NO bb session provider (parts/plain.mjs)
# A workspace that does not pin oats.bb, as a deployment that never took the provider is: its
# capabilities are oats.core alone, so the kernel knows no capability `oats.bb` there and no
# backend `bb`: a spawn runs where the kernel's own default puts it (tmux). Under $REAL/plain, a
# path of its own that is no prefix of the first deployment's (the fixtures' substitutions are
# plain text: $REAL/deploy must not begin it). Nothing of the first deployment is touched.
PLAIN=$REAL/plain
rm -rf "$PLAIN"
mkdir -p "$PLAIN/ws" "$PLAIN/src"
cd "$PLAIN/ws"
git init -q -b main
cat > oats-workspace.yaml <<Y
schemaVersion: 2
name: bbplain
members:
  - file://$PLAIN/src/oats-plain
packages:
  oats.framework: $FRAMEWORK
defaults:
  capabilities:
    oats.core: { from: package }
  knowledge: none
  messaging: none
  tasks: none
Y
cat > oats-membership.yaml <<Y
schemaVersion: 2
workspace: file://$PLAIN/src/oats-plain
Y
soul oats-developer directory "OATS developer: builds and proves one spec."
git add -A
commit -m "the real run's second workspace: no bb session provider"
git clone -q --bare . "$PLAIN/src/oats-plain"
mkdir -p "$PLAIN/deploy"
cd "$PLAIN/deploy"
oats onboard "$PLAIN/deploy" --workspace "file://$PLAIN/src/oats-plain"
oats sync --dir "$PLAIN/deploy" || { echo "workspace: the second deployment (no bb session provider) did not sync" >&2; exit 1; }

echo "workspace: kernel $KERNEL_VERSION, provider commit $PROVIDER_OID ($TRIAL), bb $BB_VERSION; a second deployment with no bb session provider in $PLAIN/deploy"
