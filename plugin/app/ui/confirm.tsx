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
  /** "What will happen", as sentences about the named agent; and what is kept. Text from OATS is filtered here. */
  happens: readonly string[];
  kept?: readonly string[];
  /** More of the dialog's own (a field, a tick), under the sentences. */
  children?: ReactNode;
  /** The primary button, named for the act: "Retire", "Stop". `destructive`: the focus starts on Cancel. */
  confirmLabel: string;
  destructive?: boolean;
  /** Why the primary button is off, in words, beside it; null when it can be pressed. */
  blocked?: string | null;
  phase:
    | { kind: "reading" }
    | { kind: "ready" }
    /** The act is on its way: the dialog says so and cannot be dismissed into a lost result. */
    | { kind: "running"; doing: string }
    | { kind: "done"; title: string; lines?: readonly string[]; actions?: ReactNode }
    /** A refusal or a failure: a person's words (`title`), then the kernel's code and message, and the next step. */
    | { kind: "failed"; title: string; refusal: string; actions?: ReactNode };
  onConfirm: () => void;
  /** Cancel before the act, Close after it. Not called while the act runs. */
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
};

export function Confirm({ title, about, shownFor, happens, kept = [], children, confirmLabel, destructive = false, blocked = null, phase, onConfirm, onClose, returnFocus }: ConfirmProps) {
  const running = phase.kind === "running";
  const settled = phase.kind === "done" || phase.kind === "failed";
  const mismatch = shownFor !== null && shownFor !== about;
  // A plan that names no agent proves nothing about whose it is: it cannot be confirmed either.
  const unnamed = phase.kind === "ready" && shownFor === null;
  const off = phase.kind !== "ready" || mismatch || unnamed || blocked !== null;
  const why = unnamed ? "OATS did not say which agent this plan is for." : blocked;
  const close = () => {
    if (!running) onClose();
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
    else if (lost) dialog.focus();
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
                {why}
              </span>
            )}
            <Button data-testid="oats-confirm-cancel" disabled={running} {...(destructive ? { "data-autofocus": "" } : {})} onClick={close}>
              Cancel
            </Button>
            <Button data-testid="oats-confirm-act" variant={destructive ? "destructive" : "primary"} disabled={off} {...(destructive ? {} : { "data-autofocus": "" })} onClick={onConfirm}>
              {running ? phase.doing : confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div ref={body} data-testid="oats-confirm" data-about={about} data-phase={phase.kind} className="flex flex-col gap-3">
        {mismatch ? (
          <Result title="This is not the plan for this agent." tone="failed">
            <p>{`OATS answered for ${shown(shownFor)}, not for ${shown(about)}. Nothing was done. Close this and ask again.`}</p>
          </Result>
        ) : phase.kind === "reading" ? (
          <Loading>Reading the plan from OATS…</Loading>
        ) : phase.kind === "done" ? null : (
          <>
            {sentences("What will happen", happens)}
            {sentences("What is kept", kept)}
            {children}
          </>
        )}
        {phase.kind === "running" ? <Loading>{phase.doing}</Loading> : null}
        {phase.kind === "done" ? (
          <Result title={phase.title} actions={phase.actions}>
            {(phase.lines ?? []).map((line, index) => (
              <p key={index}>{shown(line)}</p>
            ))}
          </Result>
        ) : null}
        {phase.kind === "failed" ? (
          <Result title={phase.title} tone="failed" actions={phase.actions}>
            <p className="text-muted-foreground">
              <Lines text={phase.refusal} />
            </p>
          </Result>
        ) : null}
      </div>
    </Modal>
  );
}
