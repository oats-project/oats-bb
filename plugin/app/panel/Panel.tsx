// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
// Drawn with the patterns of app/ui.tsx; its own parts are in parts.tsx.
import { useSyncExternalStore } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AgentTabProps } from "../home/agent-tab";
import type { PanelInstance } from "../../kernel/panel-instance";
import type { Agent, AgentState, Node } from "../../model/types";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { agentStatus } from "../roster/status";
import { onWindowReset } from "../store";
import type { Read, Result } from "../store";
import { Button, Card, Fact, Facts, LINK, Loading, Notice, Section, Stale, StatusLine, TARGET, Tabs, plainClick } from "../ui";
import type { TabItem } from "../ui";
import { shown } from "../ui/text";
import { instanceDisplayName, readAge, waitingLabel, waitingSince } from "../ui/words";
import { openSoul } from "../workspace/pages";
import { Code, Fold, PathLine, Tag } from "./parts";
import { useInstanceRead, useNow } from "./read";
import { SHARED_TITLE, ageText, driftLines, harnessName, modelFromText, runtimeErrorLine, sessionLine, sharedWork, shortAge, workFolder, workSentence } from "./words";

type InstanceAnswer = Result<"panelInstance">;
type InstanceRead = Read<InstanceAnswer> & { retry(): void; fetching: boolean };
type Ready = Extract<Oats, { phase: "ready" }>;

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
/** Shows one of the panel's tabs, from anywhere: an open panel turns to it, and the next one opens on it. */
export function showPanelTab(tab: TabId): void {
  if (shownTab === tab) return;
  shownTab = tab;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const useShownTab = (): TabId => useSyncExternalStore(subscribe, () => shownTab, () => shownTab);
onWindowReset(() => showPanelTab("instance"));

/** The panel as the plugin's fixed thread tab shows it on an agent's own thread. */
export function AgentTab({ threadId }: AgentTabProps) {
  return <InstancePanel threadId={threadId} />;
}

/** The state to draw for an agent with no bb thread: the kernel's word alone. */
function stateWithoutThread(agent: Agent): AgentState {
  if (agent.runtimeState === "unreachable") return "unreachable";
  if (agent.runtimeState === "stopped" || agent.running === false) return "stopped";
  if (agent.runtimeState === "shell") return "error";
  return agent.running === true ? "working" : "idle";
}

/**
 * The panel of one agent: by its thread (an agent's thread in bb) or by its instance name (an
 * agent with no thread). Draws nothing while the roster is not read, or for a thread or a name
 * that is no agent's: the caller then shows what it shows without an agent.
 */
export function InstancePanel({ threadId, instance }: { threadId?: string; instance?: string }) {
  const oats = useOats();
  const tab = useShownTab();
  if (oats.phase !== "ready") return null;
  const node = threadId !== undefined ? oats.nodeByThread.get(threadId) : instance !== undefined ? oats.nodeByInstance.get(instance) : undefined;
  const agent = node?.agent ?? (instance === undefined ? undefined : oats.agents.find((candidate) => candidate.instance === instance));
  if (agent === undefined) return null;
  return (
    <div data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div className="shrink-0 px-3">
        <Tabs label="Instance context" tabs={TABS} value={tab} onChange={showPanelTab} panelId={PANEL_ID} />
      </div>
      {/* One instance at a time: another agent starts from its own read. */}
      <Pages key={agent.instance} oats={oats} agent={agent} node={node} tab={tab} />
    </div>
  );
}

function Pages({ oats, agent, node, tab }: { oats: Ready; agent: Agent; node: Node | undefined; tab: TabId }) {
  const read = useInstanceRead("panelInstance", agent.instance);
  const now = useNow();
  return (
    <div role="tabpanel" id={PANEL_ID} data-testid={`oats-panel-page-${tab}`} aria-labelledby={`${PANEL_ID}-tab-${tab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
      {tab === "instance" ? <InstancePage oats={oats} agent={agent} node={node} read={read} now={now} /> : <SoulPage oats={oats} agent={agent} read={read} now={now} />}
    </div>
  );
}

/** A refusal as the server words it, `<code>: <message>`: the code apart, to be drawn after the words. */
function refusalParts(error: string): { code: string | null; message: string } {
  const lead = /^([A-Z][A-Z0-9_]*): ([\s\S]*)$/.exec(error);
  return lead === null ? { code: null, message: error } : { code: lead[1]!, message: lead[2]! };
}

/** What a read that is not there yet, or failed, says in a tab: nothing when the read is there and current. */
function ReadState({ read, now }: { read: InstanceRead; now: number }) {
  if (read.status === "loading") return <Loading>Reading this instance…</Loading>;
  if (read.status !== "error") return null;
  const { code, message } = refusalParts(read.error);
  const retry = <Button onClick={read.retry}>Retry</Button>;
  // A failed reread keeps what was read, and says how old it is.
  if (read.data !== undefined) {
    return <Stale age={readAge(read.data.at, now)} refreshing={read.fetching} held={`It could not be read again${code === null ? "" : ` (${code})`}.`} action={retry} />;
  }
  return (
    <Notice title="This instance could not be read" tone="error" code={code} actions={retry}>
      <Fold summary="Details" testId="oats-panel-refusal">
        <p className="m-0 break-words text-muted-foreground">{shown(message)}</p>
      </Fold>
    </Notice>
  );
}

function InstancePage({ oats, agent, node, read, now }: { oats: Ready; agent: Agent; node: Node | undefined; read: InstanceRead; now: number }) {
  const facts = read.data?.facts;
  // A claim is shown unless the agent is stopped: one that waits on a person is idle in bb, and a
  // stopped agent's claim belongs to a session that ended.
  const claim = agent.waiting !== null && agent.running !== false ? agent.waiting : null;
  const drawn = node === undefined ? stateWithoutThread(agent) : agentStatus(agent, node.thread, now).state;
  // The header never says "Needs you" for a wait the panel does not show.
  const state = drawn === "needs-you" && claim === null && node?.thread.hasPendingInteraction !== true ? stateWithoutThread(agent) : drawn;
  // Since when: for an agent that waits, how long it has waited; for one that runs, since its last start.
  const since = state === "needs-you" && claim !== null ? waitingSince(claim.since, now) : agent.running === true ? shortAge(facts?.startedAt ?? null, now) : null;
  const drift = facts === undefined ? null : driftLines(facts.drift);
  const soul = shown(oats.soulOf(agent));
  return (
    <>
      <header data-testid="oats-panel-header" className="flex min-w-0 flex-col gap-1">
        <h2 data-testid="oats-panel-name" title={agent.instance} className="m-0 min-w-0 break-words text-base font-semibold">
          {instanceDisplayName(shown(agent.instance))}
        </h2>
        <div data-testid="oats-panel-state" title={agent.running === true && facts?.startedAt ? `started ${facts.startedAt}` : undefined}>
          <StatusLine state={state} since={since} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span>instance of</span>
          <button type="button" data-testid="oats-panel-soul-link" title={`${soul}: show the Soul tab`} className={`${TARGET} ${LINK} inline-flex min-w-0 items-center break-all text-foreground`} onClick={() => showPanelTab("soul")}>
            {soul}
          </button>
        </div>
        {drift === null ? null : (
          <Fold summary={<span className="rounded border border-border px-1.5 py-0.5 text-xs">older build</span>} testId="oats-panel-drift">
            <div className="flex flex-col gap-0.5 pb-1 text-muted-foreground">
              {drift.map((line, index) => (
                <span key={index}>{shown(line)}</span>
              ))}
            </div>
          </Fold>
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

      <ReadState read={read} now={now} />
      {facts === undefined ? null : <InstanceFacts oats={oats} facts={facts} now={now} />}
    </>
  );
}

function InstanceFacts({ oats, facts, now }: { oats: Ready; facts: PanelInstance; now: number }) {
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
          <Card testId="oats-panel-work-card">
            <p data-testid="oats-panel-work-sentence" className="m-0 leading-relaxed">
              {sentence.map((part, index) => (typeof part === "string" ? <span key={index}>{part}</span> : <Code key={index}>{part.code}</Code>))}
            </p>
            <Fold summary="Paths" testId="oats-panel-paths" className="border-t border-border pt-1">
              <div className="pb-1">
                <Facts>
                  <Fact label="Folder">
                    <PathLine
                      path={workFolder(facts.home)}
                      copyLabel="Copy folder path"
                      testId="oats-panel-folder"
                      tag={sharedWork(facts.work) ? <Tag title={SHARED_TITLE}>shared</Tag> : undefined}
                    />
                  </Fact>
                  <Fact label="Home">
                    <PathLine path={facts.home} copyLabel="Copy home path" testId="oats-panel-home" />
                  </Fact>
                </Facts>
              </div>
            </Fold>
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
                    title={facts.startedAt === null ? started : [facts.startedAt, facts.createdAt === null ? null : `created ${facts.createdAt}`].filter(Boolean).join(" · ")}
                  >
                    {ageText(started, now)}
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
              <PathLine path={facts.messagingId} copyLabel="Copy messaging ID" testId="oats-panel-messaging-id" />
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

function SoulPage({ oats, agent, read, now }: { oats: Ready; agent: Agent; read: InstanceRead; now: number }) {
  const navigate = useBbNavigate();
  const answer = read.data;
  const key = answer?.soul.key ?? null;
  const description = answer?.soul.description ?? null;
  return (
    <>
      <header data-testid="oats-panel-soul-header" className="flex min-w-0 flex-col gap-1">
        <h2 data-testid="oats-panel-soul-name" className="m-0 min-w-0 break-words text-base font-semibold">
          {shown(key ?? oats.soulOf(agent))}
        </h2>
        {description === null ? null : (
          <p data-testid="oats-panel-soul-description" className="m-0 break-words text-muted-foreground">
            {shown(description)}
          </p>
        )}
      </header>
      <ReadState read={read} now={now} />
      {answer === undefined || answer.agentsRoot === null ? null : (
        <Fold summary="Details" testId="oats-panel-details" className="border-t border-border pt-1">
          <Facts>
            <Fact label="Agents root">
              <PathLine path={answer.agentsRoot} copyLabel="Copy agents root path" testId="oats-panel-agents-root" />
            </Fact>
          </Facts>
        </Fold>
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
