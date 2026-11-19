// input: one tell, and only a dispatched tell is a submission (contract item 1).
import { bbClient } from "./bb.mjs";
import { ProviderError, fail, isObject } from "./errors.mjs";
import { readEndpoint } from "./threads.mjs";

const failed = (error) => {
  if (!(error instanceof ProviderError)) throw error;
  return error.code === "E_SESSION_INPUT_FAILED" ? error : fail("E_SESSION_INPUT_FAILED", error.message);
};

/** → { submitted: true, verified }.
 *  1. A tell never answers a pending interaction (a permission prompt or a question):
 *     while one is open the provider refuses E_SESSION_PROMPT_OPEN and sends nothing,
 *     or a mail from anyone could stand in for a person's approval.
 *  2. bb answers "sent": dispatched into the thread: submitted.
 *  3. bb answers "queued", for any reason (an interaction that opened between the read
 *     and the tell included): never a submission. The provider withdraws the queued copy
 *     (`bb thread queue delete`) and answers E_SESSION_INPUT_QUEUED whatever the delete
 *     says. A delete that succeeds means nothing was delivered. Any other outcome is in
 *     doubt: bb's "Queued message not found" cannot tell a copy that was dispatched from
 *     one that someone removed, and a failure or a timeout tells nothing. In doubt the
 *     answer is not submitted: the mail stays unread and the agent may see it twice (its
 *     message_id makes that one message), never lose it. */
export async function sendInput(input, settings, { deadline, env = process.env } = {}) {
  let endpoint, bb;
  try {
    if (!isObject(input)) throw fail("E_SESSION_INPUT_FAILED", "the input is not an object");
    if (typeof input.text !== "string" || input.text.length === 0) throw fail("E_SESSION_INPUT_FAILED", "the input has no text");
    endpoint = readEndpoint(input.endpoint, "E_SESSION_INPUT_FAILED");
    bb = bbClient({ cli: settings.cli, server: endpoint.server, deadline, env, fallbackCode: "E_SESSION_INPUT_FAILED" });
  } catch (error) { throw failed(error); }

  let interactions;
  try { interactions = await bb.interactions(endpoint.threadId); }
  catch (error) { throw failed(error); }
  const open = interactions.filter((interaction) => isObject(interaction) && interaction.status === "pending");
  if (open.length > 0) {
    const kinds = [...new Set(open.map((interaction) => (isObject(interaction.payload) && typeof interaction.payload.kind === "string" ? interaction.payload.kind : "interaction")))];
    throw fail("E_SESSION_PROMPT_OPEN", `bb thread ${endpoint.threadId} waits on a person (${open.length} pending ${kinds.join(", ")}: ${open.map((interaction) => interaction.id).filter((id) => typeof id === "string").join(", ")}): nothing was sent. Answer it in bb`);
  }

  const told = await bb.tell(endpoint.threadId, input.text);
  if (!told.ok) {
    // A tell cut off by time may have reached bb: the caller must not take it for unsent.
    throw fail("E_SESSION_INPUT_FAILED", `bb thread tell failed: ${told.message}${told.timedOut ? "; the message may have been delivered" : ""}`);
  }
  const answer = told.value;
  if (isObject(answer) && answer.ok === true && answer.delivery === "sent") return { submitted: true, verified: true };
  if (!isObject(answer) || answer.ok !== true || answer.delivery !== "queued") {
    throw fail("E_SESSION_INPUT_FAILED", `bb thread tell answered neither sent nor queued (${JSON.stringify(isObject(answer) ? answer.delivery ?? null : null)}); the message may have been delivered`);
  }

  const queued = isObject(answer.queuedMessage) ? answer.queuedMessage : {};
  const waitingOn = isObject(queued.waitingOn) && typeof queued.waitingOn.kind === "string" ? queued.waitingOn.kind : "unknown";
  if (typeof queued.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(queued.id)) {
    throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message (waiting on ${waitingOn}) and gave no id to withdraw it by: it may still be delivered`);
  }
  const withdrawn = await bb.queueDelete(endpoint.threadId, queued.id);
  if (withdrawn.ok) {
    throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message instead of dispatching it (waiting on ${waitingOn}); the queued copy was withdrawn, so nothing was delivered`);
  }
  throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message (waiting on ${waitingOn}) and the queued copy could not be withdrawn (${withdrawn.message}): it may still be delivered, or already was`);
}
