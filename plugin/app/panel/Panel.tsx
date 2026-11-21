// The instance panel: who an agent is and how it runs, in tabs, as the OATS Desktop's instance
// panel (packages/desktop/renderer/context-panel.mjs). It reads one instance by its name and never
// assumes the agent has a bb thread: the thread only adds the state the tree draws and the links.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Agent, AgentState, Node } from "../../model/types";
import type { PanelInstance } from "../../kernel/panel-instance";
import { STATE_WORD } from "../format";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { agentStatus } from "../roster/status";
import { onWindowReset } from "../store";
import type { Read, Result } from "../store";
import { Button, Dot, ErrorLine, Note, plainClick } from "../ui";
import { shown } from "../ui/text";
import { Card, Code, CopyButton, Facts, PathLine, Section, Tabs, Tag } from "./parts";
import type { TabId } from "./parts";
import { useInstanceRead, useNow } from "./read";
import {
  SHARED_TITLE, ageText, driftLines, harnessName, modelFromText, runtimeErrorLine, sessionLine, sharedWork, stateText, waitingHead, workFolder, workSentence,
} from "./words";

type InstanceAnswer = Result<"panelInstance">;
type Ready = Extract<Oats, { phase: "ready" }>;

/** The tab a person left the panel on, for the length of the app window: another agent opens on it too. */
let lastTab: TabId = "instance";
onWindowReset(() => {
  lastTab = "instance";
});

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
  const [tab, setTab] = useState<TabId>(lastTab);
  if (oats.phase !== "ready") return null;
  const node = threadId !== undefined ? oats.nodeByThread.get(threadId) : instance !== undefined ? oats.nodeByInstance.get(instance) : undefined;
  const agent = node?.agent ?? (instance === undefined ? undefined : oats.agents.find((candidate) => candidate.instance === instance));
  if (agent === undefined) return null;
  const select = (next: TabId) => {
    lastTab = next;
    setTab(next);
  };
  return (
    <div data-testid="oats-panel" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <Tabs selected={tab} onSelect={select} />
      {/* One instance at a time: another agent starts from its own read. */}
      <Pages key={agent.instance} oats={oats} agent={agent} node={node} tab={tab} onSelect={select} />
    </div>
  );
}

function Pages({ oats, agent, node, tab, onSelect }: { oats: Ready; agent: Agent; node: Node | undefined; tab: TabId; onSelect: (tab: TabId) => void }) {
  const read = useInstanceRead("panelInstance", agent.instance);
  const now = useNow();
  return (
    <div
      role="tabpanel"
      id={`oats-panel-page-${tab}`}
      data-testid={`oats-panel-page-${tab}`}
      aria-labelledby={`oats-panel-tab-${tab}`}
      tabIndex={0}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3"
    >
      {tab === "instance" ? <InstancePage oats={oats} agent={agent} node={node} read={read} now={now} onSelect={onSelect} /> : <SoulPage oats={oats} agent={agent} read={read} />}
    </div>
  );
}

/** What a read that is not there yet, or failed, says in a tab: nothing when the read is there and current. */
function ReadState({ read, now }: { read: Read<InstanceAnswer> & { retry(): void }; now: number }) {
  if (read.status === "loading") return <Note>Reading this instance from OATS…</Note>;
  if (read.status !== "error") return null;
  if (read.data === undefined) return <ErrorLine onRetry={read.retry}>{read.error}</ErrorLine>;
  // A failed reread keeps what was read, and says how old it is.
  return (
    <div data-testid="oats-panel-stale" className="flex flex-col gap-1">
      <Note>{`Couldn't read this instance again · showing what was read ${ageText(read.data.at, now)}.`}</Note>
      <ErrorLine onRetry={read.retry}>{read.error}</ErrorLine>
    </div>
  );
}

function InstancePage({
  oats, agent, node, read, now, onSelect,
}: { oats: Ready; agent: Agent; node: Node | undefined; read: Read<InstanceAnswer> & { retry(): void }; now: number; onSelect: (tab: TabId) => void }) {
  const facts = read.data?.facts;
  const status = node === undefined ? null : agentStatus(agent, node.thread, now);
  const drawn = status?.state ?? stateWithoutThread(agent);
  const state = stateText({ running: agent.running, startedAt: facts?.startedAt ?? null }, status?.word ?? STATE_WORD[drawn], now);
  const drift = facts === undefined ? null : driftLines(facts.drift);
  // A claim is shown unless the agent is stopped: one that waits on a person is idle in bb.
  const claim = agent.waiting !== null && agent.running !== false ? agent.waiting : null;
  return (
    <>
      <header data-testid="oats-panel-header" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 data-testid="oats-panel-name" title={agent.instance} className="min-w-0 flex-1 truncate text-base font-semibold">
            {shown(agent.instance)}
          </h2>
          <span data-testid="oats-panel-state" title={state.title ?? undefined} className="flex shrink-0 items-center gap-1.5 text-sm text-foreground">
            <Dot state={drawn} />
            {state.text}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          <span>instance of</span>
          <button
            type="button"
            data-testid="oats-panel-soul-link"
            title={`${shown(oats.soulOf(agent))}: show the Soul tab`}
            className="min-w-0 truncate text-foreground underline"
            onClick={() => onSelect("soul")}
          >
            {shown(oats.soulOf(agent))}
          </button>
        </div>
        {drift === null ? null : (
          <details data-testid="oats-panel-drift" className="text-sm">
            <summary className="w-fit cursor-pointer rounded border border-border px-1.5 text-xs font-semibold text-foreground">older build</summary>
            <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {drift.map((line, index) => (
                <span key={index}>{shown(line)}</span>
              ))}
            </div>
          </details>
        )}
      </header>

      {claim === null ? null : (
        <Section label="Needs input" testId="oats-panel-waiting">
          <p data-testid="oats-panel-waiting-head" className="m-0 font-semibold text-foreground">
            {waitingHead(claim, now)}
          </p>
          {claim.message === null || shown(claim.message) === "" ? null : (
            <p data-testid="oats-panel-waiting-message" dir="auto" className="m-0 break-words text-foreground">
              {shown(claim.message)}
            </p>
          )}
        </Section>
      )}

      <ReadState read={read} now={now} />
      {facts === undefined ? null : <InstanceFacts oats={oats} agent={agent} facts={facts} now={now} />}
    </>
  );
}

function InstanceFacts({ oats, agent, facts, now }: { oats: Ready; agent: Agent; facts: PanelInstance; now: number }) {
  const navigate = useBbNavigate();
  const sentence = workSentence(facts);
  const where = sessionLine(facts);
  const from = modelFromText(facts);
  const started = facts.startedAt ?? facts.createdAt;
  const hasSession = facts.harness !== null || where !== "" || started !== null || facts.runtimeError !== null;
  const instanceLink = (name: string, testId: string) => {
    const thread = oats.nodeByInstance.get(name)?.thread;
    const bbThread = thread === undefined ? undefined : oats.threadById.get(thread.id);
    if (bbThread === undefined) return <span data-testid={testId}>{shown(name)}</span>;
    return (
      <a
        data-testid={testId}
        href={bbThread.href}
        className="underline"
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
        <Section label="Work" testId="oats-panel-work">
          <Card>
            <p data-testid="oats-panel-work-sentence" className="m-0 px-3 py-2.5 leading-relaxed">
              {sentence.map((part, index) => (typeof part === "string" ? <span key={index}>{part}</span> : <Code key={index}>{shown(part.code)}</Code>))}
            </p>
            <details data-testid="oats-panel-paths" className="border-t border-border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Paths</summary>
              <div className="mt-2">
                <Facts
                  rows={[
                    {
                      label: "Folder",
                      testId: "oats-panel-folder-row",
                      value: (
                        <PathLine
                          path={workFolder(facts.home)}
                          copyLabel="Copy folder path"
                          testId="oats-panel-folder"
                          tag={sharedWork(facts.work) ? <Tag title={SHARED_TITLE}>shared</Tag> : undefined}
                        />
                      ),
                    },
                    { label: "Home", testId: "oats-panel-home-row", value: <PathLine path={facts.home} copyLabel="Copy home path" testId="oats-panel-home" /> },
                  ]}
                />
              </div>
            </details>
          </Card>
        </Section>
      )}

      {!hasSession ? null : (
        <Section label="Session" testId="oats-panel-session">
          <Card>
            <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                {facts.harness === null ? null : (
                  <span data-testid="oats-panel-harness" className="font-semibold">
                    {shown(harnessName(facts.harness))}
                  </span>
                )}
                {where === "" ? null : (
                  <span data-testid="oats-panel-session-line" className="min-w-0 break-all font-mono text-xs text-foreground">
                    {shown(where)}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-muted-foreground">
                {facts.model === null ? null : (
                  <span data-testid="oats-panel-model" className="min-w-0 break-words">
                    {from === null ? shown(facts.model) : `${shown(facts.model)} · ${from}`}
                  </span>
                )}
                {started === null ? null : (
                  <span
                    data-testid="oats-panel-started"
                    title={facts.startedAt === null ? started : [facts.startedAt, facts.createdAt === null ? null : `created ${facts.createdAt}`].filter(Boolean).join(" · ")}
                  >
                    {`${facts.startedAt === null ? "created" : "started"} ${ageText(started, now)}`}
                  </span>
                )}
              </div>
              {facts.runtimeError === null ? null : (
                <p data-testid="oats-panel-runtime-error" className="m-0 break-words text-muted-foreground">
                  {shown(runtimeErrorLine(facts.runtimeError))}
                </p>
              )}
            </div>
          </Card>
        </Section>
      )}

      {facts.messagingId === null ? null : (
        <Section label="Messaging & Teams" testId="oats-panel-messaging">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Messaging ID</span>
            <span className="flex min-w-0 items-start gap-2">
              <span data-testid="oats-panel-messaging-id" title={facts.messagingId} className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                {shown(facts.messagingId)}
              </span>
              <CopyButton value={facts.messagingId} label="Copy messaging ID" testId="oats-panel-messaging-id-copy" />
            </span>
          </div>
        </Section>
      )}

      {facts.human === null && facts.parent === null && facts.sibling === null ? null : (
        <Section label="Lineage" testId="oats-panel-lineage">
          <Facts
            rows={[
              { label: "Owning human", testId: "oats-panel-human", value: facts.human === null ? null : shown(facts.human) },
              { label: "Parent", testId: "oats-panel-parent-row", value: facts.parent === null ? null : instanceLink(facts.parent, "oats-panel-parent") },
              { label: "Sibling", testId: "oats-panel-sibling-row", value: facts.sibling === null ? null : instanceLink(facts.sibling, "oats-panel-sibling") },
            ]}
          />
        </Section>
      )}
    </>
  );
}

function SoulPage({ oats, agent, read }: { oats: Ready; agent: Agent; read: Read<InstanceAnswer> & { retry(): void } }) {
  const navigate = useBbNavigate();
  const answer = read.data;
  const key = answer?.soul.key ?? null;
  const description = answer?.soul.description ?? null;
  return (
    <>
      <header data-testid="oats-panel-soul-header" className="flex min-w-0 flex-col gap-1">
        <h2 data-testid="oats-panel-soul-name" title={oats.soulOf(agent)} className="min-w-0 truncate text-base font-semibold">
          {shown(key ?? oats.soulOf(agent))}
        </h2>
        {description === null ? null : (
          <p data-testid="oats-panel-soul-description" className="m-0 break-words text-muted-foreground">
            {shown(description)}
          </p>
        )}
      </header>
      {answer === undefined || answer.agentsRoot === null ? null : (
        <details data-testid="oats-panel-details" className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Details</summary>
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agents root</span>
            <PathLine path={answer.agentsRoot} copyLabel="Copy agents root path" testId="oats-panel-agents-root" />
          </div>
        </details>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          data-testid="oats-panel-open-soul"
          disabled={key === null}
          title={key === null ? "OATS lists no soul of this name here: there is no soul page to open." : "Open this instance's soul on the Souls page"}
          onClick={() => {
            if (key !== null) navigate.toPluginPanel("souls", { subPath: key });
          }}
        >
          Open soul page
        </Button>
      </div>
    </>
  );
}
