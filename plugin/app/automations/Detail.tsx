// One automation's page: what it sends (whole, never summarized), when it runs or what it
// watches, what it spawns, its recent runs or fires on the machine, what is wrong with it, its
// run state, where it runs and where it comes from. In the Desktop's words and order
// (awebai/oats packages/desktop/renderer/views/automations.mjs at a4a43220).
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AutomationHost, AutomationProblem, AutomationRow, AutomationRun, TriggerStatus } from "../../contract/automations";
import { cleanLine, displayLine, shown, shownBlock } from "../ui/text";
import { readAge } from "../ui/words";
import { Button, Card, Disclosure, Empty, Lines, Notice, Section, Toned } from "../ui";
import { eventLabel, eventWords } from "../../model/automations";
import { RunningContext, useHere } from "./here";
import { OriginTag, StateTags } from "./List";
import { FactList, Quote, Tokens } from "./parts";
import type { FactRow, QuoteLine } from "./parts";
import {
  capabilitySource,
  causeWords,
  cronInWords,
  EVENTS_SHOWN,
  fileTarget,
  harnessName,
  hostLogin,
  LEAD_INS,
  onSummary,
  outcomeWords,
  placementText,
  reconcileCommand,
  dueWords,
  pastTime,
  relativeTime,
  ruleWords,
  runState,
  runTime,
  soulOriginText,
  sourceLabel,
  sourceParams,
  taskParts,
  templateLabel,
  templateProvenance,
  TITLES,
  hereWhileOff,
} from "./words";
import type { CapabilitySource, FileTarget, RunState } from "./words";

const NOTE = "text-xs text-muted-foreground";
const LINE = "min-w-0 break-words text-sm";
const PROSE = "max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground";

// A prompt or a wake message is drawn as a block through `shownBlock` (app/ui/text.ts): the text
// as it is, for these two fields only (decided by the spec's author: it is the definition a
// person or their workspace wrote, the page's purpose is to read it, and the same reader can open
// the file). Nothing is withheld and nothing is cut; only a character that is not text is drawn
// as U+FFFD, so a definition from a shared repository cannot reorder or hide what the page shows.
/** The block a prompt or a message is drawn in: whole, its lines and indentation kept, scrolling when it is long. */
function Prose({ children }: { children: ReactNode }) {
  return (
    <div data-testid="oats-automation-prose" tabIndex={0} className={PROSE}>
      {children}
    </div>
  );
}

/** "14:05" today, else "6 Oct, 14:05": when a run state began (its title keeps the full date). */
function clockTime(iso: string, now: number): string {
  const at = new Date(iso);
  const today = new Date(now).toDateString() === at.toDateString();
  return today ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : at.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A command to paste, whole: a line never ends inside `--dir` or inside a path (Tokens). */
function Command({ text }: { text: string }) {
  return (
    <code className="rounded border border-border bg-background px-1 font-mono text-foreground">
      <Tokens text={text} />
    </code>
  );
}

function Time({ iso, now }: { iso: string | null; now: number }) {
  const at = pastTime(iso, now);
  return (
    <time title={at?.title} dateTime={at === null || iso === null ? undefined : iso} className="shrink-0 text-xs text-muted-foreground">
      {at?.label ?? "—"}
    </time>
  );
}

const events = (n: number): string => `${n} ${n === 1 ? "event" : "events"}`;
/** The counts of what a poll left out that are not zero: "1 filtered, 2 skipped, 3 refused". */
const tally = ({ filtered, skipped, refused }: { filtered: number; skipped: number; refused: number }): string =>
  [
    [filtered, "filtered"],
    [skipped, "skipped"],
    [refused, "refused"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(", ");

/** The trigger file's parameters, as display-only text in the quote treatment; nothing when it gives none. */
function ParamsQuote({ row }: { row: AutomationRow }) {
  const params = sourceParams(row.on);
  if (params.count === 0) return null;
  return (
    <div data-testid="oats-automation-params" className="flex flex-col gap-1">
      <Quote leadIn={LEAD_INS.triggerFile} lines={params.lines.map((line) => ({ text: [line.text], note: line.note }))} />
      {params.more > 0 ? <p className={NOTE}>{`and ${params.more} more`}</p> : null}
    </div>
  );
}

/**
 * The events OATS refused and the items the source skipped, each list only when it has entries,
 * at most EVENTS_SHOWN then "and N more". An event's text and the reason for a skip are the
 * source's words (quoted); the rule is said in the product's, the subject is the kernel's.
 */
function SourceLists({ refused, skipped, source, from }: { refused: TriggerStatus["refused"]; skipped: TriggerStatus["skipped"]; source: { capability: string | null; name: string | null }; from?: ReactNode }) {
  if (refused.length === 0 && skipped.length === 0) return null;
  const leadIn = LEAD_INS.source(source.capability, source.name);
  const part = (title: string, testId: string, total: number, lines: QuoteLine[]) =>
    total === 0 ? null : (
      <div data-testid={testId} className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        <Quote leadIn={leadIn} lines={lines} />
        {total > EVENTS_SHOWN ? <p className={NOTE}>{`and ${total - EVENTS_SHOWN} more`}</p> : null}
      </div>
    );
  return (
    <div data-testid="oats-automation-source-lists" className="flex flex-col gap-2">
      {from}
      {part("Refused by OATS", "oats-automation-refused", refused.length, refused.slice(0, EVENTS_SHOWN).map((entry) => ({ text: [entry.text], note: `Refused: ${ruleWords(entry.rule) ?? "no rule reported"}.` })))}
      {part("Skipped by the source", "oats-automation-skipped", skipped.length, skipped.slice(0, EVENTS_SHOWN).map((entry) => ({ label: entry.subject, text: [entry.why] })))}
    </div>
  );
}

/** What a run sends, whole: a spawn's or a trigger's task, a wake's message and the home it wakes, a command's argv and cwd, an operation and its home. */
function Sends({ row }: { row: AutomationRow }) {
  if (row.run === "wake") {
    return (
      <Section title="Wake message" testId="oats-automation-sends">
        {row.message !== null ? <Prose>{shownBlock(row.message)}</Prose> : <Empty>No wake message reported.</Empty>}
        <FactList facts={[["Wakes", row.home === null ? null : shown(row.home)]]} />
      </Section>
    );
  }
  if (row.run === "command") {
    return (
      <Section title="Command" testId="oats-automation-sends">
        <p className={NOTE}>run as written, without a shell</p>
        {row.argv !== null && row.argv.length > 0 ? (
          // The argv, one chip per argument, so the boundaries show; each through the display filter, like every text of OATS but a prompt.
          <ol aria-label="Command arguments" className="flex flex-wrap gap-1.5 rounded-md border border-border bg-card p-3">
            {row.argv.map((word, at) => (
              <li key={at} className="break-all rounded border border-border bg-background px-1.5 py-px font-mono text-xs text-foreground">
                {shown(word)}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No command reported.</Empty>
        )}
        <FactList facts={[["Runs in", row.cwd === null ? null : shown(row.cwd)]]} />
      </Section>
    );
  }
  if (row.run === "operation") {
    return (
      <Section title="Operation" testId="oats-automation-sends">
        {row.operation !== null || row.home !== null ? (
          <FactList facts={[["Operation", row.operation === null ? null : shown(row.operation)], ["Runs in", row.home === null ? null : shown(row.home)]]} />
        ) : (
          <Empty>No operation reported.</Empty>
        )}
      </Section>
    );
  }
  const trigger = row.kind === "trigger";
  return (
    <Section title="Prompt" testId="oats-automation-sends">
      {trigger ? <p className={NOTE}>highlighted fields are filled from the event</p> : null}
      {row.task !== null ? (
        <>
          <Prose>
            {trigger
              ? taskParts(shownBlock(row.task), row.on).map((part, at) =>
                  "field" in part ? (
                    <span key={at} data-field={part.field} className="rounded border border-border bg-background px-1 font-semibold">{`{${part.field}}`}</span>
                  ) : (
                    part.text
                  ),
                )
              : shownBlock(row.task)}
          </Prose>
          {trigger ? (
            <p className={NOTE}>
              {capabilitySource(row.on) !== null
                ? "The highlighted fields are filled from the source's event after OATS checks them. They are still the source's data, and the instance is told so."
                : "Pull request titles and bodies are never inserted: the instance reads them from its event file."}
            </p>
          ) : null}
        </>
      ) : (
        <Empty>{row.run !== null && row.run !== "spawn" ? `Nothing to show for a ${shown(row.run)} run.` : "No prompt reported."}</Empty>
      )}
    </Section>
  );
}

/**
 * A schedule's next run on the machine, as what is so: none while the host scheduler is off; a
 * time that has passed was due, it is not next.
 */
function nextFact(row: AutomationRow, now: number, running: boolean): FactRow {
  if (!row.runsHere) return ["Next", null];
  if (!running) return ["Next", "None while the scheduler is off"];
  const next = dueWords(row.nextDue, now);
  return [next?.word ?? "Next", next?.label, next?.title];
}
/** A schedule's When card, or a trigger's On card: a pull request's event, repo, labels, base and poll, or a capability source with its events, its poll and its parameters. */
function WhenCard({ row, now, running, source, canOpenCapability, onOpenCapability }: { row: AutomationRow; now: number; running: boolean; source: CapabilitySource | null } & Pick<DetailProps, "canOpenCapability" | "onOpenCapability">) {
  if (row.kind === "schedule") {
    return (
      <Card title="When" testId="oats-automation-when">
        <FactList facts={[["Runs", cronInWords(row.cron)], ["Cron", row.cron === null ? null : shown(row.cron)], ["Time zone", row.tz === null ? null : shown(row.tz)], nextFact(row, now, running)]} />
      </Card>
    );
  }
  const on = onSummary(row.on);
  if (source === null) {
    return (
      <Card title="On" testId="oats-automation-when">
        <FactList facts={[["Event", on === null ? null : shown(on.title)], ["Repo", on?.repo == null ? null : shown(on.repo)], ["Labels", on === null ? null : shown(on.labels.join(", "))], ["Base", on?.base == null ? null : shown(on.base)], ["Polls", on?.poll ? `every ${shown(on.poll)}` : null]]} />
      </Card>
    );
  }
  const lookup = source.lookup;
  return (
    <Card title="On" testId="oats-automation-when">
      <FactList facts={[["Source", sourceLabel(source) ?? source.id], ["Events", on?.events.join(", ")], ["Polls", on?.poll ? `every ${on.poll}` : null]]} />
      {lookup !== null && onOpenCapability !== undefined && canOpenCapability?.(lookup) === true ? (
        <div>
          <Button data-testid="oats-automation-open-capability" aria-label={`Open capability ${lookup}`} onClick={() => onOpenCapability(lookup)}>
            Open capability
          </Button>
        </div>
      ) : null}
      {sourceParams(row.on).count > 0 ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">Parameters</p>
          <ParamsQuote row={row} />
        </>
      ) : null}
    </Card>
  );
}

/** The recurring wake-up of the agent a schedule launches: when, and what it is told. A card of its own, under the Desktop's name for the group. */
function WakeCard({ wake }: { wake: NonNullable<AutomationRow["wake"]> }) {
  return (
    <Card title="Recurring wake-up" testId="oats-automation-wake">
      <FactList facts={[["Repeats", cronInWords(wake.cron) ?? (wake.cron === null ? null : shown(wake.cron)), wake.cron === null ? null : shown(wake.cron)], ["Time zone", wake.tz === null ? null : shown(wake.tz)], ["Message", wake.message === null ? null : shown(wake.message)]]} />
    </Card>
  );
}
/** What a spawn schedule and every trigger launch: the soul and its settings (the wake a schedule attaches to its agents has its own card). */
function SpawnsCard({ row }: { row: AutomationRow }) {
  const concurrency = row.concurrency === null ? null : [row.concurrency.max !== null ? `${row.concurrency.max} at once` : null, row.concurrency.perKey !== null ? `${row.concurrency.perKey} per event` : null].filter(Boolean).join(" · ");
  const origin = row.soul === null ? "" : soulOriginText(row.soul.origin).short;
  const facts: FactRow[] = [
    ["Soul", row.soul === null ? null : shown(`${row.soul.name}${origin !== "" ? ` · ${origin}` : ""}`)],
    ["Purpose", row.purpose === null ? null : shown(row.purpose)],
    ["Teams", shown(row.teams.join(", "))],
    ["Harness", shown([row.harness !== null ? harnessName(row.harness) : null, row.model].filter(Boolean).join(" · "))],
    ["Launch config", row.launchConfig === null ? null : shown(row.launchConfig)],
    ["Permissions", row.yolo === true ? "YOLO — skips permission prompts" : row.yolo === false ? "Native permission policy" : null],
    ["Backend", row.backend === null ? null : shown(row.backend)],
    ["Concurrency", concurrency],
  ];
  return (
    <Card title="Spawns" testId="oats-automation-spawns">
      <FactList facts={facts} />
    </Card>
  );
}

/** One line of the history: when, then what. */
function HistoryLine({ iso, now, children, testId }: { iso: string | null; now: number; children: ReactNode; testId: string }) {
  return (
    <li data-testid={testId} className="flex min-w-0 items-baseline gap-3 border-t border-border py-1.5 text-sm first:border-t-0">
      <span className="w-24 shrink-0">
        <Time iso={iso} now={now} />
      </span>
      <div className="min-w-0 flex-1 break-words text-foreground">{children}</div>
    </li>
  );
}

/**
 * Recent runs (a schedule) or recent fires (a trigger), on the machine. A trigger's come from
 * `oats trigger status`: the last poll, the last error (its message, then its code), the events
 * waiting (newest first, at most 10), the instances live now, then what fired. Until that answer
 * is here, and when it fails, the row's own last fire shows.
 */
function History({ row, status, failure, source, check, now }: { row: AutomationRow; status: TriggerStatus | null; failure: DetailProps["statusFailure"]; source: CapabilitySource | null; check: AutomationProblem | null; now: number }) {
  const here = useHere();
  const trigger = row.kind === "trigger";
  const st = trigger ? status : null;
  const lead =
    st === null
      ? ""
      : [st.liveCount !== null ? `${st.liveCount}${st.max !== null ? ` of ${st.max}` : ""} live now` : null, st.firedTotal ? `${st.firedTotal} fired in all` : null, st.pending.length > 0 ? `${st.pending.length} waiting` : null].filter(Boolean).join(" · ");
  const poll = st?.lastPoll ?? null;
  // A capability source's failure is said once. After a failed poll the kernel's last error is
  // that same failure (its time and message), and after a failed check it repeats `invalid`: the
  // Last error line is then left out, and its code goes beside the kernel's text of the failure.
  const err = st?.lastError ?? null;
  const pollFailure = source !== null && poll !== null && !poll.ok && poll.cause !== null;
  const samePoll = pollFailure && err !== null && err.at === poll.at && err.message === poll.error;
  const sameCheck = check !== null && check.at !== null && err !== null && err.at === check.at && err.message === displayLine(check.message);
  const says = (value: { code: string | null; message: string | null } | null | undefined) =>
    value == null || source === null ? null : <Quote testId="oats-automation-source-says" leadIn={LEAD_INS.source(source.capability, source.name)} lines={[{ text: [value.code, value.message] }]} />;
  const eventText = (entry: { label: string | null; event: string | null }) => [entry.label, entry.event].filter(Boolean).join(" · ");

  // A trigger's fires are named by what fired; a schedule's runs lead with their outcome.
  const fromRow = (run: AutomationRun) =>
    trigger
      ? { at: runTime(run), parts: [eventLabel(run, row.on?.source ?? null), eventWords(run.event), displayLine(run.instance), outcomeWords(run.outcome)], run }
      : { at: runTime(run), parts: [outcomeWords(run.outcome), run.event === null ? null : run.event.replace(/_/g, " "), run.number ? `#${run.number}` : null, run.instance], run };
  const items =
    st !== null && st.fired.length > 0
      ? st.fired.map((fired) => ({ at: fired.at, parts: [fired.label, fired.event, fired.instance, outcomeWords(fired.outcome)], run: null as AutomationRun | null }))
      : (row.recentRuns.length > 0 ? row.recentRuns : row.lastRun !== null ? [row.lastRun] : []).map(fromRow);

  return (
    <Section title={trigger ? "Recent fires" : "Recent runs"} testId="oats-automation-history">
      <p data-testid="oats-automation-history-note" className={NOTE}>
        {[`on ${here.on}`, lead].filter(Boolean).join(" · ")}
      </p>
      {failure == null ? null : (
        // The state could not be read (again): said in words, the kernel's message and its code after, over what was read before.
        <div data-testid="oats-automation-status-failed">
          <Notice
            tone="error"
            title="This trigger's state could not be read"
            code={failure.code}
            details={failure.message}
            {...(failure.readAt === null ? {} : { age: readAge(failure.readAt, now) })}
            actions={
              <Button data-testid="oats-automation-status-retry" onClick={failure.onRetry}>
                Retry
              </Button>
            }
          >
            {/* A person's words; the kernel's own are one press away, under Details. */}
            <p>{status === null ? "What is live and what waits is not known; the trigger's last fire, as the list has it, is below." : "What is below is the state that was read before."}</p>
          </Notice>
        </div>
      )}
      {poll !== null && !poll.ok ? (
        // A poll that failed is a notice, as a state that cannot be read is: what happened in a
        // person's words, the cause the kernel names, its own message one press away, and for a
        // capability's source the source's words as a quote.
        <div data-testid="oats-automation-last-poll">
          <Notice tone="error" title="The last poll failed" code={samePoll ? (err?.code ?? null) : null} details={poll.error}>
            <p>
              <Time iso={poll.at} now={now} />
              {source !== null && causeWords(poll.cause) !== null ? `: ${causeWords(poll.cause)}` : ""}
              {". What is listed below is from before it."}
            </p>
            {source !== null ? says(poll.says ?? (samePoll ? err?.says : null)) : null}
          </Notice>
        </div>
      ) : poll !== null && source !== null && poll.events !== null ? (
        <p data-testid="oats-automation-last-poll" className={`${LINE} text-foreground`}>
          {"Last poll "}
          <Time iso={poll.at} now={now} />
          {`: ${[events(poll.events ?? 0), tally({ filtered: poll.filtered ?? 0, skipped: poll.skipped ?? 0, refused: poll.refused ?? 0 })].filter(Boolean).join(", ")}`}
        </p>
      ) : poll !== null && source === null ? (
        <p data-testid="oats-automation-last-poll" className={`${LINE} text-foreground`}>
          {"Last poll "}
          <Time iso={poll.at} now={now} />
          {`: ${poll.prs} ${poll.prs === 1 ? "pull request" : "pull requests"}, ${poll.matching} matching`}
        </p>
      ) : null}
      {err !== null && !samePoll && !sameCheck ? (
        <>
          <p data-testid="oats-automation-last-error" className={`${LINE} text-destructive-text`}>
            {`Last error: ${err.message ?? ""}`}
            {err.code !== null ? <code className="font-mono text-xs">{`${err.message !== null ? " " : ""}${err.code}`}</code> : null}
          </p>
          {says(err.says)}
        </>
      ) : null}
      {st !== null && st.pending.length > 0 ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">Waiting</p>
          <ul aria-label="Waiting" className="flex flex-col">
            {st.pending.slice(0, 10).map((entry, at) => (
              <HistoryLine key={entry.key ?? at} iso={entry.observedAt} now={now} testId="oats-automation-waiting">
                {eventText(entry)}
              </HistoryLine>
            ))}
          </ul>
          {st.pending.length > 10 ? <p className={NOTE}>{`and ${st.pending.length - 10} more`}</p> : null}
        </>
      ) : null}
      {st !== null && st.live.length > 0 ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">Live now</p>
          <ul aria-label="Live now" className="flex flex-col">
            {st.live.map((entry, at) => (
              <li key={at} data-testid="oats-automation-live" className="min-w-0 break-words border-t border-border py-1.5 text-sm text-foreground first:border-t-0">
                {eventText(entry)}
                {entry.instance !== null ? (
                  <>
                    {eventText(entry) !== "" ? " · " : ""}
                    <span className="font-mono">
                      <Tokens text={entry.instance} />
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {items.length > 0 && st !== null && (st.pending.length > 0 || st.live.length > 0) ? <p className="text-xs font-semibold text-muted-foreground">Fired</p> : null}
      {items.length > 0 ? (
        <ul aria-label={trigger ? "Fired" : "Runs"} className="flex flex-col">
          {items.slice(0, 10).map((item, at) => (
            <HistoryLine key={at} iso={item.at} now={now} testId="oats-automation-run">
              {shown(item.parts.filter(Boolean).join(" · ")) || "Recorded"}
              {/* Why a run did not happen: the line says it in a person's words; the kernel's own, and its code, are one press away. */}
              {/* A run that did not happen because the definition is not valid repeats what the Invalid card says: it is said once, there. */}
              {item.run !== null && item.run.error !== null && !(row.invalid?.message != null && item.run.error.includes(row.invalid.message)) ? (
                <Disclosure summary="Details" testId="oats-automation-run-error">
                  {/* The kernel's message names ids: each word whole. */}
                  <p className="text-xs text-muted-foreground">
                    <Tokens text={shown(item.run.error)} />
                  </p>
                  {item.run.errorCode !== null && !item.run.error.includes(item.run.errorCode) ? <code className="font-mono text-xs text-muted-foreground">{shown(item.run.errorCode)}</code> : null}
                </Disclosure>
              ) : null}
            </HistoryLine>
          ))}
        </ul>
      ) : (
        <Empty>{row.runsHere ? `Not run yet on ${here.on}.` : "Runs are recorded on the computer that runs it."}</Empty>
      )}
      {/* What the source's last GOOD poll refused or skipped. A failed poll leaves the lists as they
          were, so they can be older than the failure above: the line over them says which poll they are from. */}
      {source !== null && st !== null && st.source !== null ? (
        <SourceLists
          refused={st.refused}
          skipped={st.skipped}
          source={source}
          from={
            <p data-testid="oats-automation-lists-from" className={NOTE}>
              {poll !== null && poll.ok ? (
                <>
                  {"At the last poll, "}
                  <Time iso={poll.at} now={now} />
                </>
              ) : poll !== null ? (
                "From the last successful poll, before the failure above"
              ) : (
                "From the last successful poll"
              )}
            </p>
          }
        />
      ) : null}
    </Section>
  );
}

/** Run state on the machine: running since, an unknown state (with the reconcile command to paste), a wake waiting to be delivered. */
function RunStateCard({ row, run, now, action }: { row: AutomationRow; run: RunState; now: number; action?: ReactNode }) {
  const line = (tone: "ok" | "bad", words: string, iso: string | null) => {
    const at = pastTime(iso, now);
    return (
      <p title={at?.title} className="text-sm font-semibold text-foreground">
        <Toned tone={tone}>{at !== null && iso !== null ? `${words} since ${clockTime(iso, now)} · ${at.label}` : words}</Toned>
      </p>
    );
  };
  const unknown = run.unknown;
  const scheduled = unknown === null ? null : relativeTime(unknown.scheduledFor, now);
  return (
    <Card title="Run state" testId="oats-automation-run-state">
      {run.running !== null ? line("ok", "Running", run.running.since) : null}
      {unknown !== null ? (
        <>
          {line("bad", "Run state unknown", unknown.since)}
          <p className={LINE}>OATS does not know whether this run happened. Check it, so the schedule can run again.</p>
          <FactList facts={[["Scheduled", scheduled?.label, scheduled?.title], ["Host slot", unknown.holdsSlot ? "held (counts against the host limit)" : null]]} />
          {/* What the kernel recorded of the process, one press away. */}
          {unknown.exited || unknown.exitStatus !== null || unknown.exitSignal !== null || unknown.error !== null ? (
            <Disclosure summary="Details" testId="oats-automation-run-state-details">
              <FactList
                facts={[
                  ["Exited", unknown.exited ? "yes" : null],
                  ["Exit status", unknown.exitStatus === null ? null : String(unknown.exitStatus)],
                  ["Exit signal", unknown.exitSignal === null ? null : shown(unknown.exitSignal)],
                  ["Error", unknown.error === null ? null : shown(unknown.error)],
                ]}
              />
            </Disclosure>
          ) : null}
          {action}
          {/* The command works when pasted, so it is drawn as it is or not at all: only when the id and the directory the kernel gave are lines of plain text. */}
          {cleanLine(row.id) && (row.scope === null || cleanLine(row.scope)) ? (
            <p data-testid="oats-automation-reconcile-command" className={NOTE}>
              {"From a terminal: "}
              <Command text={reconcileCommand(row)} />
              {". If its effects can’t be proven, check by hand, then "}
              <Command text={reconcileCommand(row, { clear: true })} />
              {" records it as launch failed and frees its slot."}
            </p>
          ) : (
            <p data-testid="oats-automation-reconcile-command" className={NOTE}>
              The command that checks it from a terminal (oats schedule reconcile) cannot be shown: this schedule's id or its directory holds characters that are not text.
            </p>
          )}
        </>
      ) : null}
      {run.pendingWake !== null ? (
        <p title={relativeTime(run.pendingWake.scheduledFor, now)?.title} className={`${LINE} text-foreground`}>
          {`A wake message is waiting to be delivered${relativeTime(run.pendingWake.scheduledFor, now) !== null ? ` (due ${relativeTime(run.pendingWake.scheduledFor, now)!.label})` : ""}.`}
        </p>
      ) : null}
    </Card>
  );
}

export type DetailProps = {
  row: AutomationRow;
  host: AutomationHost;
  now: number;
  /** A trigger's recorded state, once `oats trigger status` answered; null before, and when it never did. */
  status: TriggerStatus | null;
  /** Why that state could not be read, or read again: the kernel's code and message, when `status` was read, and how to ask again. */
  statusFailure?: { code: string | null; message: string; readAt: string | null; onRetry: () => void } | null;
  onBack: () => void;
  /** Opens the row's defining file; absent where this client cannot. */
  onOpenFile?: (target: FileTarget) => void;
  /** The bb machine that holds the deployment, once known: a file of that machine is previewed there. */
  hostId?: string | null;
  /** Whether a capability of that name is one the Capabilities page lists exactly once. */
  canOpenCapability?: (name: string) => boolean;
  onOpenCapability?: (name: string) => void;
  /** False while the host scheduler is off: the page then never says the row runs or has a next run. */
  running?: boolean;
  /** More of the page's bar (the acts on this row), after Open file. */
  actions?: ReactNode;
  /** The run-state card's own act (Check run state). */
  runStateAction?: ReactNode;
  /** What an act put on the page (a test's confirmation and its answer): it leads the second column, and comes first where the columns stack. */
  answers?: ReactNode;
  /** Beside the name (the on/off switch), and under "No summary" (Edit summary). */
  identityAction?: ReactNode;
  summaryAction?: ReactNode;
};

export function Detail({ row, host, now, running = true, status, statusFailure = null, onBack, onOpenFile, hostId = null, canOpenCapability, onOpenCapability, actions, runStateAction, answers, identityAction, summaryAction }: DetailProps) {
  const here = useHere();
  const title = TITLES[row.kind];
  const page = useRef<HTMLDivElement>(null);
  // Opening the page puts focus on Back, where Escape and Enter both lead out again.
  useEffect(() => {
    page.current?.querySelector<HTMLElement>('[data-testid="oats-automation-back"]')?.focus();
  }, [row.id]);
  const source = row.kind === "trigger" ? capabilitySource(row.on, status?.source ?? null) : null;
  const file = fileTarget(row, hostId, here);
  const place = placementText(row, host, running, here);
  const run = runState(row);
  const bad = row.unreadable ?? row.invalid;
  // A capability source's check that failed at a poll: the state's own, else the row's. Worked out once, for the card and the history.
  const sourceCheck: AutomationProblem | null = source === null ? null : status?.invalid?.at ? status.invalid : row.invalid;
  const check = row.unreadable === null ? sourceCheck : null;
  const checked = check === null ? null : pastTime(check.at, now);
  const template: FactRow = ["Template", shown(templateProvenance(row.template)), row.template === null ? null : shown([templateLabel(row.template) ?? row.template.from, row.template.version, row.template.commit].filter(Boolean).join(" "))];
  const stamp = (label: string, iso: string | null): FactRow => [label, pastTime(iso, now)?.label, pastTime(iso, now)?.title];
  return (
    <RunningContext.Provider value={running}>
    <div
      ref={page}
      data-testid="oats-automation-detail"
      data-id={row.id}
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onBack();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="oats-automation-back" aria-label={`Back to ${title}`} onClick={onBack}>
          {`‹ ${title}`}
        </Button>
        <span className="min-w-0 flex-1" />
        {onOpenFile === undefined ? null : (
          <Button data-testid="oats-automation-open-file" disabled={file.target === null} title={shown(file.title)} onClick={() => (file.target === null ? undefined : onOpenFile(file.target))}>
            Open file
          </Button>
        )}
        {actions}
      </div>
      <div data-testid="oats-automation-identity" className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="break-words font-mono text-lg font-semibold text-foreground">
            <Tokens text={shown(row.name)} />
          </h2>
          <p className="break-words font-mono text-xs text-muted-foreground">
            <Tokens text={shown(row.id)} />
          </p>
          <div className="flex flex-wrap gap-1">
            <OriginTag row={row} />
            <StateTags row={row} />
          </div>
          {row.description !== null ? (
            <p className="break-words text-sm text-foreground">{shown(row.description)}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>No summary</span>
              {summaryAction}
            </p>
          )}
        </div>
        {identityAction}
      </div>
      {/* What an act just put on the page (a confirmation, a test's answer): right under the buttons that were pressed, at every width. */}
      <div data-testid="oats-automation-answers" className="flex min-w-0 flex-col gap-3 empty:hidden">
        {answers}
      </div>
      <Sends row={row} />
      {/* The row's facts, in cards of equal width: two beside each other from the width that gives
          each a value column a code, a path or an id fits in; one under the other below it. What
          is wrong and what is running come first. */}
      <div className="grid gap-3 @3xl:grid-cols-2">
        {check !== null && check.at !== null ? (
          // The last source check failed at a poll: a person's words, then the kernel's message, code and field one press away.
          <Card title="Source check failed" testId="oats-automation-problem" tone="warn">
            <p className={LINE}>{`The source's check failed at the last poll${checked === null ? "" : ` (${checked.label})`}, so this trigger did not fire.`}</p>
            <Disclosure summary="Details" testId="oats-automation-problem-details">
              <FactList facts={[["Message", displayLine(check.message)], ["Code", displayLine(check.code)], ["Field", displayLine(check.field)], ["Checked", checked?.label, checked?.title]]} />
            </Disclosure>
          </Card>
        ) : bad !== null ? (
          <Card title={row.unreadable !== null ? "Unreadable" : "Invalid"} testId="oats-automation-problem" tone="warn">
            <p className={LINE}>{row.unreadable !== null ? "OATS cannot read this definition, so it does not run." : "OATS cannot use this definition as it is written, so it does not run."}</p>
            <Disclosure summary="Details" testId="oats-automation-problem-details">
              <FactList facts={[["Code", bad.code === null ? null : shown(bad.code)], ["Field", bad.field === null ? null : shown(bad.field)], ["Message", bad.message === null ? null : shown(bad.message)]]} />
            </Disclosure>
          </Card>
        ) : null}
        {run !== null ? <RunStateCard row={row} run={run} now={now} action={runStateAction} /> : null}
        <WhenCard row={row} now={now} running={running} source={source} canOpenCapability={canOpenCapability} onOpenCapability={onOpenCapability} />
        {row.run === "spawn" ? <SpawnsCard row={row} /> : null}
        {row.wake === null ? null : <WakeCard wake={row.wake} />}
        <Card title="Where it runs" testId="oats-automation-where">
          {/* A local row that runs here has one thing to say, and the line under says it. */}
          <FactList
            facts={
              row.origin.kind === "local"
                ? []
                : [["Runs on", row.runsOn === null ? null : shown(row.runsOn)], ["Host name in OATS", shown(host.name ?? "none")], ["Acts as", row.owner === null ? null : shown(row.owner)], ["Logged in", shown(hostLogin(host, row.owner))]]
            }
          />
          <p data-testid="oats-automation-verdict" className="text-sm font-semibold text-foreground">
            <Toned tone={place.tone}>{row.runsHere ? (running ? `Runs on ${here.on}` : `${hereWhileOff(here)}; the scheduler is off`) : shown(place.label)}</Toned>
          </p>
          {/* Why not here, in the kernel's words; what is wrong with the definition is said once, in its own card. */}
          {row.reasonDetail !== null && row.reasonDetail !== bad?.message ? <p className={`${NOTE} break-words`}>{shown(row.reasonDetail)}</p> : null}
        </Card>
        {/* A path or a file can be fifty characters: this card has the whole width, so that one is whole on its line. */}
        <div className="@3xl:col-span-2">
        <Card title="Comes from" testId="oats-automation-from">
          {row.origin.kind === "workspace" ? (
            <FactList
              facts={[
                ["Member", row.origin.member === null ? null : shown(row.origin.member)],
                ["Repo", row.origin.repoKey === null ? null : shown(row.origin.repoKey)],
                ["Path", row.origin.path === null ? null : shown(row.origin.path)],
                ["Commit", row.origin.commit === null ? null : shown(row.origin.commit.slice(0, 7)), shown(row.origin.commit)],
                template,
              ]}
            />
          ) : (
            <>
              <p className={NOTE}>{`Local to ${here.on}; not shared through Git.`}</p>
              <FactList facts={[template, stamp("Created", row.createdAt), stamp("Updated", row.updatedAt)]} />
            </>
          )}
        </Card>
        </div>
      </div>
      <History row={row} status={status} failure={row.kind === "trigger" ? statusFailure : null} source={source} check={sourceCheck} now={now} />
    </div>
    </RunningContext.Provider>
  );
}
