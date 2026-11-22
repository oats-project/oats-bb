#!/bin/sh
# Runs inside the container, after container/real/workspace.sh made the real run's workspace and
# deployment in $REAL: adds what the Automations fixtures need and nothing the kernel does not
# read as its own input.
#   - a member capability that fills the knowledge layer with one operation (acme.notes), and its
#     soul (note-keeper): what a schedule that runs a provider operation names;
#   - a member capability, acme.graph, that declares the trigger source `harvest-branches` (a script
#     that answers the events in $REAL/source.json), and a soul that composes it (graph-reviewer);
#   - workspace schedules and triggers in the member repository, placed on this host and elsewhere;
#   - this host's name, its trust list, and a `gh` that answers as the account "ana" and lists the
#     open pull requests in $REAL/pulls.json. The `gh` is a double of GitHub, the one boundary the
#     recording cannot cross; the OATS repository's own tests use the same double
#     (test/helpers/trigger-source-fixture.mjs).
set -eu
REAL=${REAL:-/home/node/real}
HOST_NAME=${HOST_NAME:-bb-box}
commit() {
  GIT_AUTHOR_DATE=2026-01-02T00:00:00Z GIT_COMMITTER_DATE=2026-01-02T00:00:00Z \
    git -c user.name=real-run -c user.email=real-run@example.invalid commit -q "$@"
}

# ---- gh, as the account "ana"
mkdir -p "$REAL/bin"
cat > "$REAL/bin/gh" <<G
#!/bin/sh
case "\$1 \$2" in
  "auth status") printf '%s\n' "github.com" "  ✓ Logged in to github.com account ana (keyring)" "  - Active account: true"; exit 0 ;;
  "api user") echo ana; exit 0 ;;
esac
case "\$*" in
  *"/pulls"*) cat "$REAL/pulls.json"; exit 0 ;;
  *"repos/"*) cat "$REAL/repo.json"; exit 0 ;;
esac
echo "unexpected gh \$*" >&2; exit 2
G
chmod 0755 "$REAL/bin/gh"
[ -f "$REAL/pulls.json" ] || echo '[]' > "$REAL/pulls.json"
[ -f "$REAL/repo.json" ] || echo '{"full_name":"acme/knowledge","permissions":{"push":true,"maintain":false,"admin":false},"allow_merge_commit":true}' > "$REAL/repo.json"
[ -f "$REAL/source.json" ] || echo '{"events":[]}' > "$REAL/source.json"

# ---- the member: the capability with a trigger source, its soul, the workspace automations
cd "$REAL/ws"
mkdir -p capabilities/acme-graph/bin souls/graph-reviewer oats-schedules oats-triggers services/billing
cat > capabilities/acme-graph/oats.json <<Y
{
  "capability": "acme.graph",
  "version": "1.0.0",
  "compatibility": { "oats": ">=0.50.0" },
  "description": "A knowledge graph with harvest branches (the Automations fixtures' trigger source).",
  "requires": [],
  "commands": { "review-source": "bin/source.mjs review-source" },
  "triggerSources": {
    "harvest-branches": {
      "command": "review-source",
      "description": "Ready harvest branches, one event per judged head",
      "events": ["opened", "updated"],
      "parameters": { "prefix": { "default": "harvest/", "pattern": "^[A-Za-z0-9._/-]{1,80}\$" }, "graph": { "required": false } },
      "fields": { "graph": { "pattern": "^[a-z0-9-]{1,40}\$" }, "branch": { "pattern": "^[A-Za-z0-9._/-]{1,200}\$" } },
      "urlHosts": ["graph.example.org"]
    }
  }
}
Y
cat > capabilities/acme-graph/bin/source.mjs <<Y
// The trigger source of the Automations fixtures: answers what $REAL/source.json holds.
//   { "events": [...], "skipped": [...] }            an answer
//   { "refuse": { "code": "...", "message": "..." } }  the source's own refusal
//   { "exit": 3 }                                      a failed command
import { readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
const control = JSON.parse(readFileSync("$REAL/source.json", "utf8"));
const echo = { schemaVersion: request.schemaVersion, phase: request.phase, capability: request.capability, source: request.source };
if (control.exit) process.exit(control.exit);
if (control.refuse) process.stdout.write(JSON.stringify({ ...echo, ok: false, error: control.refuse }) + "\n");
else process.stdout.write(JSON.stringify({ ...echo, ok: true, result: control }) + "\n");
Y
cat > souls/graph-reviewer/soul.yaml <<Y
schemaVersion: 2
name: graph-reviewer
description: "Reviews harvest branches of the knowledge graph."
work: directory
knowledge: none
capabilities:
  acme.graph: { from: here }
launch: { harness: claude, model: claude-opus-5-5 }
Y
printf '# graph-reviewer\n\nA soul of the Automations fixtures. Do what TASK.md says, then stop.\n' > souls/graph-reviewer/AGENTS.md

# A capability that fills the knowledge layer and declares one operation, and a soul that keeps it:
# what a schedule that runs a provider operation names.
mkdir -p capabilities/acme-notes/bin souls/note-keeper
cat > capabilities/acme-notes/oats.json <<Y
{
  "capability": "acme.notes",
  "command": "acme-notes",
  "version": "1.0.0",
  "compatibility": { "oats": ">=0.50.0" },
  "description": "Notes an agent keeps (the Automations fixtures' knowledge layer, with one operation).",
  "layer": "knowledge",
  "requires": [],
  "commands": { "checkpoint": "bin/notes.mjs checkpoint" },
  "operations": { "checkpoint": { "kind": "action", "command": "checkpoint", "context": "home", "description": "Record this instance's checkpoint" } }
}
Y
cat > capabilities/acme-notes/bin/notes.mjs <<Y
// The one operation of the Automations fixtures' knowledge layer: it answers that it ran.
process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { checkpoint: "recorded" } }) + "\\n");
Y
cat > souls/note-keeper/soul.yaml <<Y
schemaVersion: 2
name: note-keeper
description: "Keeps the team's notes."
work: directory
knowledge: {}
capabilities:
  acme.notes: { from: here }
launch: { harness: claude, model: claude-opus-5-5 }
Y
printf '# note-keeper\n\nA soul of the Automations fixtures. Do what TASK.md says, then stop.\n' > souls/note-keeper/AGENTS.md

cat > oats-schedules/nightly-digest.yaml <<Y
kind: oats-schedule
schemaVersion: 1
description: Write the nightly digest of what the team shipped
run: spawn
cron: "0 7 * * *"
tz: Europe/Madrid
agent: knowledge-harvester
purpose: digest
task: |
  Write the nightly digest.
  Read yesterday's merged pull requests and summarise them for the team.
backend: bb
yolo: true
runsOn: $HOST_NAME
owner: github.com/ana
Y
cat > oats-schedules/weekly-report.yaml <<Y
kind: oats-schedule
schemaVersion: 1
description: The weekly report, on the reporting server
run: spawn
cron: "0 9 * * 1"
tz: Europe/Madrid
agent: oats-product-expert
task: Write the weekly report.
runsOn: report-server
owner: github.com/acme-bot
Y
cat > oats-schedules/release-check.yaml <<Y
kind: oats-schedule
schemaVersion: 1
run: spawn
cron: "30 8 * * 1-5"
tz: Europe/Madrid
agent: oats-developer
task: Check the release branch and report what blocks it.
backend: bb
yolo: true
runsOn: $HOST_NAME
owner: github.com/ana
Y
cat > services/billing/reconcile.oats-schedule.yaml <<Y
kind: oats-schedule
schemaVersion: 1
description: Reconcile the billing ledger as the billing bot
run: command
cron: "*/30 * * * *"
tz: UTC
argv: ["oats", "status", "--json"]
cwd: .
runsOn: $HOST_NAME
owner: github.com/acme-billing-bot
Y
cat > oats-triggers/proposal-review.yaml <<Y
kind: oats-trigger
schemaVersion: 1
description: Review every knowledge proposal pull request
on:
  source: github.pull_request
  repo: github.com/acme/knowledge
  events: [opened, reopened, ready_for_review]
  labels: [okf-proposal]
  base: main
  poll: 2m
spawn:
  soul: oats-developer
  purpose: "review-pr-{number}"
  task: "Review knowledge-base PR {repo}#{number} ({url}). Load knowledge-review first."
  backend: bb
  yolo: true
concurrency: { max: 2, perKey: 1 }
runsOn: $HOST_NAME
owner: github.com/ana
Y
cat > oats-triggers/docs-review.yaml <<Y
kind: oats-trigger
schemaVersion: 1
on:
  source: github.pull_request
  repo: github.com/acme/docs
  events: [opened, synchronize]
  poll: 5m
spawn:
  soul: oats-developer
  task: "Review docs PR {repo}#{number}."
runsOn: docs-server
owner: github.com/acme-bot
Y
cat > oats-triggers/harvest-review.yaml <<Y
kind: oats-trigger
schemaVersion: 1
description: Review harvest branches of the knowledge graph
on:
  source: "acme.graph:harvest-branches"
  params: { prefix: "harvest/", graph: kb }
  events: [opened]
  poll: 1m
spawn:
  soul: graph-reviewer
  task: "Review branch {subject} of graph {fields.graph} ({url})."
  backend: bb
  yolo: true
runsOn: $HOST_NAME
owner: github.com/ana
Y
# Its syntax is right and its meaning is not: the source declares no event `closed`. The workspace
# snapshot checks syntax only, so the poll finds it.
cat > oats-triggers/harvest-closed.yaml <<Y
kind: oats-trigger
schemaVersion: 1
on:
  source: "acme.graph:harvest-branches"
  events: [closed]
  poll: 1m
spawn:
  soul: graph-reviewer
  task: "Archive branch {subject}."
  backend: bb
  yolo: true
runsOn: $HOST_NAME
owner: github.com/ana
Y
git add -A
commit -m "the Automations fixtures: a trigger source, its soul, workspace schedules and triggers"
git push -q "$REAL/src/oats-real" main

# ---- the deployment: this host's name and what it trusts
cd "$REAL/deploy"
git -C "$REAL/deploy/oats-real" pull -q
cat >> oats-local.yaml <<Y
host:
  name: $HOST_NAME
automations:
  trust:
    - oats-real/nightly-digest
    - oats-real/reconcile
    - oats-real/proposal-review
    - oats-real/harvest-review
    - oats-real/harvest-closed
Y
PATH="$REAL/bin:$PATH" oats sync --dir "$REAL/deploy"
