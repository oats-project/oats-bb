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
// - never for an act through OATS, which archives the thread itself, from this plugin or from a
//   terminal (a stop, a retire, a restart): bb's list changes before the roster is read, so OATS is
//   asked again ONCE, and a roster read AFTER that (its stamp is the asked read's, or later) decides,
//   and only on what the row SAYS: told where it says that its session was lost (what a kernel with
//   this repository's provider prints after bb's archive: the provider no longer answers for an
//   archived thread; recorded, test/fixtures/outside/status-archived-while-running.json) or that the
//   agent runs (a provider that still answers for it: not recorded); dropped where it says an operator stopped it
//   (`sessionEnd: "stopped"`), where the agent is gone, on a new thread, or its thread is back; and
//   where the row says neither (not running with no word how its session ended: a retire on its way;
//   unreachable: a restart on its way) the look WAITS for a later roster, asking nothing more;
// - never while an act of ours is in flight or its dialog is on screen: the look waits for it;
// - once per agent and thread in an app window.
// Not told, by design: an agent that runs OUTSIDE OATS (OATS recorded it stopped and its harness
// runs): it is never "seen running" here (its row says an operator stopped it), and its row and its
// thread's line already warn of it (README, "Outside OATS").
import { rest } from "../../model/rest";
import type { Oats } from "../oats";
import { onWindowReset } from "../store";

type Ready = Extract<Oats, { phase: "ready" }>;

/** Each agent as last seen ON its listed thread: which thread, and whether it ran. */
const seen = new Map<string, { threadId: string; ran: boolean }>();
/**
 * An agent that ran and whose thread bb now says is archived or gone. `after`: the stamp of the read
 * OATS made when it was asked again (null: not asked yet, or the answer is not here yet); `asking`:
 * the question that is out (null: none; an answer to an earlier one is nobody's); `failedOn`: what the window
 * held when the question failed: it is asked again once the window holds something newer (below).
 */
type Candidate = { threadId: string; after: string | null; asking: number | null; failedOn: Renewal | null };
/**
 * What says that the window holds something newer than when a question failed: another roster (its stamp), or
 * bb's answers for the threads asked anew (`whereOf` is a new function then: at each roster, each change of bb's
 * list, and each MINUTE, app/outside/threads.ts). A quiet deployment brings no new roster (the server publishes
 * only a roster that changed): the minute does, so a failed question is asked again within one, and never at each draw.
 */
type Renewal = { at: string; whereOf: unknown };
const renewed = (oats: Ready, since: Renewal): boolean => oats.at !== since.at || oats.whereOf !== since.whereOf;
let questions = 0;
const candidates = new Map<string, Candidate>();
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

export type Look = {
  /** An act of ours is in flight, or its dialog is on screen. */
  busy: boolean;
  /**
   * Ask OATS to read its status again now, and have the window read it: resolves to the stamp of
   * that read (the plugin server's `refresh`), or null where it could not be asked.
   */
  ask: () => Promise<string | null>;
  /** Called at most once per agent and thread. */
  tell: (instance: string) => void;
};

/**
 * Look at the roster the window holds now. Called at each draw of the overlay; it asks OATS again
 * once per candidate, and decides on a roster read after that.
 */
export function lookForLeft(oats: Oats, { busy, ask, tell }: Look): void {
  // Only a roster that was just read says anything: the last one kept while OATS cannot be read is not asked.
  if (oats.phase !== "ready" || oats.stale !== null) return;
  const byInstance = new Map(oats.agents.map((agent) => [agent.instance, agent]));

  // An agent that was seen running on a thread, and whose SAME thread bb now says is archived or gone.
  for (const [instance, was] of seen) {
    const agent = byInstance.get(instance);
    if (agent === undefined) seen.delete(instance);
    else if (agent.threadId === was.threadId && left(oats, agent)) {
      seen.delete(instance);
      if (was.ran && !told.has(keyOf(instance, was.threadId)) && !candidates.has(instance)) candidates.set(instance, { threadId: was.threadId, after: null, asking: null, failedOn: null });
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
    if (agent === undefined || oats.gone.has(instance) || agent.threadId !== candidate.threadId || oats.whereOf(agent) === "open") {
      candidates.delete(instance);
      continue;
    }
    // bb does not say of the thread now (it is asked again at each roster and each minute, and one failed answer
    // forgets them all): the candidate is kept, and nothing is decided until bb says again that it is archived or gone.
    if (!left(oats, agent)) continue;
    // An act of ours may be what archived it (a stop, a retire, of it or of its parent): the look waits, and asks after.
    if (busy) {
      candidate.after = null;
      candidate.asking = null;
      continue;
    }
    if (candidate.after === null) {
      if (candidate.asking !== null || (candidate.failedOn !== null && !renewed(oats, candidate.failedOn))) continue;
      const question = ++questions;
      candidate.asking = question;
      const askedOn: Renewal = { at: oats.at, whereOf: oats.whereOf };
      void ask().then((at) => {
        // (An act of ours began meanwhile, or a new window: this answer is nobody's.)
        if (candidates.get(instance) !== candidate || candidate.asking !== question) return;
        candidate.asking = null;
        if (at === null) candidate.failedOn = askedOn;
        else {
          candidate.failedOn = null;
          candidate.after = at;
        }
      });
      continue;
    }
    // A roster read after OATS was asked again decides (the server's stamps are times, in one form: they compare as text).
    if (oats.at < candidate.after) continue;
    // What the row says. An operator's stop: its thread was archived by that stop.
    if (agent.sessionEnd === "stopped") {
      candidates.delete(instance);
      continue;
    }
    // Its session was lost, or it runs: what a kernel prints of an agent whose thread bb archived under it (the header says which is recorded).
    if (rest(agent) === "runs" || agent.sessionEnd === "lost") {
      candidates.delete(instance);
      told.add(keyOf(instance, candidate.threadId));
      tell(instance);
    }
    // Else the row says neither (not running, with no word how its session ended: a retire on its way; unreachable:
    // a restart on its way): a later roster decides, and OATS is not asked again.
  }
}
