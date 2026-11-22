// What a part of the panel says when what it shows is not a current read of a command of its own
// (`oats inspect`, `oats instance events`, `oats readiness`): the read in flight, a first read that
// failed, or what was read earlier under the refusal of the last read. Nothing when the read is
// there and current. A failure is always the titled notice (the UX standard's Notice), the same
// drawing whether or not something read earlier is still shown: with it, the notice says how old
// that is, once.
import { codes } from "../../kernel/result";
import { Button, Loading, Notice } from "../ui";
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

type CommandRead = Read<unknown> & { retry(): void; fetching: boolean; readAt: number | null };

/** Whether the notice of a failed read offers Retry: the part's own button to read again is then not drawn beside it. */
export const offersRetry = (read: CommandRead, of: "readiness" | "activity" | "soul"): boolean => read.status === "error" && refusalWords(of, codeOf(read.error), read.error).retry;

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
  return (
    <Notice
      title={kept ? `${failed} again` : failed}
      tone="error"
      code={code}
      details={read.error}
      {...(kept ? { age: staleAge(at ?? read.readAt, now) } : {})}
      actions={words.retry ? <Button onClick={read.retry}>{read.fetching ? "Reading…" : "Retry"}</Button> : undefined}
    >
      {words.sentence === null ? null : <p className="m-0">{words.sentence}</p>}
      {words.next === null ? null : <p className="m-0">{words.next}</p>}
    </Notice>
  );
}
