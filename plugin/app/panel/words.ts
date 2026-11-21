// The instance panel's words, as pure functions of what the kernel reported. They are the OATS
// Desktop's own (packages/desktop/renderer/context-panel.mjs, packages/client/waiting-on-you.mjs and
// packages/desktop/renderer/provider-row.mjs at awebai/oats 95c7b43b): where words are the
// feature, bb says what the Desktop says. No bb and no React import.
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
 * The header's state in words: "Running · 42m" (since its last start) and "Stopped" where the
 * kernel says so; where it says neither (an agent idle in bb reads `running: null`), `word`, the
 * word the tree draws the agent with (app/roster/status.ts), so every place says the same thing.
 */
export function stateText(facts: { running: boolean | null; startedAt: string | null }, word: string, now: number): { text: string; title: string | null } {
  if (facts.running === true) {
    const since = shortAge(facts.startedAt, now);
    return since === null ? { text: "Running", title: null } : { text: `Running · ${since}`, title: `started ${facts.startedAt}` };
  }
  return { text: facts.running === false ? "Stopped" : word.charAt(0).toUpperCase() + word.slice(1), title: null };
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
  return HARNESS[reported.toLowerCase()] ?? reported;
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

// ---- Needs input ----

export type Claim = { reason: string | null; message: string | null; since: string | null };

const REASON: Record<string, string> = { permission: "Waiting for a tool approval", question: "Asked you a question", attention: "Asked for your attention" };
const reasonWords = (claim: Claim): string | null => (claim.reason !== null && Object.hasOwn(REASON, claim.reason) ? (REASON[claim.reason] ?? null) : null);

/** The reason in words. The raw reason is never drawn: an unknown one reads "Needs input". */
export const waitingLabel = (claim: Claim): string => reasonWords(claim) ?? "Needs input";
/** What a place that already says "Needs input" adds: the message, else the reason in words, else nothing. */
export const waitingDetail = (claim: Claim): string | null => (claim.message !== null && claim.message.trim() !== "" ? claim.message : reasonWords(claim));

/** How long it has waited: "under a minute", "N min", "N h", "N d". */
export function waitedText(since: string | null, now: number): string {
  const ms = since === null ? Number.NaN : now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 60_000) return "under a minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");
/** The claim's start in local time: "14:03" today, "Oct 2, 14:03" another day of this year, "2025-10-02 14:03" another year. */
export function waitingClock(since: string | null, now: number): string {
  const at = new Date(since ?? Number.NaN);
  const today = new Date(now);
  if (!Number.isFinite(at.getTime())) return "";
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.getFullYear() !== today.getFullYear()) return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
  return at.getMonth() === today.getMonth() && at.getDate() === today.getDate() ? time : `${MONTHS[at.getMonth()]} ${at.getDate()}, ${time}`;
}

/** The Needs input section's head: "<reason> · waiting 12 min (since 14:03)". */
export function waitingHead(claim: Claim, now: number): string {
  const clock = waitingClock(claim.since, now);
  return `${waitingLabel(claim)} · waiting ${waitedText(claim.since, now)}${clock === "" ? "" : ` (since ${clock})`}`;
}
