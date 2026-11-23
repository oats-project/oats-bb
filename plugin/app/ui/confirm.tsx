// The confirmation of an act on an agent (the UX standard, section 3): a dialog titled with the act
// and the agent's name, what will happen as sentences, what is kept, the primary button named for
// the act, and then, in the same dialog, the act in progress and its result.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Lines, Modal } from "../ui";
import { Loading, Result } from "./patterns";
import { shown } from "./text";

export type ConfirmProps = {
  /** The act and who it is about: "Retire Weekly digest?". */
  title: string;
  /**
   * The instance the dialog is about, and the instance what it shows is for (the plan's own, as
   * the kernel named it; null while none is read). When they differ the dialog shows no plan and
   * cannot be confirmed: it never asks about one agent with another's facts. A plan that is ready
   * and names no agent cannot be confirmed either. Once the act is done the plan gives way to the result.
   */
  about: string;
  shownFor: string | null;
  /**
   * What the act does, in view, under no heading: the ONE consequence line and at most one more
   * (the lifecycle dialogs: the text audit of 23 Nov 2026). `saysWarns`: the first line is a warning,
   * drawn in the warning tone. Text from OATS is filtered here.
   */
  says?: readonly string[];
  saysWarns?: boolean;
  /** "What will happen", as sentences about the named agent, under that heading; and what is kept. For a dialog that is not cut to one line. */
  happens?: readonly string[];
  kept?: readonly string[];
  /**
   * What a person must read BEFORE the plan, above it: that the plan changed under their
   * confirmation, and how. It is the first thing in the dialog, so it is on screen at any width.
   */
  notice?: ReactNode;
  /** More of the dialog's own (a field, a tick), under the sentences. */
  children?: ReactNode;
  /** The primary button, named for the act: "Retire", "Stop". `destructive`: the focus starts on Cancel. */
  confirmLabel: string;
  destructive?: boolean;
  /** Why the primary button is off, in words, beside it; null when it can be pressed. */
  blocked?: string | null;
  /** The primary button is off and the dialog already says why, in view (a notice with its own act): no words beside the button. */
  held?: boolean;
  phase:
    /** The kernel is being asked: `text` says for what, where the place has the Desktop's own line ("Checking instance…"). */
    | { kind: "reading"; text?: string }
    | { kind: "ready" }
    /**
     * The act is on its way: the dialog says so (`doing`, once, under the plan). It cannot be
     * dismissed into a lost result: with no `leave` it stays until the act answers. `leave` is for
     * a place that tells the result elsewhere when the dialog is gone (the toaster): the line that
     * says so ("You can close this; stopping continues."), with Close on, and `onClose` is then
     * called while the act runs. An empty `leave` is Close with no line: the button says it.
     */
    | { kind: "running"; doing: string; leave?: string }
    /**
     * The act's result. `tone: "unknown"` is a result that is NOT CONFIRMED (an answer that was
     * lost): neither done nor failed, drawn as such, with the next step ("Check again") in
     * `actions`. `code` is the kernel's or the plugin's code, after the words.
     */
    | { kind: "done"; tone?: "done" | "unknown"; title: string; lines?: readonly string[]; code?: string | null; actions?: ReactNode }
    /** A refusal or a failure: a person's words (`title`, `refusal`), then the kernel's code (`code`, or leading `refusal`), and the next step. */
    | { kind: "failed"; title: string; refusal: string; code?: string | null; actions?: ReactNode };
  onConfirm: () => void;
  /** Cancel before the act, Close after it. Not called while the act runs, unless the running phase has `leave`. */
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
};

export function Confirm({ title, about, shownFor, says = [], saysWarns = false, happens = [], kept = [], notice, children, confirmLabel, destructive = false, blocked = null, held = false, phase, onConfirm, onClose, returnFocus }: ConfirmProps) {
  const running = phase.kind === "running";
  const settled = phase.kind === "done" || phase.kind === "failed";
  const mismatch = shownFor !== null && shownFor !== about;
  // A plan that names no agent proves nothing about whose it is: it cannot be confirmed either.
  const unnamed = phase.kind === "ready" && shownFor === null;
  const off = phase.kind !== "ready" || mismatch || unnamed || blocked !== null || held;
  const why = unnamed ? "OATS did not say which agent this plan is for." : blocked;
  const leave = phase.kind === "running" ? (phase.leave ?? null) : null;
  const close = () => {
    if (!running || leave !== null) onClose();
  };
  // The focus never falls out of the dialog when the act starts or ends: the button that held it
  // goes off, or goes away. It moves to Close once there is a result, and to the dialog meanwhile.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]');
    if (dialog === null || dialog === undefined) return;
    const held = document.activeElement;
    const lost = !(held instanceof HTMLElement) || !dialog.contains(held) || (held instanceof HTMLButtonElement && held.disabled);
    if (settled) dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // While the act runs: on Close where the dialog can be left (Cancel went and Close came), else on the dialog itself.
    // (Also when the focus is on the dialog itself: a dialog that opens on a running act puts it there.)
    else if (lost || held === dialog) (dialog.querySelector<HTMLElement>('[data-testid="oats-confirm-leave"]') ?? dialog).focus();
  }, [phase.kind, settled]);
  const sentences = (title: string, lines: readonly string[]) =>
    lines.length === 0 ? null : (
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <ul className="flex flex-col gap-1">
          {lines.map((line, index) => (
            <li key={index} className="break-words">
              {shown(line)}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <Modal
      title={title}
      onCancel={close}
      returnFocus={returnFocus}
      footer={
        settled ? (
          <Button data-testid="oats-confirm-close" data-autofocus="" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            {why === null || phase.kind !== "ready" ? null : (
              <span data-testid="oats-confirm-blocked" className="mr-auto self-center text-xs text-muted-foreground">
                {/* A reason can hold text of OATS or an agent (a branch's name): filtered here, as every line of the pattern. */}
                {shown(why)}
              </span>
            )}
            {leave !== null ? (
              // The act runs on without the dialog: Close, not Cancel (nothing is cancelled).
              <Button data-testid="oats-confirm-leave" onClick={close}>
                Close
              </Button>
            ) : (
              <Button data-testid="oats-confirm-cancel" disabled={running} {...(destructive ? { "data-autofocus": "" } : {})} onClick={close}>
                Cancel
              </Button>
            )}
            <Button data-testid="oats-confirm-act" variant={destructive ? "destructive" : "primary"} disabled={off} {...(destructive ? {} : { "data-autofocus": "" })} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div ref={body} data-testid="oats-confirm" data-about={about} data-phase={phase.kind} className="flex flex-col gap-3">
        {mismatch ? (
          <Result title="This is not the plan for this agent." tone="failed">
            <p>{`OATS answered for ${shown(shownFor)}. Nothing was done.`}</p>
          </Result>
        ) : phase.kind === "reading" ? (
          <Loading>{phase.text ?? "Reading the plan from OATS…"}</Loading>
        ) : phase.kind === "done" ? null : (
          <>
            {phase.kind === "ready" ? notice : null}
            {says.length === 0 ? null : (
              <ul data-testid="oats-confirm-says" className="flex flex-col gap-1">
                {says.map((line, index) => (
                  <li key={index} {...(index === 0 && saysWarns ? { "data-tone": "warning", className: "break-words font-semibold text-warning-text" } : { className: "break-words" })}>
                    {shown(line)}
                  </li>
                ))}
              </ul>
            )}
            {sentences("What will happen", happens)}
            {sentences("What is kept", kept)}
            {children}
          </>
        )}
        {phase.kind === "running" ? (
          // One block: a place that brings the running line on screen brings the way out with it.
          <div data-testid="oats-confirm-running" className="flex flex-col gap-1">
            <Loading>{phase.doing}</Loading>
            {leave === null || leave === "" ? null : (
              <p data-testid="oats-confirm-leave-line" className="text-xs text-muted-foreground">
                {leave}
              </p>
            )}
          </div>
        ) : null}
        {phase.kind === "done" ? (
          <Result title={phase.title} tone={phase.tone ?? "done"} code={phase.code} actions={phase.actions}>
            {(phase.lines ?? []).map((line, index) => (
              <p key={index}>{shown(line)}</p>
            ))}
          </Result>
        ) : null}
        {phase.kind === "failed" ? (
          <Result title={phase.title} tone="failed" code={phase.code} actions={phase.actions}>
            <p className="text-muted-foreground">
              <Lines text={phase.refusal} />
            </p>
          </Result>
        ) : null}
      </div>
    </Modal>
  );
}
