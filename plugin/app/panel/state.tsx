// What a part of the panel says when what it shows is not a current read of a command of its own
// (`oats inspect`, `oats instance events`, `oats readiness`): the read in flight, a first read that
// failed, or what was read earlier under the refusal of the last read. Nothing when the read is
// there and current. A failure is always the titled notice (the UX standard's Notice), the same
// drawing whether or not something read earlier is still shown: with it, the notice says how old
// that is, once.
import { codes } from "../../kernel/result";
import { useEffect, useState } from "react";
import { Button, Loading, Notice } from "../ui";
import type { Read } from "../store";
import { readAge } from "../ui/words";
import { refusalWords } from "./refusal-words";

/**
 * The code that leads a refusal as the server words it (`<code>: <message>`), the kernel's or one
 * of the plugin's own: drawn after the words. The rule is that of app/ui/text.ts `refusalLines`.
 */
export function codeOf(error: string): string | null {
  const lead = /^([A-Z][A-Z0-9_]*): /.exec(error)?.[1];
  return lead !== undefined && (lead.startsWith("E_") || (Object.values(codes) as string[]).includes(lead)) ? lead : null;
}

type CommandRead = Read<unknown> & { retry(): void; fetching: boolean; readAt: number | null };

/**
 * Whether the notice of a failed read offers Retry: the part's own button to read again is then
 * not drawn beside it. For a refusal that reading again cannot change as things are, the notice
 * offers none and the part keeps its own button (Refresh, Retry on the Soul tab): for the person
 * who mended what was wrong.
 */
export const offersRetry = (read: CommandRead, of: "readiness" | "activity" | "soul"): boolean => read.status === "error" && refusalWords(of, codeOf(read.error), read.error).retry;
/** Whether a failed read is something a person could mend and read again: not where OATS simply has none of it for this agent (the part then draws nothing: there is nothing to show, and no sentence says so). */
export const mendable = (read: CommandRead, of: "readiness" | "activity" | "soul"): boolean => read.status === "error" && refusalWords(of, codeOf(read.error), read.error).fault;

/**
 * `of` names the read, for the words of its refusal (refusal-words.ts); `failed` is the notice's
 * title; `at` is the instant of what is still shown where its answer names one (else the instant
 * the panel received it); `now` is the clock.
 */
export function CommandState({ read, of, reading, failed, at = null, now }: { read: CommandRead; of: "readiness" | "activity" | "soul"; reading: string; failed: string; at?: string | null; now: number }) {
  // The panel's clock ticks every half minute: a failure is aged by the clock as it was when the
  // failure was seen, read after the drawing (an effect), never during it.
  const [seen, setSeen] = useState(now);
  const failing = read.status === "error" && !read.fetching;
  useEffect(() => {
    if (failing) setSeen(Date.now());
  }, [failing, read.error]);
  if (read.status === "loading") return <Loading>{reading}</Loading>;
  if (read.status !== "error") return null;
  const code = codeOf(read.error);
  /** When what is still shown was read: the instant the part names, else when this window received it. */
  const stale = at ?? read.readAt;
  const words = refusalWords(of, code, read.error);
  const kept = read.data !== undefined;
  // OATS has none of it for this kind of agent: nothing to show and nothing to press, so nothing is drawn (the part leaves the page).
  if (!words.fault) return null;
  return (
    <Notice
      title={kept ? `${failed} again` : failed}
      tone="error"
      code={code}
      // What to do next is one press away, with the kernel's own message: the notice's face is what happened.
      details={[words.next, read.error]}
      {...(kept ? { age: stale === null ? null : readAge(stale, Math.max(now, seen)) } : {})}
      actions={words.retry ? <Button onClick={read.retry}>{read.fetching ? "Reading…" : "Retry"}</Button> : undefined}
    >
      {words.sentence === null ? null : <p className="m-0">{words.sentence}</p>}
    </Notice>
  );
}
