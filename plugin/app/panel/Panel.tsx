// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
// Drawn with the patterns of app/ui.tsx; its own parts are in parts.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AgentTabProps } from "../home/agent-tab";
import type { PanelInstance } from "../../kernel/panel-instance";
import { isKernelCode } from "../../kernel/result";
import type { Agent, AgentState, Node } from "../../model/types";
import { claimOf } from "../../model/view";
import { agentStatus } from "../roster/status";
import { Unreadable, failureWords } from "../roster/unreadable";
import { failureLine, useOats } from "../oats";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";
import { Button, Card, Chip, Code, Disclosure, Fact, Facts, LINK, Loading, Notice, Section, StatusLine, TARGET, Tabs, plainClick } from "../ui";
import type { TabItem } from "../ui";
import { shown } from "../ui/text";
import { instanceDisplayName, waitingLabel } from "../ui/words";
import { openSoul } from "../workspace/pages";
import { Activity } from "./Activity";
import { PathLine, SoulMark } from "./parts";
import { Readiness } from "./Readiness";
import { useNow, usePanelInstance, usePanelSoul } from "./read";
import type { PanelRead } from "./read";
import { SoulBody } from "./SoulBody";
import { codeOf } from "./state";
import { SHARED_TITLE, ageText, driftLines, harnessName, modelFromText, sessionWhere, sharedWork, staleAge, workFolder, workSentence } from "./words";

type InstanceRead = PanelRead<"panelInstance">;
/** What the panel reads of the roster beside its agent: the souls' names, and the threads its links go to. */
type Roster = Pick<Oats, "soulOf" | "threadById" | "retry"> & { nodeByInstance: ReadonlyMap<string, Node>; /** the instances whose parent is the agent shown, in the roster's order */ children: readonly string[] };
/** The agent a panel shows, and for which thread or name it is shown. */
type Shown = { key: string; agent: Agent; node: Node | undefined };
const NO_NODES: ReadonlyMap<string, Node> = new Map();
/** The roster could not be read again: what it said, and the way to ask again. */
type RosterFailure = { code: string; message: string; machine: string | null; line: string; retry(): void };

/** The panel's tabs. */
export type TabId = "instance" | "soul";
const TABS: readonly TabItem<TabId>[] = [
  { id: "instance", label: "Instance" },
  { id: "soul", label: "Soul" },
];
/** The id of the panel's one tab panel: the tabs name it, and it names the tab it shows. */
const PANEL_ID = "oats-panel-page";

// The tab a person left the panel on, for the length of the app window: another agent opens on it too.
let shownTab: TabId = "instance";
const listeners = new Set<() => void>();
/**
 * Shows one of the panel's tabs, from anywhere: an open panel turns to it, and the next one opens
 * on it. `focus`: the tab takes the focus too, for a control that leaves the page as the tab turns.
 */
export function showPanelTab(tab: TabId, { focus = false }: { focus?: boolean } = {}): void {
  if (shownTab !== tab) {
    shownTab = tab;
    for (const listener of listeners) listener();
  }
  // Once the open panel has drawn the tab selected (the store's change is drawn before this runs).
  if (focus) queueMicrotask(() => document.getElementById(`${PANEL_ID}-tab-${tab}`)?.focus());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const useShownTab = (): TabId => useSyncExternalStore(subscribe, () => shownTab, () => shownTab);
onWindowReset(() => showPanelTab("instance"));

/** The panel as the plugin's fixed thread tab shows it on an agent's own thread. */
export function AgentTab({ agent, threadId }: AgentTabProps) {
  return <InstancePanel threadId={threadId} known={agent} />;
}

/**
 * The panel of one agent: by its thread (an agent's thread in bb) or by its instance name (an
 * agent with no thread). Draws nothing for a thread or a name that is no agent's: the caller then
 * shows what it shows without an agent. Once an agent was shown, here or by the caller (`known`:
 * the agent the caller last read for this thread), it stays while the roster is read again or
 * cannot be read, with the age of what is shown.
 */
export function InstancePanel({ threadId, instance, known }: { threadId?: string; instance?: string; known?: Agent }) {
  const oats = useOats();
  const tab = useShownTab();
  const key = threadId ?? instance ?? "";
  const last = useRef<Shown | null>(null);
  if (oats.phase === "ready") {
    const node = threadId !== undefined ? oats.nodeByThread.get(threadId) : instance !== undefined ? oats.nodeByInstance.get(instance) : undefined;
    const agent = node?.agent ?? (instance === undefined ? undefined : oats.agents.find((candidate) => candidate.instance === instance));
    // What the roster says now, also when it says the agent is gone.
    last.current = agent === undefined ? null : { key, agent, node };
  } else if (known !== undefined && last.current?.key !== key) {
    last.current = { key, agent: known, node: undefined };
  }
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const visible = useVisibleWidth(root);
  const held = last.current;
  // Another thread or name than the one held: nothing of that agent is known yet.
  if (held === null || held.key !== key) return null;
  const roster: Roster = {
    soulOf: oats.soulOf,
    threadById: oats.threadById,
    retry: oats.retry,
    nodeByInstance: oats.phase === "ready" ? oats.nodeByInstance : NO_NODES,
    children: oats.phase === "ready" ? oats.agents.filter((other) => other.parent === held.agent.instance).map((other) => other.instance) : [],
  };
  // OATS cannot be read: never (no roster), or not again (the roster is the last one read).
  const unread = oats.phase === "failed" ? oats : oats.phase === "ready" ? oats.stale : null;
  const failure: RosterFailure | null = unread === null ? null : { code: unread.code, message: unread.message, machine: oats.phase === "failed" ? oats.machine : oats.phase === "ready" ? oats.deployment.machine : null, line: failureLine(unread), retry: oats.retry };
  return (
    <div ref={setRoot} data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      {/* What the panel draws is as wide as the part of it that is in the window (`useVisibleWidth`). */}
      <div data-testid="oats-panel-visible" className="flex min-h-0 min-w-0 flex-1 flex-col" style={visible === null ? undefined : { width: visible }}>
        {/* One instance at a time: another agent starts from its own read. */}
        <Pages key={held.agent.instance} oats={roster} agent={held.agent} node={held.node} tab={tab} failure={failure} />
      </div>
    </div>
  );
}

/**
 * How wide the part of `root` that is in the window is, in px; null while it is whole in it. bb
 * 0.50.1 lays its side panel out wider than the window leaves room for when its sidebar, a thread
 * and the panel are all open (the panel's column runs past the window's right edge, by up to
 * about 140 px at 1280 px), and what is drawn there cannot be reached. So the panel draws within
 * the part that is in the window: nothing of it is cut.
 */
function useVisibleWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    // The panel's root comes on the page once an agent is known: measured from then on.
    if (element === null) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const past = Math.round(box.right - document.documentElement.clientWidth);
      setWidth(past > 0 && box.width - past > 0 ? Math.floor(box.width - past) : null);
    };
    measure();
    // The panel moves without changing size when bb's thread column grows: seen by how much of it is in the window.
    const seen = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(measure, { threshold: Array.from({ length: 101 }, (_, step) => step / 100) });
    seen?.observe(element);
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sized?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      seen?.disconnect();
      sized?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);
  return width;
}

function Pages({ oats, agent, node, tab, failure }: { oats: Roster; agent: Agent; node: Node | undefined; tab: TabId; failure: RosterFailure | null }) {
  const read = usePanelInstance(agent.instance);
  const now = useNow();
  const state = <ReadState read={read} now={now} failure={failure} />;
  // Where the agent is, by the one function every place reads (app/roster/status.ts): the same
  // word, since when and reason as the sidebar's row and the thread's line say. An agent with no
  // bb thread has none to give it.
  const status = agentStatus(agent, node?.thread ?? null, now);
  const drift = read.data === undefined ? null : driftLines(read.data.facts.drift);
  const soul = shown(oats.soulOf(agent));
  return (
    <>
      {/* Who this is and where it is, over the tabs: it stays in view whatever tab is shown and however far its page is scrolled. */}
      <header data-testid="oats-panel-header" className="flex min-w-0 shrink-0 flex-col gap-1 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SoulMark soul={oats.soulOf(agent)} />
          <h2 data-testid="oats-panel-name" title={shown(agent.instance)} className="m-0 min-w-0 break-words text-base font-semibold">
            {instanceDisplayName(shown(agent.instance))}
          </h2>
        </div>
        <div data-testid="oats-panel-state">
          {/* The shared status line. What an agent with a claim asks is said once, in Needs input; a question bb itself shows has no claim, and is said here. */}
          <StatusLine state={status.state} since={status.since} detail={status.state === "needs-you" && claimOf(agent) !== null ? null : status.detail} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span>instance of</span>
          <button type="button" data-testid="oats-panel-soul-link" title={`${soul}: show the Soul tab`} className={`${TARGET} ${LINK} inline-flex min-w-0 items-center break-words text-foreground`} onClick={() => showPanelTab("soul", { focus: true })}>
            {soul}
          </button>
        </div>
        {drift === null ? null : (
          <Disclosure summary="older build" testId="oats-panel-drift">
            {drift.map((line, index) => (
              <span key={index} className="text-muted-foreground">
                {shown(line)}
              </span>
            ))}
          </Disclosure>
        )}
      </header>
      <div className="shrink-0 px-3">
        <Tabs label="Instance context" tabs={TABS} value={tab} onChange={showPanelTab} panelId={PANEL_ID} />
      </div>
      <div role="tabpanel" id={PANEL_ID} data-testid={`oats-panel-page-${tab}`} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {tab === "instance" ? <InstancePage oats={oats} agent={agent} read={read} now={now} state={state} status={status.state} /> : <SoulPage oats={oats} agent={agent} read={read} now={now} state={state} />}
      </div>
    </>
  );
}

/**
 * What the panel says when what it shows is not a current read: the read in flight, a first read
 * that failed, or (the roster's failure first: it is why the instance cannot be read either) what
 * was read earlier, with its age. Nothing when the read is there and current.
 */
function ReadState({ read, now, failure }: { read: InstanceRead; now: number; failure: RosterFailure | null }) {
  const refusal = failure !== null ? failure.line : read.status === "error" ? read.error : null;
  // Retry asks for the roster again where that is what failed, and for the instance in either case:
  // the server answers it from the roster it holds then, and says when a newer one lands.
  const again = () => {
    failure?.retry();
    read.retry();
  };
  if (refusal === null) return read.status === "loading" ? <Loading>Reading this instance…</Loading> : null;
  // Nothing was ever read: the notice every place of the plugin shows when OATS cannot be read, whole.
  if (failure !== null && read.data === undefined) return <Unreadable failure={failure} machine={failure.machine} onRetry={again} />;
  // Why, in the words every place says it (the sidebar's notice, the thread's row) where it is OATS that cannot be read.
  const words = failure === null ? null : failureWords(failure, failure.machine);
  const code = failure !== null ? (isKernelCode(failure.code) ? failure.code : null) : codeOf(refusal);
  const kept = read.data !== undefined;
  return (
    // One drawing for a read that failed, with or without something read earlier under it: with it, how old that is, once.
    <Notice
      title={words !== null ? words.title : kept ? "This instance could not be read again" : "This instance could not be read"}
      tone="error"
      code={code}
      details={refusal}
      {...(read.data === undefined ? {} : { age: staleAge(read.data.at, now) })}
      actions={words === null || words.retry ? <Button onClick={again}>{read.fetching ? "Reading…" : "Retry"}</Button> : undefined}
    >
      {words === null || words.sentence === null ? null : <p className="m-0">{words.sentence}</p>}
    </Notice>
  );
}

function InstancePage({ oats, agent, read, now, state: readState, status }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode; status: AgentState }) {
  const facts = read.data?.facts;
  const answerRoot = read.data?.agentsRoot ?? null;
  const claim = claimOf(agent);
  return (
    <>
      {claim === null ? null : (
        <Section title="Needs input" testId="oats-panel-waiting">
          {/* The reason in words; how long it has waited is the header's to say, once. */}
          <p data-testid="oats-panel-waiting-head" className="m-0 font-semibold text-foreground">
            {waitingLabel(claim)}
          </p>
          {claim.message === null || shown(claim.message) === "" ? null : (
            <p data-testid="oats-panel-waiting-message" dir="auto" className="m-0 break-words text-foreground">
              {shown(claim.message)}
            </p>
          )}
        </Section>
      )}

      {readState}
      {facts === undefined ? null : <InstanceFacts oats={oats} facts={facts} state={status} now={now} />}
      <Readiness instance={agent.instance} of="instance" context={answerRoot === null ? null : { name: agent.instance, root: answerRoot }} now={now} />
      {/* The header's claim is the roster's; a recorded activity that names a newer one asks for the roster again. */}
      <Activity instance={agent.instance} claimSince={agent.waiting?.since ?? null} onNewerClaim={oats.retry} now={now} />
    </>
  );
}

/** `state` is the state the header says: what OATS says of an unreachable session is said there, once, and an agent that does not run was last started, not started. */
function InstanceFacts({ oats, facts, state, now }: { oats: Roster; facts: PanelInstance; state: AgentState; now: number }) {
  const unreachable = state === "unreachable";
  const runs = state !== "stopped" && state !== "error";
  const navigate = useBbNavigate();
  const sentence = workSentence(facts);
  const where = sessionWhere(facts);
  const from = modelFromText(facts);
  const started = facts.startedAt ?? facts.createdAt;
  const saysError = facts.runtimeError !== null && !unreachable;
  const hasSession = facts.harness !== null || where !== null || started !== null || saysError;
  /** Another instance, by its name: a link to its thread where it has one in bb. */
  const instanceLink = (name: string, testId: string) => {
    const thread = oats.nodeByInstance.get(name)?.thread;
    const bbThread = thread === undefined ? undefined : oats.threadById.get(thread.id);
    // An agent by its name as words, as every place names one; the kernel's own name is the title.
    const words = instanceDisplayName(shown(name));
    if (bbThread === undefined) {
      return (
        <span data-testid={testId} title={shown(name)}>
          {words}
        </span>
      );
    }
    return (
      // A target of the size a press needs, on the label's line: its height is taken back from the line's.
      <a
        data-testid={testId}
        href={bbThread.href}
        title={shown(name)}
        className={`${TARGET} ${LINK} -my-3 inline-flex items-center md:-my-1.5`}
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          navigate.toThread(bbThread.id);
        }}
      >
        {words}
      </a>
    );
  };
  return (
    <>
      {sentence === null ? null : (
        <Section title="Work" testId="oats-panel-work">
          <Card
            testId="oats-panel-work-card"
            footer={
              <Disclosure summary="Paths" testId="oats-panel-paths">
                <Facts>
                  <Fact label="Folder">
                    <PathLine
                      path={workFolder(facts.home)}
                      copyName="Copy folder path"
                      testId="oats-panel-folder"
                      tag={
                        sharedWork(facts.work) ? (
                          <span role="note" aria-label={`shared: ${SHARED_TITLE}`}>
                            <Chip tone="muted" title={SHARED_TITLE}>
                              shared
                            </Chip>
                          </span>
                        ) : undefined
                      }
                    />
                  </Fact>
                  <Fact label="Home">
                    <PathLine path={facts.home} copyName="Copy home path" testId="oats-panel-home" />
                  </Fact>
                </Facts>
              </Disclosure>
            }
          >
            <p data-testid="oats-panel-work-sentence" className="m-0 leading-relaxed">
              {sentence.map((part, index) => (typeof part === "string" ? <span key={index}>{part}</span> : <Code key={index}>{part.code}</Code>))}
            </p>
          </Card>
        </Section>
      )}

      {!hasSession ? null : (
        <Section title="Session" testId="oats-panel-session">
          <Card testId="oats-panel-session-card">
            <Facts>
              {facts.harness === null ? null : (
                <Fact label="Harness">
                  <span data-testid="oats-panel-harness">{shown(harnessName(facts.harness))}</span>
                </Fact>
              )}
              {facts.model === null ? null : (
                <Fact label="Model">
                  <span data-testid="oats-panel-model">{from === null ? shown(facts.model) : `${shown(facts.model)} · ${from}`}</span>
                </Fact>
              )}
              {where === null ? null : (
                <Fact label="Runs in">
                  {/* Where, in a word; the session's own id is a code, whole and on a line of its own, never broken inside. */}
                  <span data-testid="oats-panel-session-line" className="flex min-w-0 flex-col gap-0.5">
                    <span>{shown(where.where)}</span>
                    {where.id === null ? null : (
                      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={shown(where.idName)}>
                        {shown(where.id)}
                      </span>
                    )}
                  </span>
                </Fact>
              )}
              {started === null ? null : (
                // An agent that does not run was started then, and is not running since then.
                <Fact label={facts.startedAt === null ? "Created" : runs ? "Started" : "Last started"}>
                  <span
                    data-testid="oats-panel-started"
                    title={shown(facts.startedAt === null ? started : [facts.startedAt, facts.createdAt === null ? null : `created ${facts.createdAt}`].filter(Boolean).join(" · "))}
                  >
                    {shown(ageText(started, now))}
                  </span>
                </Fact>
              )}
              {!saysError ? null : (
                <Fact label="OATS says">
                  <span data-testid="oats-panel-runtime-error">{shown(facts.runtimeError)}</span>
                </Fact>
              )}
            </Facts>
          </Card>
        </Section>
      )}

      {facts.messagingId === null ? null : (
        <Section title="Messaging & Teams" testId="oats-panel-messaging">
          <Facts>
            <Fact label="Messaging ID">
              <PathLine path={facts.messagingId} copyName="Copy messaging ID" testId="oats-panel-messaging-id" />
            </Fact>
          </Facts>
        </Section>
      )}

      {facts.human === null && facts.parent === null && facts.sibling === null && oats.children.length === 0 ? null : (
        <Section title="Lineage" testId="oats-panel-lineage">
          <Facts>
            {facts.human === null ? null : (
              <Fact label="Owning human">
                <span data-testid="oats-panel-human">{shown(facts.human)}</span>
              </Fact>
            )}
            {facts.parent === null ? null : <Fact label="Parent">{instanceLink(facts.parent, "oats-panel-parent")}</Fact>}
            {facts.sibling === null ? null : <Fact label="Sibling">{instanceLink(facts.sibling, "oats-panel-sibling")}</Fact>}
            {/* The agents it started, as the thread's row counts them ("1 child"): each by its name, a link where it has a thread. */}
            {oats.children.length === 0 ? null : (
              <Fact label={oats.children.length === 1 ? "Child" : "Children"}>
                <span data-testid="oats-panel-children" className="flex min-w-0 flex-col items-start">
                  {oats.children.map((child) => (
                    <span key={child}>{instanceLink(child, "oats-panel-child")}</span>
                  ))}
                </span>
              </Fact>
            )}
          </Facts>
        </Section>
      )}
    </>
  );
}

function SoulPage({ oats, agent, read, now, state: readState }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode }) {
  const navigate = useBbNavigate();
  const answer = read.data;
  // Read again when the instance was started again or what it was built from moved: the same instance, another record.
  const soul = usePanelSoul(agent.instance, answer === undefined ? "" : JSON.stringify([answer.facts.startedAt, answer.facts.drift]));
  const key = answer?.soul.key ?? null;
  const description = answer?.soul.description ?? null;
  return (
    <>
      <header data-testid="oats-panel-soul-header" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <SoulMark soul={key ?? oats.soulOf(agent)} />
          <h2 data-testid="oats-panel-soul-name" className="m-0 min-w-0 break-words text-base font-semibold">
            {shown(key ?? oats.soulOf(agent))}
          </h2>
        </div>
        {description === null ? null : (
          <p data-testid="oats-panel-soul-description" className="m-0 break-words text-muted-foreground">
            {shown(description)}
          </p>
        )}
      </header>
      {readState}
      <SoulBody read={soul} now={now} />
      {key === null ? null : <Readiness instance={agent.instance} of="soul" context={answer?.agentsRoot == null ? null : { name: key, root: answer.agentsRoot }} now={now} />}
      {answer === undefined || answer.agentsRoot === null ? null : (
        <Disclosure summary="Details" testId="oats-panel-details">
          <Facts>
            <Fact label="Agents root">
              <PathLine path={answer.agentsRoot} copyName="Copy agents root path" testId="oats-panel-agents-root" />
            </Fact>
          </Facts>
        </Disclosure>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          data-testid="oats-panel-open-soul"
          disabled={key === null}
          onClick={() => {
            if (key !== null) openSoul(navigate, key);
          }}
        >
          Open soul page
        </Button>
        {key !== null || answer === undefined ? null : <span data-testid="oats-panel-open-soul-why" className="text-xs text-muted-foreground">OATS lists no soul of this name here, so there is no soul page to open.</span>}
      </div>
    </>
  );
}
