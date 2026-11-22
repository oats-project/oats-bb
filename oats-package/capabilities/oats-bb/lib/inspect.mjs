// inspect and inspectMany: what bb shows of a home's thread, from one `bb thread list`.
import { isAbsolute } from "node:path";
import { bbClient } from "./bb.mjs";
import { bounded, fail, isObject, recode } from "./errors.mjs";
import { processLook } from "./processes.mjs";
import { inspectHome, readEndpoint } from "./threads.mjs";

function readHome(entry) {
  if (!isObject(entry)) throw fail("E_SESSION_UNAVAILABLE", "the inspect input is not an object");
  if (typeof entry.home !== "string" || !isAbsolute(entry.home)) throw fail("E_SESSION_UNAVAILABLE", "the inspect input's home must be an absolute path");
  return { home: entry.home, endpoint: readEndpoint(entry.endpoint) };
}

/** bb unreachable, or any other failed read, is an error: never "stopped". */
const unavailable = (error) => recode("E_SESSION_UNAVAILABLE", error);

/** → { present, state, running, open? } */
export async function inspect(input, settings, { deadline, env = process.env } = {}) {
  try {
    const subject = readHome(input);
    const bb = bbClient({ cli: settings.cli, server: subject.endpoint.server, deadline, env });
    return inspectHome(subject, await bb.threads(), processLook());
  } catch (error) { throw unavailable(error); }
}

/** → { results: [<inspect answer> | { error: { code, message } }] }, in the input's
 *  order: one thread list per bb server, whatever the number of homes. */
export async function inspectMany(input, settings, { deadline, env = process.env } = {}) {
  if (!isObject(input) || !Array.isArray(input.homes)) throw fail("E_SESSION_UNAVAILABLE", "the inspectMany input has no homes list");
  const lists = new Map();
  // One look at this host's processes for all the homes, and only if a thread needs it
  // (one in error, or one at rest: lib/threads.mjs).
  const processes = processLook();
  const listOf = (server) => {
    if (!lists.has(server)) lists.set(server, bbClient({ cli: settings.cli, server, deadline, env }).threads().then((threads) => ({ threads }), (error) => ({ error })));
    return lists.get(server);
  };
  const results = await Promise.all(input.homes.map(async (entry) => {
    try {
      const subject = readHome(entry);
      const read = await listOf(subject.endpoint.server);
      if (read.error) throw read.error;
      return inspectHome(subject, read.threads, processes);
    } catch (error) {
      const refused = unavailable(error);
      return { error: { code: refused.code, message: bounded(refused.message) } };
    }
  }));
  return { results };
}
