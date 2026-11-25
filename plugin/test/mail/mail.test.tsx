// @vitest-environment jsdom
// An agent's incoming mail as a person sees it (D-132, D-154 to D-157): the list, one message in
// its place, the words, each refusal's one line, and when it reads. Drawn from the answers
// recorded from the real kernel and messaging layer (test/fixtures/mail/README.md); where the
// stage could produce no such answer, from a recorded one with ONE named field changed here.
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Mail } from "../../app/mail";
import { refusalLine } from "../../app/mail/words";
import type { MailPage } from "../../kernel/mail";
import { handlers, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { recordedMail } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
});

const AGENT = "redesign-ui-lead";
/** A quarter of an hour after the recorded mail was sent. */
const NOW = Date.parse("2026-11-25T12:15:00.000Z");
const text = (element: Element | null) => element?.textContent ?? "";

function mail(over: Partial<Handlers> = {}, instance = AGENT) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return renderSlot<{ instance: string }, Contract>({ component: Mail }, { instance }, { rpc: handlers(over) });
}
/** The view, for an agent a test changes: the place that mounts it gives it another instance. */
let showAgent: (instance: string) => void = () => undefined;
function Shown({ instance }: { instance: string }) {
  const [now, setNow] = useState(instance);
  showAgent = setNow;
  return <Mail instance={now} />;
}
function mailOf(over: Partial<Handlers> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return renderSlot<{ instance: string }, Contract>({ component: Shown }, { instance: AGENT }, { rpc: handlers(over) });
}
const reads = (slot: { inspection: { rpcCalls: { method: string; input: unknown }[] } }) => slot.inspection.rpcCalls.filter((call) => call.method === "mail").map((call) => call.input);
const rows = (root: HTMLElement) => within(root).getAllByTestId("oats-mail-row");
/** A promise a test settles when it wants: a read in flight. */
function pending<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<Value>((yes, no) => ((resolve = yes), (reject = no)));
  return { promise, resolve, reject };
}

// ---- the list

test("the list: the mail the agent received, newest first; each row is who it is from and its age, then its subject", async () => {
  const slot = mail();
  const list = await slot.findByTestId("oats-mail-list");
  expect(list.getAttribute("aria-label")).toBe("Mail, newest first");
  expect(rows(list).map((row) => text(row))).toEqual(["mail-writer15 min ago<i>Markup</i> in a subject", "mail-writer15 min agoA long report", "mail-writer15 min agoParser ready for a first read"]);
  // The one message the agent sent is no row.
  expect(text(list)).not.toContain("Re: first read");
  expect(reads(slot)).toEqual([{ instance: AGENT, older: null }]);
});

test("markup in a subject is text: no element is made of it", async () => {
  const slot = mail();
  const subject = (await slot.findAllByTestId("oats-mail-subject"))[0] as HTMLElement;
  expect(text(subject)).toBe("<i>Markup</i> in a subject");
  expect(subject.querySelector("i")).toBeNull();
  expect(slot.container.querySelector("script, a, img, iframe")).toBeNull();
});

test("no mail: the two words, and Refresh", async () => {
  const slot = mail({ mail: () => recordedMail("mail-none.json") });
  expect(text(await slot.findByTestId("oats-mail-empty"))).toBe("No mail.");
  expect(slot.queryByTestId("oats-mail-list")).toBeNull();
  expect(text(slot.getByTestId("oats-mail-refresh"))).toBe("Refresh");
  // Just read: no age is said.
  expect(text(slot.getByTestId("oats-mail-read"))).toBe("");
});

test("while the first read is on its way: Reading…, and nothing else", async () => {
  const wait = pending<MailPage>();
  const slot = mail({ mail: () => wait.promise });
  expect(text(await slot.findByTestId("oats-loading"))).toBe("Reading…");
  expect(slot.queryByTestId("oats-mail-refresh")).toBeNull();
  await act(async () => wait.resolve(recordedMail()));
  await slot.findByTestId("oats-mail-list");
  expect(slot.queryByTestId("oats-loading")).toBeNull();
});

test("a sender that is not verified, and a signature that failed, are said on the row and on the message, in the warning tone (a recorded answer with ONE field changed: `sender`, as the adapter reads `verification`)", async () => {
  const page = recordedMail();
  (page.messages[0] as MailPage["messages"][number]).sender = "unverified";
  (page.messages[1] as MailPage["messages"][number]).sender = "failed";
  const slot = mail({ mail: () => page });
  const list = await slot.findByTestId("oats-mail-list");
  const said = within(list).getAllByTestId("oats-mail-sender");
  expect(said.map(text)).toEqual(["Unverified sender", "Signature failed"]);
  for (const word of said) expect(word.className).toContain("text-warning-text");
  // A verified sender's row says nothing of it.
  expect(within(rows(list)[2] as HTMLElement).queryByTestId("oats-mail-sender")).toBeNull();
  fireEvent.click(rows(list)[1] as HTMLElement);
  expect(text(within(await slot.findByTestId("oats-mail-message")).getByTestId("oats-mail-sender"))).toBe("Signature failed");
});

test("a message with no subject reads (no subject) (a recorded answer with ONE field changed: `subject`)", async () => {
  const page = recordedMail();
  (page.messages[0] as MailPage["messages"][number]).subject = null;
  const slot = mail({ mail: () => page });
  expect(text((await slot.findAllByTestId("oats-mail-subject"))[0] as HTMLElement)).toBe("(no subject)");
});

// ---- one message

test("a press on a row shows the message in the list's place: its subject, its age, the sender's alias as its first line, then the body's lines; Back returns to the list and the focus to that row", async () => {
  const slot = mail();
  const list = await slot.findByTestId("oats-mail-list");
  fireEvent.click(rows(list)[2] as HTMLElement);
  const message = await slot.findByTestId("oats-mail-message");
  expect(slot.queryByTestId("oats-mail-list")).toBeNull();
  expect(text(message.querySelector("h3"))).toBe("Parser ready for a first read");
  expect(text(message.querySelector("header p"))).toBe("15 min ago");
  const lines = Array.from(within(message).getByTestId("oats-mail-body").querySelectorAll("p")).map(text);
  expect(lines).toEqual(["mail-writer", "The parser is ready for a first read.", "", "Two things are still open:", "- the list at 390 px", "- the words of the refusals"]);
  expect(within(message).queryByTestId("oats-mail-shortened")).toBeNull();
  // The message takes the focus on Back.
  const back = within(message).getByTestId("oats-mail-back");
  expect(text(back)).toBe("‹ Back");
  expect(document.activeElement).toBe(back);
  fireEvent.click(back);
  const again = await slot.findByTestId("oats-mail-list");
  expect(document.activeElement).toBe(rows(again)[2]);
  // Opening and closing a message reads nothing.
  expect(reads(slot)).toHaveLength(1);
});

test("the hostile message: markup and a link are text, never an element; a line with a control character and a line shaped like a credential are withheld, and the others show", async () => {
  const slot = mail();
  fireEvent.click(rows(await slot.findByTestId("oats-mail-list"))[0] as HTMLElement);
  const body = within(await slot.findByTestId("oats-mail-message")).getByTestId("oats-mail-body");
  expect(Array.from(body.querySelectorAll("p")).map(text)).toEqual([
    "mail-writer",
    "<b>bold?</b> <script>alert(1)</script>",
    "[a link](https://example.invalid/x) https://example.invalid/y",
    "[withheld]",
    "[withheld]",
    "last line.",
  ]);
  expect(slot.container.querySelector("b, script, a, img")).toBeNull();
  expect(text(body)).not.toMatch(/[\u202A-\u202E\u200B\u0007]/);
});

test("the 300 KB message, which the messaging layer cut: its first lines, and Shortened.", async () => {
  const slot = mail();
  fireEvent.click(rows(await slot.findByTestId("oats-mail-list"))[1] as HTMLElement);
  const message = await slot.findByTestId("oats-mail-message");
  expect(text(within(message).getByTestId("oats-mail-shortened"))).toBe("Shortened.");
  expect(text(within(message).getByTestId("oats-mail-body").querySelectorAll("p")[1] ?? null)).toBe("Line 1 of a long report about nothing in particular.");
});

// ---- reading again, and further back

test("Refresh reads the first page again, keeps the list on screen meanwhile, and is off while it reads", async () => {
  const wait = pending<MailPage>();
  let asked = 0;
  const slot = mail({ mail: () => (++asked === 1 ? recordedMail("mail-none.json") : wait.promise) });
  await slot.findByTestId("oats-mail-empty");
  fireEvent.click(slot.getByTestId("oats-mail-refresh"));
  await waitFor(() => expect(text(slot.getByTestId("oats-mail-read"))).toBe("Reading…"));
  expect((slot.getByTestId("oats-mail-refresh") as HTMLButtonElement).disabled).toBe(true);
  expect(slot.queryByTestId("oats-mail-empty")).not.toBeNull();
  await act(async () => wait.resolve(recordedMail()));
  expect(rows(await slot.findByTestId("oats-mail-list"))).toHaveLength(3);
  expect(reads(slot)).toEqual([{ instance: AGENT, older: null }, { instance: AGENT, older: null }]);
});

test("Older: only while there is an older page; it reads the page after the cursor the last one named and adds its mail under the list", async () => {
  const first = recordedMail("mail-first-page.json");
  const slot = mail({ mail: ({ older }) => (older === null ? first : recordedMail("mail-older-page.json")) });
  const list = await slot.findByTestId("oats-mail-list");
  expect(rows(list)).toHaveLength(2);
  const older = slot.getByTestId("oats-mail-older");
  expect(text(older)).toBe("Older");
  fireEvent.click(older);
  await waitFor(() => expect(rows(slot.getByTestId("oats-mail-list"))).toHaveLength(3));
  expect(text(rows(slot.getByTestId("oats-mail-list"))[2] as HTMLElement)).toContain("Parser ready for a first read");
  expect(reads(slot)).toEqual([{ instance: AGENT, older: null }, { instance: AGENT, older: first.older }]);
  // No page is older than that one.
  expect(slot.queryByTestId("oats-mail-older")).toBeNull();
});

test("Older: the teams that could not be read are those of the page just read (a recorded older page with ONE field changed: a team's `conversations`)", async () => {
  const first = recordedMail("mail-first-page.json");
  const older = recordedMail("mail-older-page.json");
  older.unread = [{ team: "mailspike", conversations: 3 }];
  const slot = mail({ mail: ({ older: cursor }) => (cursor === null ? first : older) });
  await slot.findByTestId("oats-mail-list");
  expect(slot.queryByTestId("oats-mail-unread")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-mail-older"));
  await waitFor(() => expect(slot.getAllByTestId("oats-mail-unread").map(text)).toEqual(["mailspike: 3 conversations can't be read"]));
});

test("shown again while its first read is still on its way: it takes that read's answer and starts no second one", async () => {
  const slow = pending<MailPage>();
  let asked = 0;
  const slot = mail({ mail: () => (++asked, slow.promise) });
  await slot.findByTestId("oats-loading");
  slot.unmount();
  const again = mail({ mail: () => (++asked, recordedMail("mail-none.json")) });
  await again.findByTestId("oats-loading");
  expect(asked).toBe(1);
  await act(async () => slow.resolve(recordedMail()));
  expect(rows(await again.findByTestId("oats-mail-list"))).toHaveLength(3);
  expect(asked).toBe(1);
  // Once it has landed, a view shown again reads again.
  again.unmount();
  const third = mail({ mail: () => (++asked, recordedMail()) });
  await third.findByTestId("oats-mail-list");
  await waitFor(() => expect(asked).toBe(2));
});

test("it reads when it is shown, on Refresh and on Older, and at no other time: not when the clock ticks, and not when OATS changes", async () => {
  vi.useFakeTimers({ now: NOW });
  const slot = renderSlot<{ instance: string }, Contract>({ component: Mail }, { instance: AGENT }, { rpc: handlers() });
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(reads(slot)).toHaveLength(1);
  await act(async () => void (await vi.advanceTimersByTimeAsync(10 * 60_000)));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: new Date().toISOString() }));
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  expect(reads(slot)).toHaveLength(1);
  expect(text(slot.getByTestId("oats-mail-read"))).toBe("Read 11 min ago.");
});

test("another agent: its own read, and nothing of the agent before on screen", async () => {
  const slot = mailOf({ mail: ({ instance }) => recordedMail(instance === AGENT ? "mail.json" : "mail-none.json") });
  await slot.findByTestId("oats-mail-list");
  act(() => showAgent("desktop-mockups-developer"));
  await slot.findByTestId("oats-mail-empty");
  expect(slot.queryByTestId("oats-mail-list")).toBeNull();
  expect(reads(slot)).toEqual([{ instance: AGENT, older: null }, { instance: "desktop-mockups-developer", older: null }]);
});

test("an answer that arrives for an agent no longer shown is dropped", async () => {
  const slow = pending<MailPage>();
  const slot = mailOf({ mail: ({ instance }) => (instance === AGENT ? slow.promise : recordedMail("mail-none.json")) });
  await slot.findByTestId("oats-loading");
  act(() => showAgent("desktop-mockups-developer"));
  await slot.findByTestId("oats-mail-empty");
  await act(async () => slow.resolve(recordedMail()));
  expect(slot.queryByTestId("oats-mail-list")).toBeNull();
  expect(text(slot.getByTestId("oats-mail-empty"))).toBe("No mail.");
});

// ---- why mail cannot be read

test.each([
  ["E_OPERATION_UNKNOWN", 'oats.aweb declares no operation "mail" (declared: teams, join, leave, invite)', "Its messaging is too old for mail."],
  ["E_OPERATION_UNAVAILABLE", "no messaging provider is resolved for /abs/deployment/agents/knowledge-harvester/instances/mail-none", "No messaging."],
  ["E_AW_TOO_OLD", "messaging:mail: aw 1.36.33 cannot list mail threads, so mail can't be read without acknowledging it: messaging:mail needs aw >= 1.36.53; upgrade with `npm i -g @awebai/aw@latest`", "aw is too old to read mail."],
  ["E_MAIL_UNREADABLE", "messaging:mail: no identity of this instance could be read (mailspike: identity-missing)", "Its mail can't be read."],
  ["E_MAIL_TOO_LARGE", "messaging:mail: this instance's mail answer can't fit the 256 KiB bound, even with no messages", "Too much mail to read."],
  ["OATS_BAD_ANSWER", "`oats operation run messaging:mail` answered mail the plugin cannot read", "Mail can't be read."],
  ["OATS_TIMEOUT", "`oats` did not answer within 170 s and was stopped", "Reading took too long."],
  ["E_BAD_ARGS", "messaging:mail: cursor is not a nextCursor from a previous answer", "Mail can't be read."],
  ["HOST_UNREACHABLE", "The machine that runs oats did not answer.", "Mail can't be read."],
])("%s: ONE line on the face, Retry, and the kernel's code with its sentence under Details", async (code, message, line) => {
  let asked = 0;
  const slot = mail({
    mail: () => {
      if (++asked === 1) throw new Error(`${code}: ${message}`);
      return recordedMail("mail-none.json");
    },
  });
  const notice = await slot.findByTestId("oats-notice");
  expect(text(notice.querySelector("h3"))).toBe(line);
  expect(notice.getAttribute("role")).toBe("alert");
  // The face: the line and its two controls. The code is not on it.
  const details = within(notice).getByTestId("oats-notice-details");
  const face = Array.from(notice.children).filter((child) => child !== details).map(text);
  expect(face).toEqual([line, "Retry"]);
  expect((details as HTMLDetailsElement).open).toBe(false);
  expect(text(details.querySelector("summary"))).toContain("Details");
  expect(text(details)).toContain(code);
  expect(text(details)).toContain(message.split(":").pop()?.trim().slice(0, 30) ?? "");
  // No Refresh beside the notice: Retry is the one act.
  expect(slot.queryByTestId("oats-mail-refresh")).toBeNull();
  fireEvent.click(within(notice).getByTestId("oats-mail-retry"));
  expect(text(await slot.findByTestId("oats-mail-empty"))).toBe("No mail.");
  expect(slot.queryByTestId("oats-notice")).toBeNull();
});

test("a refusal with no code the plugin knows, and one with none at all, read the one general line", () => {
  expect(refusalLine("E_SOMETHING_NEW")).toBe("Mail can't be read.");
  expect(refusalLine(null)).toBe("Mail can't be read.");
});

test("a read that fails after one that answered: the line, Retry, the age of what is still shown, and the mail read earlier under it", async () => {
  let asked = 0;
  const slot = mail({
    mail: () => {
      if (++asked === 2) throw new Error("E_AW_TOO_OLD: messaging:mail: aw 1.36.33 cannot list mail threads");
      return recordedMail();
    },
  });
  await slot.findByTestId("oats-mail-list");
  fireEvent.click(slot.getByTestId("oats-mail-refresh"));
  const notice = await slot.findByTestId("oats-notice");
  expect(text(notice.querySelector("h3"))).toBe("aw is too old to read mail.");
  expect(text(notice)).toContain("Read less than a minute ago.");
  expect(rows(slot.getByTestId("oats-mail-list"))).toHaveLength(3);
  fireEvent.click(within(notice).getByTestId("oats-mail-retry"));
  await waitFor(() => expect(slot.queryByTestId("oats-notice")).toBeNull());
  expect(reads(slot)).toHaveLength(3);
});

test("an older page that cannot be read: the line with Retry, which asks for that page again; the list stays", async () => {
  const first = recordedMail("mail-first-page.json");
  let olderAsked = 0;
  const slot = mail({
    mail: ({ older }) => {
      if (older === null) return first;
      if (++olderAsked === 1) throw new Error("OATS_TIMEOUT: `oats` did not answer within 170 s and was stopped");
      return recordedMail("mail-older-page.json");
    },
  });
  await slot.findByTestId("oats-mail-list");
  fireEvent.click(slot.getByTestId("oats-mail-older"));
  const notice = await slot.findByTestId("oats-notice");
  expect(text(notice.querySelector("h3"))).toBe("Reading took too long.");
  expect(rows(slot.getByTestId("oats-mail-list"))).toHaveLength(2);
  expect(slot.queryByTestId("oats-mail-older")).toBeNull();
  fireEvent.click(within(notice).getByTestId("oats-mail-retry"));
  await waitFor(() => expect(rows(slot.getByTestId("oats-mail-list"))).toHaveLength(3));
  expect(reads(slot).at(-1)).toEqual({ instance: AGENT, older: first.older });
});

test("one team's mail cannot be read (recorded): ONE line at the list's end, in the warning tone, without the provider's word; the other team's mail shows", async () => {
  const slot = mail({ mail: () => recordedMail("mail-identity-missing.json") });
  const list = await slot.findByTestId("oats-mail-list");
  expect(rows(list)).toHaveLength(3);
  const lines = slot.getAllByTestId("oats-mail-unread");
  expect(lines.map(text)).toEqual(["wider: can't be read"]);
  expect(lines[0]?.className).toContain("text-warning-text");
  expect(text(slot.container)).not.toContain("identity-missing");
});

test("some of a team's conversations cannot be read: how many, never which (a recorded answer with ONE field changed: the team's `conversations`)", async () => {
  const page = recordedMail("mail-identity-missing.json");
  (page.unread[0] as MailPage["unread"][number]).conversations = 2;
  const slot = mail({ mail: () => page });
  await slot.findByTestId("oats-mail-list");
  expect(slot.getAllByTestId("oats-mail-unread").map(text)).toEqual(["wider: 2 conversations can't be read"]);
  (page.unread[0] as MailPage["unread"][number]).conversations = 1;
  slot.unmount();
  const one = mail({ mail: () => page });
  await waitFor(() => expect(one.getAllByTestId("oats-mail-unread").map(text)).toEqual(["wider: 1 conversation can't be read"]));
});

// ---- read-only

test("the view has no act: its only controls are the rows, Refresh and Older, and it calls no verb but the read", async () => {
  const slot = mail({ mail: ({ older }) => (older === null ? recordedMail("mail-first-page.json") : recordedMail("mail-older-page.json")) });
  await slot.findByTestId("oats-mail-list");
  const controls = () => Array.from(slot.container.querySelectorAll("button, a, input, textarea, select, [contenteditable]")).map((control) => control.getAttribute("data-testid"));
  expect(controls()).toEqual(["oats-mail-refresh", "oats-mail-row", "oats-mail-row", "oats-mail-older"]);
  fireEvent.click(rows(slot.getByTestId("oats-mail-list"))[0] as HTMLElement);
  await slot.findByTestId("oats-mail-message");
  expect(controls()).toEqual(["oats-mail-back"]);
  expect(new Set(slot.inspection.rpcCalls.map((call) => call.method))).toEqual(new Set(["mail"]));
});
