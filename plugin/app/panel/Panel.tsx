// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
// Drawn with the patterns of app/ui.tsx; its own parts are in parts.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BOARD, Board, useBoardTab } from "../board";
import { MAIL, Mail } from "../mail";
import { TerminalButton } from "../terminal/Terminal";
import { OutsideAgent, OutsideAgentDetails, pageActs, pageParts, words as outsideWords } from "../outside";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AgentTabProps } from "../home/agent-tab";
import type { PanelInstance } from "../../kernel/panel-instance";
import type { Agent, AgentState, BbThread, Node, ThreadWhere } from "../../model/types";
import { claimOf, isListed } from "../../model/view";
import { AgentActs } from "../lifecycle";
import { ReadingLine, useReading } from "../roster/reading";
import { agentStatus, stoppedAt } from "../roster/status";
import { Unreadable } from "../roster/unreadable";
import { failureLine, useOats } from "../oats";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";
import { Button, Card, Chip, Code, CopyButton, Disclosure, Fact, Facts, KernelSays, LINK, Loading, Notice, Section, StatusLine, TARGET, Tabs, plainClick } from "../ui";
import type { TabItem } from "../ui";
import { shown } from "../ui/text";
import { agentName, readAge, waitingLabel } from "../ui/words";
import { openSoul, usePageShown } from "../workspace/pages";
import { Activity } from "./Activity";
import { AgentMark, CommandText, PathLine, SoulMark } from "./parts";
import { Readiness } from "./Readiness";
import { useNow, usePanelEvents, usePanelInstance, usePanelSoul } from "./read";
import type { PanelRead } from "./read";
import { SoulBody } from "./SoulBody";
import { codeOf } from "./state";
import { isDrawn, mountedOn, moved } from "./tab-state";
import type { Drawn, TabId } from "./tab-state";
import { ATTACH, SHARED_TITLE, ageText, attachCommand, attachOffered, driftLines, harnessName, modelFromText, sessionWhere, sharedWork, workFolder, workSentence } from "./words";

type InstanceRead = PanelRead<"panelInstance">;
/** What the panel reads of the roster beside its agent: the souls' names, and the threads its links go to. */
type Roster = Pick<Oats, "soulOf" | "threadById" | "retry"> & { /** the machine OATS is read on, by the name bb gives it; null while none is known */ machine: string | null; nodeByInstance: ReadonlyMap<string, Node>; /** the instances whose parent is the agent shown, in the roster's order */ children: readonly string[]; /** what bb says of the thread an agent's row names (`Oats.whereOf`); "unknown" while there is no roster */ whereOf(agent: Agent): ThreadWhere };
/** The agent a panel shows, and for which thread or name it is shown. */
type Shown = { key: string; agent: Agent; node: Node | undefined };
const NO_NODES: ReadonlyMap<string, Node> = new Map();
/** The roster could not be read again: what it said, and the way to ask again. */
type RosterFailure = { code: string; message: string; machine: string | null; line: string; /** when the roster kept was read; null where none ever was */ at: string | null; retry(): void };

/** The panel's tabs. */
export type { TabId } from "./tab-state";
const TABS: readonly TabItem<TabId>[] = [
  // The agent's questions and facts, FIRST: a view of its own (app/board) that takes the agent's name and nothing of the panel's.
  // Drawn only for an agent whose board has a fact or a question (`tabsOf`): what there is nothing of is not offered.
  { id: "board", label: BOARD.tab },
  { id: "instance", label: "Instance" },
  { id: "soul", label: "Soul" },
  // The agent's incoming mail, read-only: a view of its own (app/mail) that takes the agent's name and nothing of the panel's.
  // Drawn only for an agent that has a messaging id (`tabsOf`): what cannot be done is not offered.
  { id: "mail", label: MAIL.tab },
];
const tabsOf = (drawn: Drawn): readonly TabItem<TabId>[] => TABS.filter((tab) => isDrawn(tab.id, drawn));
/**
 * The agent whose Mail tab a person pressed. Mail is NOT remembered from one agent to the next, as
 * the other tabs are: showing an agent's mail reads it (over the network, with the agent's own
 * identities), and that takes a press on THAT agent's tab. A press on Mail is good for the agent
 * it was pressed on until another agent's panel is shown: that panel drops the marker (not the
 * memory), so the first agent's panel, shown again, opens on Instance and reads no mail by itself.
 */
let mailOf: string | null = null;
/** A tab pressed in the panel of `instance`. */
function pressTab(instance: string, tab: TabId): void {
  mailOf = tab === "mail" ? instance : null;
  showPanelTab(tab);
}
/** The id of the panel's one tab panel: the tabs name it, and it names the tab it shows. */
const PANEL_ID = "oats-panel-page";

// The tab a person left the panel on, for the length of the app window: another agent opens on it too.
let shownTab: TabId = "instance";
/**
 * How many times a tab was ASKED FOR (a press on a tab, or another feature's `showPanelTab`). A
 * press is an EVENT, not a change of the memory: a press that names the tab the memory already
 * holds moves a panel all the same (one that fell to Instance when the tab it showed went).
 */
let presses = 0;
const listeners = new Set<() => void>();
const tell = (): void => {
  for (const listener of listeners) listener();
};
/**
 * Shows one of the panel's tabs, from anywhere, as a press does: it writes the window's memory, so
 * an open panel turns to the tab and the next one that mounts (bb may mount it twice) opens on
 * it. `focus`: the tab takes the focus too, for a control that leaves the page as the tab turns.
 */
export function showPanelTab(tab: TabId, { focus = false }: { focus?: boolean } = {}): void {
  shownTab = tab;
  presses += 1;
  tell();
  // Once the open panel has drawn the tab selected (the store's change is drawn before this runs).
  if (focus) queueMicrotask(() => document.getElementById(`${PANEL_ID}-tab-${tab}`)?.focus());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const useShownTab = (): TabId => useSyncExternalStore(subscribe, () => shownTab, () => shownTab);
const usePresses = (): number => useSyncExternalStore(subscribe, () => presses, () => presses);
onWindowReset(() => {
  mailOf = null;
  shownTab = "instance";
  presses = 0;
  tell();
});

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
  const failure: RosterFailure | null = unread === null ? null : { code: unread.code, message: unread.message, machine: oats.phase === "failed" ? oats.machine : oats.phase === "ready" ? oats.deployment.machine : null, line: failureLine(unread), at: oats.phase === "ready" ? oats.at : null, retry: oats.retry };
  return (
    <div ref={setRoot} data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      {/* What the panel draws is as wide as the part of it that is in the window (`useVisibleWidth`). */}
      <div data-testid="oats-panel-visible" className="flex min-h-0 min-w-0 flex-1 flex-col" style={visible === null ? undefined : { width: visible }}>
        {/* One instance at a time: another agent starts from its own read. */}
        <Pages page={threadId === undefined} key={held.agent.instance} oats={roster} agent={held.agent} node={held.node} thread={thread} tab={tab} failure={failure} />
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

function Pages({ oats, agent, node, thread, tab: remembered, failure, page }: { oats: Roster; agent: Agent; node: Node | undefined; thread: BbThread | null; tab: TabId; failure: RosterFailure | null; /** the panel is an agent's page, not the tab beside its thread */ page: boolean }) {
  const read = usePanelInstance(agent.instance);
  const now = useNow();
  // Beside a thread (the tab: `threadId`) the thread's own line says that the roster is the last one read; on an
  // agent's page this panel IS the pane a person is looking at, and says it itself, once.
  const state = <ReadState read={read} now={now} failure={failure} page={page} />;
  // Where the agent is, by the one function every place reads (app/roster/status.ts): the same
  // word, since when and reason as the sidebar's row and the thread's line say. An agent with no
  // bb thread has none to give it (`thread`, from InstancePanel).
  const status = agentStatus(agent, thread, now);
  const drift = read.data === undefined ? null : driftLines(read.data.facts.drift);
  const line = pageParts(agent, oats, status);
  const reading = useReading(agent.instance);
  const soul = shown(oats.soulOf(agent));
  // The agent's board, for the tabs: whether there is one to show, as this mount's own read of it says.
  const board = useBoardTab(agent.instance);
  // Which tabs are drawn for this agent (the rule over `Drawn`). The row's own word (`hasBoard`) draws the Board tab at
  // once, and keeps it where the board's read failed: what could not be read is said there, with Retry.
  // (Once the board's own read has ANSWERED for this panel, since its mount, the board says: it is the board itself,
  // where the row's word is a summary of it that the roster may hold a moment longer. STICKY: what the board last
  // answered stands while it is read again and where a later read fails; the row's word never comes back to decide.
  // An answer bb holds from before the mount decides nothing.)
  const boardSaid = useRef<boolean | null>(null);
  if (board.answered) boardSaid.current = board.shown;
  const drawn: Drawn = { board: boardSaid.current ?? agent.hasBoard === true, mail: read.data !== undefined && read.data.facts.messagingId !== null };
  // THE TAB SHOWN: a state of this panel (one agent's: `Pages` is keyed by the agent's name where it is drawn, so a
  // panel bb keeps open while the thread changes is mounted anew), moved by the three events of `TabState` and by
  // nothing else: the panel never chooses a tab by itself. (An event is taken as it is seen, in the draw that sees
  // it: the state it leaves is kept.)
  const pressed = usePresses();
  const [held, setHeld] = useState(() => mountedOn({ memory: shownTab, mailOf, presses }, agent.instance, drawn));
  const tabNow = moved(held, { presses: pressed, pressedTab: remembered, drawn });
  if (tabNow !== held) setHeld(tabNow);
  const tab = tabNow.tab;
  useEffect(() => {
    // A press on Mail is good for its agent until another agent's panel is shown: that panel drops the marker.
    if (mailOf !== null && mailOf !== agent.instance) mailOf = null;
  }, [agent.instance]);
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
          {/* An agent that runs outside OATS: the line is its thread's line, with Stop… (the primary act), Start… and then Retire… as the line's own acts, the page's ONE row of acts (app/outside `pageActs`; `AgentActs` below draws none for it); off behind "Reading…" and while the roster is the last one read. */}
          {reading ? (
            <ReadingLine action={pageActs(line.report, agent.instance, true)?.buttons} />
          ) : (
            <>
              <StatusLine state={status.state} word={status.word} since={line.since} tone={line.tone} markTone={line.markTone} detail={status.state === "needs-you" && claimOf(agent) !== null ? line.reason : line.detail} action={pageActs(line.report, agent.instance, failure !== null)?.buttons} />
              <KernelSays text={status.kernel} bb={status.bb} />
              {/* The kernel's report that it runs outside OATS: its Details, under the state it explains (app/outside). */}
              <OutsideAgentDetails agent={agent} roster={oats} />
            </>
          )}
        </div>
        {/* What a person can do with the agent, where its state is said: the lifecycle's own acts (each opens its dialog; nothing runs on the press), the ones that apply to its state, held with the reason while the roster is the last one read. Here an agent with no thread in bb has them too: its row opens this panel on its own page. */}
        <AgentActs instance={agent.instance} except={pageActs(line.report, agent.instance, false)?.verbs} />
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
        <Tabs
          label="Instance context"
          tabs={tabsOf(drawn)}
          value={tab}
          onChange={(id) => pressTab(agent.instance, id)}
          panelId={PANEL_ID}
        />
      </div>
      <div role="tabpanel" id={PANEL_ID} data-testid={`oats-panel-page-${tab}`} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {tab === "board" ? <Board instance={agent.instance} /> : tab === "instance" ? <InstancePage oats={oats} agent={agent} read={read} now={now} state={state} status={status.state} held={failure !== null || reading} reading={reading} unread={failure !== null} /> : tab === "soul" ? <SoulPage oats={oats} agent={agent} read={read} now={now} state={state} unread={failure !== null} /> : <Mail instance={agent.instance} />}
      </div>
    </>
  );
}

/**
 * What the panel says when what it shows is not a current read: the read in flight, a first read
 * that failed, or (the roster's failure first: it is why the instance cannot be read either) what
 * was read earlier, with its age. Nothing when the read is there and current.
 */
function ReadState({ read, now, failure, page }: { read: InstanceRead; now: number; failure: RosterFailure | null; /** the panel is an agent's page, not the tab beside its thread */ page: boolean }) {
  const refusal = failure !== null ? failure.line : read.status === "error" ? read.error : null;
  // Retry asks for the roster again where that is what failed, and for the instance in either case:
  // the server answers it from the roster it holds then, and says when a newer one lands.
  const again = () => {
    failure?.retry();
    read.retry();
  };
  if (refusal === null) return read.status === "loading" ? <Loading>Reading…</Loading> : null;
  // Nothing was read here, and no roster is kept (OATS was never read). An agent's PAGE is the pane a person looks at:
  // the notice every place of the plugin shows when OATS cannot be read, whole. The TAB beside a thread draws none:
  // that thread's own line says the notice, with the one Retry (the second review round of the T3 change).
  // The roster is the last one read and this panel has read nothing yet (an agent opened meanwhile): the same rule as
  // below, before its first read lands: the page says the notice with the roster's age (none where it was never read:
  // `failure.at` is null); the tab beside a thread draws none.
  if (failure !== null && read.data === undefined) return page ? <Unreadable failure={failure} machine={failure.machine} at={failure.at ?? undefined} now={now} onRetry={again} /> : read.status === "loading" ? <Loading>Reading…</Loading> : null;
  // The ROSTER is the last one read, and the panel keeps what it read. The notice stands ONCE, in the pane a person
  // is looking at (the lead's T3). Beside a thread that is the thread's own line: the panel draws none and only holds
  // its buttons. On an agent's page the panel is that pane: the notice every place shows, whole, with the age of what
  // is shown and that the acts are off (the sidebar beside it then says one line).
  if (failure !== null) return page ? <Unreadable failure={failure} machine={failure.machine} at={read.data?.at} now={now} onRetry={again} /> : null;
  const kept = read.data !== undefined;
  return (
    // The INSTANCE's own read failed (the roster reads): one drawing, with or without something read earlier under it: with it, how old that is, once.
    <Notice title={kept ? "This instance could not be read again" : "This instance could not be read"} tone="error" code={codeOf(refusal)} details={[refusal]} {...(read.data === undefined ? {} : { age: readAge(read.data.at, now) })} actions={<Button onClick={again}>{read.fetching ? "Reading…" : "Retry"}</Button>} />
  );
}

function InstancePage({ oats, agent, read, now, state: readState, status, held, reading, unread }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode; status: AgentState; /** the roster is the last one read: the acts are held */ held: boolean; /** behind a result that says the agent changed: what it asked BEFORE the act is not drawn under a "Reading…" header */ reading: boolean; /** the roster cannot be read: the parts below draw no Retry of their own and their Refresh and Load are off (ONE Retry on a screen: the notice's) */ unread: boolean }) {
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
      {claim === null || reading ? null : (
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
      {facts === undefined ? null : <InstanceFacts oats={oats} facts={facts} state={status} running={agent.running} lost={agent.sessionEnd === "lost"} instance={agent.instance} startedAt={agent.startedAt ?? null} now={now} held={held} />}
      <Readiness instance={agent.instance} of="instance" context={answerRoot === null ? null : { name: agent.instance, root: answerRoot }} now={now} unread={unread} />
      {/* The header's claim is the roster's; a recorded activity that names a newer one asks for the roster again. */}
      <Activity instance={agent.instance} claimSince={agent.waiting?.since ?? null} onNewerClaim={oats.retry} now={now} unread={unread} />
    </>
  );
}

/** `state` is the state the header says: what OATS says of an unreachable session is said there, once, and an agent that does not run was last started, not started. */
function InstanceFacts({ oats, facts, state, running, lost, instance, startedAt, now, held }: { oats: Roster; facts: PanelInstance; /** the page's acts are off (the roster is the last one read, or it reads "Reading…"): so is Terminal, over the attach command */ held: boolean; state: AgentState; /** the kernel's row says its session was lost (`sessionEnd: "lost"`): nobody stopped it */ lost: boolean; /** the kernel's own word of the roster's row, as `state` is read from it */ running: Agent["running"]; instance: string; /** the roster's own time of the session's last start: a stop recorded before it is not this stop */ startedAt: string | null; now: number }) {
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
                <Fact label={state === "outside" ? outsideWords.OUTSIDE_STOPPED_FACT : "Stopped"}>
                  <span data-testid="oats-panel-stopped">{stopped}</span>
                </Fact>
              )}
            </Facts>
            {/* An agent on tmux has no thread in bb: where its session is and how to reach it, in one sentence and one command to copy (the home's card of such an agent gives the same command). Only while the kernel itself says it runs (`running: true`; it works, or it waits on a person): a stopped one has no session, and for one the kernel cannot reach, or says nothing of, `oats session attach` refuses, also when such an agent still carries a claim. */}
            {attachOffered(where?.where === "tmux session", running, state) ? (
              <div data-testid="oats-panel-attach" className="flex min-w-0 flex-col gap-1">
                {/* bb's own Terminal tab, attached to its session (app/terminal): the command to copy stays under it, for a person's own terminal. */}
                <TerminalButton instance={instance} held={held} />
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
            // (A relative's link over it is a target as high as a finger needs, taken back from its line: at a phone's width the fold stands clear of it.)
            <div className="pt-2 md:pt-0">
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
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function SoulPage({ oats, agent, read, now, state: readState, unread }: { oats: Roster; agent: Agent; read: InstanceRead; now: number; state: ReactNode; /** the roster cannot be read: see `InstancePage` */ unread: boolean }) {
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
      <SoulBody read={soul} now={now} unread={unread} />
      {/* The agents root is said where it explains something: what the readiness checks observed (the fold of Readiness: "Soul: <key> · <agents root>"). No fold of its own at the tab's foot. */}
      {key === null ? null : <Readiness instance={agent.instance} of="soul" context={answer?.agentsRoot == null ? null : { name: key, root: answer.agentsRoot }} now={now} unread={unread} />}
    </>
  );
}
