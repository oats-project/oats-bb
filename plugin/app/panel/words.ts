// The instance panel's own words, as pure functions of what the kernel reported. They are the OATS
// Desktop's (packages/desktop/renderer/context-panel.mjs, age-text.mjs, identity-marks.mjs and
// provider-row.mjs at awebai/oats 95c7b43b): where words are the feature, bb says what the Desktop
// says. The words every feature shares (a state, a waiting claim) are in app/ui/words.ts. No bb and
// no React import.
import type { PanelInstance } from "../../kernel/panel-instance";

/** How long ago, compactly ("<1m", "42m", "3h", "2d"); null when it is no timestamp. */
export function shortAge(iso: string | null, now: number): string | null {
  const at = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

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

/** A part of the Work sentence: plain words, or one of the row's own facts (drawn in the code face). */
export type SentencePart = string | { code: string };

const WORK_SENTENCE: Record<string, (facts: Pick<PanelInstance, "repo" | "branch" | "parent">) => SentencePart[]> = {
  worktree: ({ repo, branch }) => ["Works in its own worktree of ", repo === null ? "its soul's repository" : { code: repo }, ...(branch === null ? [] : [", on branch ", { code: branch }]), "."],
  checkout: ({ repo }) => ["Works in the shared checkout of ", repo === null ? "its soul's repository" : { code: repo }, ", alongside the other instances that use it."],
  attached: ({ parent }) => ["Works in ", ...(parent === null ? ["its parent's tree"] : [{ code: parent }, "'s tree"]), ", sharing its branch and changes."],
  directory: () => ["Has its own folder, not tied to one repository: free to work across repos as its task needs."],
  workspace: () => ["Sees the whole workspace: reads across every member repository."],
};

/** The work mode in one sentence, or null for a mode the row does not report or this plugin does not know. */
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
 * Where the session runs, in one line: `bb · thread thr_…` for a row on a session provider (the
 * provider alone when the row names no thread), `tmux · <session>` for a tmux row, "" for neither.
 */
export function sessionLine(facts: Pick<PanelInstance, "backend" | "threadId" | "tmuxSession">): string {
  if (facts.backend !== null && facts.backend !== "tmux") return facts.threadId === null ? facts.backend : `${facts.backend} · thread ${facts.threadId}`;
  return facts.tmuxSession === null ? "" : `tmux · ${facts.tmuxSession}`;
}

/** The row's runtime error, with who said it: every fact here is the kernel's. */
export const runtimeErrorLine = (error: string): string => `OATS says: ${error}`;

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
  const chars = parts.length >= 2 ? [[...parts[0]!][0]!, [...parts[1]!][0]!] : parts.length === 1 ? [...parts[0]!].slice(0, 2) : [];
  const upper = [...chars.join("").toLocaleUpperCase("en")];
  // Upper case can grow ("ß" is "SS"): a mark is two glyphs at most, so then each character keeps its first.
  return (upper.length <= 2 ? upper : chars.map((char) => [...char.toLocaleUpperCase("en")][0])).join("") || "?";
}
