// Acting on a row of the Automations page, and on the machine's scheduler: on and off, Run now,
// Test (a capability source's only after a confirmation that says what will run), Edit summary,
// Delete, Check run state, Enable scheduler. Each goes through the plugin's server to the kernel's
// own verb; what it answered or refused is said where the person is looking. The names of the
// acts and their sentences are the Desktop's (views/automations.mjs, views/schedules.mjs).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { experimental_PluginRpcCallError as PluginRpcCallError } from "@get-bb/plugin-sdk/app";
import type { AutomationRow, AutomationTest } from "../../contract/automations";
import { isUnconfirmed } from "../../contract/shared";
import { isKernelCode } from "../../kernel/result";
import { DESCRIPTION_MAX, DESCRIPTION_RULE, descriptionValid } from "../../model/automations";
import { attempt, errorMessage } from "../store";
import type { Rpc } from "../store";
import { Button, Card, Confirm, Field, INPUT, Lines, Loading, Modal, Result, Switch } from "../ui";
import type { ConfirmProps, MenuItem } from "../ui";
import { displayLine, shown } from "../ui/text";
import type { DetailProps } from "./Detail";
import { useHere, useRunning } from "./here";
import { FactList, Quote } from "./parts";
import {
  capabilitySource,
  causeWords,
  EVENTS_SHOWN,
  fileTarget,
  LEAD_INS,
  NAME_CUT,
  NOTHING_RAN,
  refusalParts,
  ruleWords,
  runState,
  runTone,
  runWhy,
  scheduleOutcome,
  sourceParams,
  switchTitle,
  dueWords,
  failedTitle,
  summaryFailed,
  TEST_REFUSED,
  testReady,
  TEST_TIMED_OUT,
  HERE,
  TEST_UNREAD,
} from "./words";
import type { CapabilitySource, Failed, FileTarget, Here } from "./words";

/** A test's answer, or why there is none. */
/** bb's codes for a call the plugin's server ANSWERED with a no (as app/lifecycle/acts.tsx reads them). */
const ANSWERED = new Set(["conflict", "invalid", "invalid_input", "forbidden", "not_found", "unknown_method"]);
/**
 * A failed act, as what it was: the code that leads its message (the kernel's, or one of the
 * plugin's own) and the message; and whether it was REFUSED, so that it did not happen. Refused
 * is the kernel's own no (an `E_…` code it did not mark as unconfirmed), or the plugin's server
 * turning the request down before any process: bb's code for an answered no, with no code leading
 * the message. Anything else (no answer in time, an answer that cannot be read, a process that
 * died, a call nobody answered) may have happened all the same.
 */
export function failureOf(error: unknown): { code: string | null; message: string; refused: boolean } {
  const { code, message } = refusalParts(errorMessage(error));
  const confirmed = !isUnconfirmed(error);
  if (code !== null) return { code, message, refused: confirmed && isKernelCode(code) };
  return { code, message, refused: confirmed && error instanceof PluginRpcCallError && ANSWERED.has(error.code) };
}

type Tested = { test: AutomationTest } | { error: string; code: string | null; /** the kernel's own message, where `error` is the plugin's sentence for it */ says?: string };
/** A test's answer as it is kept: for the row as it was tested (its signature), with the number of its arrival. */
type Kept = { tested: Tested; signature: string; arrival: number };
type Said = { title: string; tone: "done" | "failed" | "unknown"; lines: string[]; code: string | null };
type Phase = ConfirmProps["phase"];
type Dialog =
  | { kind: "delete"; row: AutomationRow; phase: Phase }
  | { kind: "scheduler"; phase: Phase }
  | { kind: "summary"; row: AutomationRow; value: string; error: string | null; saving: boolean };

const LINE = "min-w-0 break-words text-sm";

/**
 * What an act just put on the page (its result, a test's answer, a confirmation): the focus moves
 * to it once, when it arrives, which also brings it into view. A row's page is longer than a
 * phone's screen and its side column is under the main one, so an answer is not always where the
 * press was. `seen` remembers the last arrival that took the focus, so drawing it again takes nothing.
 */
function Arrive({ token, seen, testId, children }: { token: number; seen: { current: number }; testId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (token <= seen.current) return;
    seen.current = token;
    box.current?.focus();
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [token, seen]);
  return (
    <div ref={box} tabIndex={-1} data-testid={testId} className="flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </div>
  );
}

/** A row among both lists: a schedule and a trigger may share an id, so the kind is part of it. */
const keyOf = (row: Pick<AutomationRow, "kind" | "id">): string => `${row.kind}:${row.id}`;
/** What a capability source's test would run, whole: the trigger's `on` (its source, every parameter, its events), as the Desktop ties a confirmation to the whole row. */
const signatureOf = (row: AutomationRow): string => JSON.stringify([row.id, row.on]);
const events = (n: number): string => `${n} ${n === 1 ? "event" : "events"}`;
const tally = (parts: readonly (readonly [number, string])[]): string => parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`).join(", ");

/** Each event that would fire, with the instance name its spawn would be asked to derive; a source's URL is text, never a link. */
function FireList({ test }: { test: AutomationTest }) {
  if (test.wouldFire === null) return null;
  if (test.wouldFire.length === 0) return <p className={LINE}>Nothing would fire now.</p>;
  return (
    <>
      <p className={LINE}>Would fire now:</p>
      <ul aria-label="Would fire now" className="flex flex-col gap-1 pl-3">
        {test.wouldFire.map((fire, at) => (
          <li key={fire.key ?? at} data-testid="oats-automation-would-fire" title={fire.nameCut ? NAME_CUT : undefined} className={LINE}>
            {fire.label}
            {fire.instance === null ? null : (
              <>
                {" → "}
                <span className="font-mono">{fire.instance}</span>
              </>
            )}
            {fire.held ? ` (held${fire.heldReason === null ? "" : `: ${fire.heldReason}`})` : ""}
            {fire.nameCut ? " · name shortened to fit" : ""}
            {fire.url === null ? null : <span className="block break-all font-mono text-xs text-muted-foreground">{fire.url}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** What OATS refused and what the source skipped in a test, as the source's own quoted text. */
function SourceLists({ source }: { source: NonNullable<AutomationTest["source"]> }) {
  const leadIn = LEAD_INS.source(source.capability, source.name);
  return (
    <>
      {source.refused.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">Refused by OATS</p>
          <Quote leadIn={leadIn} lines={source.refused.slice(0, EVENTS_SHOWN).map((entry) => ({ text: [entry.text], note: `Refused: ${ruleWords(entry.rule) ?? "no rule reported"}.` }))} />
          {source.refused.length > EVENTS_SHOWN ? <p className="text-xs text-muted-foreground">{`and ${source.refused.length - EVENTS_SHOWN} more`}</p> : null}
        </div>
      )}
      {source.skipped.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">Skipped by the source</p>
          <Quote leadIn={leadIn} lines={source.skipped.slice(0, EVENTS_SHOWN).map((entry) => ({ label: entry.subject, text: [entry.why] }))} />
          {source.skipped.length > EVENTS_SHOWN ? <p className="text-xs text-muted-foreground">{`and ${source.skipped.length - EVENTS_SHOWN} more`}</p> : null}
        </div>
      )}
    </>
  );
}

/** The Test result card. A capability source's speaks of the source first; another's of whether it would run here. */
export function TestCard({ tested, now }: { tested: Tested; now: number }) {
  const here = useHere();
  // The kernel's test knows nothing of the host timer: while it is off nothing is due, and the card does not say a run is.
  const running = useRunning();
  const warn = `${LINE} text-destructive-text`;
  if ("error" in tested) {
    return (
      <Card title="Test result" testId="oats-automation-test">
        <p className={warn}>
          <Lines text={tested.error} />
        </p>
        {tested.says === undefined ? null : (
          <p className={LINE}>
            <Lines text={tested.says} />
          </p>
        )}
        {tested.code === null ? null : <p className="text-xs text-muted-foreground">{shown(tested.code)}</p>}
      </Card>
    );
  }
  const { test } = tested;
  const ran = test.source;
  const soul = test.soul !== null && !test.soul.resolves && test.problems.length === 0 ? <p className={warn}>{shown(`The soul does not resolve${test.soul.error !== null ? `: ${test.soul.error}` : ""}`)}</p> : null;
  const account = test.account === null ? null : <p className={LINE}>{shown(`gh acts as ${test.account}`)}</p>;
  const due = dueWords(test.nextDue, now);
  if (ran === null) {
    return (
      <Card title="Test result" testId="oats-automation-test">
        <p className={test.ok ? LINE : warn}>{test.ok ? testReady(running) : `Not ready on ${here.on}.`}</p>
        {test.problems.map((problem, at) => (
          <p key={`p${at}`} className={warn}>
            {shown(problem)}
          </p>
        ))}
        {test.warnings.map((warning, at) => (
          <p key={`w${at}`} className={LINE}>
            {shown(warning)}
          </p>
        ))}
        {soul}
        {account}
        <FireList test={test} />
        {/* Only what is so: a due time that has passed (a list kept, or the moment before the next tick) was due, it is not next. */}
        {due === null || !running ? null : <p className={LINE}>{`${due.word === "Next" ? "Next due" : due.word} ${due.label}`}</p>}
      </Card>
    );
  }
  // A capability source: first what the source did (not whether the machine is ready), then the
  // placement as the kernel reports it, its warnings, and what would fire when the source answered.
  return (
    <Card title="Test result" testId="oats-automation-test">
      {ran.ok ? (
        <>
          <p className={LINE}>{`The source answered: ${[events(ran.events), tally([[ran.filtered, "filtered"], [ran.skipped.length, "skipped"], [ran.refused.length, "refused"]])].filter(Boolean).join(", ")}`}</p>
          <SourceLists source={ran} />
        </>
      ) : ran.invalid !== null ? (
        <>
          <p className={warn}>The source check failed</p>
          <FactList facts={[["Message", ran.invalid.message], ["Code", ran.invalid.code], ["Field", ran.invalid.field]]} />
        </>
      ) : (
        <>
          <p className={warn}>{`The poll failed: ${causeWords(ran.cause) ?? "no cause reported"}`}</p>
          {ran.error === null ? null : (
            <p className={warn}>
              {ran.error}
              {ran.code === null ? null : <code className="font-mono text-xs">{` ${ran.code}`}</code>}
            </p>
          )}
          {ran.says === null ? null : <Quote leadIn={LEAD_INS.source(ran.capability, ran.name)} lines={[{ text: [ran.says.code, ran.says.message] }]} />}
        </>
      )}
      {/* A manual test runs the source whatever the machine's trust and the trigger's host say: "would run here" is said only when the kernel found nothing against it. */}
      {test.ok && test.problems.length === 0 ? <p className={LINE}>Would run here on its own</p> : test.problems.length > 0 ? <p className={LINE}>Tested by hand</p> : null}
      {test.problems.map((problem, at) => (
        <p key={`p${at}`} className={warn}>
          {problem}
        </p>
      ))}
      {test.warnings.map((warning, at) => (
        <p key={`w${at}`} className={LINE}>
          {warning}
        </p>
      ))}
      {soul}
      {account}
      {ran.ok ? <FireList test={test} /> : null}
    </Card>
  );
}

/** The Test confirm of a capability source's trigger: what pressing Run test does, said before it does it. It offers Run test and Cancel, and nothing that trusts, enables, starts or schedules the trigger. */
function SourceConfirm({ row, source, host, running, disabled, onRun, onCancel }: { row: AutomationRow; source: CapabilitySource; host: string | null; /** This test is on its way. */ running: boolean; /** An act is on its way, this one or another. */ disabled: boolean; onRun: () => void; onCancel: () => void }) {
  const here = useHere();
  const params = sourceParams(row.on);
  const elsewhere = row.reason === "assigned-elsewhere" || (row.runsOn !== null && row.runsOn !== host);
  return (
    <Card title="Test this trigger" tone="warn" testId="oats-automation-test-confirm">
      <p className={LINE}>
        {"This runs "}
        {source.capability === null ? "the capability" : <code className="font-mono text-xs">{source.capability}</code>}
        {`'s source command on ${here.on}, now, once. Nothing is recorded and nothing is spawned.`}
      </p>
      {row.reason === "untrusted" ? <p className={LINE}>{`This trigger isn't trusted on ${here.on}. Testing doesn't trust it or start it.`}</p> : null}
      {elsewhere ? (
        <p className={LINE}>
          {"The test runs here, not on "}
          {row.runsOn === null ? "the host that runs it" : <code className="font-mono text-xs">{shown(row.runsOn)}</code>}
          {"."}
        </p>
      ) : null}
      {params.count > 0 ? (
        <>
          <p className={LINE}>The command receives these parameters.</p>
          <Quote leadIn={LEAD_INS.triggerFile} lines={params.lines.map((line) => ({ text: [line.text], note: line.note }))} />
          {params.more > 0 ? <p className="text-xs text-muted-foreground">{`and ${params.more} more`}</p> : null}
        </>
      ) : (
        <p className={LINE}>It receives no parameters.</p>
      )}
      {running ? <Loading>Testing…</Loading> : null}
      <div className="flex flex-wrap gap-2">
        <Button data-testid="oats-automation-test-cancel" disabled={running} onClick={onCancel}>
          Cancel
        </Button>
        <Button data-testid="oats-automation-test-run" variant="primary" disabled={disabled} onClick={onRun}>
          Run test
        </Button>
      </div>
    </Card>
  );
}

export type Acts = {
  /** What the last act did or why it was refused, above the list or the row's page. */
  result: ReactNode;
  /** A row's switch: on or off on the machine. Nothing for a row another computer runs. */
  switchOf(row: AutomationRow): ReactNode;
  /** A row's menu, after Open. */
  menuOf(row: AutomationRow): MenuItem[];
  /** What a row's page adds: its acts, the test's confirmation and result. */
  rowParts(row: AutomationRow, now: number, host: string | null): Pick<DetailProps, "actions" | "runStateAction" | "answers" | "identityAction" | "summaryAction">;
  /** The act of the notice of a scheduler that is off. */
  schedulerAction: ReactNode;
  /** The dialog that is open, if one is. */
  dialog: ReactNode;
};

export function useActs({ rpc, refresh, summaries, kind, open, held, onOpen, onOpenFile, hostId, onRemoved, neighbourOf, here = HERE }: {
  rpc: Rpc;
  /** The machine that holds the deployment, as the page names it. */
  here?: Here;
  /** Reads the lists again. */
  refresh: () => void;
  /** This OATS writes summaries (feature automation-descriptions). */
  summaries: boolean;
  /** The list that is shown. */
  kind: AutomationRow["kind"];
  /** The row whose page is open, if one is. */
  open: Pick<AutomationRow, "kind" | "id"> | null;
  /** Why a kind's acts are held: its list could not be read again, so what a row is now is not known. Null where they are not. */
  held: Record<AutomationRow["kind"], string | null>;
  onOpen: (row: AutomationRow) => void;
  onOpenFile?: (target: FileTarget) => void;
  /** The bb machine that holds the deployment, once known. */
  hostId: string | null;
  /** A row was deleted: its page, if open, has nothing to show. */
  onRemoved: (row: AutomationRow) => void;
  /** Where the focus goes once a row is deleted: the row beside it in the list, named when this is asked (while the row is still there); the answer finds that row's Open. */
  neighbourOf: (row: AutomationRow) => () => HTMLElement | null;
}): Acts {
  /** The act on its way, in words; while one is, the controls that would start another are off. */
  const [doing, setDoing] = useState<{ words: string; test: string | null } | null>(null);
  const busy = doing !== null;
  /** A row's acts are off while an act runs, and while its list is one that could not be read again. */
  const off = (row: AutomationRow) => busy || held[row.kind] !== null;
  const [said, setSaid] = useState<(Said & { arrival: number }) | null>(null);
  const [tests, setTests] = useState<ReadonlyMap<string, Kept>>(new Map());
  /** The confirmation that is open: for one row, as its definition was shown. It arrives once its row's page is open. */
  const [confirming, setConfirming] = useState<{ key: string; signature: string; arrival: number | null } | null>(null);
  const [nothingRan, setNothingRan] = useState<{ key: string; arrival: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const running = useRef(false);
  /**
   * Each thing an act puts on the page carries the number of its own arrival; the newest one takes
   * the focus, once (`seen`). A result left on the page takes nothing from what arrives after it.
   */
  const arrivals = useRef(0);
  const seen = useRef(0);
  const arrival = () => (arrivals.current += 1);
  const openKey = open === null ? null : keyOf(open);

  // A confirmation is for the row whose page it was asked on: Back, or another row's page, drops it.
  // Asked from the list's menu, it is kept while that row's page opens (`opening`).
  const opening = useRef<string | null>(null);
  useEffect(() => {
    if (opening.current !== null && opening.current === openKey) opening.current = null;
    setConfirming((before) => (before !== null && before.key !== openKey && opening.current !== before.key ? null : before));
  }, [openKey]);
  // It arrives once its row's page is open: this effect runs after the page's own (which puts the
  // focus on Back when it opens), so the confirmation is what holds the focus.
  const confirmingKey = confirming?.key ?? null;
  useEffect(() => {
    if (confirmingKey === null || confirmingKey !== openKey) return;
    setConfirming((before) => (before !== null && before.arrival === null ? { ...before, arrival: arrival() } : before));
  }, [confirmingKey, openKey]);
  // Where the focus goes when a press removes or turns off the control that held it (a switch
  // while its act runs, Cancel, Dismiss): set at the press, taken once no act is on its way.
  const back = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    if (back.current === null || doing !== null) return;
    const to = back.current();
    back.current = null;
    to?.focus();
  });
  const switchOfRow = (row: AutomationRow) => () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="switch"]')).find((control) => control.getAttribute("aria-label") === `${row.id} enabled on ${here.on}`) ?? null;
  const first = () => document.querySelector<HTMLElement>('[data-testid="oats-automation-back"], [data-testid="oats-automations"] [role="tab"][aria-selected="true"]');

  const refused = (what: Failed, error: unknown): Said => {
    const { code, message, refused: no } = failureOf(error);
    return { title: failedTitle(no, what), tone: "failed", lines: [message], code };
  };
  /**
   * One act at a time. While it runs the page says so in words; then what it answered (`done`) or
   * why it did not (`failed`), and the lists are read again whatever it answered.
   */
  const act = useCallback(
    async <Value,>(words: string, call: () => Promise<Value>, done: (value: Value) => void, failed: (error: unknown) => void, test: string | null = null) => {
      if (running.current) return;
      running.current = true;
      setDoing({ words, test });
      setSaid(null);
      setNothingRan(null);
      try {
        done(await attempt(call));
      } catch (error) {
        failed(error);
      } finally {
        running.current = false;
        setDoing(null);
        refresh();
      }
    },
    [refresh],
  );
  /** An act whose answer is said above the list or the row's page. */
  const say = <Value,>(words: string, call: () => Promise<Value>, done: (value: Value) => Said | null, failed: Failed) => {
    const put = (answer: Said | null) => setSaid(answer === null ? null : { ...answer, arrival: arrival() });
    return act(words, call, (value) => put(done(value)), (error) => put(refused(failed, error)));
  };
  /** Keeps a test's answer for the row as it was tested, or drops what was kept. */
  const keep = (row: AutomationRow, tested: Tested | null) =>
    setTests((before) => {
      const next = new Map(before);
      if (tested === null) next.delete(keyOf(row));
      else next.set(keyOf(row), { tested, signature: signatureOf(row), arrival: arrival() });
      return next;
    });

  const toggle = (row: AutomationRow) =>
    say(
      row.enabledHere ? `Turning ${row.name} off here…` : `Turning ${row.name} on here…`,
      () => rpc.call("automationEnable", { kind: row.kind, id: row.id, enabled: !row.enabledHere }),
      () => {
        // Nothing is said of a switch that was taken: the focus goes back to it.
        back.current = switchOfRow(row);
        return null;
      },
      row.enabledHere
        ? { no: `${row.name} was not turned off here`, maybe: `${row.name} may not have been turned off here` }
        : { no: `${row.name} was not turned on here`, maybe: `${row.name} may not have been turned on here` },
    );
  const runNow = (row: AutomationRow) =>
    say(
      `Running ${row.name}…`,
      () => rpc.call("scheduleRun", { id: row.id }),
      ({ run }) => ({ title: `${row.id}: ${scheduleOutcome(run)}`, tone: runTone(run), lines: runWhy(run), code: run?.errorCode ?? null }),
      { no: `${row.name} was not run`, maybe: `${row.name} may not have been run` },
    );
  const reconcile = (row: AutomationRow) =>
    say(
      `Checking the run state of ${row.name}…`,
      () => rpc.call("scheduleReconcile", { id: row.id }),
      ({ reconciled, remedy }) => ({ title: reconciled === "unknown" ? "Run state is still unknown." : `Run state: ${reconciled ?? "checked"}.`, tone: reconciled === "unknown" ? "unknown" : "done", lines: remedy === null ? [] : [remedy], code: null }),
      { no: `The run state of ${row.name} was not checked`, maybe: `The run state of ${row.name} may not have been checked` },
    );
  /**
   * A test's answer is kept for its row and shown on the row's page, so a test from the list's menu
   * opens that page. A capability source's is never one press: it goes through its confirmation.
   */
  const test = (row: AutomationRow, runSource = false) => {
    if (running.current) return;
    const key = keyOf(row);
    if (openKey !== key) {
      opening.current = key;
      onOpen(row);
    }
    if (!runSource && capabilitySource(row.on) !== null) {
      setNothingRan(null);
      setConfirming({ key, signature: signatureOf(row), arrival: null });
      return;
    }
    // Run test stands for what the confirmation showed: a row read again with another definition is asked again.
    if (runSource && (confirming === null || confirming.key !== key || confirming.signature !== signatureOf(row))) return setConfirming(null);
    const nothing = () => {
      keep(row, null);
      setNothingRan({ key, arrival: arrival() });
    };
    void act(
      `Testing ${row.name}…`,
      () => rpc.call("automationTest", { kind: row.kind, id: row.id, ...(runSource ? { runSource: true as const } : {}) }),
      (answered) => {
        setConfirming(null);
        // No confirmation was given and the answer is about a source: no capability code ran, and the confirmed test will say it again.
        if (!runSource && answered.source !== null) nothing();
        else keep(row, { test: answered });
      },
      (error) => {
        setConfirming(null);
        const { code, message, refused: no } = failureOf(error);
        if (!runSource && code === "E_TRIGGER_SOURCE_RUN") nothing();
        else keep(row, code === "OATS_TIMEOUT" ? { error: TEST_TIMED_OUT, code } : { error: no ? TEST_REFUSED : TEST_UNREAD, says: message, code });
      },
      key,
    );
  };

  const canDescribe = (row: AutomationRow) => summaries && row.origin.kind === "local" && row.unreadable === null;
  const describe = (row: AutomationRow) => setDialog({ kind: "summary", row, value: row.description ?? "", error: null, saving: false });
  const saveSummary = async () => {
    if (dialog === null || dialog.kind !== "summary" || dialog.saving) return;
    const { row, value } = dialog;
    // Sent as typed: only "" clears; the kernel keeps boundary spaces, and refuses what breaks its rule.
    if (!descriptionValid(value)) return setDialog({ ...dialog, error: DESCRIPTION_RULE });
    setDialog({ ...dialog, saving: true, error: null });
    try {
      await attempt(() => rpc.call("automationDescribe", { kind: row.kind, id: row.id, description: value }));
      setDialog(null);
      refresh();
    } catch (error) {
      // A failure leads with a person's words (not saved when it was refused; else it may have been); the message follows, its code last.
      const { code, message, refused: no } = failureOf(error);
      setDialog({ kind: "summary", row, value, saving: false, error: summaryFailed(no, code, message) });
      refresh();
    }
  };
  const confirmDelete = async () => {
    if (dialog === null || dialog.kind !== "delete" || dialog.phase.kind !== "ready") return;
    const { row } = dialog;
    // The neighbour is named now, while the row is still in the list.
    beside.current = neighbourOf(row);
    setDialog({ ...dialog, phase: { kind: "running", doing: "Deleting…" } });
    try {
      await attempt(() => rpc.call("scheduleRemove", { id: row.id }));
      setDialog({ kind: "delete", row, phase: { kind: "done", title: `${shown(row.name)} was deleted`, lines: [`It is removed from ${here.on} and no longer runs here.`] } });
      onRemoved(row);
      refresh();
    } catch (error) {
      const title = failedTitle(failureOf(error).refused, { no: `${shown(row.name)} was not deleted`, maybe: `${shown(row.name)} may not have been deleted` });
      setDialog({ kind: "delete", row, phase: { kind: "failed", title, refusal: errorMessage(error) } });
      refresh();
    }
  };
  const confirmScheduler = async () => {
    if (dialog === null || dialog.kind !== "scheduler" || dialog.phase.kind !== "ready") return;
    setDialog({ kind: "scheduler", phase: { kind: "running", doing: "Enabling…" } });
    try {
      const { scheduler, warnings } = await attempt(() => rpc.call("schedulerEnable", null));
      const on = scheduler.installed && scheduler.active && scheduler.registered !== false;
      setDialog({ kind: "scheduler", phase: { kind: "done", title: on ? "The scheduler is on" : "The timer was installed, and the scheduler is not running yet", lines: warnings } });
    } catch (error) {
      // The kernel's own E_SCHEDULE_HOST can come after part of the install (the timer written, the service manager then failing): only a refusal before any of it says nothing was enabled.
      const failure = failureOf(error);
      const title = failure.code === "E_SCHEDULE_HOST" ? "The scheduler may not have been enabled" : failedTitle(failure.refused, { no: "The scheduler was not enabled", maybe: "The scheduler may not have been enabled" });
      setDialog({ kind: "scheduler", phase: { kind: "failed", title, refusal: errorMessage(error) } });
    } finally {
      refresh();
    }
  };

  // When each act applies to a row, said once for the row's menu and the row's page.
  const canRun = (row: AutomationRow) => row.kind === "schedule" && row.runsHere;
  // An unknown last run is checked through the kernel's reconcile, wherever the schedule comes from.
  const canReconcile = (row: AutomationRow) => canRun(row) && Boolean(runState(row)?.unknown);
  // Delete is for local schedules only: a workspace one is removed in its repository.
  const canDelete = (row: AutomationRow) => row.kind === "schedule" && row.origin.kind === "local";
  const remove = (row: AutomationRow) => setDialog({ kind: "delete", row, phase: { kind: "ready" } });

  const menuOf = (row: AutomationRow): MenuItem[] => {
    const disabled = off(row);
    const items: MenuItem[] = [{ id: "open", label: "Open", onSelect: () => onOpen(row) }];
    items.push({ id: "test", label: "Test", disabled, onSelect: () => test(row) });
    if (canRun(row)) items.push({ id: "run", label: "Run now", disabled, onSelect: () => void runNow(row) });
    if (row.group !== "elsewhere") items.push({ id: "toggle", label: row.enabledHere ? "Turn off here" : "Turn on here", disabled, onSelect: () => void toggle(row) });
    const file = fileTarget(row, hostId, here).target;
    if (onOpenFile !== undefined && file !== null) items.push({ id: "file", label: "Open file", onSelect: () => onOpenFile(file) });
    if (canDescribe(row)) items.push({ id: "describe", label: "Edit summary", disabled, onSelect: () => describe(row) });
    if (canReconcile(row)) items.push({ id: "reconcile", label: "Check run state", disabled, onSelect: () => void reconcile(row) });
    if (canDelete(row)) items.push({ id: "remove", label: "Delete…", destructive: true, disabled, onSelect: () => remove(row) });
    return items;
  };

  const switchOf = (row: AutomationRow): ReactNode =>
    row.group === "elsewhere" ? null : (
      <Switch label={here.name} name={`${row.id} enabled on ${here.on}`} title={held[row.kind] ?? switchTitle(row, here)} checked={row.enabledHere} disabled={off(row)} onChange={() => void toggle(row)} />
    );

  const rowParts: Acts["rowParts"] = (row, now, host) => {
    const key = keyOf(row);
    const disabled = off(row);
    const source = row.kind === "trigger" ? capabilitySource(row.on) : null;
    // An answer is for the row as it was tested: a re-read that shows another definition (a trigger that became a capability source's) drops it.
    const kept = tests.get(key);
    const tested = kept !== undefined && kept.signature === signatureOf(row) ? kept : undefined;
    const testing = doing !== null && doing.test === key;
    const card =
      tested === undefined ? null : (
        <Arrive token={tested.arrival} seen={seen} testId="oats-automation-test-arrived">
          <TestCard tested={tested.tested} now={now} />
        </Arrive>
      );
    // The confirmation stands only while the row is what it showed: a re-read with another definition withdraws it.
    const confirm = source !== null && confirming !== null && confirming.key === key && confirming.signature === signatureOf(row) ? confirming : null;
    // Under "No summary" while there is none, in the page's bar once there is one.
    const editSummary = canDescribe(row) ? (
      <Button data-testid="oats-automation-edit-summary" disabled={disabled} onClick={() => describe(row)}>
        Edit summary
      </Button>
    ) : null;
    return {
      identityAction: switchOf(row),
      summaryAction: row.description === null ? editSummary : null,
      actions: (
        <>
          {row.description !== null ? editSummary : null}
          {canDelete(row) ? (
            <Button data-testid="oats-automation-delete" disabled={disabled} onClick={() => remove(row)}>
              Delete…
            </Button>
          ) : null}
          {canRun(row) ? (
            <Button data-testid="oats-automation-run-now" disabled={disabled} onClick={() => void runNow(row)}>
              Run now
            </Button>
          ) : null}
          <Button data-testid="oats-automation-test-button" variant="primary" disabled={disabled} onClick={() => test(row)}>
            Test
          </Button>
        </>
      ),
      runStateAction: canReconcile(row) ? (
        <div>
          <Button data-testid="oats-automation-reconcile" disabled={disabled} onClick={() => void reconcile(row)}>
            Check run state
          </Button>
        </div>
      ) : null,
      // What an act put on the page: a confirmation, that nothing ran, a test on its way, its answer.
      answers: (
        <>
          {/* This press carried no confirmation and the row turned out to watch a capability's source: nothing ran, and that is no failure of the trigger. */}
          {nothingRan !== null && nothingRan.key === key ? (
            <Arrive token={nothingRan.arrival} seen={seen} testId="oats-automation-nothing-ran-arrived">
              <p role="status" data-testid="oats-automation-nothing-ran" className={LINE}>
                {NOTHING_RAN}
              </p>
            </Arrive>
          ) : null}
          {source !== null && confirm !== null ? (
            <Arrive token={confirm.arrival ?? 0} seen={seen} testId="oats-automation-test-confirm-arrived">
              <SourceConfirm row={row} source={source} host={host} running={testing} disabled={disabled} onRun={() => test(row, true)}
                onCancel={() => {
                  back.current = () => document.querySelector<HTMLElement>('[data-testid="oats-automation-test-button"]');
                  setConfirming(null);
                }}
              />
            </Arrive>
          ) : null}
          {source === null && testing ? <Loading>{shown(doing.words)}</Loading> : card}
        </>
      ),
    };
  };

  // In the result's place: the act on its way, in words, then what it did. A test's own words are on its row's page while that page is open, and here once it is left.
  const result: ReactNode =
    doing !== null && (doing.test === null || doing.test !== openKey) ? (
      <div data-testid="oats-automations-doing">
        <Loading>{shown(doing.words)}</Loading>
      </div>
    ) : said === null ? null : (
      <Arrive token={said.arrival} seen={seen} testId="oats-automations-result">
        <Result
          title={shown(said.title)}
          tone={said.tone}
          code={said.code}
          actions={
            <Button
              data-testid="oats-automations-result-dismiss"
              onClick={() => {
                back.current = first;
                setSaid(null);
              }}
            >
              Dismiss
            </Button>
          }
        >
          {said.lines.length === 0
            ? null
            : said.lines.map((line, at) => (
                <p key={at}>
                  <Lines text={line} />
                </p>
              ))}
        </Result>
      </Arrive>
    );

  // While a summary is saved its field and buttons are off: the focus is put on the dialog, so it
  // does not fall to the page behind and Tab stays inside.
  const summaryForm = useRef<HTMLFormElement>(null);
  const saving = dialog !== null && dialog.kind === "summary" && dialog.saving;
  useEffect(() => {
    if (saving) summaryForm.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [saving]);
  const beside = useRef<(() => HTMLElement | null) | null>(null);
  const close = () => {
    // After a delete the focus goes to the row beside the deleted one, never back to a control of the deleted row.
    if (dialog !== null && dialog.kind === "delete" && dialog.phase.kind === "done") back.current = beside.current;
    setDialog(null);
  };
  const dialogNode: ReactNode =
    dialog === null ? null : dialog.kind === "delete" ? (
      <Confirm
        title="Delete schedule"
        about={dialog.row.name}
        shownFor={dialog.row.name}
        happens={[`${dialog.row.name} is removed from ${here.on} and stops running here.`]}
        confirmLabel="Delete schedule"
        destructive
        phase={dialog.phase}
        onConfirm={() => void confirmDelete()}
        onClose={close}
        // Asked only when what opened the dialog is gone: the row was deleted, or the kernel refused because it already was.
        returnFocus={() => (dialog.phase.kind === "done" || dialog.phase.kind === "failed" ? (beside.current?.() ?? null) : null)}
      />
    ) : dialog.kind === "scheduler" ? (
      <Confirm
        title="Enable scheduler"
        about={here.on}
        shownFor={here.on}
        happens={[
          `OATS installs its scheduler's timer on ${here.on}, for the account bb's machine runs as: a systemd user timer (oats-schedule-tick.timer) on Linux, a launchd agent (ai.oats.schedule-tick) on macOS.`,
          "Every minute the timer runs `oats schedule tick`, which launches what this deployment's schedules and triggers say is due.",
        ]}
        kept={[`Nothing else on ${here.on} is changed. \`oats schedule host uninstall\`, run in the deployment, removes the timer.`]}
        confirmLabel="Enable scheduler"
        phase={dialog.phase}
        onConfirm={() => void confirmScheduler()}
        onClose={close}
      />
    ) : (
      <Modal
        title={`Summary of ${shown(dialog.row.name)}`}
        onCancel={() => {
          if (!dialog.saving) close();
        }}
        footer={
          <>
            <Button data-testid="oats-automation-summary-cancel" disabled={dialog.saving} onClick={close}>
              Cancel
            </Button>
            <Button data-testid="oats-automation-summary-save" variant="primary" disabled={dialog.saving} onClick={() => void saveSummary()}>
              Save summary
            </Button>
          </>
        }
      >
        <form
          ref={summaryForm}
          data-testid="oats-automation-summary"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSummary();
          }}
        >
          <Field label="Summary" hint={`One line of up to ${DESCRIPTION_MAX} characters. Leave it empty to remove the summary.`} error={dialog.error === null ? null : (displayLine(dialog.error) ?? dialog.error)}>
            <input className={INPUT} name="description" type="text" autoComplete="off" data-autofocus="" disabled={dialog.saving} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value, error: null })} />
          </Field>
          {dialog.saving ? <Loading>Saving the summary…</Loading> : null}
        </form>
      </Modal>
    );

  return {
    result,
    switchOf,
    menuOf,
    rowParts,
    schedulerAction: (
      <Button data-testid="oats-automations-enable-scheduler" disabled={busy || held[kind] !== null} onClick={() => setDialog({ kind: "scheduler", phase: { kind: "ready" } })}>
        Enable scheduler
      </Button>
    ),
    dialog: dialogNode,
  };
}

