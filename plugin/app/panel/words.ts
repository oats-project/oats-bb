// The instance panel's own words, as pure functions of what the kernel reported. They are the OATS
// Desktop's (packages/desktop/renderer/context-panel.mjs, age-text.mjs, identity-marks.mjs and
// provider-row.mjs at awebai/oats 95c7b43b): where words are the feature, bb says what the Desktop
// says. The words every feature shares (a state, a waiting claim) are in app/ui/words.ts. No bb and
// no React import.
import type { AgentState } from "../../model/types";
import type { PanelInstance } from "../../kernel/panel-instance";
import { shown } from "../ui/text";
import { waitingClock } from "../ui/words";

/** A reported timestamp as a relative age ("3 h ago"); anything that is no timestamp, as sent. */
export function ageText(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(at).toISOString().slice(0, 10);
}

/**
 * What the "older build" chip says when the instance's soul or modules moved since it was spawned:
 * the lines of its description, or null when nothing moved.
 */
export function driftLines(drift: PanelInstance["drift"]): string[] | null {
  const said: string[] = [];
  if (drift.soul !== null) {
    said.push(
      drift.soul === "moved"
        ? "Its soul's repository has moved on since it was spawned."
        : drift.soul === "missing"
          ? "The soul commit it was spawned from is no longer found."
          : `Its soul is ${drift.soul}.`,
    );
  }
  for (const row of drift.modules) {
    const name = row.name ?? "A capability";
    if (row.status === "moved") said.push(`${name} has changed since${row.now === null ? "" : ` (${row.was === null ? "now " : `${row.was} → `}${row.now})`}.`);
    else if (row.status === "missing") said.push(`${name} is no longer available${row.reason === null ? "" : ` (${row.reason})`}.`);
    else said.push(`${name} is ${row.status}.`);
  }
  if (said.length === 0) return null;
  return ["Built from an older state of the workspace:", ...said.map((line) => `• ${line}`), "Re-spawning picks up the new state; this instance keeps what it was built with."];
}

/** A part of the Work fact: plain words, or one of the row's own facts (drawn in the code face). */
export type SentencePart = string | { code: string };

// Where it works, as a fact and not a sentence: the mode in a word or two, then the one thing that
// tells it from another of its kind (the branch of its worktree, the repository of a shared
// checkout, whose tree it shares). plugin/WORDS.md holds the Desktop's sentences they stand for.
const WORK_SENTENCE: Record<string, (facts: Pick<PanelInstance, "repo" | "branch" | "parent">) => SentencePart[]> = {
  worktree: ({ branch }) => ["worktree", ...(branch === null ? [] : [" · ", { code: branch }])],
  checkout: ({ repo }) => ["shared checkout", ...(repo === null ? [] : [" · ", { code: repo }])],
  attached: ({ parent }) => (parent === null ? ["its parent's tree"] : [{ code: parent }, "'s tree"]),
  directory: () => ["own folder"],
  workspace: () => ["workspace"],
};

/** The work mode as a fact, or null for a mode the row does not report or this plugin does not know. */
export function workSentence(facts: Pick<PanelInstance, "work" | "repo" | "branch" | "parent">): SentencePart[] | null {
  const sentence = facts.work === null || !Object.hasOwn(WORK_SENTENCE, facts.work) ? undefined : WORK_SENTENCE[facts.work];
  return sentence === undefined ? null : sentence(facts);
}

/** The modes whose `<home>/work` is a link to a tree other instances share. */
export const sharedWork = (work: string | null): boolean => work === "checkout" || work === "attached" || work === "workspace";
export const SHARED_TITLE = "A link to the shared tree; changes here are visible to every instance that shares it.";

/** The folder an instance works in: `<home>/work`, in every mode. */
export const workFolder = (home: string): string => `${home.replace(/\/+$/, "")}/work`;

const MODEL_FROM: Record<string, string> = {
  soul: "the soul's choice",
  spawn: "chosen at spawn",
  start: "chosen at start",
  "launch-config": "from the launch configuration",
  "harness-default": "the harness's default",
  local: "set for this soul on this computer",
  "local-default": "this computer's default for every soul",
};
/** Where the model came from, in words; null without a model beside it, or for a word this plugin does not know. */
export function modelFromText(facts: Pick<PanelInstance, "model" | "modelFrom">): string | null {
  if (facts.model === null || facts.modelFrom === null || !Object.hasOwn(MODEL_FROM, facts.modelFrom)) return null;
  return MODEL_FROM[facts.modelFrom] ?? null;
}

const HARNESS: Record<string, string> = { claude: "Claude", pi: "Pi", codex: "Codex" };
/** A reported harness's display name (Claude, Pi, Codex), else the value as reported. */
export function harnessName(harness: string): string {
  const reported = harness.trim();
  const key = reported.toLowerCase();
  return Object.hasOwn(HARNESS, key) ? (HARNESS[key] ?? reported) : reported;
}

/**
 * Where the session runs: the place in a word (`bb`, a provider's name, `tmux`), and the session's
 * own id with what it is ("thread" on a session provider, "session" on tmux); null for neither.
 * The Desktop says it in one line, `bb · thread thr_…`; here the id stands on a line of its own,
 * so that it is never broken inside (plugin/WORDS.md).
 */
export function sessionWhere(facts: Pick<PanelInstance, "backend" | "threadId" | "tmuxSession">): { where: string; id: string | null; idName: string } | null {
  if (facts.backend !== null && facts.backend !== "tmux") return { where: facts.threadId === null ? facts.backend : `${facts.backend} thread`, id: facts.threadId, idName: `the thread's id in ${facts.backend}` };
  return facts.tmuxSession === null ? null : { where: "tmux session", id: facts.tmuxSession, idName: "the tmux session's name" };
}

const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/**
 * A soul's two-letter mark, the Desktop's grammar (packages/desktop/renderer/identity-marks.mjs
 * `markText`): drop a package qualifier (after the last `/` or `--`) and, from three words, a
 * leading namespace word; then the initials of two words, or a single word's first two
 * characters, upper-cased. By code points; "?" when there is no letter or digit to take.
 */
export function markText(value: string): string {
  const slash = value.lastIndexOf("/");
  const dashes = value.lastIndexOf("--");
  const cut = Math.max(slash < 0 ? 0 : slash + 1, dashes < 0 ? 0 : dashes + 2);
  let parts = wordsOf(value.slice(cut));
  if (parts.length >= 3) parts = parts.slice(1);
  return initials(parts) || "?";
}
/**
 * Words as a mark: the initials of the first two, or a single word's first two characters,
 * upper-cased, by code points; "" for no word. Upper case can grow ("ß" is "SS"): a mark is two
 * glyphs at most, so then each character keeps its first.
 */
function initials(parts: string[]): string {
  const chars = parts.length >= 2 ? [[...parts[0]!][0]!, [...parts[1]!][0]!] : parts.length === 1 ? [...parts[0]!].slice(0, 2) : [];
  const upper = [...chars.join("").toLocaleUpperCase("en")];
  return (upper.length <= 2 ? upper : chars.map((char) => [...char.toLocaleUpperCase("en")][0])).join("");
}
/**
 * An AGENT's two-letter mark, beside its name: the name's own letters, so that the tile reads as
 * the initials of the words next to it ("Overnight sweep developer" is "OS", never its soul's
 * "CD"). The initials of the name's first two words, or a single word's first two characters,
 * upper-cased, by code points. Nothing is dropped from a name (a soul's mark drops a namespace
 * word: a name has none). null when the name has no letter or digit: no tile is drawn then.
 */
export function nameMark(instance: string): string | null {
  return initials(wordsOf(instance)) || null;
}

/**
 * An instant the kernel reports, in the plugin's one form for an instant (app/ui/words.ts
 * `waitingClock`: "18:23" today, "Nov 21, 18:23" another day, local time); what is no instant, as
 * sent, through the display filter. The kernel's own text of it (ISO, UTC, milliseconds) belongs
 * in a title, for whoever needs the exact value.
 */
export function whenText(iso: string, now: number): string {
  return waitingClock(iso, now) || shown(iso);
}

// ---- reaching the session of an agent on tmux (the agent's page, and the home's card of one that waits)
/** A path as one word of a shell command: as it is when it has nothing a shell reads, else in single quotes. */
const shellWord = (text: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
/** The kernel's own way into an agent's session, by its home (docs/execution-targets.md, "Attach"): it runs from any directory of that machine. */
export const attachCommand = (home: string): string => `oats session attach --home ${shellWord(home)}`;
/** Over the command that reaches the session of an agent on tmux ("Runs in" beside it already says tmux). */
export const ATTACH = "Attach:";
/**
 * Whether the attach line is drawn: for an agent on tmux, while the kernel's own word is that it
 * runs (`running === true`) and its state is one of an agent that runs (it works, or it waits on a
 * person). Not for a stopped one (no session), nor for one the kernel cannot reach or says nothing
 * of (`oats session attach` refuses), also when such an agent needs the person by a claim it still
 * carries: the state alone would then say yes.
 */
export const attachOffered = (onTmux: boolean, running: boolean | null, state: AgentState): boolean => onTmux && running === true && (state === "working" || state === "needs-you");
