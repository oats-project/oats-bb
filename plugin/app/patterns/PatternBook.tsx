// Every pattern of app/ui.tsx in each of its states (index.ts says what the page is for).
import { useState } from "react";
import type { AgentState } from "../../model/types";
import { Button, Card, Confirm, CopyButton, DisabledReason, Empty, Fact, Facts, Field, Heading, INPUT, LINK, Loading, Menu, Notice, Page, Result, SearchField, Segmented, Stale, State, StateMark, StatusLine, Switch, Tabs, Toned } from "../ui";
import type { ConfirmProps } from "../ui";
import { instanceDisplayName, waitingLabel, waitingSince } from "../ui/words";

const STATES: AgentState[] = ["needs-you", "working", "idle", "stopped", "error", "unreachable"];
const INSTANCE = "weekly-digest-helper";
const NAME = instanceDisplayName(INSTANCE);
// A fixed instant, so the page reads the same at every run.
const NOW = new Date(2026, 10, 21, 14, 30).getTime();
const SINCE = waitingSince(new Date(2026, 10, 21, 14, 3).toISOString(), NOW);

type Phase = ConfirmProps["phase"];
const PHASES: Record<string, Phase> = {
  reading: { kind: "reading" },
  ready: { kind: "ready" },
  running: { kind: "running", doing: "Retiring…" },
  done: { kind: "done", title: `${NAME} was retired.`, lines: ["Its work tree is kept, moved out of the home."] },
  failed: { kind: "failed", title: `${NAME} could not be retired.`, refusal: "E_CHILDREN_RUNNING: a child would not stop\nstop it first, then retire again", actions: <Button>Review again</Button> },
};

export function PatternBook() {
  const [tab, setTab] = useState<"schedules" | "triggers" | "history">("schedules");
  const [filter, setFilter] = useState<"all" | "workspace" | "local">("all");
  const [search, setSearch] = useState("");
  const [on, setOn] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ destructive: boolean; phase: string } | null>(null);
  return (
    <Page testId="oats-patterns-page">
      <section data-testid="oats-patterns-states" className="flex flex-col gap-2">
        <Heading>State</Heading>
        <ul data-testid="oats-patterns-state-list" className="flex flex-wrap gap-x-6 gap-y-2">
          {STATES.map((state) => (
            <li key={state} className="flex items-center gap-3">
              <State state={state} />
              <StateMark state={state} />
            </li>
          ))}
        </ul>
        <ul data-testid="oats-patterns-toned" className="flex flex-wrap gap-x-6 gap-y-2">
          <li><Toned tone="ok">Runs on this computer</Toned></li>
          <li><Toned tone="warn">Wrong account here</Toned></li>
          <li><Toned tone="bad">The scheduler is not running</Toned></li>
          <li><Toned tone="muted">Off</Toned></li>
        </ul>
        <Heading>Status line</Heading>
        <StatusLine state="needs-you" since={SINCE} detail={waitingLabel({ reason: "question", message: null, since: null })} action={<Button>Open</Button>} />
        <StatusLine state="working" />
        <StatusLine state="stopped" action={<Button>Start</Button>} />
        <StatusLine state="unreachable" detail="OATS says: bb did not answer" action={<Button>Retry</Button>} />
      </section>

      <section data-testid="oats-patterns-facts" className="flex flex-col gap-2">
        <Heading>Facts</Heading>
        <Facts>
          <Fact label="Soul">
            <a className={LINK} href="/plugins/oats/souls/oats-expert">
              oats-expert
            </a>
          </Fact>
          <Fact label="Branch">agents/weekly-digest-helper</Fact>
          <Fact label="Home">/home/joan/Work/oats/agents/oats-expert/instances/weekly-digest-helper</Fact>
        </Facts>
        <CopyButton text={`oats session attach --home /abs/${INSTANCE}`} label="Copy command" />
      </section>

      <section data-testid="oats-patterns-notices" className="flex flex-col gap-2">
        <Heading>Notice</Heading>
        <Notice title="No OATS deployment is set">Open a bb project inside the deployment, or choose its directory in the settings.</Notice>
        <Notice title="OATS is older than this plugin needs" tone="warning" actions={<Button>Details</Button>}>
          Some of what is shown may be missing until OATS is updated.
        </Notice>
        <Notice title="OATS could not be read" tone="error" code="OATS_TIMEOUT" age="2 min ago" actions={<Button>Retry</Button>}>
          The machine did not answer in time.
        </Notice>
        <Heading>Empty, loading, stale</Heading>
        <Empty action={<Button variant="primary">New agent</Button>}>No agents yet.</Empty>
        <Loading>Reading your agents…</Loading>
        <Stale age="2 min ago" held="Acts are held until OATS is read again." action={<Button>Retry</Button>} />
        <Stale age="just now" refreshing />
        <Heading>Result</Heading>
        <Result title={`${NAME} was stopped.`}>
          <p>Its home and its work are kept. Start brings it back.</p>
        </Result>
        <Result title={`${NAME} could not be stopped.`} tone="failed" code="E_SESSION_STOP_FAILED" actions={<Button>Try again</Button>}>
          <p>Its session did not end.</p>
        </Result>
        <Result title="It is not known whether the spawn finished." tone="unknown" actions={<Button>Check result</Button>} />
      </section>

      <section data-testid="oats-patterns-controls" className="flex flex-col gap-3">
        <Heading>Controls</Heading>
        <Tabs label="Automations" panelId="oats-patterns-panel" value={tab} onChange={setTab} tabs={[{ id: "schedules", label: "Schedules", count: 3 }, { id: "triggers", label: "Triggers", count: 0 }, { id: "history", label: "History" }]} />
        <div role="tabpanel" id="oats-patterns-panel" aria-labelledby={`oats-patterns-panel-tab-${tab}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Show" value={filter} onChange={setFilter} options={[{ id: "all", label: "All" }, { id: "workspace", label: "Workspace" }, { id: "local", label: "Local" }]} />
            <div className="min-w-40 flex-1">
              <SearchField label="Filter schedules" value={search} onChange={setSearch} />
            </div>
          </div>
          <Card>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words font-semibold">{NAME}</span>
              <Switch label="Weekly digest" checked={on} onChange={setOn} />
              <Menu
                label={`Actions for ${NAME}`}
                items={[
                  { id: "run", label: "Run now", onSelect: () => setPicked("Run now") },
                  { id: "edit", label: "Edit…", onSelect: () => setPicked("Edit"), disabled: true, reason: "Defined in the workspace file." },
                  { id: "remove", label: "Remove…", onSelect: () => setPicked("Remove"), destructive: true },
                ]}
              />
            </div>
            {picked === null ? null : <p data-testid="oats-patterns-picked" className="text-xs text-muted-foreground">{`Picked: ${picked}`}</p>}
          </Card>
        </div>
      </section>

      <section data-testid="oats-patterns-form" className="flex flex-col gap-3">
        <Heading>Form</Heading>
        <Field label="Opening instruction" optional hint="What this agent is for.">
          <textarea className={`${INPUT} py-2`} rows={3} defaultValue="" />
        </Field>
        <Field label="Name" optional error="Lower-case letters, digits and dashes; starts with a letter or a digit; 63 characters at most.">
          <input className={INPUT} defaultValue="Bad Name" aria-invalid="true" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled>
            Spawn
          </Button>
          <DisabledReason>Reading what will be created…</DisabledReason>
        </div>
      </section>

      <section data-testid="oats-patterns-dialogs" className="flex flex-col gap-2">
        <Heading>Confirmation</Heading>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="oats-patterns-open-retire" onClick={() => setDialog({ destructive: true, phase: "ready" })}>
            Retire…
          </Button>
          <Button data-testid="oats-patterns-open-stop" onClick={() => setDialog({ destructive: false, phase: "ready" })}>
            Stop…
          </Button>
          <Button data-testid="oats-patterns-open-other" onClick={() => setDialog({ destructive: true, phase: "other" })}>
            Another agent's plan
          </Button>
        </div>
      </section>
      {dialog === null ? null : (
        <Confirm
          title={`${dialog.destructive ? "Retire" : "Stop"} ${NAME}?`}
          about={INSTANCE}
          shownFor={dialog.phase === "other" ? "flaky-ci-developer" : INSTANCE}
          happens={dialog.destructive ? ["Its home is removed.", "Its session is open and is stopped first."] : ["Its session is stopped."]}
          kept={dialog.destructive ? ["Its work tree, moved out of the home, and its branch."] : ["Its home, its work, its transcript and its launch settings. Start brings it back."]}
          confirmLabel={dialog.destructive ? "Retire" : "Stop"}
          destructive={dialog.destructive}
          phase={PHASES[dialog.phase] ?? PHASES.ready!}
          // The book walks the phases a real act goes through: each press of the act shows the next.
          onConfirm={() => setDialog({ ...dialog, phase: "running" })}
          onClose={() => setDialog(null)}
        >
          {dialog.phase === "running" ? (
            <div className="flex flex-wrap gap-2">
              <Button data-testid="oats-patterns-finish" onClick={() => setDialog({ ...dialog, phase: "done" })}>
                (book) finish
              </Button>
              <Button data-testid="oats-patterns-refuse" onClick={() => setDialog({ ...dialog, phase: "failed" })}>
                (book) refuse
              </Button>
            </div>
          ) : null}
        </Confirm>
      )}
    </Page>
  );
}
