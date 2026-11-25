// The mail's RPC method as a slot test's default: the recorded answers (test/fixtures/mail/), read
// by the server's own parser, as the server would answer them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/mail";
import { parseMail, type MailPage } from "../../kernel/mail";

/** A recorded answer of the mail read as the app gets it. */
export function recordedMail(name = "mail.json"): MailPage {
  const document = JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/mail", name), "utf8")) as { result: unknown };
  const page = parseMail(document.result);
  if (!page.ok) throw new Error(`${name}: ${page.error.code}`);
  return page.value;
}

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  mail: () => recordedMail(),
});
