// What a part of the panel says when what it shows is not a current read of a command of its own
// (`oats inspect`, `oats instance events`, `oats readiness`): the read in flight, a first read that
// failed, or what was read earlier under the refusal of the last read. Nothing when the read is
// there and current. A failure is always the titled notice (the UX standard's Notice), the same
// drawing whether or not something read earlier is still shown: with it, the notice says how old
// that is, once.
import { codes } from "../../kernel/result";
import { Fragment } from "react";
import { Button, Code, Loading, Notice } from "../ui";
import type { Read } from "../store";
import { refusalWords } from "./refusal-words";
import { staleAge } from "./words";

/**
 * The code that leads a refusal as the server words it (`<code>: <message>`), the kernel's or one
 * of the plugin's own: drawn after the words. The rule is that of app/ui/text.ts `refusalLines`.
 */
export function codeOf(error: string): string | null {
  const lead = /^([A-Z][A-Z0-9_]*): /.exec(error)?.[1];
  return lead !== undefined && (lead.startsWith("E_") || (Object.values(codes) as string[]).includes(lead)) ? lead : null;
}

/** A sentence of the plugin's with the kernel's words in it (a command between backticks): each drawn as code. */
function Sentence({ children }: { children: string }) {
  return (
    <p className="m-0">
      {children.split("`").map((part, index) => (index % 2 === 1 ? <Code key={index}>{part}</Code> : <Fragment key={index}>{part}</Fragment>))}
    </p>
  );
}

type CommandRead = Read<unknown> & { retry(): void; fetching: boolean; readAt: number | null };

/**
 * Whether the notice of a failed read offers Retry: the part's own button to read again is then
 * not drawn beside it. For a refusal that reading again cannot change as things are, the notice
 * offers none and the part keeps its own button (Refresh readiness, Refresh activity, Read the
 * soul again): for the person who mended what was wrong.
 */
export const offersRetry = (read: CommandRead, of: "readiness" | "activity" | "soul"): boolean => read.status === "error" && refusalWords(of, codeOf(read.error), read.error).retry;
/** Whether a failed read is something a person could mend and read again: not where OATS simply has none of it for this agent. */
export const mendable = (read: CommandRead, of: "readiness" | "activity" | "soul"): boolean => read.status === "error" && refusalWords(of, codeOf(read.error), read.error).fault;

/**
 * `of` names the read, for the words of its refusal (refusal-words.ts); `failed` is the notice's
 * title; `at` is the instant of what is still shown where its answer names one (else the instant
 * the panel received it); `now` is the clock.
 */
export function CommandState({ read, of, reading, failed, at = null, now }: { read: CommandRead; of: "readiness" | "activity" | "soul"; reading: string; failed: string; at?: string | null; now: number }) {
  if (read.status === "loading") return <Loading>{reading}</Loading>;
  if (read.status !== "error") return null;
  const code = codeOf(read.error);
  const words = refusalWords(of, code, read.error);
  const kept = read.data !== undefined;
  // OATS has none of it for this kind of agent: a fact, said once and not drawn as a failure; nothing to press.
  if (!words.fault && words.sentence !== null) return <Notice title={words.sentence.replace(/\.$/, "")} tone="info" code={code} details={read.error} />;
  return (
    <Notice
      title={kept ? `${failed} again` : failed}
      tone="error"
      code={code}
      details={read.error}
      // The panel's clock ticks every half minute: a failure drawn between two ticks is aged by the clock as it is now.
      {...(kept ? { age: staleAge(at ?? read.readAt, Math.max(now, Date.now())) } : {})}
      actions={words.retry ? <Button onClick={read.retry}>{read.fetching ? "Reading…" : "Retry"}</Button> : undefined}
    >
      {words.sentence === null ? null : <Sentence>{words.sentence}</Sentence>}
      {words.next === null ? null : <Sentence>{words.next}</Sentence>}
    </Notice>
  );
}
