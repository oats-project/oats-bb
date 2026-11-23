// What the plugin does to an agent: Stop, Start, Restart and Retire, each through the plugin's
// server and so through OATS, each in a dialog first: nothing runs on one press. Stop and Retire
// show the kernel's plan as what will happen and what is kept, and ask once; Start and Restart
// check the agent as the kernel has it now and offer the harness and the model of the start. The
// act in progress, its result and its refusal are said in the same dialog. The requests come from
// thread menus, pages, the instance panel and the keyboard; one overlay per app window draws them.
// The words are the OATS Desktop's (./words.ts).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { experimental_PluginRpcCallError as PluginRpcCallError, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { RetirePlan, StopPlan } from "../../kernel/lifecycle";
import { newKey } from "../keys";
import { errorMessage, onWindowReset } from "../store";
import type { Contract, Result as Answer } from "../store";
import { RPC_FAILED, useOats } from "../oats";
import { markGone, planSaysGone } from "../roster/gone";
import { isUnreadable, Unreadable } from "../roster/unreadable";
import { Button, Confirm, Disclosure, Fact, Facts, Field, INPUT, Lines, Notice, Switch } from "../ui";
import type { ConfirmProps } from "../ui";
import { refusalCode, shown } from "../ui/text";
import { agentName, readAge } from "../ui/words";
import { notify } from "../ui";
import { harnessLabel, KEEP_HARNESS, resolvedLabel, useModelSuggestions } from "../spawn/models";
import {
  applyRefused,
  applying,
  carriesOn,
  LEAVE,
  piOnBb,
  SHOW_RESULT,
  toasted,
  checkAgainRefused,
  checking,
  CHECKING_AGAIN,
  FULL_MODE,
  modelHelp,
  NOTHING_SHOWN_CHANGED,
  planChanges,
  planRefused,
  REVIEW_FIRST,
  retireOutcome,
  retirePlanView,
  START,
  startOutcome,
  startRefused,
  stopArchivesThread,
  stopOutcome,
  stopPlanView,
  titleOf,
  UPDATING,
} from "./words";
import type { Outcome, PlanVerb, Refusal, RunVerb, Verb } from "./words";

export type { PlanVerb, RunVerb, Verb };

/**
 * A result whose dialog went before it arrived, kept so that the dialog can be opened again ON it
 * (the toaster's "Show result"): the settled state as the dialog held it, with what "Check again"
 * needs (the plan and its key) and what the person chose (a stop's children, a retire's worktree,
 * a start's harness and model).
 */
type Resume =
  | { plan: Extract<PlanState, { phase: "settled" }>; recursive: boolean; discard: boolean }
  | { start: Extract<StartState, { phase: "settled" }>; harness: string; model: string };
type Request = { verb: Verb; instance: string; id: number; resume?: Resume };

let current: Request | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
function set(next: Request | null): void {
  current = next;
  for (const listener of [...listeners]) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const get = () => current;

// A new app window starts with nothing asked.
onWindowReset(() => {
  current = null;
  listeners.clear();
});

/** The act whose dialog is open, if one is: for a test of a place that asks for one. */
export const asked = (): { verb: Verb; instance: string } | null => (current === null ? null : { verb: current.verb, instance: current.instance });

/** Open the dialog of an act on an agent. It asks the kernel first, and acts only on its own button. */
export function openAct(verb: Verb, instance: string): void {
  set({ verb, instance, id: ++sequence });
}
/** Open an act's dialog again on a result it had when it was gone: nothing is asked of the kernel. */
function reopen(verb: Verb, instance: string, resume: Resume): void {
  set({ verb, instance, id: ++sequence, resume });
}
/**
 * Tell the result of an act whose dialog is gone (`toasted`): a plain one whole, with the way to
 * the agent; any other by its title, staying until dismissed, with "Show result".
 */
function tell(verb: Verb, instance: string, outcome: Outcome, resume: Resume, open: { label: string; run: () => void } | null): void {
  const { plain, ...toast } = toasted(verb, outcome);
  if (plain) notify({ ...toast, ...(open === null ? {} : { open }) });
  else notify({ ...toast, stays: true, open: { label: SHOW_RESULT, run: () => reopen(verb, instance, resume) } });
}
/** Ask for the kernel's plan to stop or retire an agent; the overlay shows it and asks once. */
export const askPlan = (verb: PlanVerb, instance: string): void => openAct(verb, instance);
/**
 * Start or restart an agent: opens its dialog. Nothing is started on this call (the Desktop's
 * Start… and Restart…); the dialog starts it, and opens the thread the kernel answers with.
 * The last two arguments are no longer read: the overlay has its own.
 */
export async function run(verb: RunVerb, instance: string, _rpc?: unknown, _navigate?: unknown): Promise<void> {
  openAct(verb, instance);
}

/** bb's codes for a call the plugin's server ANSWERED with a no: a refusal of the kernel's or of its own, an input it did not take. */
const ANSWERED = new Set(["conflict", "invalid", "invalid_input", "forbidden", "not_found", "unknown_method"]);
/**
 * A rejected call, as what it was. A refusal: the code that leads its message (the kernel's, or one
 * of the plugin's own), or none for a refusal of the plugin's server itself. Or a call that FAILED
 * (bb restarted, the plugin was reloaded under a long retire, the browser lost the server): then
 * nobody answered, the act may have run, and its code is the app's own RPC_FAILED, which every
 * place reads as "not confirmed", never as refused.
 */
function refusalOf(cause: unknown): Refusal & { text: string } {
  const text = errorMessage(cause);
  const code = refusalCode(text);
  if (code !== null) return { code, message: text.slice(code.length + 2), text };
  const answered = cause instanceof PluginRpcCallError && ANSWERED.has(cause.code);
  return { code: answered ? null : RPC_FAILED, message: text, text };
}

/**
 * Where the focus goes when the dialog closes and what opened it is gone (a menu's entry always
 * is): the agent's row in the sidebar; after a retire took the row away, the row now in its place.
 */
function useRowFocus(threadId: string | null): () => HTMLElement | null {
  const place = useRef(-1);
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"));
  useEffect(() => {
    place.current = threadId === null ? -1 : rows().findIndex((row) => row.getAttribute("data-sidebar-thread-id") === threadId);
  }, [threadId]);
  return useCallback(() => {
    const all = rows();
    const own = threadId === null ? undefined : all.find((row) => row.getAttribute("data-sidebar-thread-id") === threadId);
    return own ?? all[Math.min(Math.max(place.current, 0), all.length - 1)] ?? null;
  }, [threadId]);
}

/** The lifecycle dialog that is open, as the element that holds the focus; null when none is. */
const dialogOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="oats-confirm"]')?.closest<HTMLElement>('[role="dialog"]') ?? null;

/**
 * The focus when a dialog that was reading becomes ready: on the control the pattern marks (Cancel
 * for a destructive act, a form's first field, else the act), if it was left on the dialog itself
 * because that control was not there, or was off, while the kernel was asked.
 */
function useFocusWhenReady(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const dialog = dialogOf();
    if (dialog !== null && document.activeElement === dialog) dialog.querySelector<HTMLElement>("[data-autofocus]:not([disabled])")?.focus();
  }, [ready]);
}

/** What is a layer of its own over the page: a dialog, a menu, a list of choices, bb's toaster. */
const OTHER_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-sonner-toaster], [data-radix-popper-content-wrapper]';
/**
 * The focus stays in the dialog while it is open (the UX standard, section 3). The pattern's dialog
 * keeps Tab inside; this holds what Tab is not: bb puts the focus in its composer when a thread
 * opens, and a start opens the agent's new thread behind its result. Whatever takes the focus
 * outside the dialog gives it back: to what held it in the dialog, else to the control the pattern
 * marks, else to the dialog itself.
 */
function useKeepFocus(): void {
  useEffect(() => {
    let last: HTMLElement | null = null;
    let returning = false;
    const onFocus = (event: FocusEvent) => {
      // Its own focus() lands here again: it is not answered a second time.
      if (returning) return;
      const dialog = dialogOf();
      if (dialog === null) return;
      const target = event.target;
      if (target instanceof HTMLElement && dialog.contains(target)) {
        last = target;
        return;
      }
      // A layer of bb's that holds the focus for itself (its command palette, a confirmation, a
      // menu, its toaster) keeps it: bb's own layers trap the focus too, and two traps that each
      // take it back from the other would never end. The dialog takes it again when that layer closes.
      if (target instanceof HTMLElement && target.closest(OTHER_LAYER) !== null) return;
      const held = last !== null && last.isConnected && dialog.contains(last) && !(last instanceof HTMLButtonElement && last.disabled) ? last : null;
      returning = true;
      try {
        (held ?? dialog.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ?? dialog).focus();
      } finally {
        returning = false;
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
}

/**
 * What a person must see NOW is on screen, where the dialog holds more than fits (a phone): the
 * line that says the act runs, the result or the refusal when it arrives; and a plan, or a notice
 * above it, is read from its top. `what` names the moment; it moves nothing while it stays the same.
 */
function useReveal(what: "top" | "first" | "running" | "result" | "warning" | "kept" | null): void {
  useEffect(() => {
    if (what === null) return;
    const reveal = () => {
      const dialog = document.querySelector<HTMLElement>('[data-testid="oats-confirm"]');
      if (dialog === null) return;
      // "first": a notice that must be read first came with the plan; the focus that went to a field below it scrolled it away.
      if (what === "top" || what === "first") dialog.closest<HTMLElement>('[data-testid="oats-modal-body"]')?.scrollTo?.({ top: 0 });
      else dialog.querySelector<HTMLElement>(`[data-testid="${what === "running" ? "oats-confirm-running" : what === "result" ? "oats-result" : what === "kept" ? "oats-act-warning" : "oats-plan-warning"}"]`)?.scrollIntoView?.({ block: "nearest" });
    };
    reveal();
    // Once more when the dialog has said what is out of sight ("More above", "More below"): those lines take room of their own.
    const again = setTimeout(reveal, 80);
    return () => clearTimeout(again);
  }, [what]);
}

/** A settled outcome in the dialog's phase: a person's words, the code after them, the kernel's own text under Details, and what to do next. */
function settledPhase(outcome: Outcome, actions: ReactNode): ConfirmProps["phase"] {
  const details =
    outcome.details === null ? null : (
      <Disclosure summary="Details" testId="oats-act-details">
        <p className="text-xs text-muted-foreground">
          <Lines text={outcome.details} />
        </p>
      </Disclosure>
    );
  const next = (
    <>
      {actions}
      {details}
    </>
  );
  // A result that is not confirmed is neither done nor failed: the pattern draws it as that.
  if (outcome.tone !== "failed") return { kind: "done", tone: outcome.tone, title: outcome.title, lines: outcome.lines, code: outcome.code, actions: next };
  return { kind: "failed", title: outcome.title, refusal: outcome.lines.join("\n"), code: outcome.code, actions: next };
}

/** OATS itself cannot be read: the one notice every place shows, in the dialog, with Retry. */
function CannotRead({ refusal, onRetry }: { refusal: Refusal; onRetry: () => void }) {
  const oats = useOats();
  const machine = oats.phase === "ready" ? oats.deployment.machine : oats.phase === "failed" ? oats.machine : null;
  return <Unreadable failure={{ code: refusal.code ?? "", message: refusal.message }} machine={machine} onRetry={onRetry} />;
}

// ---- Stop and Retire ----

type Plan = StopPlan | Answer<"retirePlan">;
type PlanState =
  /** `kept`: the plan under review stays on screen while a new one is read for a choice or a check. */
  | { phase: "reading"; kept: Plan | null; why: string }
  /** `changed`: the plan was confirmed and had changed (E_PLAN_STALE); this is the plan as it is now, and what differs. It cannot be confirmed until it was reviewed again. */
  | { phase: "ready"; plan: Plan; key: string; changed: string[] | null }
  | { phase: "applying"; plan: Plan; key: string }
  | { phase: "settled"; outcome: Outcome; refusal: Refusal | null; sent: { plan: Plan; key: string } | null };

/**
 * Whether bb holds the thread archived NOW, as bb itself answers (`sdk.threads.get`): true or
 * false; null when bb cannot be asked or does not say. Read after a stop, for what its result
 * says of the thread: the provider's release decides whether a stop archives, and what a person
 * is told is what happened, not what a version number promises.
 */
async function threadArchived(sdk: ReturnType<typeof useSdk>, threadId: string): Promise<boolean | null> {
  // The stop is done and the kernel has answered: its result never waits long on this read.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), THREAD_READ_MS);
  try {
    const thread: unknown = await Promise.race([
      sdk.threads.get({ threadId, signal: limit.signal }),
      new Promise<null>((resolve) => limit.signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]);
    if (typeof thread !== "object" || thread === null || !("archivedAt" in thread)) return null;
    return thread.archivedAt !== null && thread.archivedAt !== undefined;
  } catch {
    // bb could not be asked (or this bb has no such read): not known, and the result says what the confirmation said.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
/** How long a stop's result waits for bb's word on the thread before it says what the confirmation said. */
const THREAD_READ_MS = 5_000;

function PlanDialog({ request }: { request: Request & { verb: PlanVerb } }) {
  const rpc = useRpc<Contract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const oats = useOats();
  const { verb, instance } = request;
  const threadId = oats.phase === "ready" ? (oats.nodeByInstance.get(instance)?.thread.id ?? null) : null;
  const returnFocus = useRowFocus(threadId);
  // Opened again on a result (the toaster's "Show result"): that result, and nothing is read.
  const resumed = request.resume !== undefined && "plan" in request.resume ? request.resume : null;
  const [state, setState] = useState<PlanState>(resumed?.plan ?? { phase: "reading", kept: null, why: checking(verb, instance) });
  /** The plan's one tick: a stop's children (on, the kernel's default), a retire's worktree (off). */
  const [recursive, setRecursive] = useState(resumed?.recursive ?? true);
  const [discard, setDiscard] = useState(resumed?.discard ?? false);
  const [now, setNow] = useState(() => Date.now());
  const live = useRef(true);
  /** The read whose answer is still wanted: a newer read, or a close, drops an older one's. */
  const ticket = useRef(0);
  useEffect(() => {
    live.current = true;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live.current = false;
      clearInterval(tick);
    };
  }, []);

  // Whether the provider archives the thread of a home it stops: from its version, which the spawn
  // module's read of the provider will expose; until it does the version is not known here, and
  // the answer is the one that is true of every provider released so far.
  const archives = stopArchivesThread(null);

  const read = useCallback(
    (why: string, withChildren: boolean, changedFrom: Plan | null = null) => {
      const mine = ++ticket.current;
      setState((before) => ({ phase: "reading", kept: before.phase === "ready" ? before.plan : before.phase === "reading" ? before.kept : null, why }));
      const asked: Promise<Plan> = verb === "stop" ? rpc.call("stopPlan", { instance, recursive: withChildren }) : rpc.call("retirePlan", { instance });
      asked.then(
        (plan) => {
          // A new plan is a new intent: it gets its own idempotency key.
          if (live.current && mine === ticket.current) setState({ phase: "ready", plan, key: newKey(), changed: changedFrom === null ? null : planChanges(changedFrom, plan, archives) });
        },
        (cause: unknown) => {
          const refusal = refusalOf(cause);
          // A plan refused for a name the kernel does not know: the agent went after the roster on
          // screen was read, and its row says so until the next roster.
          const gone = planSaysGone(refusal.code);
          if (gone) markGone(instance);
          if (live.current && mine === ticket.current) setState({ phase: "settled", outcome: planRefused(verb, instance, refusal, gone), refusal, sent: null });
        },
      );
    },
    [rpc, verb, instance, archives],
  );
  useEffect(() => {
    if (resumed === null) read(checking(verb, instance), true);
    // (`resumed` is the request's, and a dialog has one request for its whole life.)
  }, [read, verb, instance, resumed]);

  /** `again`: the same revision and key, sent to read the result of an apply whose answer was lost ("Check again"). */
  const send = (plan: Plan, key: string, again = false) => {
    setState({ phase: "applying", plan, key });
    const sent = { plan, key };
    const settle = (outcome: Outcome, refusal: Refusal | null) => {
      if (live.current && current === request) setState({ phase: "settled", outcome, refusal, sent });
      // The person moved on (they left the dialog, or another act's took its place): the result reaches them
      // where they are, and what a toast cannot hold is one press away ("Show result").
      else tell(verb, instance, outcome, { plan: { phase: "settled", outcome, refusal, sent }, recursive, discard }, threadId === null || verb === "retire" ? null : { label: `Open ${agentName(instance)}`, run: () => navigate.toThread(threadId) });
    };
    const answered =
      plan.action === "stop"
        ? rpc.call("stopApply", { instance, revision: plan.revision, key, recursive: plan.recursive }).then(async (receipt) => {
            const onBb = plan.targets.some((target) => target.backend === "bb");
            // What the stop left of the agent's thread is what bb SHOWS of it now, where bb answers; else what the confirmation said.
            const archived = receipt.ok && onBb && threadId !== null ? await threadArchived(sdk, threadId) : null;
            return stopOutcome(receipt, plan.instance ?? instance, onBb, archived ?? archives);
          })
        : rpc.call("retireApply", { instance, revision: plan.revision, key, discardWorktree: discard }).then((receipt) => retireOutcome(receipt, plan));
    answered.then(
      (outcome) => settle(outcome, null),
      (cause: unknown) => {
        const refusal = refusalOf(cause);
        // The plan changed under the confirmation: back to review with the plan as it is now.
        const pi = plan.action === "retire" && piOnBb(plan); // (a retire's plan alone says the backend and the harness)
        if (again) settle(checkAgainRefused(verb, plan.instance ?? instance, refusal, pi), refusal);
        else if (refusal.code === "E_PLAN_STALE" && live.current && current === request) read(checking(verb, instance), recursive, plan);
        else settle(applyRefused(verb, plan.instance ?? instance, refusal, pi), refusal);
      },
    );
  };

  const close = () => {
    ticket.current++;
    if (current === request) set(null);
  };
  const plan = state.phase === "ready" || state.phase === "applying" ? state.plan : state.phase === "reading" ? state.kept : (state.sent?.plan ?? null);
  const view = plan === null ? null : plan.action === "stop" ? stopPlanView(plan, archives) : retirePlanView(plan, discard);
  const shownFor = plan === null ? null : plan.instance;
  const choose = (checked: boolean) => {
    if (verb === "stop") {
      setRecursive(checked);
      // Whom a stop includes is the kernel's to say: the plan is read again for the choice.
      read(UPDATING, checked);
    } else setDiscard(checked);
  };
  const again = () => read(CHECKING_AGAIN, recursive);
  useFocusWhenReady(state.phase === "ready");
  // A plan that changed under the confirmation is not armed: it comes back for review with the
  // focus on Cancel, and is confirmed only after "Review again" has read it once more.
  // A result with a warning of its own (a home that was kept) is read from that warning.
  useReveal(state.phase === "applying" ? "running" : state.phase === "settled" ? (state.outcome.warning === undefined ? "result" : "kept") : "top");
  // What a choice would lose is said under it the moment it is turned on: it is brought on screen with it.
  useReveal(state.phase === "ready" && view?.choice?.warning ? "warning" : null);
  const changed = state.phase === "ready" ? state.changed : null;
  useEffect(() => {
    if (changed !== null) document.querySelector<HTMLElement>('[data-testid="oats-confirm-cancel"]')?.focus();
  }, [changed]);
  useKeepFocus();

  const phase: ConfirmProps["phase"] =
    state.phase === "reading"
      ? state.kept === null
        ? { kind: "reading", text: state.why }
        : { kind: "ready" }
      : state.phase === "ready"
        ? { kind: "ready" }
        : state.phase === "applying"
          ? { kind: "running", doing: applying(verb, plan?.instance ?? instance), leave: LEAVE[verb] }
          : settledPhase(
              state.outcome,
              <>
                {state.outcome.offers.includes("review") ? (
                  <Button data-testid="oats-act-review" onClick={() => read(checking(verb, instance), recursive)}>
                    Review again
                  </Button>
                ) : null}
                {state.outcome.offers.includes("check") && state.sent !== null ? (
                  <Button data-testid="oats-act-check" onClick={() => send(state.sent!.plan, state.sent!.key, true)}>
                    Check again
                  </Button>
                ) : null}
              </>,
            );
  // While a new plan is read over the one on screen, nothing can be confirmed, and the dialog says why.
  const updating = state.phase === "reading" && state.kept !== null ? state.why : null;
  const unreadable = state.phase === "settled" && state.refusal !== null && state.sent === null && isUnreadable(state.refusal.code) ? state.refusal : null;

  return (
    <Confirm
      // The agent is named from the kernel's plan, never from the row that was pressed: the roster
      // on screen may be older than what the kernel knows. Until a plan is read no agent is named.
      title={titleOf(verb, shownFor, plan !== null, state.phase === "settled" && state.sent !== null)}
      about={instance}
      shownFor={shownFor}
      // Once the act has an answer the plan gives way to it, a refusal as a result: "What will happen" over
      // "wasn't stopped" would say in the future what did not happen. Review again brings the plan back.
      happens={state.phase === "settled" ? [] : (view?.happens ?? [])}
      kept={state.phase === "settled" ? [] : (view?.kept ?? [])}
      confirmLabel={view?.confirm ?? (verb === "stop" ? "Stop" : "Retire")}
      // Both acts end something a person may want running: the focus starts on Cancel for each.
      destructive
      blocked={updating ?? (changed !== null ? REVIEW_FIRST : null) ?? view?.blocked ?? null}
      notice={
        changed === null ? null : (
          <Notice title="Something changed since you opened this" tone="warning" actions={<Button data-testid="oats-plan-review" onClick={again}>Review again</Button>}>
            {(changed.length === 0 ? [NOTHING_SHOWN_CHANGED] : changed).map((line, index) => (
              <p key={index}>
                <Lines text={line} />
              </p>
            ))}
          </Notice>
        )
      }
      phase={unreadable === null ? phase : { kind: "failed", title: state.phase === "settled" ? state.outcome.title : "", refusal: "", actions: <CannotRead refusal={unreadable} onRetry={again} /> }}
      onConfirm={() => {
        if (state.phase === "ready" && state.changed === null && view?.blocked === null) send(state.plan, state.key);
      }}
      onClose={close}
      returnFocus={returnFocus}
    >
      {state.phase === "settled" && state.outcome.warning !== undefined ? (
        // What a person must read first, in the warning tone, with the rest one press away (a retire that kept the home).
        <div data-testid="oats-act-warning">
          <Notice title={state.outcome.warning.title} tone="warning" details={state.outcome.warning.details} />
        </div>
      ) : null}
      {view === null || state.phase === "settled" ? null : (
        <div data-testid="oats-plan" className="flex min-w-0 flex-col gap-3">
          {view.attention.length === 0 ? null : (
            // What a person should see before confirming (an agent in the middle of a task, no way back): set apart
            // in the attention tone, under a heading of its own, never as more of "What is kept".
            <section data-testid="oats-plan-attention" className="flex flex-col gap-1 rounded-lg border border-warning-text bg-card p-3 text-foreground">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before you confirm</h3>
              <ul className="flex flex-col gap-1">
                {view.attention.map((line, index) => (
                  <li key={index} className="break-words font-semibold">
                    <Lines text={line} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current state</h3>
            <Facts>
              {view.state.map((row) => (
                // A label here can be an agent's name, a value a branch an agent chose: both are filtered where they are drawn (`Fact` filters nothing).
                <Fact key={row.label} label={shown(row.label)}>
                  {shown(row.value)}
                </Fact>
              ))}
            </Facts>
            {view.notes.map((note, index) => (
              <p key={index} className="break-words text-xs text-muted-foreground">
                <Lines text={note} />
              </p>
            ))}
          </section>
          {view.choice === null ? null : (
            <div className="flex flex-col gap-1">
              {/* The plan's tick, drawn with the plugin's one pattern for a choice that is on or off: it says which it is in a word. */}
              <span data-testid="oats-plan-choice" className="flex">
                <Switch label={view.choice.label} checked={view.choice.checked} disabled={state.phase === "applying"} onChange={choose} />
              </span>
              {view.choice.warning === null ? null : (
                <p role="status" data-testid="oats-plan-warning" className="break-words text-destructive-text">
                  <Lines text={view.choice.warning} />
                </p>
              )}
            </div>
          )}
          {state.phase === "ready" ? (
            <p data-testid="oats-plan-observed" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{plan?.at ? `Observed ${readAge(plan.at, now) ?? "earlier"}` : "Observed earlier"}</span>
              <Button variant="ghost" data-testid="oats-plan-check" onClick={again}>
                Check again
              </Button>
            </p>
          ) : null}
        </div>
      )}
    </Confirm>
  );
}

// ---- Start and Restart ----

/**
 * The kernel's answer, with what the dialog says of the agent's conversation: decided ONCE, from
 * bb's threads as they were when the check answered. The launch archives the thread the agent
 * had, so the same question asked while it runs would answer something else.
 */
type Check = Answer<"startCheck"> & { begins: string; carryOn: string | null };
type StartState =
  | { phase: "checking" }
  | { phase: "ready"; check: Check }
  | { phase: "running"; check: Check }
  | { phase: "settled"; check: Check | null; outcome: Outcome; refusal: Refusal | null; threadId: string | null };

/** What a model field may hold: one line that cannot be read as an option (kernel/spawn.ts `checkModel` holds the rule; this says it before any call). */
const isModel = (model: string): boolean => model.length <= 256 && !model.startsWith("-") && !/[\0\n\r]/.test(model);

/** Why the agent cannot be started now, by the kernel's own row (the Desktop's start gate); null when it can. */
function gate(verb: RunVerb, check: Check): { reason: string; running: boolean } | null {
  // A state that could not be reached is not known, for either act: nothing is started or restarted on a guess.
  if (check.runtimeState === "unreachable") return { reason: START.unknownState, running: false };
  // Restart: the Desktop restarts only what it knows running or stopped. bb reports an idle agent
  // as neither (`running: null`), and that is the ordinary agent a person restarts: allowed here
  // (a named difference, WORDS.md).
  if (verb === "restart") return null;
  // Start: the Desktop's rule (start-gate.mjs). Running is "already running"; only an agent the
  // kernel says is NOT running (`running === false`) is started. A word of the runtime's state is never read as that.
  if (check.running === true) return { reason: START.alreadyRunning, running: true };
  return check.running === false ? null : { reason: START.unknownState, running: false };
}

function StartDialog({ request }: { request: Request & { verb: RunVerb } }) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const oats = useOats();
  const { verb, instance } = request;
  const rowThread = oats.phase === "ready" ? (oats.nodeByInstance.get(instance)?.thread.id ?? null) : null;
  const returnFocus = useRowFocus(rowThread);
  /**
   * bb's own row of the agent's thread, as it is when the check answers: kept for that answer by an
   * effect after each draw (never written while drawing), declared before the effect that asks.
   */
  const thread = rowThread === null || oats.phase !== "ready" ? null : (oats.threadById.get(rowThread) ?? null);
  const threadNow = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    threadNow.current = thread;
  }, [thread]);
  const resumed = request.resume !== undefined && "start" in request.resume ? request.resume.start : null;
  const [state, setState] = useState<StartState>(resumed ?? { phase: "checking" });
  /** "" keeps the recorded harness: nothing is passed. */
  const [harness, setHarness] = useState(request.resume !== undefined && "start" in request.resume ? request.resume.harness : "");
  const [model, setModel] = useState(request.resume !== undefined && "start" in request.resume ? request.resume.model : "");
  const live = useRef(true);
  const ticket = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const check = useCallback(() => {
    const mine = ++ticket.current;
    setState({ phase: "checking" });
    rpc.call("startCheck", { instance }).then(
      (answer) => {
        if (!live.current || mine !== ticket.current) return;
        // bb's thread of the agent NOW: in the sidebar (not archived, not hidden), with bb's own status of it.
        const threadThen = threadNow.current;
        setState({
          phase: "ready",
          check: {
            ...answer,
            // An agent with a thread in bb gets a NEW one from a start or a restart, and the one it has is archived.
            begins: threadThen === null ? START.fresh : START.newThread,
            // Cut off, with a thread that can take a message: said first, with the way to that thread, in both dialogs
            // (a restart loses the agent's place in its conversation exactly as a start does); the act stays possible.
            carryOn: threadThen !== null && carriesOn(answer, threadThen) ? threadThen.id : null, // (the first check narrows it for its id)
          },
        });
      },
      (cause: unknown) => {
        const refusal = refusalOf(cause);
        if (live.current && mine === ticket.current) setState({ phase: "settled", check: null, outcome: startRefused(verb, instance, refusal), refusal, threadId: null });
      },
    );
  }, [rpc, verb, instance]);
  useEffect(() => {
    // Opened again on a result: nothing is asked until the person asks (Refresh status).
    if (resumed === null) check();
  }, [check, resumed]);

  const known = state.phase === "checking" ? null : state.check;
  const name = known?.instance ?? instance;
  const typed = model.trim();
  const badModel = typed !== "" && !isModel(typed);
  // The harness that will run: the chosen one, else the recorded one. Its models are the ones suggested.
  const running = harness !== "" ? harness : (known?.harness ?? null);
  const suggestions = useModelSuggestions(known === null ? null : running);
  const held = state.phase === "ready" ? gate(verb, state.check) : null;

  const start = () => {
    if (state.phase !== "ready" || held !== null || badModel) return;
    const { check: checked } = state;
    setState({ phase: "running", check: checked });
    rpc.call(verb, { instance, ...(harness === "" ? {} : { harness }), ...(typed === "" ? {} : { model: typed }) }).then(
      (started) => {
        const outcome = startOutcome(verb, started.instance ?? checked.instance, started);
        const open = { label: `Open ${agentName(checked.instance)}`, run: () => navigate.toThread(started.threadId) };
        if (live.current && current === request) {
          setState({ phase: "settled", check: checked, outcome, refusal: null, threadId: started.threadId });
          // The agent's new thread opens behind the result, as the Desktop opens its terminal: Close leaves the person on it.
          navigate.toThread(started.threadId);
        } else tell(verb, checked.instance, outcome, { start: { phase: "settled", check: checked, outcome, refusal: null, threadId: started.threadId }, harness, model }, open);
      },
      (cause: unknown) => {
        const refusal = refusalOf(cause);
        const outcome = startRefused(verb, checked.instance, refusal);
        if (live.current && current === request) setState({ phase: "settled", check: checked, outcome, refusal, threadId: null });
        else tell(verb, instance, outcome, { start: { phase: "settled", check: checked, outcome, refusal, threadId: null }, harness, model }, null);
      },
    );
  };
  const close = () => {
    ticket.current++;
    if (current === request) set(null);
  };
  const openThread = (threadId: string) => {
    close();
    navigate.toThread(threadId);
  };

  const unreadable = state.phase === "settled" && state.refusal !== null && state.check === null && isUnreadable(state.refusal.code) ? state.refusal : null;
  const phase: ConfirmProps["phase"] =
    state.phase === "checking"
      ? { kind: "reading", text: START.checking }
      : state.phase === "ready"
        ? { kind: "ready" }
        : state.phase === "running"
          ? { kind: "running", doing: verb === "restart" ? START.restarting : START.starting, leave: LEAVE[verb] }
          : unreadable !== null
            ? { kind: "failed", title: `Couldn't check ${agentName(instance)}`, refusal: "", actions: <CannotRead refusal={unreadable} onRetry={check} /> }
            : settledPhase(
                state.outcome,
                <>
                  {state.outcome.offers.includes("refresh") ? (
                    <Button data-testid="oats-start-refresh" onClick={check}>
                      {START.refresh}
                    </Button>
                  ) : null}
                </>,
              );
  const editable = state.phase === "ready";
  useFocusWhenReady(editable);
  // A dialog that says first to send a message instead is read from that line, whatever field takes the focus.
  useReveal(state.phase === "running" ? "running" : state.phase === "settled" ? "result" : state.phase === "ready" && state.check.carryOn !== null ? "first" : "top");
  useKeepFocus();
  const recorded = known?.harness ?? null;
  const begins = known?.begins ?? START.fresh;
  const carryOn = state.phase === "ready" ? state.check.carryOn : null;

  return (
    <Confirm
      // Named from the kernel's row as read for this dialog, never from the row that was pressed.
      title={titleOf(verb, known?.instance ?? null, known !== null)}
      about={instance}
      shownFor={known?.instance ?? null}
      // What a start does is said of an agent the kernel has named: a check that failed says none of it.
      // And once the start has an answer, none of it either: a refusal is not read under "What will happen".
      happens={known === null || state.phase === "settled" ? [] : verb === "restart" ? [START.restartWarning, begins, FULL_MODE] : [begins, FULL_MODE]}
      kept={known === null || state.phase === "settled" ? [] : [START.continues]}
      confirmLabel={verb === "restart" ? "Restart" : "Start"}
      blocked={held?.reason ?? (badModel ? START.badModel : null)}
      notice={
        carryOn !== null ? (
          <Notice
            title={START.carryOn}
            actions={
              <Button data-testid="oats-start-thread" onClick={() => openThread(carryOn)}>
                {`Open ${agentName(name)}`}
              </Button>
            }
          />
        ) : null
      }
      phase={phase}
      onConfirm={start}
      onClose={close}
      returnFocus={returnFocus}
    >
      {known === null || state.phase === "settled" ? null : (
        <div data-testid="oats-start" className="flex min-w-0 flex-col gap-3">
          <Facts>
            {/* With a choice of harness, the field's first entry says which one is recorded: it is not said twice. */}
            {known.harnesses.length > 1 ? null : <Fact label="Harness">{recorded === null ? "Harness not reported" : shown(harnessLabel(recorded))}</Fact>}
            {/* The kernel's row is a record the agent can write: its harness, model and home are drawn through the display filter. */}
            <Fact label="Machine">{shown(known.machine)}</Fact>
            <Fact label="Home">{shown(known.home)}</Fact>
          </Facts>
          {known.harnesses.length > 1 ? (
            <Field label={START.harness}>
              <select data-testid="oats-start-harness" className={INPUT} value={harness} disabled={!editable} {...(editable ? { "data-autofocus": "" } : {})} onChange={(event) => setHarness(event.currentTarget.value)}>
                <option value="">{shown(resolvedLabel(KEEP_HARNESS, recorded))}</option>
                {known.harnesses.map((id) => (
                  <option key={id} value={id}>
                    {shown(harnessLabel(id))}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            label={START.model}
            optional
            hint={shown(`${modelHelp(running !== null && running === recorded ? known.model : null)}${suggestions.note === null ? "" : ` ${suggestions.note}`}`)}
            error={badModel ? START.badModel : null}
          >
            <input
              data-testid="oats-start-model"
              className={INPUT}
              list={`oats-start-models-${request.id}`}
              autoComplete="off"
              spellCheck={false}
              value={model}
              disabled={!editable}
              {...(editable && known.harnesses.length <= 1 ? { "data-autofocus": "" } : {})}
              placeholder={running !== null && running === recorded && known.model !== null ? shown(known.model) : "Harness default"}
              onChange={(event) => setModel(event.currentTarget.value)}
            />
          </Field>
          <datalist id={`oats-start-models-${request.id}`}>
            {suggestions.models.map((each) => (
              <option key={each.id} value={each.id} label={shown(each.label)} />
            ))}
          </datalist>
          {state.phase === "ready" ? (
            <p role="status" data-testid="oats-start-status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{held === null ? START.ready : held.reason}</span>
              {held !== null && !held.running && known.runtimeError !== null ? <span>{shown(`OATS says: ${known.runtimeError}`)}</span> : null}
              {held?.running === true && rowThread !== null ? (
                <Button data-testid="oats-start-open" onClick={() => openThread(rowThread)}>
                  {`Open ${agentName(name)}`}
                </Button>
              ) : null}
              <Button variant="ghost" data-testid="oats-start-refresh" onClick={check}>
                {START.refresh}
              </Button>
            </p>
          ) : null}
        </div>
      )}
    </Confirm>
  );
}

/**
 * The plugin's one overlay (experimental_appOverlay): nothing until an act is asked. It draws the
 * dialog of the act: Stop and Retire with the kernel's plan, Start and Restart with the agent as
 * the kernel has it now.
 */
export function ActsOverlay() {
  const request = useSyncExternalStore(subscribe, get, get);
  if (request === null) return null;
  if (request.verb === "stop" || request.verb === "retire") return <PlanDialog key={request.id} request={request as Request & { verb: PlanVerb }} />;
  return <StartDialog key={request.id} request={request as Request & { verb: RunVerb }} />;
}
