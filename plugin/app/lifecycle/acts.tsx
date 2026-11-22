// What the plugin does to an agent: Stop, Start, Restart and Retire, each through the plugin's
// server and so through OATS. Stop and Retire show the kernel's plan and ask once. The requests
// come from thread menus and from pages; one overlay per app window draws them.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { newKey } from "../keys";
import { errorMessage, onWindowReset } from "../store";
import type { Contract, Rpc } from "../store";
import { useOats } from "../oats";
import { markGone, saysGone } from "../roster/gone";
import { isUnreadable, Unreadable } from "../roster/unreadable";
import { Button, ErrorLine, Modal, Note, Notice } from "../ui";
import { refusalCode, shown } from "../ui/text";

export type PlanVerb = "stop" | "retire";
export type RunVerb = "start" | "restart";

type Request =
  | { kind: "plan"; verb: PlanVerb; instance: string; id: number }
  | { kind: "running"; verb: RunVerb; instance: string }
  | { kind: "failed"; verb: RunVerb; instance: string; message: string };

let current: Request | null = null;
/** A failure that arrived while another request was on screen: shown when that one closes. */
let deferred: Request | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
function set(next: Request | null): void {
  current = next ?? deferred;
  if (next === null) deferred = null;
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
  deferred = null;
  listeners.clear();
});

/** Ask for the kernel's plan to stop or retire an agent; the overlay shows it and asks once. */
export function askPlan(verb: PlanVerb, instance: string): void {
  set({ kind: "plan", verb, instance, id: ++sequence });
}

/** Start or restart an agent through OATS, then open the thread the kernel answers with. */
export async function run(verb: RunVerb, instance: string, rpc: Rpc, navigate: BbNavigate): Promise<void> {
  const mine: Request = { kind: "running", verb, instance };
  set(mine);
  try {
    const { threadId } = await rpc.call(verb, { instance });
    // The person may have moved on to another request meanwhile: their screen is left as it is.
    if (current !== mine) return;
    set(null);
    navigate.toThread(threadId);
  } catch (cause) {
    // The thread menu contains and hides a thrown error: say it here instead, without replacing
    // a dialog the person opened meanwhile.
    const message = errorMessage(cause);
    // The kernel has no such agent any more (the roster on screen was read before it went).
    if (saysGone(refusalCode(message), message)) markGone(instance);
    const failed: Request = { kind: "failed", verb, instance, message };
    if (current === mine || current === null) set(failed);
    else deferred = failed;
  }
}

const PLAN = {
  stop: { plan: "stopPlan", apply: "stopApply", title: "Stop", confirm: "Stop agent", done: "stopped" },
  retire: { plan: "retirePlan", apply: "retireApply", title: "Retire", confirm: "Retire agent", done: "retired" },
} as const satisfies Record<PlanVerb, { plan: keyof Contract; apply: keyof Contract; title: string; confirm: string; done: string }>;

type PlanState =
  | { phase: "reading" }
  | { phase: "ready"; revision: string; lines: string[]; instance: string | null; key: string; error: string | null; applying: boolean }
  | { phase: "unreadable"; error: string; gone: boolean };

function PlanDialog({ request }: { request: Extract<Request, { kind: "plan" }> }) {
  const rpc = useRpc<Contract>();
  const words = PLAN[request.verb];
  const [state, setState] = useState<PlanState>({ phase: "reading" });
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let wanted = true;
    setState({ phase: "reading" });
    rpc.call(words.plan, { instance: request.instance }).then(
      (plan) => {
        // A new plan is a new intent: it gets its own idempotency key.
        if (wanted) setState({ phase: "ready", ...plan, key: newKey(), error: null, applying: false });
      },
      (cause: unknown) => {
        const error = errorMessage(cause);
        // The kernel no longer has an agent of this name (the roster on screen was read before it
        // went): its row says so until the next roster is read.
        const gone = saysGone(refusalCode(error), error);
        if (gone) markGone(request.instance);
        if (wanted) setState({ phase: "unreadable", error, gone });
      },
    );
    return () => {
      wanted = false;
    };
  }, [rpc, words.plan, request.instance, attempt]);

  // Once Confirm is pressed the act is on its way: the dialog stays until OATS answers, so its
  // refusal has a place to show and a closed dialog never reads as "cancelled".
  const applying = state.phase === "ready" && state.applying;
  const cancel = () => {
    if (!applying) set(null);
  };
  const confirm = () => {
    if (state.phase !== "ready" || state.applying) return;
    const { revision, key } = state;
    setState({ ...state, applying: true, error: null });
    rpc.call(words.apply, { instance: request.instance, revision, key }).then(
      () => {
        if (current === request) set(null);
      },
      (cause: unknown) => {
        const error = errorMessage(cause);
        // The agent went between the plan and the act: nothing is left to confirm.
        const gone = saysGone(refusalCode(error), error);
        if (gone) markGone(request.instance);
        if (live.current) setState((now) => (now.phase !== "ready" ? now : gone ? { phase: "unreadable", error, gone } : { ...now, applying: false, error }));
      },
    );
  };

  return (
    <Modal
      // The agent is named from the kernel's plan, never from the row that was pressed: the roster
      // on screen may be older than what the kernel knows. Until the plan is read no agent is named.
      title={state.phase === "ready" && state.instance !== null ? `${words.title} ${shown(state.instance)}?` : state.phase === "ready" ? `${words.title} this agent?` : `${words.title} an agent`}
      onCancel={cancel}
      footer={
        <>
          <Button data-testid="oats-plan-cancel" disabled={applying} onClick={cancel}>
            Cancel
          </Button>
          {state.phase === "ready" && state.error !== null ? (
            <Button data-testid="oats-plan-reread" onClick={() => setAttempt((n) => n + 1)}>
              Read the plan again
            </Button>
          ) : null}
          <Button
            data-testid="oats-plan-confirm"
            variant={request.verb === "retire" ? "destructive" : "primary"}
            disabled={state.phase !== "ready" || state.applying}
            onClick={confirm}
          >
            {applying ? "Working…" : words.confirm}
          </Button>
        </>
      }
    >
      <div data-testid="oats-plan" className="flex flex-col gap-2">
        {state.phase === "reading" ? <Note>Reading the plan from OATS…</Note> : null}
        {state.phase === "unreadable" ? <Refused error={state.error} gone={state.gone} instance={request.instance} onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {state.phase === "ready" ? (
          <>
            {state.lines.length === 0 ? (
              <Note>OATS gave no detail for this plan.</Note>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.lines.map((line, index) => (
                  <li key={index} className="break-words">
                    {shown(line)}
                  </li>
                ))}
              </ul>
            )}
            {state.error === null ? null : <ErrorLine>{state.error}</ErrorLine>}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

const RUN = { start: { doing: "Starting", failed: "Start" }, restart: { doing: "Restarting", failed: "Restart" } } as const;

/**
 * The plugin's one overlay (experimental_appOverlay): nothing until something is asked. It draws
 * the plan dialogs of Stop and Retire, the running line of Start and Restart, and their failure.
 */
export function ActsOverlay() {
  const request = useSyncExternalStore(subscribe, get, get);
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  if (request === null) return null;
  if (request.kind === "plan") return <PlanDialog key={request.id} request={request} />;
  if (request.kind === "running") {
    return (
      <div
        role="status"
        data-testid="oats-act-running"
        className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-lg"
      >
        {`${RUN[request.verb].doing} ${shown(request.instance)} through OATS…`}
      </div>
    );
  }
  const again = () => void run(request.verb, request.instance, rpc, navigate);
  const gone = saysGone(refusalCode(request.message), request.message);
  return (
    <Modal
      // No agent is named in the title: the name asked for is the row's, which may be older than what the kernel knows.
      title={`${RUN[request.verb].failed} did not happen`}
      onCancel={() => set(null)}
      footer={
        <>
          <Button data-testid="oats-act-close" onClick={() => set(null)}>
            Close
          </Button>
          {gone ? null : (
            <Button data-testid="oats-act-again" variant="primary" onClick={again}>
              Try again
            </Button>
          )}
        </>
      }
    >
      <div data-testid="oats-act-failed" className="flex flex-col gap-2">
        {gone ? null : <p>{`OATS was asked to ${request.verb} ${shown(request.instance)}.`}</p>}
        <Refused error={request.message} gone={gone} instance={request.instance} onRetry={again} footerRetries />
      </div>
    </Modal>
  );
}

/**
 * Why an act did not happen, in the place that asked for it: the agent is not in OATS any more
 * (a notice, nothing to retry); OATS itself cannot be read (the same notice every place shows,
 * and Retry asks again); or the kernel's refusal, its code and message as the filter draws them.
 */
function Refused({ error, gone, instance, onRetry, footerRetries = false }: { error: string; gone: boolean; instance: string; onRetry: () => void; /** the dialog's footer has "Try again": the kernel's refusal draws no Retry of its own */ footerRetries?: boolean }) {
  const code = refusalCode(error);
  const oats = useOats();
  // The machine by its name where the roster, or its failure, names it.
  const machine = oats.phase === "ready" ? oats.deployment.machine : oats.phase === "failed" ? oats.machine : null;
  if (gone) {
    return (
      <Notice title={`${shown(instance)} is not in OATS any more`} tone="error" code={code} details={error}>
        <p>OATS has no agent of this name now: it was retired, or removed, after the roster on screen was read. Nothing was changed.</p>
      </Notice>
    );
  }
  if (code !== null && isUnreadable(code)) return <Unreadable failure={{ code, message: error.slice(code.length + 2) }} machine={machine} onRetry={onRetry} />;
  return footerRetries ? <ErrorLine>{error}</ErrorLine> : <ErrorLine onRetry={onRetry}>{error}</ErrorLine>;
}
