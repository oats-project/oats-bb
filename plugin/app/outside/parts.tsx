// What the places draw of this feature: the acts of a line, the kernel's report as a notice, and
// the thread's own row of an agent whose thread bb has archived. Drawn with the patterns of
// app/ui.tsx; the acts go through OATS (app/lifecycle/acts.tsx).
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { hasAgentPage, openAgentPage } from "../home/agent-tab";
import { AgentActs, actsFor, openAct } from "../lifecycle";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { useNow } from "../roster/now";
import { agentStatus } from "../roster/status";
import { ReadingLine, useReading } from "../roster/reading";
import { Unreadable } from "../roster/unreadable";
import { Button, Disclosure, StatusLine } from "../ui";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import type { Agent, AgentState, ThreadWhere } from "../../model/types";
import { said as sayOf } from "./say";
import type { Act, Said } from "./say";
import type { Outside } from "./use";
import { LOST_ARCHIVED, MAY_RUN_NOTE, MESSAGE_CONTINUES, LOST_NOTE, OUTSIDE_NEEDS, OUTSIDE_WHAT, OUTSIDE_WHAT_STOP, STOPPED_OPEN_ASKING } from "./words";

/** On a button: with the dots, since each opens its dialog and nothing runs on the press. */
const BUTTON: Record<Act, string> = { stop: "Stop…", start: "Start…", retire: "Retire…" };

/**
 * The acts this feature itself offers for an agent, as buttons, in order. Each opens the
 * lifecycle's own dialog for that act (`openAct`, app/lifecycle): the kernel is asked first and
 * nothing runs on one press. Never a second path to `oats`. `held`: the roster is the last one
 * read, and the acts stay in their place, off (the Desktop's rule); the notice on the same screen says why.
 */
export function OutsideActs({ instance, acts, held, primary }: { instance: string; acts: readonly Act[]; held: boolean; /** the one of them that is the primary act, where a place says which a person wants (the kernel's report: Stop) */ primary?: Act | undefined }) {
  return (
    <>
      {acts.map((act) => (
        <Button key={act} data-testid="oats-status-act" data-act={act} {...(act === primary ? { variant: "primary" as const, "data-primary": "" } : {})} disabled={held} onClick={() => openAct(act, instance)}>
          {BUTTON[act]}
        </Button>
      ))}
    </>
  );
}

/** The state each reason is said after: `said()` reads the agent's state without bb's own question on its thread. */
const AFTER: Partial<Record<Said["kind"], AgentState>> = { "stopped-open": "stopped", "lost-open": "stopped", "lost-tmux": "stopped", "stopped-archived": "stopped", "lost-archived": "stopped", deleted: "stopped", "idle-unloaded": "idle", "failed-open": "error", outside: "outside" };

/**
 * Whether a reason belongs on a line or a row that draws `state`: the reason follows ONE state,
 * and `said()` reads the agent's state without bb's own question on its thread. Where bb holds one,
 * the place says "Needs you", and a reason made for "Stopped" or "Idle" has no place after it. One
 * reason holds there too: a stop that warns, whose warning is about a message typed in that thread.
 */
const follows = (said: Said, state: AgentState): boolean => AFTER[said.kind] === undefined || AFTER[said.kind] === state || said.kind === "stopped-open";

/**
 * The acts of a status line where this feature has something to say of the agent: the buttons
 * (for the kernel's report: Stop… and Start…, the line's own acts);
 * undefined where the line keeps the roster's own act for the state: this feature has no acts for
 * it, or the line's state is not the one the reason follows (the sentence that names the act is
 * then not on the line).
 */
export function lineActs(said: Said | null, instance: string, held: boolean, state: AgentState): ReactNode | null | undefined {
  if (said === null || said.acts === null || !follows(said, state)) return undefined;
  if (said.warning !== null) return <OutsideActs instance={instance} acts={reportActs(said)} held={held} primary={REPORT_PRIMARY} />;
  return <OutsideActs instance={instance} acts={said.acts} held={held} />;
}

/**
 * What a sidebar's row says after the state's word, in the soul's place, and whether its mark is in
 * the warning tone: the reason, where the row's state is the one it follows; null (the soul, the
 * state's own mark) where it is not ("Needs you · session lost" is no sentence), and where this
 * feature has nothing to say.
 */
export function rowParts(said: Said | null, state: AgentState): { note: string | null; tone: "warning" | undefined } {
  if (said === null || !follows(said, state)) return { note: null, tone: undefined };
  return { note: said.note, tone: said.rowTone === "warning" ? "warning" : undefined };
}

/**
 * Whether the sidebar's row of an agent is drawn in the warning tone by this feature: a process
 * may run with no thread a person can see (its thread archived in bb while it ran; its session
 * lost with its thread archived), or its thread was deleted in bb. For the roster's fold: a
 * closed parent carries a mark for such a row inside it. Never for an operator's stop with its
 * thread archived (plain: nothing is wrong), nor an idle child. By the row's own rule (`rowParts`),
 * so that the parent's mark and the row's never disagree.
 */
export const rowWarns = (said: Said | null, state: AgentState): boolean => rowParts(said, state).tone === "warning";

/**
 * What a ROW draws in the state's place and after it (the sidebar's row, bb's drawer, the home's
 * rows), from the state's own word and the row's reason (`rowParts`' note). ONE case has a word of
 * its own: a stopped agent whose reason is "session lost" reads **Lost** (the kernel's own word:
 * `sessionEnd: "lost"`), with no reason after it: on a row "session lost" then needs no room, and
 * is never the part that must fit or leave (the lead's L17, 24 Nov 2026: on a roster whose host
 * was restarted every row is lost, and a row is too narrow for the reason). Nothing else gets a
 * word in the state's place. The agent's STATE is untouched: it is stopped (its mark, Start, its
 * place in the order); and the thread's line, the agent's page and the row's own title keep
 * "Stopped · session lost" (`title`: the words the title says, whole).
 * A lost session whose thread bb archived or deleted has another reason on its row ("may still
 * run", "deleted in bb", in the warning tone): that is what needs a person, so its row reads
 * "Stopped" and that reason, never "Lost".
 */
export const LOST_WORD = "Lost";
export function rowWords(word: string, state: AgentState, note: string | null): { state: string; reason: string | null; title: { state: string; reason: string | null } } {
  // (A row that says "may still run" says in its title the whole of it: where its thread is, too.)
  const title = { state: word, reason: note === MAY_RUN_NOTE ? LOST_ARCHIVED : note };
  return state === "stopped" && note === LOST_NOTE ? { state: LOST_WORD, reason: null, title } : { state: word, reason: note, title };
}

/**
 * What a status line says after the state's word, where this feature has a reason for it: the
 * reason, or the sentence that keeps a person from harm, and whether the line warns. `status` is
 * the roster's own (`agentStatus`). When OATS recorded a stop is a fact of the instance panel.
 * - the kernel's report: "stopped in OATS";
 * - where a MESSAGE is the way on (`said.message`): the reason, then "message to continue";
 * - any other reason, on a line whose state is the one the reason follows: the reason;
 * - a line whose state is another (bb holds a question on the thread, so it says "Needs you"): the
 *   roster's own words, which say what the agent asks. But for a stop that warns, where an answer
 *   typed in the thread is the message that starts the agent without OATS: the warning, saying
 *   first what OATS recorded;
 * - none: the roster's own.
 */
export function lineParts(said: Said | null, status: { state: AgentState; since: string | null; detail: string | null }): { since: string | null; detail: string | null; tone: "warning" | undefined; markTone?: "warning" | null } {
  const own = { since: status.since, detail: status.detail, tone: undefined };
  if (said === null || said.sentence === null) return own;
  const tone = said.tone === "warning" ? "warning" : undefined;
  // The MARK has one colour for an agent: the one its row in the sidebar draws (`rowParts`). A
  // stopped agent whose live composer warns has the state's own grey mark on its line as on its
  // row, and the SENTENCE beside it keeps the warning tone (the lead's P9, 24 Nov 2026).
  const markTone = rowParts(said, status.state).tone ?? null;
  if (said.kind === "stopped-open" && status.state !== "stopped") return { since: null, detail: STOPPED_OPEN_ASKING, tone, markTone };
  if (!follows(said, status.state)) return own;
  // Where a message is the way on: the reason, then "message to continue", each a part of the
  // line with its own separator ("Stopped · session lost · message to continue"). No time before
  // them: none of the three says since when.
  if (said.message) return { since: said.sentence, detail: MESSAGE_CONTINUES, tone, markTone };
  // A lost session has no time: the kernel records none of the loss (never "lost since").
  if (said.kind === "lost-open" || said.kind === "lost-tmux") return { since: null, detail: said.sentence, tone, markTone };
  return { since: status.since, detail: said.sentence, tone, markTone };
}

/**
 * The acts of an agent the roster draws on no thread (its thread archived in bb), for the place
 * that shows that agent and has no acts of its own (its archived thread's row): the lifecycle's own
 * buttons for its state (`AgentActs`: Start and Retire for a stopped agent). Where a process runs,
 * or may, with no thread a person can see, the acts are this feature's: a session lost to bb's
 * Archive and an agent archived while its row still says it runs (Stop, then Retire; Start comes
 * once it is stopped), and the kernel's report, whose Stop and Start are in its notice (Retire
 * alone is here).
 */
export function DetachedActs({ said, instance, held }: { said: Said | null; instance: string; held: boolean }) {
  if (said !== null && said.warning !== null) return <OutsideActs instance={instance} acts={["retire"]} held={held} />;
  if (said !== null && (said.kind === "lost-archived" || said.kind === "running-archived")) return <OutsideActs instance={instance} acts={["stop", "retire"]} held={held} />;
  return <AgentActs instance={instance} />;
}

/**
 * What the home's card of an agent that runs outside OATS says it needs, under its line: the two
 * steps ("Stop, then Start."), where the lifecycle offers both for it (an agent on bb); null for
 * an agent of another session provider, whose one act is Stop (nobody reads "Start" with nothing
 * to press: its Details says what Stop does), and where the kernel reports nothing.
 */
export const outsideNeeds = (said: Said | null): string | null => (said !== null && said.warning !== null && reportActs(said).includes("start") ? OUTSIDE_NEEDS : null);

/** The two acts the kernel's report names, the primary one first. */
const BOTH = ["stop", "start"] as const;
/**
 * Of the two, the one that brings the agent back under OATS: Stop (words.ts `OUTSIDE_NEEDS`: it
 * always works; Start… begins a new conversation and is refused while the outside thread is in a
 * turn). Drawn as the primary button where THIS feature draws the two side by side: the thread's
 * line, the home's card, and its own block while the header has none. (The agent's page and the
 * panel draw them in their header, the lifecycle's `AgentActs`: plain buttons, no primary.)
 */
const REPORT_PRIMARY: Act = "stop";

/** The acts the kernel's report names, for the agent's session provider: the lifecycle starts an agent on bb or on tmux, and the report is never a tmux agent's, so another provider's has Stop alone (nothing is named that cannot be pressed). */
const reportActs = (said: Said): Act[] => (said.warning !== null && said.warning.backend === "bb" ? ["stop", "start"] : ["stop"]);

/**
 * Under a line that says "Running outside OATS · stopped in OATS" (the kernel's report that a
 * harness runs in a home OATS recorded stopped): no box and no title, which would repeat the line.
 * ONE fold, "Details", as under an Unreachable line: what happened and what to do in a person's
 * words, then the kernel's own code and sentence, through the display filter. No command is on
 * screen: Stop… and Start… do the same, and they are the LINE's own acts (`lineActs`). The mark
 * and "stopped in OATS" keep the warning tone. (The text audit, T21 to T24, as ruled 23 Nov 2026.)
 * `own`: the acts this draws a button of its own for, over the fold, in a place whose line has no
 * acts of its own for them (the instance panel, while no roster is read and its header offers none).
 * Nothing where the kernel reports nothing.
 * The lifecycle starts an agent on bb or on tmux, and the report is never a tmux agent's (the
 * kernel reports it of a provider home): for an agent of another session provider the fold
 * names Stop alone (`reportActs`), so that nothing is named that cannot be pressed.
 */
export function OutsideWarning({ said, instance, held, own = [], fold = true }: { said: Said | null; instance: string; held: boolean; own?: readonly Act[]; /** false: the fold is drawn elsewhere, under the state it explains (the agent's page: `OutsideAgentDetails` in its header), and this draws the buttons alone */ fold?: boolean }) {
  if (said === null || said.warning === null) return null;
  const acts = own.filter((act) => reportActs(said).includes(act));
  if (!fold && acts.length === 0) return null;
  return (
    <div data-testid="oats-outside-warning" data-instance={instance} className="flex min-w-0 flex-col gap-1.5">
      {acts.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <OutsideActs instance={instance} acts={acts} held={held} primary={REPORT_PRIMARY} />
        </div>
      )}
      {fold ? <OutsideDetails said={said} /> : null}
    </div>
  );
}

/**
 * The ONE fold of the kernel's report, "Details": what happened and what to do in a person's
 * words, then the kernel's own code and sentence, through the display filter. Drawn UNDER THE
 * STATE IT EXPLAINS, on every page (the lead's read of 24 Nov 2026, P19): under the thread's line
 * and the home card's line (`OutsideWarning`), and under the header's state on the agent's page
 * (`OutsideAgentDetails`). Nothing where the kernel reports nothing.
 */
export function OutsideDetails({ said }: { said: Said | null }) {
  if (said === null || said.warning === null) return null;
  return (
    <Disclosure summary="Details" testId="oats-outside-details">
      <p className="m-0 break-words">{said.warning.backend === "bb" ? OUTSIDE_WHAT : OUTSIDE_WHAT_STOP}</p>
      <p className="m-0 break-words text-xs text-muted-foreground">{shown(`${said.warning.code}: ${said.warning.message}`)}</p>
    </Disclosure>
  );
}

/**
 * The same fold for the place that shows ONE agent and is not its thread (the instance panel, the
 * agent's own page): in its HEADER, under the state's line, where the state it explains is; the
 * block under the tabs (`OutsideAgent`) keeps only an act the header lacks. `roster` is what the
 * place holds of the roster (`Oats`' own `nodeByInstance` and `whereOf`).
 */
export function OutsideAgentDetails({ agent, roster }: { agent: Agent; roster: { nodeByInstance: ReadonlyMap<string, { agent: Agent; thread?: { startFailure?: unknown } }>; whereOf(agent: Agent): ThreadWhere } }) {
  const node = roster.nodeByInstance.get(agent.instance);
  const attached = node?.agent === agent;
  return <OutsideDetails said={sayOf(agent, roster.whereOf(agent), attached, attached ? (node?.thread ?? null) : null)} />;
}

const FRAME = "flex flex-col gap-1.5 border-b border-border px-3 py-2 text-sm text-foreground";

/**
 * The thread's own row on a thread bb has ARCHIVED and that is the recorded thread of an agent of
 * the roster: who the agent is, where it is in words, and the act that applies. The roster draws
 * an agent's row on the thread it lists; an archived thread is none of them, and without this its
 * header would say nothing. Nothing for any other thread.
 */
export function OutsideThreadRow({ threadId, oats, outside }: Pick<ExperimentalThreadHeaderRowProps, "threadId"> & { /** the caller's own `useOats()` and `outsideOf(oats)` */ oats: Oats; outside: Outside }) {
  const navigate = useBbNavigate();
  const now = useNow();
  const agent = outside.agentOn(threadId);
  const reading = useReading(agent?.instance ?? null);
  const status = agent === undefined || oats.phase !== "ready" ? null : agentStatus(agent, null, now);
  const said = agent === undefined ? null : outside.of(agent);
  if (oats.phase !== "ready" || agent === undefined || status === null) return null;
  // (And behind a lifecycle result that says the agent changed, until the roster is read again: app/roster/reading.tsx.)
  const held = oats.stale !== null || reading;
  // The thread's menu is bb's, and the lifecycle's entries in it are for a thread the roster draws
  // an agent on: this thread is none, so the agent's acts are here, Retire among them.
  const acts = <DetachedActs said={said} instance={agent.instance} held={held} />;
  const parts = lineParts(said, { state: status.state, since: status.since, detail: status.detail });
  const buttons = (
    <>
      {acts}
      {hasAgentPage() ? (
        <Button data-testid="oats-open-panel" title="Open this agent's instance panel" onClick={() => void openAgentPage(navigate, agent.instance)}>
          Instance panel
        </Button>
      ) : null}
    </>
  );
  return (
    <div data-testid="oats-identity-row" data-outside={said?.kind ?? ""} className={FRAME}>
      <span data-testid="oats-outside-agent" className="min-w-0 break-words font-semibold">
        {agentName(agent.instance)}
      </span>
      {/* Behind a lifecycle result that says the agent changed, until the roster is read again: "Reading…", never the old state. */}
      {reading ? <ReadingLine action={buttons} /> : <StatusLine state={status.state} word={status.word} since={parts.since} detail={parts.detail} tone={parts.tone} markTone={parts.markTone} action={buttons} />}
      <OutsideWarning said={said} instance={agent.instance} held={held} />
      {oats.stale === null ? null : <Unreadable compact failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />}
    </div>
  );
}

/**
 * What the status line of the place that shows ONE agent and is not its thread (the instance
 * panel's header) says after the state's word, for an agent the roster draws on no thread (on
 * tmux, or its thread archived or deleted in bb): the reason, ON the state's line, as the thread's
 * line and the sidebar's row say it ("Stopped · session lost"); never a line of its own further
 * down the page. An agent on its thread, and one the kernel reports (its notice says it), keep the
 * roster's own words. EVERY reason a row can say is said here, whole: one with a sentence of its own
 * (a lost session, a thread deleted or archived under a stopped agent) by `lineParts`; and one that
 * is only where the thread is ("archived in bb", "deleted in bb", "no bb thread", "thread not shown
 * in bb", of an agent that is not stopped) after the roster's own words ("Failed · session ended ·
 * archived in bb"): a reason that left a narrow row is then whole on the page (the lead's rule;
 * the specialist's word of 24 Nov 2026). `reason`: that reason alone, for a line that says another
 * thing in the detail's place. `kind`: which case this feature read, for the place's `data-outside` (null: none).
 */
export function pageParts(
  agent: Agent,
  roster: { nodeByInstance: ReadonlyMap<string, { agent: Agent; thread?: { startFailure?: unknown } }>; whereOf(agent: Agent): ThreadWhere },
  status: { state: AgentState; since: string | null; detail: string | null },
): { since: string | null; detail: string | null; tone: "warning" | undefined; markTone?: "warning" | null; reason: string | null; kind: Said["kind"] | null; /** the kernel's report, where the page's line is the thread's line of it (its reason, and Stop… and Start… as the line's acts: `pageActs`) */ report: Said | null } {
  const node = roster.nodeByInstance.get(agent.instance);
  const attached = node?.agent === agent;
  // THE KERNEL'S REPORT ("Running outside OATS"): the page's line is the thread's line, on its
  // thread or not: the reason "stopped in OATS" after the state, in the warning tone, and Stop…
  // (the primary act) and Start… as the line's own acts (the lead's T7, the page: 25 Nov 2026).
  // Its Details is under this line (`OutsideAgentDetails`).
  const whole = sayOf(agent, roster.whereOf(agent), attached, attached ? (node?.thread ?? null) : null);
  if (whole !== null && whole.warning !== null && follows(whole, status.state)) return { ...lineParts(whole, status), reason: null, kind: whole.kind, report: whole };
  const said = attached ? null : whole;
  const kind = said !== null ? said.kind : agent.backend !== "tmux" && agent.outsideOats != null ? "outside" : null;
  const parts = lineParts(said !== null && said.warning === null ? said : null, status);
  // A reason with no sentence: where the thread is, as the row says it (the same function), after the roster's own words.
  const row = said !== null && said.warning === null && said.sentence === null ? rowParts(said, status.state) : null;
  if (row === null || row.note === null || row.note === "") return { ...parts, reason: null, kind, report: null };
  return { since: parts.since, detail: [parts.detail, row.note].filter((part) => part !== null && part !== "").join(" · "), tone: row.tone ?? parts.tone, markTone: row.tone ?? null, reason: row.note, kind, report: null };
}

/**
 * The acts of the page's line for the kernel's report (`pageParts`' `report`): Stop… (the primary
 * act) and Start…, as on its thread's line; and `verbs`, the lifecycle's verbs they are, which
 * the header's own row of acts then leaves out (no act is on the page twice). Null where the
 * page's line is not the report's.
 */
export function pageActs(report: Said | null, instance: string, held: boolean): { buttons: ReactNode; verbs: readonly Act[] } | null {
  if (report === null || report.warning === null) return null;
  return { buttons: <OutsideActs instance={instance} acts={reportActs(report)} held={held} primary={REPORT_PRIMARY} />, verbs: reportActs(report) };
}

/**
 * For the place that shows ONE agent and is not its thread (the instance panel: first on its
 * Instance tab's page, under the header that says its state): of an agent the roster draws on no
 * thread whose session OATS lost with its thread archived, Stop, since the header offers none
 * for an agent that reads stopped (what happened is said on the header's status line:
 * `pageParts`). Nothing else: the kernel's report is the header's whole (its reason and its two
 * acts on the status line, `pageParts` and `pageActs`, with the roster read or not; its Details
 * under that line, `OutsideAgentDetails`), so no act is on the page twice and nobody reads "Stop"
 * or "Start" with nothing to press. `roster` is what the place holds of the roster (`Oats`' own
 * `nodeByInstance` and `whereOf`); `held`: the roster is the last one read.
 */
export function OutsideAgent({ agent, roster, held }: { agent: Agent; roster: { nodeByInstance: ReadonlyMap<string, { agent: Agent; thread?: { startFailure?: unknown } }>; whereOf(agent: Agent): ThreadWhere }; held: boolean }) {
  const node = roster.nodeByInstance.get(agent.instance);
  const attached = node?.agent === agent;
  const said = sayOf(agent, roster.whereOf(agent), attached, attached ? (node?.thread ?? null) : null);
  if (said === null || said.warning !== null || attached || said.kind !== "lost-archived") return null;
  return (
    <div data-testid="oats-outside-agent-block" data-outside={said.kind} className="flex min-w-0 flex-col gap-2 text-sm text-foreground">
      {/* The panel's header has the lifecycle's acts for the agent's state (`AgentActs`). One act is not among
          them: Stop for a session OATS lost (it reads stopped, and its process may run): it is here. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <OutsideActs instance={agent.instance} acts={["stop"]} held={held} />
      </div>
    </div>
  );
}
