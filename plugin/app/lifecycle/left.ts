// The notice of an agent whose thread a person archived or deleted IN BB while the agent ran: bb
// takes the thread away and stops nothing OATS knows of, so the agent may still run, with its
// thread out of sight. At once, through bb's toaster: "<Name> may still run.", with Stop…, which
// opens the Stop dialog. (The lead's read, 24 Nov 2026, S3; the rule is the outside feature's
// design, agreed with its developer.)
//
// Never a false alarm:
// - only of an agent this window SAW run on a thread bb listed (one already archived or gone when
//   the window opened is never remembered: its row warns, as before; an agent on tmux has no thread);
// - only once bb has ANSWERED that the same thread is archived or gone (never on "not known yet";
//   a new thread id is a start or a restart);
// - never for a stop through OATS, which archives the thread itself, from this plugin or from a
//   terminal: bb's list changes before the roster is read, so OATS is asked again ONCE, and the
//   roster read AFTER decides: a row that says an operator stopped it (`sessionEnd: "stopped"`),
//   or an agent that is gone from it, is told to nobody;
// - never while an act of ours is in flight or its dialog is on screen: the look waits for it;
// - once per agent and thread in an app window.
import { rest } from "../../model/rest";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";

type Ready = Extract<Oats, { phase: "ready" }>;

/** Each agent as last seen ON its listed thread: which thread, and whether it ran. */
const seen = new Map<string, { threadId: string; ran: boolean }>();
/** An agent that ran and whose thread bb now says is archived or gone: `askedAt` is the roster's stamp when OATS was asked again (null: not asked yet). */
const candidates = new Map<string, { threadId: string; askedAt: string | null }>();
/** Told already in this window, by agent and thread. */
const told = new Set<string>();
const keyOf = (instance: string, threadId: string) => `${instance}\n${threadId}`;

onWindowReset(() => {
  seen.clear();
  candidates.clear();
  told.clear();
});

const left = (oats: Ready, agent: Ready["agents"][number]): boolean => {
  const where = oats.whereOf(agent);
  return where === "archived" || where === "missing";
};

/**
 * Look at the roster the window holds now. `busy`: an act of ours is in flight, or its dialog is on
 * screen. `tell` is called at most once per agent and thread. Called at each draw of the overlay;
 * it asks OATS again (`oats.retry`) once per candidate, and decides on the roster read after.
 */
export function lookForLeft(oats: Oats, busy: boolean, tell: (instance: string) => void): void {
  // Only a roster that was just read says anything: the last one kept while OATS cannot be read is not asked.
  if (oats.phase !== "ready" || oats.stale !== null) return;
  const byInstance = new Map(oats.agents.map((agent) => [agent.instance, agent]));

  // An agent that was seen running on a thread, and whose SAME thread bb now says is archived or gone.
  for (const [instance, was] of seen) {
    const agent = byInstance.get(instance);
    if (agent === undefined) seen.delete(instance);
    else if (agent.threadId === was.threadId && left(oats, agent)) {
      seen.delete(instance);
      if (was.ran && !told.has(keyOf(instance, was.threadId)) && !candidates.has(instance)) candidates.set(instance, { threadId: was.threadId, askedAt: null });
    }
  }

  // Each agent the roster draws ON its listed thread, as it is now.
  for (const agent of oats.agents) {
    const node = oats.nodeByInstance.get(agent.instance);
    if (agent.threadId === null || node?.agent !== agent || oats.whereOf(agent) !== "open") continue;
    seen.set(agent.instance, { threadId: agent.threadId, ran: rest(agent, node.thread) === "runs" });
  }

  for (const [instance, candidate] of candidates) {
    const agent = byInstance.get(instance);
    // Retired meanwhile, on a new thread (a start, a restart), or its thread is back (unarchived): nothing to tell.
    if (agent === undefined || oats.gone.has(instance) || agent.threadId !== candidate.threadId || !left(oats, agent)) {
      candidates.delete(instance);
      continue;
    }
    // An act of ours may be what archived it (a stop, a retire, of it or of its parent): the look waits, and asks after.
    if (busy) {
      candidate.askedAt = null;
      continue;
    }
    if (candidate.askedAt === null) {
      candidate.askedAt = oats.at;
      oats.retry();
      continue;
    }
    // The roster read after OATS was asked again decides.
    if (oats.at === candidate.askedAt) continue;
    candidates.delete(instance);
    if (agent.sessionEnd === "stopped") continue; // a stop through OATS: its thread was archived by it
    told.add(keyOf(instance, candidate.threadId));
    tell(instance);
  }
}
