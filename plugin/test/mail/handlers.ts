// The mail's RPC method as a slot test's default: the recorded answers (test/fixtures/mail/), read
// by the server's own parser, as the server would answer them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/mail";
import { parseMail, type MailPage } from "../../kernel/mail";

/** The `mail` of a recorded answer, as the messaging layer printed it: what a test changes ONE field of. */
export type RecordedMail = { identities: Record<string, unknown>[]; messages: Record<string, unknown>[]; hasMore: boolean; nextCursor: string | null } & Record<string, unknown>;

/**
 * A recorded answer of the mail read as the app gets it: read by the server's own parser. `change`
 * changes the RECORDED answer before it is read (one named field, for a shape the stage could not
 * produce), so that what a test draws went through the parser like any answer.
 */
export function recordedMail(name = "mail.json", change?: (mail: RecordedMail) => void): MailPage {
  const document = JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/mail", name), "utf8")) as { result: { result: { mail: RecordedMail } } };
  change?.(document.result.result.mail);
  const page = parseMail(document.result);
  if (!page.ok) throw new Error(`${name}: ${page.error.code}`);
  return page.value;
}

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  mail: () => recordedMail(),
});
