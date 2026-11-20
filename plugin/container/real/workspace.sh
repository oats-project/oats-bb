#!/bin/sh
# Runs inside the container (setup.sh calls it): a throwaway OATS workspace and deployment for the
# real run, in $REAL (default /home/node/real).
#   - the provider (oats.bb) as a local git repository made from the tree in $REAL/provider, with one
#     trial-only commit on top that lowers its `compatibility.oats` floor to the packed kernel's
#     version (the provider's README, "A trial against an unreleased kernel"). That commit exists
#     only in this container.
#   - a workspace repository with souls that have NO messaging capability: oats.core and oats.bb
#     only. Their names are the ones the plugin's fixtures use.
#   - the deployment $REAL/deploy, onboarded into that workspace, with the host's facts for bb
#     (`trust: container`, the pinned version) and a default launch configuration for Claude Code
#     with `yolo: true`, so that no bb approval waits (the image has no bubblewrap).
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

# ---- the provider, with the trial-only floor
cd "$REAL/provider"
if [ ! -d .git ]; then
  git init -q -b main
  git add -A
  commit -m "the provider's tree under test"
  for manifest in oats-package/oats-package.json oats-package/capabilities/oats-bb/oats.json; do
    node -e 'const fs=require("fs"),[f,v]=process.argv.slice(1),m=JSON.parse(fs.readFileSync(f,"utf8"));m.compatibility.oats=">="+v;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$manifest" "$KERNEL_VERSION"
  done
  git add -A
  commit -m "TRIAL ONLY, never pushed: compatibility.oats >=$KERNEL_VERSION (an unreleased kernel)"
fi
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
launch-configs:
  claude-full:
    harness: claude
    yolo: true
    default: true
Y
# The soul whose work is a worktree needs a clone of its member repository.
git clone -q "$WORKSPACE" "$REAL/deploy/oats-real"
oats sync --dir "$REAL/deploy"
echo "workspace: kernel $KERNEL_VERSION, provider commit $PROVIDER_OID (trial floor), bb $BB_VERSION"
