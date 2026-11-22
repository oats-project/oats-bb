// Every pattern of app/ui.tsx in each of its states (index.ts says what the page is for).
import { useEffect, useState } from "react";
import type { AgentState } from "../../model/types";
import { Button, Card, Chip, Code, Confirm, CopyButton, DisabledReason, Disclosure, Empty, Fact, Facts, Field, Heading, INPUT, LINK, Loading, Menu, notify, Notice, Page, Result, SearchField, Section, Segmented, Stale, State, StateMark, StatusLine, Switch, Tabs, Toned } from "../ui";
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
  checking: { kind: "reading", text: "Checking instance…" },
  unknown: {
    kind: "done",
    tone: "unknown",
    title: "Result not confirmed",
    lines: ["OATS didn't confirm the result. Check again before assuming nothing happened."],
    code: "OATS_TIMEOUT",
    actions: <Button>Check again</Button>,
  },
  ready: { kind: "ready" },
  running: { kind: "running", doing: "Retiring…" },
  done: { kind: "done", title: `${NAME} was retired.`, lines: ["Its work tree is kept, moved out of the home."] },
  failed: {
    kind: "failed",
    title: `${NAME} could not be retired.`,
    refusal: "E_CHILDREN_RUNNING: a child would not stop\nstop it first, then retire again",
    actions: (
      <>
        <Button>Review again</Button>
        <Disclosure summary="Details" testId="oats-patterns-refusal-details">
          <p className="text-xs text-muted-foreground">oats retire weekly-digest-helper: exit 1</p>
        </Disclosure>
      </>
    ),
  },
};

export function PatternBook() {
  const [tab, setTab] = useState<"schedules" | "triggers" | "history">("schedules");
  const [filter, setFilter] = useState<"all" | "workspace" | "local">("all");
  const [search, setSearch] = useState("");
  const [on, setOn] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ destructive: boolean; phase: string } | null>(null);
  useEffect(() => {
    const end = (event: Event) => {
      const phase = (event as CustomEvent<unknown>).detail;
      if (phase === "done" || phase === "failed") setDialog((now) => (now !== null && now.phase === "running" ? { ...now, phase } : now));
    };
    window.addEventListener("oats-patterns", end);
    return () => window.removeEventListener("oats-patterns", end);
  }, []);
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
        <StatusLine state="unreachable" detail="OATS cannot reach its session" action={<Button>Retry</Button>} />
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
        <div>
          <CopyButton text={`oats session attach --home /abs/${INSTANCE}`} label="Copy command" />
        </div>
      </section>

      <section data-testid="oats-patterns-notices" className="flex flex-col gap-2">
        <Heading>Notice</Heading>
        <Notice title="No OATS deployment is set">Open a bb project inside the deployment, or choose its directory in the settings.</Notice>
        <Notice title="OATS is older than this plugin needs" tone="warning" actions={<Button>Details</Button>}>
          Some of what is shown may be missing until OATS is updated.
        </Notice>
        <Notice title="OATS could not be read" tone="error" code="OATS_TIMEOUT" age="2 min ago" details={"OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped"} actions={<Button>Retry</Button>}>
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

      <section data-testid="oats-patterns-blocks" className="flex flex-col gap-3">
        <Heading>Section, card, tag, disclosure, code</Heading>
        <Section title="Runs" n={2}>
          <Card title="Weekly digest" footer={<Disclosure summary="Paths">/home/joan/Work/oats/agents/oats-expert/instances/weekly-digest-helper</Disclosure>}>
            <p>
              Runs <Code>oats schedule run weekly-digest</Code> on this computer.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Chip>default</Chip>
              <Chip tone="muted">workspace</Chip>
              <Chip tone="warn">wrong account</Chip>
            </div>
          </Card>
          <Card title="Nightly sweep" tone="warn">
            <p>Its last run did not start.</p>
          </Card>
        </Section>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label="Nightly sweep" checked={false} onChange={() => undefined} />
          <Switch label="Defined in the workspace" name="workspace/sweep enabled on this computer" checked disabled onChange={() => undefined} />
        </div>
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
          <Button data-testid="oats-patterns-open-reading" onClick={() => setDialog({ destructive: true, phase: "reading" })}>
            Reading the plan
          </Button>
          <Button data-testid="oats-patterns-open-checking" onClick={() => setDialog({ destructive: false, phase: "checking" })}>
            Reading, in the place's own words
          </Button>
          <Button data-testid="oats-patterns-open-unknown" onClick={() => setDialog({ destructive: true, phase: "unknown" })}>
            A result that is not confirmed
          </Button>
          <Button data-testid="oats-patterns-open-blocked" onClick={() => setDialog({ destructive: true, phase: "blocked" })}>
            Blocked
          </Button>
          <Button data-testid="oats-patterns-open-unnamed" onClick={() => setDialog({ destructive: true, phase: "unnamed" })}>
            A plan that names no agent
          </Button>
        </div>
      </section>
      <section data-testid="oats-patterns-notify" className="flex flex-col gap-2">
        <Heading>A result through bb's toaster</Heading>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="oats-patterns-notify-done" onClick={() => notify({ tone: "done", title: `${NAME} started.`, open: { label: `Open ${NAME}`, run: () => setPicked("Open") } })}>
            Notify: done, with Open
          </Button>
          <Button data-testid="oats-patterns-notify-failed" onClick={() => notify({ tone: "failed", title: `${NAME} wasn't started`, lines: ["OATS refused this start as busy. Nothing was started."] })}>
            Notify: failed (stays until dismissed)
          </Button>
        </div>
      </section>
      {/* The last thing on the page, and at its left edge: a menu opened here has no room under it, nor to its left. */}
      <section data-testid="oats-patterns-edges" className="flex flex-col gap-2">
        <Heading>A menu at the page's edges</Heading>
        <div className="flex">
          <Menu
            label="Actions at the edge"
            items={["Run now", "Edit…", "Pause", "Resume", "Duplicate…", "Show its runs", "Remove…"].map((label) => ({ id: label, label, onSelect: () => setPicked(label) }))}
          />
        </div>
      </section>
      {dialog === null ? null : (
        <Confirm
          title={`${dialog.destructive ? "Retire" : "Stop"} ${NAME}?`}
          about={INSTANCE}
          shownFor={dialog.phase === "other" ? "flaky-ci-developer" : dialog.phase === "unnamed" || dialog.phase === "reading" || dialog.phase === "checking" ? null : INSTANCE}
          blocked={dialog.phase === "blocked" ? "Tick the box to discard its work." : null}
          happens={dialog.destructive ? ["Its home is removed.", "Its session is open and is stopped first."] : ["Its session is stopped."]}
          kept={dialog.destructive ? ["Its work tree, moved out of the home, and its branch."] : ["Its home, its work, its transcript and its launch settings. Start brings it back."]}
          confirmLabel={dialog.destructive ? "Retire" : "Stop"}
          destructive={dialog.destructive}
          phase={PHASES[dialog.phase] ?? PHASES.ready!}
          // The book walks the phases a real act goes through. The act starts on its button; how it
          // ends is told from outside the dialog (a real one has nothing to press while it runs):
          // window.dispatchEvent(new CustomEvent("oats-patterns", { detail: "done" | "failed" })).
          onConfirm={() => setDialog({ ...dialog, phase: "running" })}
          onClose={() => setDialog(null)}
        />
      )}
    </Page>
  );
}
