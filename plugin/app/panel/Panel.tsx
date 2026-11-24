// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
// Drawn with the patterns of app/ui.tsx; its own parts are in parts.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OutsideAgent, pageParts } from "../outside";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AgentTabProps } from "../home/agent-tab";
import type { PanelInstance } from "../../kernel/panel-instance";
import { isKernelCode } from "../../kernel/result";
import type { Agent, AgentState, BbThread, Node, ThreadWhere } from "../../model/types";
import { claimOf, isListed } from "../../model/view";
import { AgentActs } from "../lifecycle";
import { ReadingLine, useReading } from "../roster/reading";
import { agentStatus, stoppedAt } from "../roster/status";
import { HELD, Unreadable, failureWords, useSettingsHref } from "../roster/unreadable";
import { failureLine, useOats } from "../oats";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";
import { Button, Card, Chip, Code, CopyButton, Disclosure, Fact, Facts, KernelSays, LINK, Loading, Notice, Section, StatusLine, TARGET, Tabs, plainClick } from "../ui";
import type { TabItem } from "../ui";
import { shown } from "../ui/text";
import { agentName, readAge, showingRead, waitingLabel } from "../ui/words";
import { openSoul, usePageShown } from "../workspace/pages";
import { Activity } from "./Activity";
import { AgentMark, CommandText, PathLine, SoulMark } from "./parts";
import { Readiness } from "./Readiness";
import { useNow, usePanelEvents, usePanelInstance, usePanelSoul } from "./read";
import type { PanelRead } from "./read";
import { SoulBody } from "./SoulBody";
import { codeOf } from "./state";
import { ATTACH, SHARED_TITLE, ageText, attachCommand, attachOffered, driftLines, harnessName, modelFromText, sessionWhere, sharedWork, workFolder, workSentence } from "./words";

type InstanceRead = PanelRead<"panelInstance">;
/** What the panel reads of the roster beside its agent: the souls' names, and the threads its links go to. */
type Roster = Pick<Oats, "soulOf" | "threadById" | "retry"> & { /** the machine OATS is read on, by the name bb gives it; null while none is known */ machine: string | null; nodeByInstance: ReadonlyMap<string, Node>; /** the instances whose parent is the agent shown, in the roster's order */ children: readonly string[]; /** what bb says of the thread an agent's row names (`Oats.whereOf`); "unknown" while there is no roster */ whereOf(agent: Agent): ThreadWhere };
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
  // The agent last shown is kept in state, set while drawing when the roster names another one: what
  // a draw shows is then what the roster says at that draw, and nothing is written to a ref on the way.
  const [last, setLast] = useState<Shown | null>(null);
  let held = last;
  if (oats.phase === "ready") {
    const node = threadId !== undefined ? oats.nodeByThread.get(threadId) : instance !== undefined ? oats.nodeByInstance.get(instance) : undefined;
    const agent = node?.agent ?? (instance === undefined ? undefined : oats.agents.find((candidate) => candidate.instance === instance));
    // What the roster says now, also when it says the agent is gone.
    held = agent === undefined ? null : last !== null && last.key === key && last.agent === agent && last.node === node ? last : { key, agent, node };
    if (held !== last) setLast(held);
  } else if (known !== undefined && last?.key !== key) {
    held = { key, agent: known, node: undefined };
    setLast(held);
  }
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const visible = useVisibleWidth(root);
  // Another thread or name than the one held: nothing of that agent is known yet.
  if (held === null || held.key !== key) return null;
  const roster: Roster = {
    soulOf: oats.soulOf,
    threadById: oats.threadById,
    retry: oats.retry,
    machine: oats.phase === "ready" ? oats.deployment.machine : oats.phase === "failed" ? oats.machine : null,
    whereOf: oats.phase === "ready" ? oats.whereOf : () => "unknown",
    nodeByInstance: oats.phase === "ready" ? oats.nodeByInstance : NO_NODES,
    children: oats.phase === "ready" ? oats.agents.filter((other) => other.parent === held.agent.instance).map((other) => other.instance) : [],
  };
  // The agent's bb thread, for its state: the tree's own where the agent is drawn on one. Where the
  // roster is NOT ready and the panel shows the agent its caller remembered, there is no node: bb's
  // own row of that thread is given (bb lists its threads whatever OATS answers), since whether the
  // agent works is what bb says of the thread. In a ready roster a missing node means no thread to
  // read, as the sidebar's row of such an agent says.
  const remembered = oats.phase === "ready" || held.agent.threadId === null ? undefined : oats.threadById.get(held.agent.threadId);
  const thread = held.node?.thread ?? (remembered !== undefined && isListed(remembered) ? remembered : null);
  // OATS cannot be read: never (no roster), or not again (the roster is the last one read).
  const unread = oats.phase === "failed" ? oats : oats.phase === "ready" ? oats.stale : null;
  const failure: RosterFailure | null = unread === null ? null : { code: unread.code, message: unread.message, machine: oats.phase === "failed" ? oats.machine : oats.phase === "ready" ? oats.deployment.machine : null, line: failureLine(unread), retry: oats.retry };
  return (
    <div ref={setRoot} data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      {/* What the panel draws is as wide as the part of it that is in the window (`useVisibleWidth`). */}
      <div data-testid="oats-panel-visible" className="flex min-h-0 min-w-0 flex-1 flex-col" style={visible === null ? undefined : { width: visible }}>
        {/* One instance at a time: another agent starts from its own read. */}
        <Pages key={held.agent.instance} oats={roster} agent={held.agent} node={held.node} thread={thread} tab={tab} failure={failure} />
      </div>
    </div>
  );
}

/**
 * How wide the part of the panel that is in the window is, in px; null while it is whole in it.
 * In the live checks up to oats-bb 84720c5, bb 0.50.1 laid its side panel out wider than the
 * window left room for when its sidebar, a thread and the panel were all open (the panel's column
 * ran past the window's right edge, by up to 138 px at 1280 px), and what was drawn there could
 * not be reached; it has not since, and why was not found (README, "The instance panel"). Wherever
 * the panel is not whole in the window, it draws within the part that is: nothing of it is cut.
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

function Pages({ oats, agent, node, thread, tab, failure }: { oats: Roster; agent: Agent; node: Node | undefined; thread: BbThread | null; tab: TabId; failure: RosterFailure | null }) {
  const read = usePanelInstance(agent.instance);
  const now = useNow();
  const state = <ReadState read={read} now={now} failure={failure} />;
  // Where the agent is, by the one function every place reads (app/roster/status.ts): the same
  // word, since when and reason as the sidebar's row and the thread's line say. An agent with no
  // bb thread has none to give it (`thread`, from InstancePanel).
  const status = agentStatus(agent, thread, now);
  const drift = read.data === undefined ? null : driftLines(read.data.facts.drift);
  const line = pageParts(agent, oats, status);
  const reading = useReading(agent.instance);
  const soul = shown(oats.soulOf(agent));
  return (
    <>
      {/* Who this is and where it is, over the tabs: it stays in view whatever tab is shown and however far its page is scrolled. */}
      <header data-testid="oats-panel-header" className="flex min-w-0 shrink-0 flex-col gap-1 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentMark instance={agent.instance} />
          <h2 data-testid="oats-panel-name" title={shown(agent.instance)} className="m-0 min-w-0 break-words text-base font-semibold">
            {agentName(agent.instance)}
          </h2>
        </div>
        {/* How long it has waited is said ONCE, here ("Needs you · 5 d"). Since when, by the clock, is the Activity's: its "Waiting claim" row, at its instant. */}
        <div data-testid="oats-panel-state" data-outside={line.kind ?? undefined}>
          {/* The shared status line. What an agent with a claim asks is said once, in Needs input; a question bb itself shows has no claim, and is said here.
              For an agent the roster draws on no thread, what happened to it outside OATS follows the state's word, as on its row ("Stopped · session lost"). */}
          {/* Behind a lifecycle result that says the agent changed, until the roster is read again: "Reading…", never the old state stated plainly. */}
          {reading ? (
            <ReadingLine />
          ) : (
            <>
              <StatusLine state={status.state} since={line.since} tone={line.tone} detail={status.state === "needs-you" && claimOf(agent) !== null ? line.reason : line.detail} />
              <KernelSays text={status.kernel} bb={status.bb} />
            </>
          )}
        </div>
        {/* What a person can do with the agent, where its state is said: the lifecycle's own acts (each opens its dialog; nothing runs on the press), the ones that apply to its state, held with the reason while the roster is the last one read. Here an agent with no thread in bb has them too: its row opens this panel on its own page. */}
        <AgentActs instance={agent.instance} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {/* Its soul, by its name alone: the name is the way to the Soul tab. */}
          <button type="button" data-testid="oats-panel-soul-link" title={`${soul}: show the Soul tab`} className={`${TARGET} ${LINK} inline-flex min-w-0 items-center break-words text-foreground`} onClick={() => showPanelTab("soul", { focus: true })}>
            {soul}
          </button>
        </div>
        {drift === null ? null : (
          <Disclosure summary="older build" testId="oats-panel-drift">
            {/* The header does not scroll with the page: what moved (a line per module) scrolls within its own height. */}
            <span className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {drift.map((line, index) => (
                <span key={index} className="text-muted-foreground">
                  {shown(line)}
                </span>
              ))}
            </span>
          </Disclosure>
        )}
      </header>
      <div className="shrink-0 px-3">
        <Tabs label="Instance context" tabs={TABS} value={tab} onChange={showPanelTab} panelId={PANEL_ID} />
      </div>
      <div role="tabpanel" id={PANEL_ID} data-testid={`oats-panel-page-${tab}`} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {tab === "instance" ? <InstancePage oats={oats} agent={agent} read={read} now={now} state={state} status={status.state} held={failure !== null || reading} /> : <SoulPage oats={oats} agent={agent} read={read} now={now} state={state} />}
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
  const settings = useSettingsHref();
  const refusal = failure !== null ? failure.line : read.status === "error" ? read.error : null;
  // Retry asks for the roster again where that is what failed, and for the instance in either case:
  // the server answers it from the roster it holds then, and says when a newer one lands.
  const again = () => {
    failure?.retry();
    read.retry();
  };
  if (refusal === null) return read.status === "loading" ? <Loading>Reading…</Loading> : null;
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
      // Where it is OATS that cannot be read, the code is under Details with the refusal, as in the sidebar's notice.
      code={words === null ? code : null}
      // What to do in a sentence is one press away, over the refusal itself (as in the sidebar's notice).
      details={[words === null || isKernelCode(failure?.code ?? "") ? null : words.sentence, refusal]}
      // Where it is the ROSTER that is the last one read, the header's acts are off: the notice's one line says so
      // beside the age, as the sidebar's and the thread's line do (an act that is off is never alone on the page).
      {...(read.data === undefined || failure !== null ? {} : { age: readAge(read.data.at, now) })}
      actions={
        <>
          {words === null || words.retry ? <Button onClick={again}>{read.fetching ? "Reading…" : "Retry"}</Button> : null}
          {/* The sidebar's notice for this cause offers the settings: the same here. */}
          {words !== null && words.settings ? (
            <a data-testid="oats-panel-open-settings" className={`${TARGET} ${LINK} inline-flex items-center`} href={settings}>
              Open settings
            </a>
          ) : null}
        </>
      }
    >
      {failure === null || read.data === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          {showingRead(readAge(read.data.at, now))} <span data-testid="oats-held">{HELD}</span>
        </p>
      )}
    </Notice>
  );
}

function InstancePage({ oats, agent, read, now, state: readState, status, held }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode; status: AgentState; /** the roster is the last one read: the acts are held */ held: boolean }) {
  const facts = read.data?.facts;
  const answerRoot = read.data?.agentsRoot ?? null;
  const claim = claimOf(agent);
  const message = claim === null || claim.message === null ? "" : shown(claim.message);
  return (
    <>
      {/* What happened to it outside OATS (app/outside), first on the page and scrolling with it (the
          header over the tabs does not scroll, and says the state): the kernel's report, and
          for an agent the roster draws on no thread, what happened. The acts are the header's
          (`AgentActs`, above); the block adds one only where the header offers none. */}
      <OutsideAgent agent={agent} roster={oats} held={held} />
      {claim === null ? null : (
        // What the agent asks, first on the page, under no heading: the header two lines up says
        // "Needs you" and how long it has waited, once (the claim's instant is the Activity's, in its "Waiting claim" row).
        <section data-testid="oats-panel-waiting" aria-label="Needs input" className="flex min-w-0 flex-col gap-2">
          {message !== "" ? (
            <p data-testid="oats-panel-waiting-message" dir="auto" className="m-0 break-words text-foreground">
              {message}
            </p>
          ) : waitingLabel(claim) === null ? null : (
            // No message: the reason in a word, where it says what is needed.
            <p data-testid="oats-panel-waiting-head" className="m-0 font-semibold text-foreground">
              {waitingLabel(claim)}
            </p>
          )}
        </section>
      )}

      {readState}
      {facts === undefined ? null : <InstanceFacts oats={oats} facts={facts} state={status} running={agent.running} lost={agent.sessionEnd === "lost"} instance={agent.instance} startedAt={agent.startedAt ?? null} now={now} />}
      <Readiness instance={agent.instance} of="instance" context={answerRoot === null ? null : { name: agent.instance, root: answerRoot }} now={now} />
      {/* The header's claim is the roster's; a recorded activity that names a newer one asks for the roster again. */}
      <Activity instance={agent.instance} claimSince={agent.waiting?.since ?? null} onNewerClaim={oats.retry} now={now} />
    </>
  );
}

/** `state` is the state the header says: what OATS says of an unreachable session is said there, once, and an agent that does not run was last started, not started. */
function InstanceFacts({ oats, facts, state, running, lost, instance, startedAt, now }: { oats: Roster; facts: PanelInstance; state: AgentState; /** the kernel's row says its session was lost (`sessionEnd: "lost"`): nobody stopped it */ lost: boolean; /** the kernel's own word of the roster's row, as `state` is read from it */ running: Agent["running"]; instance: string; /** the roster's own time of the session's last start: a stop recorded before it is not this stop */ startedAt: string | null; now: number }) {
  const unreachable = state === "unreachable";
  // When OATS stopped it: the time of the instance's last recorded "stopped" (also for one that runs
  // outside OATS, which OATS recorded stopped). One read, for this agent, only while it is stopped.
  // That read runs once and is kept (by bb, also for the Activity below): an answer held from before
  // THIS stop does not hold it, so each time the agent is seen to turn stopped, events already held
  // are read again. (Kept in an effect, declared before the effect that reads it.)
  // A session OATS LOST has no such time: the kernel records none of a loss (never "lost since"), and
  // the last "stopped" its events hold is an earlier stop's. No "Stopped <time>" for it, and no read.
  const recordedStopped = (state === "stopped" || state === "outside") && !lost;
  const events = usePanelEvents(instance, recordedStopped);
  const eventsNow = useRef(events);
  useEffect(() => {
    eventsNow.current = events;
  });
  useEffect(() => {
    if (recordedStopped && eventsNow.current.data !== undefined) eventsNow.current.retry();
  }, [recordedStopped, instance]);
  const stopped = recordedStopped ? stoppedAt(events.data?.events, startedAt, now) : null;
  const runs = state !== "stopped" && state !== "error";
  const navigate = useBbNavigate();
  const sentence = workSentence(facts);
  const where = sessionWhere(facts);
  const from = modelFromText(facts);
  const started = facts.startedAt ?? facts.createdAt;
  const saysError = facts.runtimeError !== null && !unreachable;
  const hasSession = facts.harness !== null || where !== null || started !== null || stopped !== null || saysError;
  // What is wanted and not needed, behind the panel's one fold for it, "Paths": the folder and the
  // home, the session's own id, where the model came from, what OATS says of the session. The fold
  // is the Work card's; where no Work is drawn it is the Session card's.
  const sessionPaths =
    (where !== null && where.id !== null) || from !== null || saysError ? (
      <>
        {where === null || where.id === null ? null : (
          <Fact label={shown(where.where)}>
            {/* The session's own id is a code, whole, never broken inside. */}
            <span data-testid="oats-panel-session-id" className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={shown(where.idName)}>
              {shown(where.id)}
            </span>
          </Fact>
        )}
        {from === null ? null : (
          <Fact label="Model">
            <span data-testid="oats-panel-model-from">{from}</span>
          </Fact>
        )}
        {!saysError ? null : (
          <Fact label="OATS says">
            <span data-testid="oats-panel-runtime-error">{shown(facts.runtimeError)}</span>
          </Fact>
        )}
      </>
    ) : null;
  /** Another instance, by its name: a link to its thread where it has one in bb. */
  /** `stacked`: one of a list of links, each on a row as high as its target (a link alone takes its target's height back from its line). */
  const instanceLink = (name: string, testId: string, stacked = false) => {
    const thread = oats.nodeByInstance.get(name)?.thread;
    const bbThread = thread === undefined ? undefined : oats.threadById.get(thread.id);
    // An agent by its name as words, as every place names one; the kernel's own name is the title.
    const words = agentName(name);
    if (bbThread === undefined) {
      return (
        <span data-testid={testId} title={shown(name)}>
          {words}
        </span>
      );
    }
    return (
      // A target of the size a press needs. Alone beside its label, its height is taken back from the line's, so the two
      // stand on one line; in a list each row is as high as the target, so no two targets overlap.
      <a
        data-testid={testId}
        href={bbThread.href}
        title={shown(name)}
        className={`${TARGET} ${LINK} inline-flex items-center ${stacked ? "" : "-my-3 md:-my-1.5"}`}
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
                  {sessionPaths}
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
          <Card
            testId="oats-panel-session-card"
            footer={
              sentence !== null || sessionPaths === null ? undefined : (
                <Disclosure summary="Paths" testId="oats-panel-paths">
                  <Facts>{sessionPaths}</Facts>
                </Disclosure>
              )
            }
          >
            <Facts>
              {facts.harness === null ? null : (
                <Fact label="Harness">
                  <span data-testid="oats-panel-harness">{shown(harnessName(facts.harness))}</span>
                </Fact>
              )}
              {facts.model === null ? null : (
                <Fact label="Model">
                  <span data-testid="oats-panel-model">{shown(facts.model)}</span>
                </Fact>
              )}
              {where === null ? null : (
                <Fact label="Runs in">
                  {/* Where, in a word; the session's own id is under Paths. */}
                  <span data-testid="oats-panel-session-line">{shown(where.where)}</span>
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
              {stopped === null ? null : (
                // When OATS stopped it: the fact that left the thread's line and the sidebar's row.
                <Fact label="Stopped">
                  <span data-testid="oats-panel-stopped">{stopped}</span>
                </Fact>
              )}
            </Facts>
            {/* An agent on tmux has no thread in bb: where its session is and how to reach it, in one sentence and one command to copy (the home's card of such an agent gives the same command). Only while the kernel itself says it runs (`running: true`; it works, or it waits on a person): a stopped one has no session, and for one the kernel cannot reach, or says nothing of, `oats session attach` refuses, also when such an agent still carries a claim. */}
            {attachOffered(where?.where === "tmux session", running, state) ? (
              <div data-testid="oats-panel-attach" className="flex min-w-0 flex-col gap-1">
                <p className="m-0">{ATTACH}</p>
                <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
                  <CommandText command={attachCommand(facts.home)} />
                  <CopyButton text={attachCommand(facts.home)} name="Copy the attach command" />
                </p>
              </div>
            ) : null}
          </Card>
        </Section>
      )}

      {facts.human === null && facts.parent === null && facts.sibling === null && oats.children.length === 0 && facts.messagingId === null ? null : (
        <Section title="Lineage" testId="oats-panel-lineage">
          {/* On the page's face: the agents it is related to. Who owns it and its address for the others are under a fold: asked for, not read on every page. */}
          {facts.parent === null && facts.sibling === null && oats.children.length === 0 ? null : (
          <Facts>
            {facts.parent === null ? null : <Fact label="Parent">{instanceLink(facts.parent, "oats-panel-parent")}</Fact>}
            {facts.sibling === null ? null : <Fact label="Sibling">{instanceLink(facts.sibling, "oats-panel-sibling")}</Fact>}
            {/* The agents it started, as the thread's row counts them ("1 child"): each by its name, a link where it has a thread. */}
            {oats.children.length === 0 ? null : (
              <Fact label={oats.children.length === 1 ? "Child" : "Children"}>
                <span data-testid="oats-panel-children" className="flex min-w-0 flex-col items-start">
                  {oats.children.map((child) => (
                    <span key={child}>{instanceLink(child, "oats-panel-child", true)}</span>
                  ))}
                </span>
              </Fact>
            )}
          </Facts>
          )}
          {facts.human === null && facts.messagingId === null ? null : (
            <Disclosure summary="Details" testId="oats-panel-lineage-details">
              <Facts>
                {facts.human === null ? null : (
                  <Fact label="Owning human">
                    <span data-testid="oats-panel-human">{shown(facts.human)}</span>
                  </Fact>
                )}
                {/* Who it is to the others: one fact, under the one heading, with no heading of its own. */}
                {facts.messagingId === null ? null : (
                  <Fact label="Messaging ID">
                    <PathLine path={facts.messagingId} copyName="Copy messaging ID" testId="oats-panel-messaging-id" />
                  </Fact>
                )}
              </Facts>
            </Disclosure>
          )}
        </Section>
      )}
    </>
  );
}

function SoulPage({ oats, agent, read, now, state: readState }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode }) {
  const navigate = useBbNavigate();
  const soulsShown = usePageShown("souls");
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
          // The soul author's own text, as long as they wrote it: two lines here, whole in its title and on the soul's page.
          <p data-testid="oats-panel-soul-description" title={shown(description)} className="m-0 line-clamp-2 break-words text-muted-foreground">
            {shown(description)}
          </p>
        )}
        {/* With the soul it opens, at the top: never below the fold, never cut at the window's foot. Offered only where the Souls page is shown in this release: a link leads somewhere. */}
        {soulsShown ? (
          <div className="flex flex-wrap items-center gap-2">
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
        ) : null}
      </header>
      {readState}
      <SoulBody read={soul} now={now} />
      {/* The agents root is said where it explains something: what the readiness checks observed (the fold of Readiness: "Soul: <key> · <agents root>"). No fold of its own at the tab's foot. */}
      {key === null ? null : <Readiness instance={agent.instance} of="soul" context={answer?.agentsRoot == null ? null : { name: key, root: answer.agentsRoot }} now={now} />}
    </>
  );
}
