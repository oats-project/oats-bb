// The mail read's adapter (kernel/mail.ts) against the answers recorded from the real kernel and
// the real messaging layer (test/fixtures/mail/README.md): mail, no mail, two pages, two teams, an
// identity that cannot be read, and each refusal the stage could produce. A shape the stage could
// not produce is a RECORDED answer with ONE named field changed here, in the test's own code, and
// the test's name says so.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { answerOf } from "../../kernel/envelope.js";
import { MAIL_BODY_BYTES, MAIL_BODY_LINES, MAIL_TIMEOUT_MS, bodyLines, cursorUsable, mailArgv, mailPage, parseMail, verbs } from "../../kernel/mail.js";
import type { Runner } from "../../kernel/runner.js";

type Row = Record<string, unknown>;
type Mail = { acknowledges?: unknown; identities: Row[]; messages: (Row & { body: string; from: Row })[]; conversations: Row[]; hasMore: boolean; nextCursor: string | null } & Row;
const file = (name: string): string => readFileSync(resolve(process.cwd(), "test/fixtures/mail", name), "utf8");
/** What `oats` printed, as the plugin's own reader of a finished process answers it. */
const answered = (name: string, exit = 0) => answerOf({ kind: "exit", code: exit, signal: null, stdout: file(name), stderr: "" }, "oats");
/** The run of a recorded answer (the envelope's `result`), to change one field of. */
const run = (name: string): Row & { result: { documents: unknown[]; mail: Mail } } => structuredClone((JSON.parse(file(name)) as { result: Row & { result: { documents: unknown[]; mail: Mail } } }).result);
const read = (name: string) => {
  const document = answered(name);
  if (!document.ok) throw new Error(`${name} is a refusal`);
  const page = parseMail(document.value);
  if (!page.ok) throw new Error(`${name} could not be read: ${page.error.code}`);
  expect(mailPage.parse(page.value)).toEqual(page.value);
  return page.value;
};
const HOME = "/abs/deployment/agents/oats-developer/instances/mail-reader";
const calls = JSON.parse(file("calls.json")) as Record<string, { argv: string[]; exit: number }>;

describe("the argv of the mail read", () => {
  it("is the messaging layer's view operation of the home the kernel named, one page, and nothing else", () => {
    expect(mailArgv(HOME)).toEqual({ ok: true, value: ["operation", "run", "messaging:mail", "--home", HOME, "--arg", "limit=50", "--json"] });
    expect(mailArgv(HOME, "abc")).toEqual({ ok: true, value: ["operation", "run", "messaging:mail", "--home", HOME, "--arg", "limit=50", "--arg", "cursor=abc", "--json"] });
  });

  it("is the argv the recorded answers were given for: the one that left the unread counts as they were", () => {
    // The recording counted the agent's unread mail before and after its reads (the fixtures' README): 3 and 3.
    expect(calls.mail).toEqual({ argv: mailArgv(HOME).ok ? (mailArgv(HOME) as { value: string[] }).value : [], exit: 0 });
    const first = run("mail-first-page.json").result.mail.nextCursor as string;
    const older = mailArgv(HOME, first);
    expect(older.ok && older.value.slice(0, 5)).toEqual(calls["mail-older-page"]?.argv.slice(0, 5));
    expect(older.ok && older.value.at(-2)).toBe(calls["mail-older-page"]?.argv.at(-2));
  });

  it("never names aw, an act of mail, a conversation, or anything a caller chose but the cursor", () => {
    for (const cursor of [null, "abc", "--home", "-x", "ack", "limit=1"]) {
      const argv = mailArgv(HOME, cursor);
      expect(argv.ok).toBe(true);
      if (!argv.ok) continue;
      expect(argv.value.slice(0, 3)).toEqual(["operation", "run", "messaging:mail"]);
      expect(argv.value.filter((word) => word.startsWith("--"))).toEqual(cursor === null ? ["--home", "--arg", "--json"] : ["--home", "--arg", "--arg", "--json"]);
      // A cursor is one element behind `--arg`, whole: never a word of its own.
      if (cursor !== null) expect(argv.value.at(-2)).toBe(`cursor=${cursor}`);
      for (const word of ["aw", "ack", "reply", "send", "inbox", "conversation"]) expect(argv.value.some((part) => part === word || part.startsWith(`${word}=`))).toBe(false);
    }
  });

  it("refuses a home that is no absolute path and a cursor that cannot travel, before any process starts", () => {
    expect(mailArgv("home").ok).toBe(false);
    expect(mailArgv(HOME, "").ok).toBe(false);
    expect(mailArgv(HOME, "a\nb").ok).toBe(false);
    expect(mailArgv(HOME, "x".repeat(1025)).ok).toBe(false);
    expect(cursorUsable("x".repeat(1024))).toBe(true);
  });

  it("runs with the mail's own time limit, past the provider's 150 s budget", async () => {
    const seen: { argv: unknown; timeoutMs: number }[] = [];
    const runner = { run: (argv: unknown, _parse: unknown, timeoutMs: number) => (seen.push({ argv, timeoutMs }), Promise.resolve({ ok: false, error: { code: "X", message: "" } })) } as unknown as Runner;
    await verbs(runner).mail(HOME, null);
    expect(seen).toEqual([{ argv: mailArgv(HOME), timeoutMs: MAIL_TIMEOUT_MS }]);
    expect(MAIL_TIMEOUT_MS).toBeGreaterThan(150_000);
  });
});

describe("the recorded mail", () => {
  it("the received mail only, newest first: who it is from, its subject, when", () => {
    const page = read("mail.json");
    // Four messages recorded: three received and one the agent sent. The sent one is not shown.
    expect(run("mail.json").result.mail.messages.map((message) => message.direction)).toEqual(["received", "received", "sent", "received"]);
    expect(page.messages.map((message) => [message.from, message.subject, message.sender, message.shortened])).toEqual([
      ["mail-writer", "<i>Markup</i> in a subject", null, false],
      ["mail-writer", "A long report", null, true],
      ["mail-writer", "Parser ready for a first read", null, false],
    ]);
    expect(page.messages.map((message) => Date.parse(message.at))).toEqual([...page.messages.map((message) => Date.parse(message.at))].sort((a, b) => b - a));
    expect(page.unread).toEqual([]);
    expect(page.older).toBeNull();
    expect(new Set(page.messages.map((message) => message.key)).size).toBe(3);
    // A key is when the message was sent and a hash: the same for the same message in another answer, and it holds neither its id nor its team.
    expect(read("mail-two-teams.json").messages.map((message) => message.key)).toEqual(expect.arrayContaining(page.messages.map((message) => message.key)));
    for (const message of page.messages) expect(message.key).toBe(`${message.at}#${message.key.slice(-16)}`);
  });

  it("a body keeps its lines, and its blank lines", () => {
    const first = read("mail.json").messages[2];
    expect(first?.lines).toEqual(["The parser is ready for a first read.", "", "Two things are still open:", "- the list at 390 px", "- the words of the refusals"]);
  });

  it("a 300 KB body arrives cut by the provider at 16 KiB, and is said to be shortened", () => {
    const recorded = run("mail.json").result.mail.messages[1];
    expect(recorded?.truncated).toBe(true);
    expect(Buffer.byteLength(recorded?.body ?? "")).toBe(MAIL_BODY_BYTES);
    const long = read("mail.json").messages[1];
    expect(long?.shortened).toBe(true);
    expect(long?.lines[0]).toBe("Line 1 of a long report about nothing in particular.");
    expect(Buffer.byteLength((long?.lines ?? []).join("\n"))).toBeLessThanOrEqual(MAIL_BODY_BYTES);
  });

  it("no mail", () => {
    expect(read("mail-none.json")).toMatchObject({ messages: [], unread: [], older: null });
  });

  it("two pages: the first names the cursor of the older one, and the older one's mail is no message of the first", () => {
    const first = read("mail-first-page.json");
    expect(first.messages).toHaveLength(2);
    expect(first.older).toBe(run("mail-first-page.json").result.mail.nextCursor);
    expect(cursorUsable(first.older)).toBe(true);
    const older = read("mail-older-page.json");
    // The older page holds one received message and the one the agent sent.
    expect(older.messages.map((message) => message.subject)).toEqual(["Parser ready for a first read"]);
    expect(older.older).toBeNull();
    expect(first.messages.map((message) => message.key)).not.toContain(older.messages[0]?.key);
  });

  it("two teams: the mail of both, newest first", () => {
    const page = read("mail-two-teams.json");
    expect(page.messages.map((message) => message.subject)).toEqual(["Review at four", "<i>Markup</i> in a subject", "A long report", "Parser ready for a first read"]);
    expect(page.unread).toEqual([]);
  });

  it("one team's identity is missing, or cannot be read: the other team's mail shows, and the team is named, without the provider's word", () => {
    const missing = read("mail-identity-missing.json");
    expect(missing.unread).toEqual([{ team: "wider", conversations: null }]);
    expect(missing.messages).toHaveLength(3);
    expect(read("mail-identity-unreadable.json").unread).toEqual([{ team: "wider", conversations: null }]);
    // The provider names neither the alias nor the identity of one it could not read: both are "" as recorded.
    expect(run("mail-identity-missing.json").result.mail.identities[1]).toMatchObject({ alias: "", identity: "", error: "identity-missing" });
  });
});

describe("a hostile message (recorded: markup, a link, a bidi override, a zero-width space, a control character, a line shaped like a credential)", () => {
  const hostile = () => read("mail.json").messages[0];

  it("the recorded body holds them", () => {
    const body = run("mail.json").result.mail.messages[0]?.body ?? "";
    for (const part of ["<script>", "\u202E", "\u200B", "\u0007", "https://example.invalid/y"]) expect(body).toContain(part);
  });

  it("markup and a link are text: the lines as written, nothing parsed", () => {
    expect(hostile()?.subject).toBe("<i>Markup</i> in a subject");
    expect(hostile()?.lines[0]).toBe("<b>bold?</b> <script>alert(1)</script>");
    expect(hostile()?.lines[1]).toBe("[a link](https://example.invalid/x) https://example.invalid/y");
  });

  it("a line with a control character, and a line shaped like a credential, are each withheld whole; the other lines show", () => {
    // The display filter's rule (model/text.ts `UNSAFE`): a C0 control other than tab and line feed withholds the text it is in. Line by line, that is one line.
    expect(hostile()?.lines).toEqual(["<b>bold?</b> <script>alert(1)</script>", "[a link](https://example.invalid/x) https://example.invalid/y", "[withheld]", "[withheld]", "last line."]);
  });

  it("a bidi override and a zero-width space in a line with no control character each show as U+FFFD", () => {
    expect(bodyLines("reversed \u202Etxet\u202C here, zero\u200Bwidth.").lines).toEqual(["reversed \uFFFDtxet\uFFFD here, zero\uFFFDwidth."]);
  });

  it("no line of any recorded message holds a character the filter replaces", () => {
    for (const name of ["mail.json", "mail-two-teams.json", "mail-first-page.json", "mail-older-page.json"]) {
      for (const message of read(name).messages) {
        for (const line of [message.from, message.subject ?? "", ...message.lines]) expect(line).not.toMatch(/[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF]/u);
      }
    }
  });
});

describe("the named difference from the Desktop's decoder: a body over the bound (a recorded answer with ONE field changed: a message's body)", () => {
  it("a 300 KB body in an answer is cut at 16 KiB at a character's boundary and said to be shortened, where the Desktop refuses the page", () => {
    const changed = run("mail.json");
    const target = changed.result.mail.messages[3];
    if (!target) throw new Error("no fourth message");
    expect(target.truncated).toBe(false);
    target.body = "é".repeat(150 * 1024); // 300 KB of two-byte characters, in one line
    const page = parseMail(changed);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const cut = page.value.messages[2];
    expect(cut?.shortened).toBe(true);
    // One line of 8192 characters: the display filter then cuts a line at 2048.
    expect(cut?.lines).toHaveLength(1);
    expect(cut?.lines[0]).toBe("é".repeat(2048));
    // The other messages of the page still show.
    expect(page.value.messages).toHaveLength(3);
  });

  it("a body under the bound with ONE line longer than the display filter's line (2048 characters): that line is drawn cut, and the message is said to be shortened", () => {
    const changed = run("mail.json");
    const target = changed.result.mail.messages[3];
    if (!target) throw new Error("no fourth message");
    expect(target.truncated).toBe(false);
    target.body = `first line\n${"word ".repeat(1000)}\nlast line`; // 5 KB in one line, under 16 KiB
    const page = parseMail(changed);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const cut = page.value.messages[2];
    expect(cut?.lines.map((line) => line.length)).toEqual([10, 2048, 9]);
    expect(cut?.shortened).toBe(true);
  });

  it("a long line that fits once its runs of spaces are one space each is whole, and the message is not said to be shortened; nor is one whose long line is withheld", () => {
    expect(bodyLines(`a${" ".repeat(3000)}b`)).toEqual({ lines: ["a b"], cut: false });
    expect(bodyLines(`password: ${"x".repeat(3000)}`)).toEqual({ lines: ["[withheld]"], cut: false });
    expect(bodyLines("x".repeat(2048))).toEqual({ lines: ["x".repeat(2048)], cut: false });
    expect(bodyLines("x".repeat(2049))).toEqual({ lines: ["x".repeat(2048)], cut: true });
    // A cut that falls inside a surrogate pair leaves one character less.
    expect(bodyLines(`${"x".repeat(2047)}😀y`).cut).toBe(true);
  });

  it("a body of very many lines carries MAIL_BODY_LINES of them and is said to be shortened", () => {
    const changed = run("mail.json");
    const target = changed.result.mail.messages[3];
    if (!target) throw new Error("no fourth message");
    target.body = "a\n".repeat(MAIL_BODY_LINES + 5);
    const page = parseMail(changed);
    expect(page.ok && page.value.messages[2]?.lines).toHaveLength(MAIL_BODY_LINES);
    expect(page.ok && page.value.messages[2]?.shortened).toBe(true);
  });
});

describe("what the stage could not produce (a recorded answer with ONE named field changed)", () => {
  const withMail = (change: (mail: Mail) => void) => {
    const changed = run("mail.json");
    change(changed.result.mail);
    return parseMail(changed);
  };
  const first = (mail: Mail) => mail.messages[0] as Row & { from: Row };

  it.each([
    ["unverified", "unverified"],
    ["unknown", "unverified"],
    ["failed", "failed"],
    ["verified", null],
  ])("a message's `verification` %s: the sender reads %s", (verification, sender) => {
    const page = withMail((mail) => void (first(mail).verification = verification));
    expect(page.ok && page.value.messages[0]?.sender).toBe(sender);
  });

  it.each(["no-mail-read", "threads-unreadable", "too-many-threads", "a word the plugin does not know"])("an identity's `error` %s: the team is named, without that word, and its mail still shows", (error) => {
    const page = withMail((mail) => void ((mail.identities[0] as Row).error = error));
    expect(page.ok && page.value.unread).toEqual([{ team: "mailspike", conversations: null }]);
    expect(page.ok && page.value.messages).toHaveLength(3);
    // The provider's word for why is not drawn, so it does not leave the machine.
    expect(JSON.stringify(page)).not.toContain(error);
  });

  it("an identity's `error` conversation-unreadable with its `unreadableConversations`: how many, and never their ids", () => {
    const page = withMail((mail) => Object.assign(mail.identities[0] as Row, { error: "conversation-unreadable", unreadableConversations: ["c-1", "c-2"] }));
    expect(page.ok && page.value.unread).toEqual([{ team: "mailspike", conversations: 2 }]);
    expect(JSON.stringify(page)).not.toContain("c-1");
  });

  it("a message with no subject reads its thread's title, and with neither, none", () => {
    const titled = withMail((mail) => Object.assign(first(mail), { subject: "", threadTitle: "The thread's title" }));
    expect(titled.ok && titled.value.messages[0]?.subject).toBe("The thread's title");
    const neither = withMail((mail) => Object.assign(first(mail), { subject: "", threadTitle: "" }));
    expect(neither.ok && neither.value.messages[0]?.subject).toBeNull();
  });

  it("a cursor that cannot travel as an argument offers no older page", () => {
    const page = withMail((mail) => Object.assign(mail, { hasMore: true, nextCursor: "x".repeat(1025) }));
    expect(page.ok && page.value.older).toBeNull();
  });
});

describe("an answer outside the contract is refused whole (a recorded answer with ONE named field changed)", () => {
  const refused = (change: (answer: ReturnType<typeof run>) => void) => {
    const changed = run("mail.json");
    change(changed);
    return parseMail(changed);
  };
  const BAD = { ok: false, error: { code: "OATS_BAD_ANSWER", message: "`oats operation run messaging:mail` answered mail the plugin cannot read" } };

  it.each([
    ["acknowledges: true", (answer: ReturnType<typeof run>) => void (answer.result.mail.acknowledges = true)],
    ["acknowledges absent", (answer: ReturnType<typeof run>) => void delete answer.result.mail.acknowledges],
    ["acknowledges: null", (answer: ReturnType<typeof run>) => void (answer.result.mail.acknowledges = null)],
    ["mailApi: 2", (answer: ReturnType<typeof run>) => void (answer.result.mail.mailApi = 2)],
    ["another operation", (answer: ReturnType<typeof run>) => void (answer.operation = "messaging:other")],
    ["operationsApi: 3", (answer: ReturnType<typeof run>) => void (answer.operationsApi = 3)],
    ["a key the contract does not have", (answer: ReturnType<typeof run>) => void (answer.result.mail.extra = 1)],
    ["a message with a key more", (answer: ReturnType<typeof run>) => void ((answer.result.mail.messages[0] as Row).html = "<b>")],
    ["a direction outside the set", (answer: ReturnType<typeof run>) => void ((answer.result.mail.messages[0] as Row).direction = "draft")],
    ["a verification outside the set", (answer: ReturnType<typeof run>) => void ((answer.result.mail.messages[0] as Row).verification = "trusted")],
    ["a time that is none", (answer: ReturnType<typeof run>) => void ((answer.result.mail.messages[0] as Row).createdAt = "yesterday")],
    ["more to read and no cursor", (answer: ReturnType<typeof run>) => void (answer.result.mail.hasMore = true)],
    ["the same message twice", (answer: ReturnType<typeof run>) => void answer.result.mail.messages.push(structuredClone(answer.result.mail.messages[0]) as Mail["messages"][number])],
    ["201 messages", (answer: ReturnType<typeof run>) => void (answer.result.mail.messages = Array.from({ length: 201 }, (_, at) => ({ ...(answer.result.mail.messages[0] as Mail["messages"][number]), id: `m-${at}` })))],
    ["an identity with no error and no alias", (answer: ReturnType<typeof run>) => void ((answer.result.mail.identities[0] as Row).alias = "")],
    ["unreadableConversations beside another error", (answer: ReturnType<typeof run>) => void Object.assign(answer.result.mail.identities[0] as Row, { error: "no-mail-read", unreadableConversations: [] })],
  ])("%s", (_name, change) => {
    expect(refused(change)).toEqual(BAD);
  });

  it("the refusal names no word of the mail", () => {
    const answer = refused((changed) => void (changed.result.mail.acknowledges = true));
    expect(JSON.stringify(answer)).not.toMatch(/Parser|report|mail-writer/);
  });

  it.each([null, 1, "mail", [], {}])("%j is no answer", (document) => {
    expect(parseMail(document)).toEqual(BAD);
  });
});

describe("the recorded refusals, as the plugin's reader of a finished process answers them", () => {
  it.each([
    ["refused-no-messaging.json", "E_OPERATION_UNAVAILABLE", "no messaging provider is resolved for /abs/deployment/agents/knowledge-harvester/instances/mail-none"],
    ["refused-messaging-too-old.json", "E_OPERATION_UNKNOWN", 'oats.aweb declares no operation "mail" (declared: teams, join, leave, invite)'],
    ["refused-aw-too-old.json", "E_AW_TOO_OLD", "messaging:mail: aw 1.36.33 cannot list mail threads, so mail can't be read without acknowledging it: messaging:mail needs aw >= 1.36.53; upgrade with `npm i -g @awebai/aw@latest`"],
    ["refused-no-identity.json", "E_MAIL_UNREADABLE", "messaging:mail: no identity of this instance could be read (mailspike: identity-missing)"],
    ["refused-bad-cursor.json", "E_BAD_ARGS", "messaging:mail: cursor is not a nextCursor from a previous answer"],
    ["refused-bad-limit.json", "E_BAD_ARGS", "messaging:mail: limit must be a whole number from 1 to 200"],
  ])("%s: %s, with the kernel's sentence", (name, code, message) => {
    expect(calls[name.replace(".json", "")]?.exit).toBe(1);
    expect(answered(name, 1)).toEqual({ ok: false, error: { code, message } });
  });
});
