// The mail's RPC verb, through the whole backend: bb's fake plugin host, the real host entry and
// the fake `oats` printing the recorded answers (test/support/backend.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostContract, rpcContract } from "../../contract/index.js";
import { MAIL_TIMEOUT_MS, type MailPage } from "../../kernel/mail.js";
import { MAIL_HOST_TIMEOUT_MS } from "../../server/mail.js";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

const AGENT = "redesign-ui-lead";
const mail = (file: string) => ({ "operation run messaging:mail": { file: `mail/${file}` } });
const cursorOf = (file: string): string => (JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/mail", file), "utf8")) as { result: { result: { mail: { nextCursor: string } } } }).result.result.mail.nextCursor;

describe("mail", () => {
  it("reads one page of the home the kernel named for the instance, with the one argv that marks nothing read", async () => {
    backend = await startBackend();
    const home = (await backend.rpc<{ agents: { instance: string; home: string }[] }>("snapshot")).agents.find((agent) => agent.instance === AGENT)?.home;
    const page = await backend.rpc<MailPage>("mail", { instance: AGENT, older: null });
    expect(page.messages.map((message) => message.subject)).toEqual(["<i>Markup</i> in a subject", "A long report", "Parser ready for a first read"]);
    const calls = (await backend.fake.calls()).filter((call) => call.verb !== "status");
    expect(calls.map((call) => call.argv)).toEqual([["operation", "run", "messaging:mail", "--home", home, "--arg", "limit=50", "--json"]]);
  });

  it("the page after a cursor: the cursor is one argument, whole", async () => {
    const cursor = cursorOf("mail-first-page.json");
    backend = await startBackend({ verbs: mail("mail-older-page.json") });
    const page = await backend.rpc<MailPage>("mail", { instance: AGENT, older: cursor });
    expect(page.messages.map((message) => message.subject)).toEqual(["Parser ready for a first read"]);
    const argv = (await backend.fake.calls()).filter((call) => call.verb !== "status")[0]?.argv ?? [];
    expect(argv.slice(-3)).toEqual(["--arg", `cursor=${cursor}`, "--json"]);
  });

  it("answers what the app draws and nothing else of a message but an opaque key: no identity, no address, no message or conversation id, no team's label in the key, no sent mail", async () => {
    backend = await startBackend({ verbs: mail("mail-two-teams.json") });
    const page = await backend.rpc<MailPage>("mail", { instance: AGENT, older: null });
    expect(Object.keys(page).sort()).toEqual(["messages", "older", "unread"]);
    for (const message of page.messages) expect(Object.keys(message).sort()).toEqual(["at", "from", "key", "lines", "sender", "shortened", "subject"]);
    const sent = JSON.stringify(page);
    for (const kept of ["did:key", "mailspike.test/", "conversationId", "Re: first read", "Thanks."]) expect(sent).not.toContain(kept);
    // The recorded ids of every message and conversation, and the teams' labels: none is in what is answered (a key is a time and a hash).
    const recorded = (JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/mail/mail-two-teams.json"), "utf8")) as { result: { result: { mail: { messages: { id: string; conversationId: string; team: string }[] } } } }).result.result.mail.messages;
    expect(recorded).toHaveLength(5);
    for (const message of recorded) for (const kept of [message.id, message.conversationId]) expect(sent).not.toContain(kept);
    for (const message of page.messages) expect(message.key).toMatch(/^\d{4}-\d{2}-\d{2}T[^#]+#[0-9a-f]{16}$/);
    expect(new Set(page.messages.map((message) => message.key)).size).toBe(page.messages.length);
  });

  it("takes an instance and a cursor, and nothing else: no home, no flag, no limit of a caller's", async () => {
    backend = await startBackend();
    await expect(backend.rpc("mail", { instance: AGENT, older: null, home: "/tmp" })).rejects.toThrow();
    await expect(backend.rpc("mail", { instance: AGENT, older: null, limit: 200 })).rejects.toThrow();
    await expect(backend.rpc("mail", { instance: "--json", older: null })).rejects.toThrow();
    await expect(backend.rpc("mail", { instance: AGENT, older: "a\nb" })).rejects.toThrow();
    await expect(backend.rpc("mail", { instance: AGENT, older: "x".repeat(1025) })).rejects.toThrow();
    await expect(backend.rpc("mail", { instance: "gone-helper", older: null })).rejects.toThrow('"gone-helper" is not an agent of this OATS deployment\'s current snapshot');
    expect((await backend.fake.calls()).filter((call) => call.verb !== "status")).toEqual([]);
  });

  it.each([
    ["refused-no-messaging.json", "E_OPERATION_UNAVAILABLE: no messaging provider is resolved for"],
    ["refused-messaging-too-old.json", 'E_OPERATION_UNKNOWN: oats.aweb declares no operation "mail"'],
    ["refused-aw-too-old.json", "E_AW_TOO_OLD: messaging:mail: aw 1.36.33 cannot list mail threads"],
    ["refused-no-identity.json", "E_MAIL_UNREADABLE: messaging:mail: no identity of this instance could be read"],
    ["refused-bad-cursor.json", "E_BAD_ARGS: messaging:mail: cursor is not a nextCursor from a previous answer"],
  ])("a recorded refusal (%s) is the RPC's refusal, with the kernel's code and sentence", async (file, refusal) => {
    backend = await startBackend({ verbs: mail(file) });
    await expect(backend.rpc("mail", { instance: AGENT, older: null })).rejects.toThrow(refusal);
  });

  it("an answer that does not say it acknowledged nothing is refused whole, and names no word of the mail (a recorded answer with ONE field changed: `acknowledges`)", async () => {
    const answer = JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/mail/mail.json"), "utf8")) as { result: { result: { mail: { acknowledges: unknown } } } };
    answer.result.result.mail.acknowledges = true;
    backend = await startBackend({ verbs: { "operation run messaging:mail": { stdout: JSON.stringify(answer) } } });
    const refused = await backend.rpc("mail", { instance: AGENT, older: null }).then(
      () => null,
      (error: Error) => error.message,
    );
    expect(refused).toContain("OATS_BAD_ANSWER: `oats operation run messaging:mail` answered mail the plugin cannot read");
    expect(refused).not.toMatch(/Parser|report|mail-writer/);
  });
});

describe("the mail's verbs: one read each way, and no act", () => {
  it("the app's contract and the host's each gain `mail`", () => {
    expect(Object.keys(rpcContract).filter((verb) => /mail/i.test(verb))).toEqual(["mail"]);
    expect(Object.keys(hostContract).filter((verb) => /mail/i.test(verb))).toEqual(["mail"]);
  });

  it("a slow read ends by the process's own limit, as OATS_TIMEOUT: the host verb is not one bb retries (bb cancels a retryable call at half its limit), and the host call's limit is the longer", () => {
    expect("experimental_retryable" in hostContract.mail).toBe(false);
    expect(MAIL_HOST_TIMEOUT_MS).toBeGreaterThan(MAIL_TIMEOUT_MS);
    // Past the messaging layer's own 150 s budget, and under bb's cap for a host call.
    expect(MAIL_TIMEOUT_MS).toBeGreaterThan(150_000);
    expect(MAIL_HOST_TIMEOUT_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});
