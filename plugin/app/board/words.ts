// The board's words (the specialist's rulings of 25 Nov 2026 on the board's plan). Little text: an
// age is the age alone (its instant in the title), loading is "Reading…", and nothing tells a
// person how to type an answer.
export const BOARD = {
  /** The panel's tab, and the section's names. */
  tab: "Board",
  questions: "Questions",
  facts: "Facts",
  reading: "Reading…",
  /** A question's fold: the agent's own context for it, as plain text. Offered only where the agent sent one. */
  context: "Context",
  previous: "Previous question",
  next: "Next question",
  /** A fact's × : on this computer alone (the kernel's `unset` is the agent's). */
  hide: "Hide on this computer",
  open: "Open in browser",
  /** What cannot be shown, each only in its place, as a quiet line; none of them reads as "no history" or "no questions". */
  historyFailed: "History could not be read.",
  contextFailed: "The context could not be read.",
  noHistory: "This OATS sends no history.",
  unreadable: "This agent's board could not be read.",
  /** At the press, the server's roster no longer holds the question as it was drawn (the agent cleared it, or asked again): nothing was sent. */
  noLongerAsked: "No longer asked. Nothing sent.",
  /** At the press, the agent waits on an approval of its harness: a message then would answer that. Nothing was sent. */
  approvalFirst: "It waits on an approval. Nothing sent.",
  /** The palette command, and what it says where there is nothing to focus. */
  focus: "Agent: questions and facts (focus)",
  nothing: "This agent has no questions or facts to show.",
} as const;

/** "2 of 3": a question's place among the open ones; null for the only one. */
export const placeSaid = (index: number, total: number): string | null => (total > 1 ? `${index + 1} of ${total}` : null);
/** What the fold of the hidden facts says: "2 hidden · show". */
export const hiddenSaid = (count: number): string => `${count} hidden · show`;
/** Entries of the board that were out of the kernel's contract and are left out. */
export const droppedSaid = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"} of this agent's board could not be shown.`;
/** A fact's address, as the agent's words: who says it, and the host alone until a person asks for the whole. */
export const linkSaid = (name: string, host: string): string => `${name} says: ${host}`;
