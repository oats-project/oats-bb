#!/bin/bash
# The mail part of the real run, inside the client container (run.sh starts it; README.md): a real
# OATS kernel, the real messaging layer and real `aw` against aweb's local stack, two agents that
# mail each other, bb with the plugin installed, and the Mail tab read in a browser (check.mjs).
# Every word of mail is written here: nothing is taken from a real workspace.
. "$(dirname "$0")/../../guard.sh" # refuses outside the checks' container, before anything is touched
set -euo pipefail
PLUGIN=$(cd "$(dirname "$0")/../../.." && pwd)
HOME_DIR=/home/node
OUT=${OUT:-$HOME_DIR/out}
S=$HOME_DIR/mailreal
D=$S/deploy
KERNEL_NPM=${KERNEL_NPM:-0.70.5}
AW_NPM=${AW_NPM:-1.36.59}
AWEB_PROVIDER=${AWEB_PROVIDER:-v1.48.0}
FRAMEWORK=${FRAMEWORK:-v1.26.0}
CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION:-2.1.332}
NAMESPACE=mailreal.test
export AWEB_URL=http://127.0.0.1:8000 AWID_REGISTRY_URL=http://127.0.0.1:8010 AWID_SKIP_DNS_VERIFY=1 AW_NO_UPDATE_CHECK=1 NO_COLOR=1
say() { printf '%s\n' "$*"; }
mkdir -p "$OUT"

say "== the stack: aweb $(curl -fsS $AWEB_URL/ready | head -c 80), awid $(curl -fsS $AWID_REGISTRY_URL/ready | head -c 60)"
say "== the kernel, aw and the harness, from npm"
npm install -g --no-audit --no-fund "@awebai/oats@$KERNEL_NPM" "@awebai/aw@$AW_NPM" "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" > "$OUT/install-npm.txt" 2>&1
say "   oats $(oats version --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version'), $(aw version | head -1), claude $(claude --version)"
# A spawn on the harness claude refuses without the aweb channel plugin, even with --no-launch.
# Nothing is launched and nothing logs in.
(claude plugin marketplace add awebai/claude-plugins && claude plugin install aweb-channel@awebai-marketplace) > "$OUT/install-channel.txt" 2>&1

say "== the workspace: two souls with messaging (oats.aweb $AWEB_PROVIDER), one without"
commit() { GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z git -c user.name=mail-real -c user.email=mail-real@example.invalid commit -q "$@"; }
rm -rf "$S"; mkdir -p "$S/ws" "$S/src" "$S/bodies" "$S/bin"
cd "$S/ws"; git init -q -b main
cat > oats-workspace.yaml <<Y
schemaVersion: 2
name: mailreal
members:
  - file://$S/src/mailreal
packages:
  oats.framework: $FRAMEWORK
  oats.aweb: $AWEB_PROVIDER
defaults:
  capabilities:
    oats.core: { from: package }
  knowledge: none
  messaging: { oats.aweb: { from: package } }
  tasks: none
teams:
  "mailreal": { team: "mailreal:$NAMESPACE" }
defaultTeam: "mailreal"
Y
printf 'schemaVersion: 2\nworkspace: file://%s/src/mailreal\n' "$S" > oats-membership.yaml
soul() { # soul <name> <extra yaml line or "">
  mkdir -p "souls/$1"
  printf 'schemaVersion: 2\nname: %s\ndescription: "A soul of the mail part of the real run."\nwork: directory\nknowledge: none\n%slaunch: { harness: claude, model: claude-opus-5-5 }\n' "$1" "$2" > "souls/$1/soul.yaml"
  printf '# %s\n\nA soul of the mail part of the real run.\n' "$1" > "souls/$1/AGENTS.md"
}
soul oats-developer ""; soul oats-expert ""; soul knowledge-harvester "messaging: none
"
git add -A; commit -m "the mail part's workspace"
git clone -q --bare . "$S/src/mailreal"
mkdir -p "$D"; cd "$D"
oats onboard "$D" --workspace "file://$S/src/mailreal" > "$OUT/onboard.txt" 2>&1
oats sync --dir "$D" > "$OUT/sync.txt" 2>&1

say "== the team: a namespace of this container's own, a team made by the messaging layer's setup"
mkdir -p "$S/controller"
(cd "$S/controller" && aw id create --domain "$NAMESPACE" --name controller --registry "$AWID_REGISTRY_URL" --skip-dns-verify --json) > "$OUT/controller.txt" 2>&1
oats aweb setup --soul oats-developer --registry "$AWID_REGISTRY_URL" --json > "$OUT/setup-registry.txt" 2>&1
oats aweb setup --soul oats-developer --create mailreal --namespace "$NAMESPACE" --name root > "$OUT/setup-team.txt" 2>&1 || { tail -5 "$OUT/setup-team.txt"; exit 1; }

say "== three agents, none launched: a reader, a writer, and one with no messaging layer"
oats spawn oats-developer --name mail-reader --no-launch --dir "$D" > "$OUT/spawn.txt" 2>&1
oats spawn oats-expert --name mail-writer --no-launch --dir "$D" >> "$OUT/spawn.txt" 2>&1
oats spawn knowledge-harvester --name mail-none --no-launch --dir "$D" >> "$OUT/spawn.txt" 2>&1
R=$D/agents/oats-developer/instances/mail-reader
W=$D/agents/oats-expert/instances/mail-writer

say "== the mail, written here"
printf 'The parser is ready for a first read.\n\nTwo things are still open:\n- the list at 390 px\n- the words of the refusals\n' > "$S/bodies/1"
node -e 'let s="";for(let i=1;s.length<300*1024;i++)s+=`Line ${i} of a long report about nothing in particular.\n`;require("fs").writeFileSync(process.argv[1],s)' "$S/bodies/2"
printf 'Thanks. I will read it today.\n' > "$S/bodies/3"
(cd "$W" && aw mail send --to mail-reader --subject "Parser ready for a first read" --body-file "$S/bodies/1" && aw mail send --to mail-reader --subject "A long report" --body-file "$S/bodies/2") > "$OUT/mail-sent.txt" 2>&1
(cd "$R" && aw mail send --to mail-writer --subject "Re: first read" --body-file "$S/bodies/3") >> "$OUT/mail-sent.txt" 2>&1

# The plugin runs `oats` through this wrapper: the real `oats`, with every argv kept, one JSON line each.
cat > "$S/bin/oats-logged" <<W
#!/bin/sh
node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\n")' "$S/argv.jsonl" "\$@"
exec "$(command -v oats)" "\$@"
W
chmod +x "$S/bin/oats-logged"
: > "$S/argv.jsonl"

say "== bb $(bb --version), sovereign, with the plugin from this checkout"
if ! bb machine list --json > /dev/null 2>&1; then
  # bb's daemon gets a bare environment and the login shell's PATH: `oats`, `aw` and `node` are found there.
  env -i HOME=$HOME_DIR USER=node BB_TELEMETRY=false PATH="$HOME_DIR/.npm-global/bin:/usr/local/bin:/usr/bin:/bin" \
    setsid "$HOME_DIR/.npm-global/bin/bb-app" --data-dir "$HOME_DIR/bbdata" --server-bind-host 127.0.0.1 --no-in-app-updates > "$OUT/bb.out" 2>&1 < /dev/null &
  for _ in $(seq 1 180); do bb machine list 2> /dev/null | grep -qw connected && break; sleep 0.5; done
  bb machine list 2> /dev/null | grep -qw connected || { say "bb did not start, or no machine connected"; tail -20 "$OUT/bb.out"; exit 1; }
fi
bb project list --json | grep -q "$R" || bb project create --name mail --root "$R" --json > /dev/null
LIVE=$HOME_DIR/mail-live
rm -rf "$LIVE"; mkdir -p "$LIVE"
(cd "$PLUGIN" && tar -c --exclude ./dist --exclude ./.git .) | tar -x -C "$LIVE"
bb plugin remove oats --yes > /dev/null 2>&1 || true
(cd "$LIVE" && bb plugin install . --yes) > "$OUT/install-plugin.txt" 2>&1 || { tail -20 "$OUT/install-plugin.txt"; exit 1; }
bb plugin config oats set deployment "$D" > /dev/null
bb plugin config oats set oatsBin "$S/bin/oats-logged" > /dev/null

say "== the checks"
OUT=$OUT MAIL_REAL=$S node "$PLUGIN/container/real/mail/check.mjs"
