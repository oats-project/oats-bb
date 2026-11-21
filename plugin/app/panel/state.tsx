// What a part of the panel says when what it shows is not a current read of a command of its own
// (`oats inspect`, `oats instance events`, `oats readiness`): the read in flight, a first read that
// failed, or what was read earlier beside the refusal of the last read. Nothing when the read is
// there and current.
import { codes } from "../../kernel/result";
import { Button, Loading, Notice, Stale } from "../ui";
import type { Read } from "../store";

/**
 * The code that leads a refusal as the server words it (`<code>: <message>`), the kernel's or one
 * of the plugin's own: drawn after the words. The rule is that of app/ui/text.ts `refusalLines`.
 */
export function codeOf(error: string): string | null {
  const lead = /^([A-Z][A-Z0-9_]*): /.exec(error)?.[1];
  return lead !== undefined && (lead.startsWith("E_") || (Object.values(codes) as string[]).includes(lead)) ? lead : null;
}

export function CommandState({ read, reading, failed }: { read: Read<unknown> & { retry(): void; fetching: boolean }; reading: string; failed: string }) {
  if (read.status === "loading") return <Loading>{reading}</Loading>;
  if (read.status !== "error") return null;
  const code = codeOf(read.error);
  const retry = <Button onClick={read.retry}>Retry</Button>;
  // A failed reread keeps what was read; the kernel names no instant for it, so no age is said.
  if (read.data !== undefined) return <Stale age={null} refreshing={read.fetching} held={`It could not be read again${code === null ? "" : ` (${code})`}.`} action={retry} />;
  return <Notice title={failed} tone="error" code={code} details={read.error} actions={retry} />;
}
