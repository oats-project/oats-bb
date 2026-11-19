// input: one tell, and only a dispatched tell is a submission (contract item 1).
import { bbClient } from "./bb.mjs";
import { ProviderError, fail, isObject } from "./errors.mjs";
import { readEndpoint } from "./threads.mjs";

const failed = (error) => {
  if (!(error instanceof ProviderError)) throw error;
  return error.code === "E_SESSION_INPUT_FAILED" ? error : fail("E_SESSION_INPUT_FAILED", error.message, error.details);
};

/** → { submitted: true, verified }.
 *  1. A tell never answers a pending interaction (a permission prompt or a question):
 *     while one is open the provider refuses E_SESSION_PROMPT_OPEN and sends nothing,
 *     or a mail from anyone could stand in for a person's approval.
 *  2. bb answers "sent": dispatched into the thread: submitted.
 *  3. bb answers "queued", for any reason (an interaction that opened between the read
 *     and the tell included): the provider withdraws the queued copy and answers
 *     E_SESSION_INPUT_QUEUED. A copy bb no longer has was dispatched: submitted. */
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
    throw fail("E_SESSION_PROMPT_OPEN", `bb thread ${endpoint.threadId} waits on a person (${open.length} pending ${kinds.join(", ")}): nothing was sent. Answer it in bb`, { interactions: open.map((interaction) => interaction.id).filter((id) => typeof id === "string") });
  }

  const told = await bb.tell(endpoint.threadId, input.text);
  if (!told.ok) {
    // A tell cut off by time may have reached bb: the caller must not take it for unsent.
    throw fail("E_SESSION_INPUT_FAILED", `bb thread tell failed: ${told.message}`, told.timedOut ? { unconfirmed: true } : undefined);
  }
  const answer = told.value;
  if (isObject(answer) && answer.ok === true && answer.delivery === "sent") return { submitted: true, verified: true };
  if (!isObject(answer) || answer.ok !== true || answer.delivery !== "queued") {
    throw fail("E_SESSION_INPUT_FAILED", `bb thread tell answered neither sent nor queued (${JSON.stringify(isObject(answer) ? answer.delivery ?? null : null)})`, { unconfirmed: true });
  }

  const queued = isObject(answer.queuedMessage) ? answer.queuedMessage : {};
  const waitingOn = isObject(queued.waitingOn) && typeof queued.waitingOn.kind === "string" ? queued.waitingOn.kind : "unknown";
  if (typeof queued.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(queued.id)) {
    throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message (waiting on ${waitingOn}) and gave no id to withdraw it by: it may still be delivered`, { unconfirmed: true, waitingOn });
  }
  const withdrawn = await bb.queueDelete(endpoint.threadId, queued.id);
  if (withdrawn.ok) {
    throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message instead of dispatching it (waiting on ${waitingOn}); the queued copy was withdrawn, so nothing was delivered`, { waitingOn });
  }
  // bb answers 404 "Queued message not found" (code invalid_request) for a copy that left
  // the queue: it was dispatched between the tell and the delete.
  if (withdrawn.code === "invalid_request" && /queued message not found/i.test(withdrawn.message)) return { submitted: true, verified: false };
  throw fail("E_SESSION_INPUT_QUEUED", `bb queued the message (waiting on ${waitingOn}) and the queued copy could not be withdrawn (${withdrawn.message}): it may still be delivered`, { unconfirmed: true, waitingOn });
}
