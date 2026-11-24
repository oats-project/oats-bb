// `oats instance events <instance> --home <abs> --since <iso> --limit 50 --json`, read for the
// roster's event path: what ONE instance's events say of its row between two status reads
// (model/events.ts `withEvents`; docs/desktop-cli-api.md, "Events" and "Waiting on you", eventsApi 2).
//
// A narrow reader, beside the instance panel's (kernel/panel-events.ts), on purpose: the panel
// draws every row and fails the whole answer on one it cannot shape; this one reads six fields
// and must not fail on an event of a kind it has never heard of. Anything else of the answer is
// not read, and an answer that does not have these in their documented shapes is refused
// whole (the server then changes nothing: the status read carries the change).
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome, checkInstance } from "./input.js";
import { codes, err, ok, type Result } from "./result.js";

/** How many of the newest rows since the status read are asked for: a stop or a claim is among the last few. */
export const ROSTER_EVENTS_LIMIT = 50;
/** The kernel answers this in about a tenth of a second; one that takes this long is given up, and the status read carries the change. */
export const ROSTER_EVENTS_TIMEOUT_MS = 5_000;

/** What the patch reads of the answer: the shape of model/events.ts `EventsSaid`. */
export const rosterEvents = z.object({
  truncated: z.boolean(),
  incarnation: z.string().nullable(),
  waitingOnYou: z.object({ since: z.string(), reason: z.string().nullable(), message: z.string().nullable() }).nullable(),
  waitingClaims: z.array(z.object({ waiting: z.boolean() })),
  events: z.array(z.object({ kind: z.string(), at: z.string(), incarnation: z.string().nullable(), producer: z.string().nullable() })),
});
export type RosterEvents = z.output<typeof rosterEvents>;

/** An ISO time as the server stamps a read (`new Date().toISOString()`): nothing else is passed as `--since`. */
const SINCE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function rosterEventsArgv(instance: string, home: string, since: string): Result<string[]> {
  const name = checkInstance(instance);
  if (!name.ok) return name;
  const at = checkHome(home);
  if (!at.ok) return at;
  if (!SINCE.test(since) || !Number.isFinite(Date.parse(since))) return err(codes.invalidInput, "since is not a time as the server stamps one");
  return ok(["instance", "events", name.value, "--home", at.value, "--since", since, "--limit", String(ROSTER_EVENTS_LIMIT), "--json"]);
}

const stamp = z.string().min(1);
const answer = z.looseObject({
  eventsApi: z.literal(2),
  incarnation: z.string().nullable(),
  truncated: z.boolean(),
  // A row of any kind: only its kind, its time, its incarnation and who wrote it are read.
  events: z.array(z.looseObject({ kind: z.string().min(1), at: stamp, incarnation: z.string().nullish(), producer: z.string().nullish() })),
  waitingOnYou: z.looseObject({ since: stamp, reason: z.string().nullish(), message: z.string().nullish() }).nullable(),
  waitingClaims: z.array(z.looseObject({ waiting: z.boolean() })),
});

export function parseRosterEvents(document: unknown): Result<RosterEvents> {
  const parsed = shaped(answer, document, "oats instance events");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  return ok({
    truncated: value.truncated,
    incarnation: value.incarnation,
    waitingOnYou: value.waitingOnYou === null ? null : { since: value.waitingOnYou.since, reason: value.waitingOnYou.reason ?? null, message: value.waitingOnYou.message ?? null },
    waitingClaims: value.waitingClaims.map(({ waiting }) => ({ waiting })),
    events: value.events.map(({ kind, at, incarnation, producer }) => ({ kind, at, incarnation: incarnation ?? null, producer: producer ?? null })),
  });
}
