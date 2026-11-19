// input: a tell never answers a pending interaction, and only a dispatched tell is a
// submission (contract item 1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { sendInput } from "../../oats-package/capabilities/oats-bb/lib/input.mjs";
import { readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { NOT_FOUND, QUEUE_GONE, UNREACHABLE, call, fakeBbIn, pendingInteraction, scratch, tellQueued, tellSent } from "../fixtures/harness.mjs";

const SERVER = "http://127.0.0.1:38886";
const settings = { version: "0.50.1", trust: "single-user" };
const endpoint = { server: SERVER, projectId: "proj_a", threadId: "thr_a" };
const TEXT = "aweb mail event received.\n- message_id: 6ab326ec\n$(touch /tmp/never) `x` 'q' \"d\"\n";

async function inputWith(t, script, input = {}) {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, script);
  const answer = await call("input", { home, endpoint, text: TEXT, ...input }, { settings, bb });
  return { answer, calls: bb.calls() };
}
const verbs = (calls) => calls.map((c) => c.argv.slice(0, ["interactions", "queue"].includes(c.argv[1]) ? 3 : 2).join(" "));

test("bb answers sent: submitted, after one interactions read and one tell carrying the text on stdin", async (t) => {
  const { answer, calls } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellSent("thr_a") } });
  assert.deepEqual(answer.result, { submitted: true, verified: true });
  assert.deepEqual(calls.map((c) => c.argv), [
    ["thread", "interactions", "list", "thr_a", "--json"],
    ["thread", "tell", "thr_a", "--message-file", "-", "--mode", "auto", "--json"],
  ]);
  assert.equal(calls[1].stdin, TEXT, "the text reaches bb byte for byte, never through a shell or argv");
  assert.equal(calls[1].server, SERVER);
});

test("a resolved interaction does not hold input", async (t) => {
  const { answer } = await inputWith(t, { "thread interactions list": { stdout: [{ ...pendingInteraction("thr_a"), status: "resolved" }] }, "thread tell": { stdout: tellSent("thr_a") } });
  assert.deepEqual(answer.result, { submitted: true, verified: true });
});

test("a pending interaction: E_SESSION_PROMPT_OPEN, and nothing is sent", async (t) => {
  const { answer, calls } = await inputWith(t, { "thread interactions list": { stdout: [pendingInteraction("thr_a")] }, "thread tell": { stdout: tellSent("thr_a") } });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_PROMPT_OPEN");
  assert.match(answer.error.message, /pint_m5byy7u9ux/);
  assert.match(answer.error.message, /nothing was sent/);
  assert.doesNotMatch(answer.error.message, /SECRET-LOOKING-COMMAND/, "the prompt's content stays in bb");
  assert.deepEqual(verbs(calls), ["thread interactions list"], "no tell, no queue call");
});

test("bb answers queued: the copy is withdrawn and the answer is E_SESSION_INPUT_QUEUED", async (t) => {
  const { answer, calls } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellQueued("thr_a", "interaction") }, "thread queue delete": { stdout: { ok: true } } });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_INPUT_QUEUED");
  assert.match(answer.error.message, /waiting on interaction.*withdrawn, so nothing was delivered/);
  assert.deepEqual(calls[2].argv, ["thread", "queue", "delete", "thr_a", "qmsg_3sgztxjk4j", "--json"]);
});

test("bb answers queued for a turn that is starting: still E_SESSION_INPUT_QUEUED", async (t) => {
  const { answer } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellQueued("thr_a", "turn-starting") }, "thread queue delete": { stdout: { ok: true } } });
  assert.equal(answer.error.code, "E_SESSION_INPUT_QUEUED");
  assert.match(answer.error.message, /waiting on turn-starting/);
});

test("bb says the queued copy already left the queue: it was dispatched, so submitted (not verified)", async (t) => {
  const { answer } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellQueued("thr_a", "turn-starting") }, "thread queue delete": QUEUE_GONE });
  assert.deepEqual(answer.result, { submitted: true, verified: false });
});

for (const [name, gone] of [
  ["bb does not answer the delete", UNREACHABLE],
  ["the delete fails with another 404", NOT_FOUND],
  ["the delete fails with invalid_request for another reason", { error: { code: "invalid_request", message: "HTTP 409: Queued message is being sent" } }],
  ["the delete answers something that is not JSON", { stdout: "ok\n" }],
]) {
  test(`in doubt is not submitted: ${name}: E_SESSION_INPUT_QUEUED, saying it may still be delivered`, async (t) => {
    const { answer } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellQueued("thr_a") }, "thread queue delete": gone });
    assert.equal(answer.ok, false);
    assert.equal(answer.error.code, "E_SESSION_INPUT_QUEUED");
    assert.match(answer.error.message, /may still be delivered/);
  });
}

test("a delete cut off by time is in doubt: E_SESSION_INPUT_QUEUED", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellQueued("thr_a") }, "thread queue delete": { delayMs: 8_000, ...QUEUE_GONE } });
  await assert.rejects(
    sendInput({ home, endpoint, text: TEXT }, readSettings({ cli: bb.cli }), { deadline: Date.now() + 2_000, env: { ...process.env, ...bb.env } }),
    (error) => error.code === "E_SESSION_INPUT_QUEUED" && /may still be delivered/.test(error.message),
  );
});

test("a queued answer with no id to withdraw by: E_SESSION_INPUT_QUEUED, unconfirmed, no delete tried", async (t) => {
  const queued = tellQueued("thr_a"); delete queued.queuedMessage.id;
  const { answer, calls } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: queued } });
  assert.equal(answer.error.code, "E_SESSION_INPUT_QUEUED");
  assert.match(answer.error.message, /may still be delivered/);
  assert.deepEqual(verbs(calls), ["thread interactions list", "thread tell"]);
});

test("a delivery word that is neither sent nor queued: E_SESSION_INPUT_FAILED, saying it may have been delivered", async (t) => {
  const { answer } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": { stdout: { threadId: "thr_a", ok: true, delivery: "scheduled" } } });
  assert.equal(answer.error.code, "E_SESSION_INPUT_FAILED");
  assert.match(answer.error.message, /may have been delivered/);
});

test("the thread is gone: E_SESSION_INPUT_FAILED, nothing sent", async (t) => {
  const { answer, calls } = await inputWith(t, { "thread interactions list": NOT_FOUND });
  assert.equal(answer.error.code, "E_SESSION_INPUT_FAILED");
  assert.deepEqual(verbs(calls), ["thread interactions list"]);
});

test("bb does not answer the interactions read: E_SESSION_INPUT_FAILED, nothing sent", async (t) => {
  const { answer, calls } = await inputWith(t, { "thread interactions list": UNREACHABLE });
  assert.equal(answer.error.code, "E_SESSION_INPUT_FAILED");
  assert.equal(calls.length, 1);
});

test("the tell fails with bb's refusal: E_SESSION_INPUT_FAILED, and nothing was delivered", async (t) => {
  const { answer } = await inputWith(t, { "thread interactions list": { stdout: [] }, "thread tell": NOT_FOUND });
  assert.equal(answer.error.code, "E_SESSION_INPUT_FAILED");
  assert.doesNotMatch(answer.error.message, /may have been delivered/);
});

test("a tell cut off by time may have landed: E_SESSION_INPUT_FAILED, saying so", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread interactions list": { stdout: [] }, "thread tell": { delayMs: 5_000, stdout: tellSent("thr_a") } });
  // In process, so the deadline can be near: the provider's own budget is 16 s.
  await assert.rejects(
    sendInput({ home, endpoint, text: TEXT }, readSettings({ cli: bb.cli }), { deadline: Date.now() + 1_200, env: { ...process.env, ...bb.env } }),
    (error) => error.code === "E_SESSION_INPUT_FAILED" && /may have been delivered/.test(error.message),
  );
});

for (const [name, input] of [["no text", { text: "" }], ["a text that is not a string", { text: 7 }], ["a malformed endpoint", { endpoint: { server: SERVER } }]]) {
  test(`${name}: E_SESSION_INPUT_FAILED, and bb is not called`, async (t) => {
    const { answer, calls } = await inputWith(t, {}, input);
    assert.equal(answer.error.code, "E_SESSION_INPUT_FAILED");
    assert.deepEqual(calls, []);
  });
}
