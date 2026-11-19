// The wire between the kernel and this provider: one JSON document in on stdin, exactly one
// out on stdout, exit 0 (docs/kernel-wire.md). All of the envelope lives here.
import { ProviderError, isObject } from "./errors.mjs";

export const PROVIDER = "bb";
// What a failure the provider did not classify means, per call (contract item 1).
const PHASE_FAILURE = {
  launch: "E_SESSION_START_FAILED",
  inspect: "E_SESSION_UNAVAILABLE",
  inspectMany: "E_SESSION_UNAVAILABLE",
  input: "E_SESSION_INPUT_FAILED",
  stop: "E_SESSION_STOP_FAILED",
};
export const PHASES = Object.freeze(Object.keys(PHASE_FAILURE));
// The provider's own time per call, inside the kernel's (launch 120 s, the others 20 s).
const PHASE_BUDGET_MS = { launch: 100_000, inspect: 16_000, inspectMany: 16_000, input: 16_000, stop: 16_000 };
const MAX_STDIN = 8 * 1024 * 1024;

export async function readStdin(stream = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_STDIN) throw new ProviderError("E_BACKEND_REQUEST", `the request is larger than ${MAX_STDIN} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The settings of a call: the request's, else the kernel's OATS_SETTINGS. */
export function settingsOf(request, env) {
  if (isObject(request) && request.settings !== undefined) return request.settings;
  if (typeof env.OATS_SETTINGS === "string" && env.OATS_SETTINGS.trim()) {
    try { return JSON.parse(env.OATS_SETTINGS); }
    catch { throw new ProviderError("E_BACKEND_SETTINGS", "OATS_SETTINGS is not JSON"); }
  }
  return {};
}

function refusal(error, fallback) {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) };
  }
  // A bug of ours, or of the platform: the phase's own failure, with the text.
  return { code: fallback, message: `the bb provider failed: ${error?.message ?? String(error)}` };
}

/** Run one session call. `handlers[phase](input, rawSettings, {deadline, env})` resolves
 *  the result or throws. → the answer envelope; never throws. */
export async function answerSession(phase, text, handlers, { env = process.env, now = Date.now } = {}) {
  const head = { schemaVersion: 1, phase, provider: PROVIDER, capability: env.OATS_CAPABILITY ?? null };
  const fallback = PHASE_FAILURE[phase] ?? "E_BACKEND_REQUEST";
  try {
    let request;
    try { request = JSON.parse(text); }
    catch { throw new ProviderError(fallback, "the request on stdin is not one JSON document"); }
    if (!isObject(request)) throw new ProviderError(fallback, "the request is not a JSON object");
    if (typeof request.provider === "string") head.provider = request.provider;
    if (typeof request.capability === "string") head.capability = request.capability;
    if (request.schemaVersion !== 1) throw new ProviderError(fallback, `the request's schemaVersion is ${JSON.stringify(request.schemaVersion)}; this provider speaks 1`);
    if (request.phase !== phase) throw new ProviderError(fallback, `the request's phase is ${JSON.stringify(request.phase)}, and the command run is ${phase}`);
    if (request.provider !== PROVIDER) throw new ProviderError(fallback, `the request names the session provider ${JSON.stringify(request.provider)}; this one is ${PROVIDER}`);
    const result = await handlers[phase](request.input, settingsOf(request, env), { deadline: now() + PHASE_BUDGET_MS[phase], env });
    return { ...head, ok: true, result };
  } catch (error) {
    return { ...head, ok: false, error: refusal(error, fallback) };
  }
}

/** Run the readiness check on the released `binding.check` wire: the request's
 *  schemaVersion, phase, slot and capability are echoed; a refusal is {code, message}. */
export async function answerCheck(text, check, { env = process.env, now = Date.now } = {}) {
  let request = null;
  try { request = JSON.parse(text); } catch { /* answered below */ }
  const head = { schemaVersion: 1, phase: "check", slot: isObject(request) ? request.slot ?? null : null, capability: isObject(request) && typeof request.capability === "string" ? request.capability : env.OATS_CAPABILITY ?? null };
  try {
    if (!isObject(request)) throw new ProviderError("E_BACKEND_REQUEST", "the request on stdin is not one JSON object");
    if (request.schemaVersion !== 1 || request.phase !== "check") throw new ProviderError("E_BACKEND_REQUEST", "the request is not a schemaVersion 1 check");
    const result = await check(settingsOf(request, env), { deadline: now() + 25_000, env });
    return { ...head, ok: true, result };
  } catch (error) {
    const { code, message } = refusal(error, "E_BACKEND_REQUEST");
    return { ...head, ok: false, error: { code, message } };
  }
}
