// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
// Drawn with the patterns of app/ui.tsx; its own parts are in parts.tsx.
import { useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AgentTabProps } from "../home/agent-tab";
import type { PanelInstance } from "../../kernel/panel-instance";
import { isKernelCode } from "../../kernel/result";
import type { Agent, Node } from "../../model/types";
import { claimOf, state as stateOf } from "../../model/view";
import { failureLine, useOats } from "../oats";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";
import { Button, Card, Chip, Code, Disclosure, Fact, Facts, LINK, Loading, Notice, Section, Stale, StatusLine, TARGET, Tabs, plainClick } from "../ui";
import type { TabItem } from "../ui";
import { shown } from "../ui/text";
import { instanceDisplayName, readAge, waitingLabel, waitingSince } from "../ui/words";
import { openSoul } from "../workspace/pages";
import { Activity } from "./Activity";
import { PathLine, SoulMark } from "./parts";
import { Readiness } from "./Readiness";
import { contextLine } from "./readiness-words";
import { useNow, usePanelInstance, usePanelSoul } from "./read";
import type { PanelRead } from "./read";
import { SoulBody } from "./SoulBody";
import { codeOf } from "./state";
import { SHARED_TITLE, ageText, driftLines, harnessName, modelFromText, runtimeErrorLine, sessionLine, sharedWork, shortAge, workFolder, workSentence } from "./words";

type InstanceRead = PanelRead<"panelInstance">;
/** What the panel reads of the roster beside its agent: the souls' names, and the threads its links go to. */
type Roster = Pick<Oats, "soulOf" | "threadById"> & { nodeByInstance: ReadonlyMap<string, Node> };
/** The agent a panel shows, and for which thread or name it is shown. */
type Shown = { key: string; agent: Agent; node: Node | undefined };
const NO_NODES: ReadonlyMap<string, Node> = new Map();
/** The roster could not be read again: what it said, and the way to ask again. */
type RosterFailure = { code: string; line: string; retry(): void };

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
  const held = last.current;
  // Another thread or name than the one held: nothing of that agent is known yet.
  if (held === null || held.key !== key) return null;
  const roster: Roster = { soulOf: oats.soulOf, threadById: oats.threadById, nodeByInstance: oats.phase === "ready" ? oats.nodeByInstance : NO_NODES };
  // OATS cannot be read: never (no roster), or not again (the roster is the last one read).
  const unread = oats.phase === "failed" ? oats : oats.phase === "ready" ? oats.stale : null;
  const failure: RosterFailure | null = unread === null ? null : { code: unread.code, line: failureLine(unread), retry: oats.retry };
  return (
    <div data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div className="shrink-0 px-3">
        <Tabs label="Instance context" tabs={TABS} value={tab} onChange={showPanelTab} panelId={PANEL_ID} />
      </div>
      {/* One instance at a time: another agent starts from its own read. */}
      <Pages key={held.agent.instance} oats={roster} agent={held.agent} node={held.node} tab={tab} failure={failure} />
    </div>
  );
}

function Pages({ oats, agent, node, tab, failure }: { oats: Roster; agent: Agent; node: Node | undefined; tab: TabId; failure: RosterFailure | null }) {
  const read = usePanelInstance(agent.instance);
  const now = useNow();
  const state = <ReadState read={read} now={now} failure={failure} />;
  return (
    <div role="tabpanel" id={PANEL_ID} data-testid={`oats-panel-page-${tab}`} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
      {tab === "instance" ? <InstancePage oats={oats} agent={agent} node={node} read={read} now={now} state={state} /> : <SoulPage oats={oats} agent={agent} read={read} now={now} state={state} />}
    </div>
  );
}

/**
 * What the panel says when what it shows is not a current read: the read in flight, a first read
 * that failed, or (the roster's failure first: it is why the instance cannot be read either) what
 * was read earlier, with its age. Nothing when the read is there and current.
 */
function ReadState({ read, now, failure }: { read: InstanceRead; now: number; failure: RosterFailure | null }) {
  const refusal = failure !== null ? failure.line : read.status === "error" ? read.error : null;
  const code = failure !== null ? (isKernelCode(failure.code) ? failure.code : null) : refusal === null ? null : codeOf(refusal);
  // Retry asks for the roster again where that is what failed, and for the instance in either case:
  // the server answers it from the roster it holds then, and says when a newer one lands.
  const again = () => {
    failure?.retry();
    read.retry();
  };
  const retry = <Button onClick={again}>Retry</Button>;
  if (refusal === null) return read.status === "loading" ? <Loading>Reading this instance…</Loading> : null;
  // A failed reread keeps what was read, and says how old it is.
  if (read.data !== undefined) {
    return <Stale age={readAge(read.data.at, now)} refreshing={read.fetching} held={`${failure === null ? "It" : "OATS"} could not be read again${code === null ? "" : ` (${code})`}.`} action={retry} />;
  }
  return <Notice title={failure === null ? "This instance could not be read" : "OATS could not be read"} tone="error" code={code} details={refusal} actions={retry} />;
}

function InstancePage({ oats, agent, node, read, now, state: readState }: { oats: Roster; agent: Agent; node: Node | undefined; read: InstanceRead; now: number; state: ReactNode }) {
  const facts = read.data?.facts;
  const answerRoot = read.data?.agentsRoot ?? null;
  const claim = claimOf(agent);
  // The one rule for a state (model/view.ts `state`, over the one gate for a claim), read as the
  // sidebar's and the thread's rows read it; an agent with no bb thread has none to give it.
  const state = stateOf(agent, node?.thread ?? null);
  // Since when: for an agent that waits, how long it has waited; for one that runs, since its last start.
  // An agent that needs you for a question bb shows, with no claim, has no instant to count from.
  const since = state === "needs-you" ? (claim === null ? null : waitingSince(claim.since, now)) : state === "working" ? shortAge(facts?.startedAt ?? null, now) : null;
  const drift = facts === undefined ? null : driftLines(facts.drift);
  const soul = shown(oats.soulOf(agent));
  return (
    <>
      <header data-testid="oats-panel-header" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <SoulMark soul={oats.soulOf(agent)} />
          <h2 data-testid="oats-panel-name" title={shown(agent.instance)} className="m-0 min-w-0 break-words text-base font-semibold">
            {instanceDisplayName(shown(agent.instance))}
          </h2>
        </div>
        <div data-testid="oats-panel-state" title={state === "working" && facts?.startedAt ? shown(`started ${facts.startedAt}`) : undefined}>
          {/* The Desktop's word for an agent that runs; every other state says its own word, as the tree does. */}
          <StatusLine state={state} word={state === "working" ? "Running" : undefined} since={since} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span>instance of</span>
          <button type="button" data-testid="oats-panel-soul-link" title={`${soul}: show the Soul tab`} className={`${TARGET} ${LINK} inline-flex min-w-0 items-center break-all text-foreground`} onClick={() => showPanelTab("soul", { focus: true })}>
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

      {claim === null ? null : (
        <Section title="Needs input" testId="oats-panel-waiting">
          <p data-testid="oats-panel-waiting-head" className="m-0 font-semibold text-foreground">
            {[waitingLabel(claim), waitingSince(claim.since, now)].filter((part) => part !== null).join(" · ")}
          </p>
          {claim.message === null || shown(claim.message) === "" ? null : (
            <p data-testid="oats-panel-waiting-message" dir="auto" className="m-0 break-words text-foreground">
              {shown(claim.message)}
            </p>
          )}
        </Section>
      )}

      {readState}
      {facts === undefined ? null : <InstanceFacts oats={oats} facts={facts} now={now} />}
      <Readiness instance={agent.instance} of="instance" context={answerRoot === null ? null : contextLine("instance", agent.instance, answerRoot)} now={now} />
      <Activity instance={agent.instance} now={now} />
    </>
  );
}

function InstanceFacts({ oats, facts, now }: { oats: Roster; facts: PanelInstance; now: number }) {
  const navigate = useBbNavigate();
  const sentence = workSentence(facts);
  const where = sessionLine(facts);
  const from = modelFromText(facts);
  const started = facts.startedAt ?? facts.createdAt;
  const hasSession = facts.harness !== null || where !== "" || started !== null || facts.runtimeError !== null;
  /** Another instance, by its name: a link to its thread where it has one in bb. */
  const instanceLink = (name: string, testId: string) => {
    const thread = oats.nodeByInstance.get(name)?.thread;
    const bbThread = thread === undefined ? undefined : oats.threadById.get(thread.id);
    if (bbThread === undefined) return <span data-testid={testId}>{shown(name)}</span>;
    return (
      <a
        data-testid={testId}
        href={bbThread.href}
        className={`${TARGET} ${LINK} inline-flex items-center`}
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          navigate.toThread(bbThread.id);
        }}
      >
        {shown(name)}
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
              {where === "" ? null : (
                <Fact label="Runs in">
                  <span data-testid="oats-panel-session-line" className="break-all font-mono text-xs">
                    {shown(where)}
                  </span>
                </Fact>
              )}
              {started === null ? null : (
                <Fact label={facts.startedAt === null ? "Created" : "Started"}>
                  <span
                    data-testid="oats-panel-started"
                    title={shown(facts.startedAt === null ? started : [facts.startedAt, facts.createdAt === null ? null : `created ${facts.createdAt}`].filter(Boolean).join(" · "))}
                  >
                    {shown(ageText(started, now))}
                  </span>
                </Fact>
              )}
            </Facts>
            {facts.runtimeError === null ? null : (
              <p data-testid="oats-panel-runtime-error" className="m-0 break-words text-muted-foreground">
                {shown(runtimeErrorLine(facts.runtimeError))}
              </p>
            )}
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

      {facts.human === null && facts.parent === null && facts.sibling === null ? null : (
        <Section title="Lineage" testId="oats-panel-lineage">
          <Facts>
            {facts.human === null ? null : (
              <Fact label="Owning human">
                <span data-testid="oats-panel-human">{shown(facts.human)}</span>
              </Fact>
            )}
            {facts.parent === null ? null : <Fact label="Parent">{instanceLink(facts.parent, "oats-panel-parent")}</Fact>}
            {facts.sibling === null ? null : <Fact label="Sibling">{instanceLink(facts.sibling, "oats-panel-sibling")}</Fact>}
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
      {key === null ? null : <Readiness instance={agent.instance} of="soul" context={answer?.agentsRoot == null ? null : contextLine("soul", key, answer.agentsRoot)} now={now} />}
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
