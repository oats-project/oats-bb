// One automation's page, in the manner of bb's own (whose breadcrumb, "Automations / its name", is
// in bb's own header: Page.tsx `usePageTitle`): the name with its switch and its "…" menu; one small line (who it starts · when · the next run or
// the last fire) and under it, in red, what is wrong; a card of WHAT IT DOES (the instruction, the
// wake message, the command or the operation, whole, with the soul, the harness and the model at
// its foot); then Runs, a table; then one closed fold, Details, for the few facts bb's manner has
// no place for. Nothing here is a sentence that explains.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { experimental_DetailRow as DetailRow, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { AutomationHost, AutomationProblem, AutomationRow, TriggerStatus } from "../../contract/automations";
import { droppedCount, pageRuns, scheduleCut, triggerCut } from "../../model/automation-runs";
import { displayLine, shown, shownBlock } from "../ui/text";
import { readAge } from "../ui/words";
import { Button, Card, Disclosure, Empty, LINK, Loading, Menu, Notice, TARGET } from "../ui";
import type { MenuItem } from "../ui";
import { RunningContext, useHere } from "./here";
import { DETAIL, ICON_BUTTON, ICONS, PLAIN, PLAIN_FOOT, SECTION, SECTION_HEAD, SEPARATED } from "./bb";
import { Answer, iconOf, Sentence, SmallLine } from "./List";
import { FactList, Quote } from "./parts";
import type { QuoteLine } from "./parts";
import { Runs } from "./Runs";
import type { AgentLink } from "./Runs";
import {
  capabilitySource,
  causeWords,
  cronInWords,
  EVENTS_SHOWN,
  attention,
  harnessName,
  LEAD_INS,
  onSummary,
  pastTime,
  placementText,
  rowLine,
  ruleWords,
  RUNS_SHOWN,
  sourceLabel,
  sourceParams,
  taskParts,
} from "./words";
import type { CapabilitySource, FileTarget } from "./words";

const NOTE = "text-xs text-muted-foreground";
const LINE = "min-w-0 break-words text-sm";

/** A text of more lines or characters than these is drawn to its bound, with "Show more" to the rest. */
export const PROSE_BOUND = { lines: 8, characters: 640 } as const;
const long = (text: string): boolean => text.length > PROSE_BOUND.characters || text.split("\n").length > PROSE_BOUND.lines;

// A prompt or a wake message is drawn as a block through `shownBlock` (app/ui/text.ts): the text
// as it is, for these two fields only (it is the definition a person or their workspace wrote, the
// page's purpose is to read it, and the same reader can open the file). Nothing is withheld; only
// a character that is not text is drawn as U+FFFD, so a definition from a shared repository cannot
// reorder or hide what the page shows. A long one has a bound and a way to the rest.
function Prose({ text, children }: { /** the text, for its length */ text: string; children: ReactNode }) {
  const [whole, setWhole] = useState(false);
  const bounded = long(text);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div data-testid="oats-automation-prose" data-bounded={bounded && !whole} className={`w-full min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground ${bounded && !whole ? "max-h-44 overflow-hidden" : ""}`}>
        {children}
      </div>
      {bounded ? (
        <button type="button" data-testid="oats-automation-prose-more" aria-expanded={whole} className={`${LINK} ${TARGET} inline-flex items-center text-xs text-muted-foreground`} onClick={() => setWhole((before) => !before)}>
          {whole ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function Time({ iso, now }: { iso: string | null; now: number }) {
  const at = pastTime(iso, now);
  return (
    <time title={at?.title} dateTime={at === null || iso === null ? undefined : iso}>
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
function SourceLists({ refused, skipped, source }: { refused: TriggerStatus["refused"]; skipped: TriggerStatus["skipped"]; source: { capability: string | null; name: string | null } }) {
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
      {part("Refused by OATS", "oats-automation-refused", refused.length, refused.slice(0, EVENTS_SHOWN).map((entry) => ({ text: [entry.text], note: `Refused: ${ruleWords(entry.rule) ?? "no rule reported"}.` })))}
      {part("Skipped by the source", "oats-automation-skipped", skipped.length, skipped.slice(0, EVENTS_SHOWN).map((entry) => ({ label: entry.subject, text: [entry.why] })))}
    </div>
  );
}

/** The card's heading, by what a run does. */
export const doesTitle = (row: AutomationRow): string => (row.run === "wake" ? "Message" : row.run === "command" ? "Command" : row.run === "operation" ? "Operation" : "Instruction");

/** What a run does, whole: a spawn's or a trigger's instruction, a wake's message, a command's argv, an operation; at its foot the soul, the harness and the model. */
function Does({ row }: { row: AutomationRow }) {
  const foot = [row.soul === null ? null : shown(row.soul.name), row.harness === null ? null : shown(harnessName(row.harness)), row.model === null ? null : shown(row.model)].filter((part): part is string => part !== null && part !== "");
  const body = (): ReactNode => {
    if (row.run === "wake") return row.message !== null ? <Prose text={row.message}>{shownBlock(row.message)}</Prose> : <Empty>No wake message reported.</Empty>;
    if (row.run === "command")
      return row.argv !== null && row.argv.length > 0 ? (
        // The argv, one chip per argument, so the boundaries show; each through the display filter, like every text of OATS but a prompt.
        <ol aria-label="Command arguments" className="flex flex-wrap gap-1.5">
          {row.argv.map((word, at) => (
            <li key={at} className="break-all rounded border border-border bg-background px-1.5 py-px font-mono text-xs text-foreground">
              {shown(word)}
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No command reported.</Empty>
      );
    if (row.run === "operation") return row.operation !== null ? <p className={`${LINE} font-mono text-foreground`}>{shown(row.operation)}</p> : <Empty>No operation reported.</Empty>;
    if (row.task === null) return <Empty>{row.run !== null && row.run !== "spawn" ? `Nothing to show for a ${shown(row.run)} run.` : "No prompt reported."}</Empty>;
    const text = shownBlock(row.task);
    return (
      <Prose text={row.task}>
        {row.kind === "trigger"
          ? taskParts(text, row.on).map((part, at) =>
              "field" in part ? (
                // A field the event fills: marked, so that what is the event's and what is written is told apart.
                <span key={at} data-field={part.field} className="rounded border border-border bg-background px-1 font-semibold">{`{${part.field}}`}</span>
              ) : (
                part.text
              ),
            )
          : text}
      </Prose>
    );
  };
  return (
    <section data-testid="oats-automation-sends" aria-label={doesTitle(row)} className={`${SECTION} ${SEPARATED}`}>
      <h3 className={SECTION_HEAD}>{doesTitle(row)}</h3>
      {/* Plain text on the page's ground, between bb's separators: no box around it. */}
      <div className={PLAIN}>
        <div className="min-w-0">{body()}</div>
        {foot.length === 0 ? null : (
          <p data-testid="oats-automation-foot" className={PLAIN_FOOT}>
            {foot.map((part, at) => (
              <span key={at} className="min-w-0 break-words">
                {part}
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/** What is wrong with the definition, or with a capability source's check: a person's words, the kernel's one press away (WORDS.md). */
function Problem({ row, check, now }: { row: AutomationRow; check: AutomationProblem | null; now: number }) {
  const bad = row.unreadable ?? row.invalid;
  const checked = check === null ? null : pastTime(check.at, now);
  if (check !== null && check.at !== null)
    return (
      <Card title="Source check failed" testId="oats-automation-problem" tone="warn">
        <p className={LINE}>{`The source's check failed at the last poll${checked === null ? "" : ` (${checked.label})`}, so this trigger did not fire.`}</p>
        <Disclosure summary="Details" testId="oats-automation-problem-details">
          <FactList facts={[["Message", displayLine(check.message)], ["Code", displayLine(check.code)], ["Field", displayLine(check.field)], ["Checked", checked?.label, checked?.title]]} />
        </Disclosure>
      </Card>
    );
  if (bad === null) return null;
  return (
    <Card title={row.unreadable !== null ? "Unreadable" : "Invalid"} testId="oats-automation-problem" tone="warn">
      <p className={LINE}>{row.unreadable !== null ? "OATS cannot read this definition, so it does not run." : "OATS cannot use this definition as it is written, so it does not run."}</p>
      <Disclosure summary="Details" testId="oats-automation-problem-details">
        <FactList facts={[["Code", bad.code === null ? null : shown(bad.code)], ["Field", bad.field === null ? null : shown(bad.field)], ["Message", bad.message === null ? null : shown(bad.message)]]} />
      </Disclosure>
    </Card>
  );
}

/** A trigger's poll and last error, where they failed: said above the runs (WORDS.md: a person's words, the kernel's one press away; a source's own words as a quote). */
function TriggerTrouble({ status, source, check, now }: { status: TriggerStatus; source: CapabilitySource | null; check: AutomationProblem | null; now: number }) {
  const poll = status.lastPoll;
  const err = status.lastError;
  // A capability source's failure is said once: after a failed poll the kernel's last error is that
  // same failure, and after a failed check it repeats `invalid`.
  const samePoll = source !== null && poll !== null && !poll.ok && poll.cause !== null && err !== null && err.at === poll.at && err.message === poll.error;
  const sameCheck = check !== null && check.at !== null && err !== null && err.at === check.at && err.message === displayLine(check.message);
  const says = (value: { code: string | null; message: string | null } | null | undefined) =>
    value == null || source === null ? null : <Quote testId="oats-automation-source-says" leadIn={LEAD_INS.source(source.capability, source.name)} lines={[{ text: [value.code, value.message] }]} />;
  return (
    <>
      {poll !== null && !poll.ok ? (
        <div data-testid="oats-automation-last-poll">
          <Notice tone="error" title="The last poll failed" code={samePoll ? (err?.code ?? null) : null} details={poll.error}>
            <p>
              <Time iso={poll.at} now={now} />
              {source !== null && causeWords(poll.cause) !== null ? `: ${causeWords(poll.cause)}` : ""}
              {"."}
            </p>
            {source !== null ? says(poll.says ?? (samePoll ? err?.says : null)) : null}
          </Notice>
        </div>
      ) : null}
      {/* With a history of failures each one is a row of the table, with its code and message: the last error alone is said only where the kernel keeps no such history. */}
      {err !== null && status.failures === null && !samePoll && !sameCheck ? (
        <>
          <p data-testid="oats-automation-last-error" className={`${LINE} text-destructive-text`}>
            {`Last error: ${err.message ?? ""}`}
            {err.code !== null ? <code className="font-mono text-xs">{`${err.message !== null ? " " : ""}${err.code}`}</code> : null}
          </p>
          {says(err.says)}
        </>
      ) : null}
    </>
  );
}

/** The one closed fold: the few facts bb's manner has no place for, each a row of bb's own (its Info tab's label and value). Only what is set. */
function Details({ row, host, status, source, running, file, onOpenFile, canOpenCapability, onOpenCapability, now }: { row: AutomationRow; host: AutomationHost; status: TriggerStatus | null; source: CapabilitySource | null; running: boolean; file: FileTarget | null; now: number } & Pick<DetailProps, "onOpenFile" | "canOpenCapability" | "onOpenCapability">) {
  const here = useHere();
  const place = placementText(row, host, running, here);
  const on = row.kind === "trigger" ? onSummary(row.on) : null;
  const poll = status?.lastPoll ?? null;
  const concurrency = row.concurrency === null ? null : [row.concurrency.max !== null ? `${row.concurrency.max} at once` : null, row.concurrency.perKey !== null ? `${row.concurrency.perKey} per event` : null].filter(Boolean).join(" · ");
  const live = status !== null && status.liveCount !== null ? `${status.liveCount}${status.max !== null ? ` of ${status.max}` : ""} live now` : null;
  const path = row.origin.path ?? row.origin.localPath;
  const lookup = source?.lookup ?? null;
  const rows: { label: string; testId: string; value: ReactNode }[] = [];
  const add = (label: string, testId: string, value: ReactNode | null | undefined | "") => {
    if (value !== null && value !== undefined && value !== "") rows.push({ label, testId, value });
  };
  add(
    "Runs on",
    "runs-on",
    <span className="flex min-w-0 flex-col">
      <span data-tone={place.tone}>{shown(place.label)}</span>
      {row.reasonDetail === null ? null : <span className={NOTE}>{shown(row.reasonDetail)}</span>}
    </span>,
  );
  if (row.kind === "schedule") add("Schedule", "schedule", [row.cron, row.tz].filter(Boolean).map((part) => shown(part as string)).join(" · "));
  else if (source === null) {
    add("Event", "event", on === null ? null : shown(on.title));
    add("Labels", "labels", on === null ? null : shown(on.labels.join(", ")));
    add("Base", "base", on?.base == null ? null : shown(on.base));
    add("Polls", "polls", on?.poll ? `every ${shown(on.poll)}` : null);
  } else {
    add(
      "Source",
      "source",
      lookup !== null && onOpenCapability !== undefined && canOpenCapability?.(lookup) === true ? (
        <button type="button" data-testid="oats-automation-open-capability" aria-label={`Open capability ${lookup}`} className={`${LINK} ${TARGET} inline-flex min-w-0 items-center break-words text-left`} onClick={() => onOpenCapability(lookup)}>
          {sourceLabel(source) ?? source.id}
        </button>
      ) : (
        (sourceLabel(source) ?? source.id)
      ),
    );
    add("Events", "events", on?.events.join(", "));
    add("Polls", "polls", on?.poll ? `every ${on.poll}` : null);
  }
  add(
    "File",
    "file",
    path === null ? null : file !== null && onOpenFile !== undefined ? (
      <button type="button" data-testid="oats-automation-open-file" className={`${LINK} ${TARGET} inline-flex min-w-0 items-center break-all text-left`} onClick={() => onOpenFile(file)}>
        {shown(path)}
      </button>
    ) : (
      <span className="break-all">{shown(path)}</span>
    ),
  );
  add("Teams", "teams", shown(row.teams.join(", ")));
  add("Concurrency", "concurrency", [concurrency, live].filter(Boolean).join(" · "));
  add("Launch configuration", "launch-config", row.launchConfig === null ? null : shown(row.launchConfig));
  if (row.wake !== null) add("Recurring wake-up", "wake", [cronInWords(row.wake.cron) ?? shown(row.wake.cron), row.wake.tz === null ? null : shown(row.wake.tz), row.wake.message === null ? null : shown(row.wake.message)].filter(Boolean).join(" · "));
  if (poll !== null && poll.ok)
    add(
      "Last poll",
      "last-poll",
      <span>
        <Time iso={poll.at} now={now} />
        {source !== null && poll.events !== null
          ? `: ${[events(poll.events ?? 0), tally({ filtered: poll.filtered ?? 0, skipped: poll.skipped ?? 0, refused: poll.refused ?? 0 })].filter(Boolean).join(", ")}`
          : poll.prs !== null
            ? `: ${poll.prs} ${poll.prs === 1 ? "pull request" : "pull requests"}, ${poll.matching} matching`
            : ""}
      </span>,
    );
  return (
    <Disclosure summary="Details" testId="oats-automation-details">
      <div className="flex min-w-0 flex-col gap-1 pt-1 text-sm">
        {rows.map((entry) => (
          <div key={entry.testId} data-testid={`oats-automation-detail-${entry.testId}`} className="min-w-0">
            <DetailRow label={entry.label} align="start">
              <span className="min-w-0 break-words">{entry.value}</span>
            </DetailRow>
          </div>
        ))}
        {source !== null && sourceParams(row.on).count > 0 ? <ParamsQuote row={row} /> : null}
        {/* What the source's last good poll refused or skipped. */}
        {source !== null && status !== null && status.source !== null ? <SourceLists refused={status.refused} skipped={status.skipped} source={source} /> : null}
      </div>
    </Disclosure>
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
  /** What the file's row opens: null where there is nothing to open. */
  file?: FileTarget | null;
  /** Whether a capability of that name is one the Capabilities page lists exactly once. */
  canOpenCapability?: (name: string) => boolean;
  onOpenCapability?: (name: string) => void;
  /** False while the host scheduler is off: the page then never says the row has a next run. */
  running?: boolean;
  /** Beside the name: the on/off switch. */
  identityAction?: ReactNode;
  /** The "…" menu's acts. */
  menu?: readonly MenuItem[];
  /** What an act put on the page (a test's confirmation and its answer). */
  answers?: ReactNode;
  /** A run's agent, as the roster has it now. */
  agentLink?: AgentLink;
  /** The agent of this automation that asks, where one does: "Answer" opens its chat. */
  asks?: string | null;
  onAnswer?: (instance: string) => void;
};

export function Detail({ row, host, now, running = true, status, statusFailure = null, onBack, onOpenFile, file = null, canOpenCapability, onOpenCapability, identityAction, menu, answers, agentLink, asks = null, onAnswer }: DetailProps) {
  const page = useRef<HTMLDivElement>(null);
  // Opening the page puts the focus on its name (the breadcrumb is bb's own, in bb's header): what a screen reader says first, and from where Escape leads back.
  useEffect(() => {
    page.current?.querySelector<HTMLElement>('[data-testid="oats-automation-name-heading"]')?.focus();
  }, [row.id]);
  const source = row.kind === "trigger" ? capabilitySource(row.on, status?.source ?? null) : null;
  // A capability source's check that failed at a poll: the state's own, else the row's.
  const sourceCheck: AutomationProblem | null = source === null ? null : status?.invalid?.at ? status.invalid : row.invalid;
  const check = row.unreadable === null ? sourceCheck : null;
  const here = useHere();
  // The page's own line says the next run too; the list's does not.
  const parts = rowLine(row, status, now, { here, asks: asks !== null, next: { running } });
  const state = attention(row, status, () => asks);
  const bad = state === "failing";
  // The line says who, when and what is next; what is wrong stands under it, in red, by itself.
  const plain = parts.filter((part) => part.tone !== "bad");
  const wrong = parts.filter((part) => part.tone === "bad");
  const entries = pageRuns(row, row.kind === "trigger" ? status : null);
  const cut = row.kind === "schedule" ? (scheduleCut(row) ? { count: null } : null) : status !== null && triggerCut(status) ? { count: droppedCount(status) } : null;
  return (
    <RunningContext.Provider value={running}>
      <div
        ref={page}
        data-testid="oats-automation-detail"
        data-id={row.id}
        className={`@container ${DETAIL}`}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          onBack();
        }}
      >
        <div data-testid="oats-automation-identity" className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true" className={`flex h-6 w-4 shrink-0 items-center justify-center ${bad ? "text-destructive-text" : "text-muted-foreground"}`}>
              <Icon name={iconOf(row, bad)} className="size-4" />
            </span>
            <h2 data-testid="oats-automation-name-heading" tabIndex={-1} title={shown(row.id)} className="min-w-0 flex-1 break-words text-base font-semibold text-foreground focus:outline-none">
              {shown(row.name)}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {asks === null || onAnswer === undefined ? null : <Answer name={row.name} onAnswer={() => onAnswer(asks)} className="mr-1" />}
              {identityAction}
              {menu === undefined || menu.length === 0 ? null : (
                <div data-testid="oats-automation-detail-menu">
                  <Menu label={`Actions for ${shown(row.name)}`} items={menu}>
                    <span className={ICON_BUTTON}>
                      <Icon name={ICONS.menu} className="size-4" />
                    </span>
                  </Menu>
                </div>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 pl-6">
            <Sentence row={row} whole />
            <SmallLine parts={plain} />
            {wrong.map((part, at) => (
              <p key={at} data-testid="oats-automation-wrong" className="flex min-w-0 items-start gap-1.5 text-xs text-destructive-text">
                <span aria-hidden="true" className="flex h-4 shrink-0 items-center">
                  <Icon name={ICONS.failing} className="size-3.5" />
                </span>
                <span className="min-w-0 break-words">{shown(part.text)}</span>
              </p>
            ))}
          </div>
        </div>
        {/* What an act just put on the page (a confirmation, a test's answer): right under the head, at every width. */}
        <div data-testid="oats-automation-answers" className="flex min-w-0 flex-col gap-3 empty:hidden">
          {answers}
        </div>
        <Problem row={row} check={check} now={now} />
        <Does row={row} />
        <section data-testid="oats-automation-history" aria-label="Runs" className={`${SECTION} ${SEPARATED}`}>
          <h3 className={SECTION_HEAD}>Runs</h3>
          {statusFailure == null ? null : (
            // The state could not be read (again): said in words, the kernel's message and its code after, over what was read before.
            <div data-testid="oats-automation-status-failed">
              <Notice
                tone="error"
                title="This trigger's state could not be read"
                code={statusFailure.code}
                details={statusFailure.message}
                {...(statusFailure.readAt === null ? {} : { age: readAge(statusFailure.readAt, now) })}
                actions={
                  <Button data-testid="oats-automation-status-retry" onClick={statusFailure.onRetry}>
                    Retry
                  </Button>
                }
              />
            </div>
          )}
          {row.kind === "trigger" && status !== null ? <TriggerTrouble status={status} source={source} check={sourceCheck} now={now} /> : null}
          {/* A new automation's table starts at its first rows. */}
          {row.kind === "trigger" && status === null ? (
            // A trigger's runs are its state's: until that is read nothing is said of them, least of all that there are none.
            statusFailure == null ? <Loading>Reading…</Loading> : null
          ) : (
            <Runs key={`${row.kind}:${row.id}`} entries={entries} now={now} agentLink={agentLink} step={RUNS_SHOWN.page} cut={cut} openFirst />
          )}
        </section>
        <Details row={row} host={host} status={status} source={source} running={running} file={file} onOpenFile={onOpenFile} canOpenCapability={canOpenCapability} onOpenCapability={onOpenCapability} now={now} />
      </div>
    </RunningContext.Provider>
  );
}
