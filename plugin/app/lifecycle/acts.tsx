// What the plugin does to an agent: Stop, Start, Restart and Retire, each through the plugin's
// server and so through OATS, each in a dialog first: nothing runs on one press. Stop and Retire
// say the kernel's plan as ONE consequence line (and at most one more), the facts that are a reason
// not to confirm, and the rest under the dialog's one "Details", and ask once; Start and Restart
// check the agent as the kernel has it now and, for an agent on bb, offer the harness and the model
// of the start (an agent on tmux starts with the launch its home recorded; one whose session was
// lost is brought back in its last conversation). The
// act in progress, its result and its refusal are said in the same dialog. The requests come from
// thread menus, pages, the instance panel and the keyboard; one overlay per app window draws them.
// The words are the OATS Desktop's (./words.ts).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { experimental_PluginRpcCallError as PluginRpcCallError, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { RetirePlan, StopPlan } from "../../kernel/lifecycle";
import { threadWorks } from "../../model/view";
import { newKey } from "../keys";
import { isUnconfirmed } from "../../contract/shared";
import { CommandText } from "../panel/parts";
import { ATTACH, attachCommand } from "../panel/words";
import { errorMessage, onWindowReset } from "../store";
import type { Contract, Result as Answer } from "../store";
import { RPC_FAILED, useOats } from "../oats";
import { markGone, planSaysGone } from "../roster/gone";
import { useNow } from "../roster/now";
import { keptState, noteActed, stateIn } from "../roster/reading";
import { isUnreadable, Unreadable } from "../roster/unreadable";
import { Button, Code, Confirm, CopyButton, Disclosure, Fact, Facts, Field, INPUT, Lines, Notice, Switch } from "../ui";
import type { ConfirmProps } from "../ui";
import { refusalCode, shown } from "../ui/text";
import { agentName, readAge, showingRead } from "../ui/words";
import { notify } from "../ui";
import { restartModel } from "../../model/restart-model";
import { harnessLabel, KEEP_HARNESS, resolvedLabel, useModelSuggestions } from "../spawn/models";
import {
  applyRefused,
  applying,
  carriesOn,
  piOnBb,
  RESUME,
  resumable,
  SHOW_RESULT,
  toasted,
  checkAgainRefused,
  CHECKING,
  HOME_KEPT_DETAILS,
  NOTHING_SHOWN_CHANGED,
  planChanges,
  planRefused,
  retireOutcome,
  retirePlanView,
  START,
  startOutcome,
  startDetails,
  startSays,
  startRefused,
  stopArchivesThread,
  stopOutcome,
  stopPlanView,
  titleOf,
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
  | { start: Extract<StartState, { phase: "settled" }>; harness: string; model: string; fresh: boolean };
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
function tell(verb: Verb, instance: string, outcome: Outcome, resume: Resume, open: { label: string; run: () => void } | null, threadless = false): void {
  const { plain, ...toast } = toasted(verb, outcome, threadless);
  if (plain) notify({ ...toast, ...(open === null ? {} : { open }) });
  else notify({ ...toast, stays: true, open: { label: SHOW_RESULT, run: () => reopen(verb, instance, resume) } });
}
/** Ask for the kernel's plan to stop or retire an agent; the overlay shows it and asks once. */
export const askPlan = (verb: PlanVerb, instance: string): void => openAct(verb, instance);
/**
 * Start or restart an agent: opens its dialog. Nothing is started on this call (the Desktop's
 * Start… and Restart…); the dialog starts it, and opens the thread the kernel answers with
 * (an agent on tmux has none: its result says where it runs).
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
  // The kernel's marker that it could not confirm what is left comes beside the text (contract/shared.ts).
  const unconfirmed = isUnconfirmed(cause);
  if (code !== null) return { code, message: text.slice(code.length + 2), text, unconfirmed };
  const answered = cause instanceof PluginRpcCallError && ANSWERED.has(cause.code);
  return { code: answered ? null : RPC_FAILED, message: text, text, unconfirmed };
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

/**
 * A settled outcome in the dialog's phase: a person's words and what to do next; under the result's
 * ONE "Details", the code and the kernel's own text (and, of a home that was kept, the longer words).
 */
function settledPhase(outcome: Outcome, actions: ReactNode): ConfirmProps["phase"] {
  const more = [outcome.warning?.details ?? null, outcome.details].filter((part): part is string => part !== null);
  const details =
    more.length === 0 && outcome.code === null ? null : (
      <Disclosure summary="Details" testId="oats-act-details">
        {more.map((text, index) => (
          <p key={index} className="text-xs text-muted-foreground">
            <Lines text={text} />
          </p>
        ))}
        {outcome.code === null ? null : <Code>{outcome.code}</Code>}
      </Disclosure>
    );
  const next = (
    <>
      {actions}
      {details}
    </>
  );
  // A result that is not confirmed is neither done nor failed: the pattern draws it as that.
  // (A done result whose title is a warning is drawn in the warning tone, which the pattern has for a result that is not confirmed.)
  if (outcome.tone !== "failed") return { kind: "done", tone: outcome.attention === true ? "unknown" : outcome.tone, title: outcome.title, lines: outcome.lines, warns: outcome.warns === true, actions: next };
  return { kind: "failed", title: outcome.title, refusal: outcome.lines.join("\n"), actions: next };
}

/** OATS itself cannot be read: the one notice every place shows, in the dialog, with Retry. */
function CannotRead({ refusal, onRetry }: { refusal: Refusal; onRetry: () => void }) {
  const oats = useOats();
  const machine = oats.phase === "ready" ? oats.deployment.machine : oats.phase === "failed" ? oats.machine : null;
  return <Unreadable failure={{ code: refusal.code ?? "", message: refusal.message }} machine={machine} onRetry={onRetry} />;
}

// ---- Stop and Retire ----

type Plan = Answer<"stopPlan"> | Answer<"retirePlan">;
type PlanState =
  /** `kept`: the plan under review stays on screen while a new one is read for a choice or a check. */
  | { phase: "reading"; kept: Plan | null; why: string }
  /** `changed`: the plan was confirmed and had changed (E_PLAN_STALE); this is the plan as it is now, and what differs. It cannot be confirmed until it was reviewed again. */
  | { phase: "ready"; plan: Plan; key: string; changed: string[] | null }
  | { phase: "applying"; plan: Plan; key: string }
  | { phase: "settled"; outcome: Outcome; refusal: Refusal | null; sent: { plan: Plan; key: string } | null };

/**
 * bb's own word on a thread NOW (`sdk.threads.get`): that it HAS it, and whether it holds it
 * archived; null when bb cannot be asked, has no such thread (it was deleted), or does not say.
 * Never waited for long: what asks it has the kernel's answer already.
 */
async function threadInBb(sdk: ReturnType<typeof useSdk>, threadId: string): Promise<{ archived: boolean } | null> {
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), THREAD_READ_MS);
  try {
    const thread: unknown = await Promise.race([
      sdk.threads.get({ threadId, signal: limit.signal }),
      new Promise<null>((resolve) => limit.signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]);
    if (typeof thread !== "object" || thread === null || !("archivedAt" in thread)) return null;
    return { archived: thread.archivedAt !== null && thread.archivedAt !== undefined };
  } catch {
    // bb could not be asked, has no such thread, or this bb has no such read: not known.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
/** How long a dialog waits for bb's word on a thread before it goes on without it. */
const THREAD_READ_MS = 5_000;
/**
 * Whether bb holds the thread archived NOW: true or false; null when it is not known. Read after
 * a stop, for what its result says of the thread: the provider's release decides whether a stop
 * archives, and what a person is told is what happened, not what a version number promises.
 */
const threadArchived = async (sdk: ReturnType<typeof useSdk>, threadId: string): Promise<boolean | null> => (await threadInBb(sdk, threadId))?.archived ?? null;

/**
 * The bb session provider's version, by which the dialog knows whether a stop archives the
 * agent's thread (`stopArchivesThread`: one fact, one function): the plugin's server answers it
 * beside the stop plan. A plan that names none, and a retire's, is not known.
 */
const versionOf = (plan: Plan | null): string | null => (plan !== null && plan.action === "stop" ? plan.providerVersion : null);

function PlanDialog({ request }: { request: Request & { verb: PlanVerb } }) {
  const rpc = useRpc<Contract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const oats = useOats();
  const rosterAt = useRef<string | null>(null);
  const oatsNow = useRef(oats);
  useEffect(() => {
    rosterAt.current = oats.phase === "ready" ? oats.at : null;
    oatsNow.current = oats;
  });
  const { verb, instance } = request;
  // When the plan on screen was read, by the window's clock; and the clock (the age is said under Details).
  const [readAt, setReadAt] = useState<number | null>(null);
  const now = useNow();
  const threadId = oats.phase === "ready" ? (oats.nodeByInstance.get(instance)?.thread.id ?? null) : null;
  const returnFocus = useRowFocus(threadId);
  // Opened again on a result (the toaster's "Show result"): that result, and nothing is read.
  const resumed = request.resume !== undefined && "plan" in request.resume ? request.resume : null;
  const [state, setState] = useState<PlanState>(resumed?.plan ?? { phase: "reading", kept: null, why: CHECKING });
  /** The plan's one tick: a stop's children (on, the kernel's default), a retire's worktree (off). */
  const [recursive, setRecursive] = useState(resumed?.recursive ?? true);
  const [discard, setDiscard] = useState(resumed?.discard ?? false);
  const live = useRef(true);
  /** The read whose answer is still wanted: a newer read, or a close, drops an older one's. */
  const ticket = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(
    (why: string, withChildren: boolean, changedFrom: Plan | null = null) => {
      const mine = ++ticket.current;
      setState((before) => ({ phase: "reading", kept: before.phase === "ready" ? before.plan : before.phase === "reading" ? before.kept : null, why }));
      const asked: Promise<Plan> = verb === "stop" ? rpc.call("stopPlan", { instance, recursive: withChildren }) : rpc.call("retirePlan", { instance });
      asked.then(
        (plan) => {
          // A new plan is a new intent: it gets its own idempotency key.
          if (live.current && mine === ticket.current) setReadAt(Date.now());
          if (live.current && mine === ticket.current) setState({ phase: "ready", plan, key: newKey(), changed: changedFrom === null ? null : planChanges(changedFrom, plan, stopArchivesThread(versionOf(plan)), stopArchivesThread(versionOf(changedFrom))) });
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
    [rpc, verb, instance],
  );
  useEffect(() => {
    if (resumed === null) read(CHECKING, true);
    // (`resumed` is the request's, and a dialog has one request for its whole life.)
  }, [read, verb, instance, resumed]);

  /** `again`: the same revision and key, sent to read the result of an apply whose answer was lost ("Check again"). */
  const send = (plan: Plan, key: string, again = false) => {
    setState({ phase: "applying", plan, key });
    const sent = { plan, key };
    // The roster the window holds as the act is sent: a result that says the agents changed is true of them
    // before that roster is read again, and the places that say their state say "Reading…" until it is (app/roster/reading.tsx).
    const sentAt = rosterAt.current;
    const acted = plan.action === "stop" ? plan.targets.map((target) => target.instance) : [plan.instance ?? instance];
    // (And each agent's state in that roster: a roster that reaches the window during the act can still say it.)
    const was = new Map(acted.map((each) => [each, keptState(plan.action === "stop" ? "stop" : "retire", stateIn(oatsNow.current, each))]));
    const settle = (outcome: Outcome, refusal: Refusal | null) => {
      if (outcome.tone === "done") noteActed(acted, sentAt, was);
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
            return stopOutcome(receipt, plan.instance ?? instance, onBb, archived ?? stopArchivesThread(versionOf(plan)));
          })
        : rpc.call("retireApply", { instance, revision: plan.revision, key, discardWorktree: discard }).then((receipt) => retireOutcome(receipt, plan));
    answered.then(
      (outcome) => settle(outcome, null),
      (cause: unknown) => {
        const refusal = refusalOf(cause);
        // The plan changed under the confirmation: back to review with the plan as it is now.
        const pi = plan.action === "retire" && piOnBb(plan); // (a retire's plan alone says the backend and the harness)
        if (again) settle(checkAgainRefused(verb, plan.instance ?? instance, refusal, pi), refusal);
        else if (refusal.code === "E_PLAN_STALE" && live.current && current === request) read(CHECKING, recursive, plan);
        else settle(applyRefused(verb, plan.instance ?? instance, refusal, pi), refusal);
      },
    );
  };

  const close = () => {
    ticket.current++;
    if (current === request) set(null);
  };
  const plan = state.phase === "ready" || state.phase === "applying" ? state.plan : state.phase === "reading" ? state.kept : (state.sent?.plan ?? null);
  // Who of the plan works on a turn now: bb's own word on each agent's thread, as the roster holds it (never the plan's midTask).
  const working = new Set(plan !== null && plan.action === "stop" && oats.phase === "ready" ? plan.targets.filter((target) => { const node = oats.nodeByInstance.get(target.instance); return node !== undefined && threadWorks(node.thread); }).map((target) => target.instance) : []);
  const view = plan === null ? null : plan.action === "stop" ? stopPlanView(plan, stopArchivesThread(versionOf(plan)), working) : retirePlanView(plan, discard);
  const shownFor = plan === null ? null : plan.instance;
  const choose = (checked: boolean) => {
    if (verb === "stop") {
      setRecursive(checked);
      // Whom a stop includes is the kernel's to say: the plan is read again for the choice.
      read(CHECKING, checked);
    } else setDiscard(checked);
  };
  const again = () => read(CHECKING, recursive);
  useFocusWhenReady(state.phase === "ready");
  // A plan that changed under the confirmation is not armed: it comes back for review with the
  // focus on Cancel, and is confirmed only after "Review again" has read it once more.
  // A result with a warning of its own (a home that was kept) is read from that warning.
  useReveal(state.phase === "applying" ? "running" : state.phase === "settled" ? (state.outcome.warning === undefined ? "result" : "kept") : "top");
  // What a choice would lose is said under it the moment it is turned on: it is brought on screen with it.
  useReveal(state.phase === "ready" && view?.choice?.deletes ? "warning" : null);
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
          ? { kind: "running", doing: applying(verb), leave: "" }
          : settledPhase(
              state.outcome,
              <>
                {state.outcome.offers.includes("review") ? (
                  <Button data-testid="oats-act-review" onClick={() => read(CHECKING, recursive)}>
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
      // Once the act has an answer the plan gives way to it, a refusal as a result: what it would do, over
      // "wasn't stopped", would say in the future what did not happen. Review again brings the plan back.
      says={state.phase === "settled" ? [] : (view?.says ?? [])}
      saysWarns={view?.warns === true}
      confirmLabel={view?.confirm ?? (verb === "stop" ? "Stop" : "Retire")}
      // Both acts end something a person may want running: the focus starts on Cancel for each.
      destructive
      blocked={updating ?? (changed !== null ? null : (view?.blocked ?? null))}
      // A plan that changed is not confirmed before it was read again: the notice over it says so, with Review again.
      held={changed !== null}
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
        // What a person must read first, in the warning tone; the rest is under the result's one Details (a retire that kept the home).
        <div data-testid="oats-act-warning">
          <Notice title={state.outcome.warning.title} tone="warning" />
        </div>
      ) : null}
      {view === null || state.phase === "settled" ? null : (
        <div data-testid="oats-plan" className="flex min-w-0 flex-col gap-3">
          {view.attention.length === 0 ? null : (
            // The facts that are a reason not to confirm (uncommitted work, a turn in progress, a work tree elsewhere):
            // set apart by a border in the attention tone, under no heading, in regular weight, one line per agent, and only when true.
            <ul data-testid="oats-plan-attention" className="flex flex-col gap-1 rounded-lg border border-warning-text bg-card p-3 text-foreground">
              {view.attention.map((line, index) => (
                <li key={index} className="break-words">
                  <Lines text={line} />
                </li>
              ))}
            </ul>
          )}
          {/* The dialog's ONE fold: what the plan keeps and deletes beside its one line, who is left out, and the current state. */}
          <Disclosure summary="Details" testId="oats-plan-details">
            <div className="flex min-w-0 flex-col gap-2">
              <ul className="flex flex-col gap-1">
                {view.details.map((line, index) => (
                  <li key={index} className="break-words">
                    <Lines text={line} />
                  </li>
                ))}
              </ul>
              <Facts>
                {view.state.map((row) => (
                  // A label here can be an agent's name, a value a branch an agent chose: both are filtered where they are drawn (`Fact` filters nothing).
                  <Fact key={row.label} label={shown(row.label)}>
                    {shown(row.value)}
                  </Fact>
                ))}
              </Facts>
              {/* The plan as it is now, read again: one press away (a plan that changed under the confirmation comes back by itself). */}
              {state.phase === "ready" ? (
                // The plan is of the moment it was read (the state rows above, and the facts on the face): how old it is, in
                // the plugin's one form for content read earlier, before the way to read it again. (The window's own
                // clock at the read and now: never the server's stamp beside the window's clock.)
                <span data-testid="oats-plan-observed" className="flex flex-wrap items-center gap-2">
                  <span data-testid="oats-plan-read" className="text-xs text-muted-foreground">
                    {showingRead(readAt === null ? null : readAge(readAt, Math.max(now, readAt)))}
                  </span>
                  <Button variant="ghost" data-testid="oats-plan-check" onClick={again}>
                    Check again
                  </Button>
                </span>
              ) : null}
            </div>
          </Disclosure>
          {view.choice === null ? null : (
            // The plan's tick, drawn with the plugin's one pattern for a choice that is on or off: it says which it is in a word.
            // What it deletes is drawn AT the tick, under its label, only while it is ticked: never a line of the dialog's text.
            <div className="flex flex-col gap-1">
              <span data-testid="oats-plan-choice" className="flex">
                <Switch label={view.choice.label} checked={view.choice.checked} disabled={state.phase === "applying"} onChange={choose} />
              </span>
              {view.choice.deletes === null ? null : (
                <p role="status" data-testid="oats-plan-warning" className="break-words text-destructive-text">
                  <Lines text={view.choice.deletes} />
                </p>
              )}
            </div>
          )}
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
type Check = Answer<"startCheck"> & { carryOn: string | null };
type StartState =
  | { phase: "checking" }
  | { phase: "ready"; check: Check }
  | { phase: "running"; check: Check }
  | { phase: "settled"; check: Check | null; outcome: Outcome; refusal: Refusal | null; threadId: string | null };

/** How long bb's model list may be read before a Restart reads it as no list: it then holds (a restart may not go without the list). */
const LIST_WAIT_MS = 10_000;
/** Whether `of` (null: nothing is waited for) has been waited for `ms`, without a break. (An `of` that was overdue and is waited for again is overdue at once: that holds, the safe side.) */
function useOverdue(of: string | null, ms: number): boolean {
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    if (of === null) return;
    const timer = setTimeout(() => setLate(of), ms);
    return () => clearTimeout(timer);
  }, [of, ms]);
  return of !== null && late === of;
}
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
  const rosterAt = useRef<string | null>(null);
  const oatsNow = useRef(oats);
  useEffect(() => {
    rosterAt.current = oats.phase === "ready" ? oats.at : null;
    oatsNow.current = oats;
  });
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
  // Opened again on a result (the toaster's "Show result"): that result and what the person had chosen.
  const kept = request.resume !== undefined && "start" in request.resume ? request.resume : null;
  const resumed = kept?.start ?? null;
  const [state, setState] = useState<StartState>(resumed ?? { phase: "checking" });
  /** "" keeps the recorded harness: nothing is passed. */
  const [harness, setHarness] = useState(kept?.harness ?? "");
  const [model, setModel] = useState(kept?.model ?? "");
  /** For a tmux agent whose session was lost: the plain start, on purpose, in place of the resume. Off by default. */
  const [fresh, setFresh] = useState(kept?.fresh ?? false);
  /** The row changed under a resume (the kernel: its session is not lost): said first when the check comes back. */
  const [changed, setChanged] = useState(false);
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

  /** Refresh status: the row is read again, and what was said of the row before it no longer stands. */
  const refresh = () => {
    setChanged(false);
    check();
  };

  const known = state.phase === "checking" ? null : state.check;
  const name = known?.instance ?? instance;
  const typed = model.trim();
  const badModel = typed !== "" && !isModel(typed);
  // The harness that will run: the chosen one, else the recorded one. Its models are the ones suggested.
  const running = harness !== "" ? harness : (known?.harness ?? null);
  // (An agent that is not on bb has no model field: nothing is asked of bb for it.)
  const suggestions = useModelSuggestions(known === null || known.backend !== "bb" ? null : running);
  const held = state.phase === "ready" ? gate(verb, state.check) : null;

  // A RESTART stops the running session before the provider judges the MODEL it was asked for: the kernel's order.
  // So a model that was CHANGED is sent only when it can be shown to start (model/restart-model.ts): bb's list for
  // the harness serves it exactly once. Held here, in the app: nothing is sent to the plugin's server. (A start
  // that is refused harms nothing: the Start dialog holds none of this. A harness bb cannot run is refused by the
  // kernel BEFORE the stop: nothing is held for it, and its refusal is the dialog's ordinary refused result.)
  const restarts = verb === "restart" && known !== null && known.backend === "bb";
  const harnessChanged = known !== null && harness !== "" && harness !== known.harness;
  // A list bb is still reading says nothing yet; one still unread after LIST_WAIT_MS reads as no list, which holds.
  const listPending = restarts && typed !== "" && suggestions.status === "loading";
  const overdue = useOverdue(listPending ? (running ?? "") : null, LIST_WAIT_MS);
  const hold = !restarts
    ? null
    : restartModel({
        typed,
        harnessChanged,
        // pi's models are resolved by their provider; any other harness's list names ids whole.
        byProvider: running === "pi",
        listed: suggestions.status === "loading" && !overdue ? { status: "loading" } : { status: "ready", models: suggestions.models.map(({ id, provider }) => ({ id, provider })) },
      });
  const heldModel = hold !== null && hold.kind === "held" ? hold : null;
  /** The word, said once: the Model field's mark. */
  const modelWord = heldModel === null ? null : heldModel.why === "required" ? START.required : heldModel.why === "not-found" ? START.notFound : START.pickProvider;
  // Beside the button: the held word; while the list is read, off with no word (it answers at once from bb's cache).
  /** The id of the Model field's mark: what the off button is described by. */
  const modelMark = `oats-start-model-mark-${request.id}`;
  const notArmed = hold === null || hold.kind === "armed" ? null : hold.kind === "reading" ? "" : modelWord;

  // What this start is, from the kernel's row as the check read it. On bb: a new thread, with a harness and a
  // model to choose. On tmux: no thread and no choice; and where its session was LOST, a resume, unless the
  // person turned on the plain start.
  const onBb = known === null || known.backend === "bb";
  const lost = verb === "start" && known !== null && resumable(known);
  const resumes = lost && !fresh;

  const start = () => {
    if (state.phase !== "ready" || held !== null || (onBb && badModel) || notArmed !== null) return;
    const { check: checked } = state;
    setChanged(false);
    setState({ phase: "running", check: checked });
    // (As for a stop: the roster held as the act is sent, and for a start the agent's state in it; a restart's
    // state is the same word before and after, so the roster's stamp alone decides; app/roster/reading.tsx.)
    const sentAt = rosterAt.current;
    const was = new Map([[checked.instance, keptState(verb, stateIn(oatsNow.current, checked.instance))] as const]);
    const asked = verb === "start" && resumes ? { instance, resume: true as const } : { instance, ...(onBb && harness !== "" ? { harness } : {}), ...(onBb && typed !== "" ? { model: typed } : {}) };
    rpc.call(verb, asked).then(
      (started) => {
        const outcome = startOutcome(verb, started.instance ?? checked.instance, started);
        if (outcome.tone === "done") noteActed([checked.instance], sentAt, was);
        const threadId = started.threadId;
        // A home that is not on bb has no thread to open: its result says where it is.
        const open = threadId === null ? null : { label: `Open ${agentName(checked.instance)}`, run: () => navigate.toThread(threadId) };
        if (live.current && current === request) {
          setState({ phase: "settled", check: checked, outcome, refusal: null, threadId });
          // The agent's new thread opens behind the result, as the Desktop opens its terminal: Close leaves the person on it.
          if (threadId !== null) navigate.toThread(threadId);
        } else tell(verb, checked.instance, outcome, { start: { phase: "settled", check: checked, outcome, refusal: null, threadId }, harness, model, fresh }, open, checked.backend !== "bb");
      },
      (cause: unknown) => {
        const refusal = refusalOf(cause);
        // The row changed under a resume (its session is not lost any more): back to the check, which says what Start does now.
        if (refusal.code === "E_RESUME_NOT_LOST" && live.current && current === request) {
          setChanged(true);
          check();
          return;
        }
        const outcome = startRefused(verb, checked.instance, refusal, checked.backend === "tmux");
        // Launch settings that changed leave one way to start it: fresh. The dialog that Refresh status brings back
        // has that choice ON, with its line on what is lost: the person sees it and presses Start, or turns it off.
        const onlyFresh = refusal.code === "E_LAUNCH_ENV_CHANGED";
        if (onlyFresh && live.current) setFresh(true);
        if (live.current && current === request) setState({ phase: "settled", check: checked, outcome, refusal, threadId: null });
        else tell(verb, instance, outcome, { start: { phase: "settled", check: checked, outcome, refusal, threadId: null }, harness, model, fresh: fresh || onlyFresh }, null);
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
          ? { kind: "running", doing: verb === "restart" ? START.restarting : START.starting, leave: "" }
          : unreadable !== null
            ? { kind: "failed", title: `Couldn't check ${agentName(instance)}`, refusal: "", actions: <CannotRead refusal={unreadable} onRetry={check} /> }
            : settledPhase(
                state.outcome,
                <>
                  {state.outcome.offers.includes("refresh") ? (
                    <Button data-testid="oats-start-refresh" onClick={refresh}>
                      {START.refresh}
                    </Button>
                  ) : null}
                  {state.outcome.waiting === true ? (
                    // The start succeeded and the harness waits for its person in its terminal: said apart, in the attention tone.
                    <div data-testid="oats-start-waiting" className="w-full">
                      <Notice title={RESUME.waiting} tone="warning" />
                    </div>
                  ) : null}
                  {(state.outcome.tone === "done" || state.outcome.tone === "unknown") && state.check !== null && state.check.backend === "tmux" ? (
                    // An agent on tmux has no thread to open: the way into it (the panel's own word and command). Under a start that is done, and under one whose end is not known: its session is or may be there.
                    <div data-testid="oats-start-where" className="flex w-full min-w-0 flex-col gap-1 text-sm">
                      <p>{ATTACH}</p>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <CommandText command={attachCommand(state.check.home)} />
                        <CopyButton text={attachCommand(state.check.home)} name="Copy the command" />
                      </span>
                    </div>
                  ) : null}
                </>,
              );
  const editable = state.phase === "ready";
  useFocusWhenReady(editable);
  // A dialog that says first to send a message instead is read from that line, whatever field takes the focus.
  useReveal(state.phase === "running" ? "running" : state.phase === "settled" ? "result" : state.phase === "ready" && state.check.carryOn !== null ? "first" : "top");
  useKeepFocus();
  const recorded = known?.harness ?? null;
  const carryOn = state.phase === "ready" ? state.check.carryOn : null;

  return (
    <Confirm
      // Named from the kernel's row as read for this dialog, never from the row that was pressed.
      title={titleOf(verb, known?.instance ?? null, known !== null)}
      about={instance}
      shownFor={known?.instance ?? null}
      // What a start does is said of an agent the kernel has named: a check that failed says none of it.
      // And once the start has an answer, none of it either: a refusal is not read under what it would have done.
      says={known === null || state.phase === "settled" ? [] : startSays(verb, { resumes })}
      confirmLabel={verb === "restart" ? "Restart" : "Start"}
      // Why Start is off is said ONCE, on the status line under the fields (with Refresh status, or the way to its
      // thread): the button is off (`held`) with no second copy of the sentence beside it. Beside the button stands
      // only what the person typed wrong.
      // Held on what is in the Model field: a model name that is none, or in a Restart a changed model bb's list does
      // not serve (#77). The word stands ONCE, as the field's mark ("Enter a model name, …", "Not found", "Required",
      // "Pick provider"); the button is off and described by that mark, with no copy of the word beside it (the
      // lead's L9). While bb's list is still read it is off with no word at all.
      held={held !== null || notArmed !== null || (onBb && badModel)}
      describedBy={(onBb && badModel) || (notArmed !== null && notArmed !== "") ? modelMark : undefined}
      notice={
        changed ? (
          // A resume the kernel refused because the row changed: said first, as a plan that changed is.
          <Notice title="Something changed since you opened this" tone="warning">
            <p>{RESUME.notLost}</p>
          </Notice>
        ) : carryOn !== null ? (
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
          {/* The dialog's ONE fold: the access it runs with, and the facts of the agent a person does not decide on. */}
          <Disclosure summary="Details" testId="oats-start-details">
            <div className="flex min-w-0 flex-col gap-2">
              {startDetails(verb, { onBb }).map((line, index) => (
                <p key={index} className="break-words">
                  {line}
                </p>
              ))}
              {/* The one way to a model bb does not list, only while the field says "Not found": in the dialog's ONE fold (never a second "Details"). */}
              {heldModel !== null && heldModel.why === "not-found" && !badModel ? (
                <p data-testid="oats-start-unlisted" className="break-words">
                  {START.unlisted}
                </p>
              ) : null}
              <Facts>
                {/* With a choice of harness, the field's first entry says which one is recorded: it is not said twice. */}
                {onBb && known.harnesses.length > 1 ? null : <Fact label="Harness">{recorded === null ? "Harness not reported" : shown(harnessLabel(recorded))}</Fact>}
                {/* The kernel's row is a record the agent can write: its harness, model and home are drawn through the display filter. */}
                <Fact label="Machine">{shown(known.machine)}</Fact>
                <Fact label="Home">{shown(known.home)}</Fact>
              </Facts>
              {/* Why its state is not known, in OATS's own words: beside the line that says Start is off, one press away. */}
              {held !== null && !held.running && known.runtimeError !== null ? <p className="break-words text-xs text-muted-foreground">{shown(`OATS says: ${known.runtimeError}`)}</p> : null}
            </div>
          </Disclosure>
          {lost ? (
            // A tmux agent whose session was lost: Start brings it back; the plain start stays, on purpose, and says what it loses.
            // (A choice made before the press: this block is not drawn beside a result; Refresh status brings the dialog back.)
            <div className="flex flex-col gap-1">
              <span data-testid="oats-start-fresh-choice" className="flex">
                <Switch label={RESUME.freshChoice} checked={fresh} disabled={!editable} onChange={setFresh} />
              </span>
              {fresh ? (
                <p role="status" data-testid="oats-start-fresh-warning" className="break-words text-destructive-text">
                  {RESUME.freshWarning}
                </p>
              ) : null}
            </div>
          ) : null}
          {onBb && known.harnesses.length > 1 ? (
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
          {/* A home on tmux starts with the launch it recorded: bb's harnesses and their models are no choice of its start. */}
          {!onBb ? null : (
          <Field
            label={START.model}
            optional
            errorId={modelMark}
            error={badModel ? START.badModel : modelWord}
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
          )}
          {!onBb ? null : (
          <datalist id={`oats-start-models-${request.id}`}>
            {/* Several listed models serve the id that was typed: the field offers only those. */}
            {suggestions.models.filter((each) => heldModel === null || heldModel.why !== "pick-provider" || heldModel.serving.includes(each.id)).map((each) => (
              <option key={each.id} value={each.id} label={shown(each.label)} />
            ))}
          </datalist>
          )}
          {/* Only where Start is off: why, said here and nowhere else in the dialog, and the way to read its status again. A start that can run says nothing here. */}
          {state.phase === "ready" && held !== null ? (
            <p role="status" data-testid="oats-start-status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{held.reason}</span>
              {held.running && rowThread !== null ? (
                <Button data-testid="oats-start-open" onClick={() => openThread(rowThread)}>
                  {`Open ${agentName(name)}`}
                </Button>
              ) : null}
              <Button variant="ghost" data-testid="oats-start-refresh" onClick={refresh}>
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
