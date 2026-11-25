// What a row says of an agent on ONE line that never wraps, "·" between its parts, in this order
// everywhere a row has them (the sidebar's row, bb's drawer, the home's rows and cards):
//   STATE · SOUL · REASON · where (bb's terminal glyph for an agent on tmux)
// (the lead's L16, 24 Nov 2026; a home row under a heading that says the state has no state part).
// What gives way, in this order, only when the line does not fit:
//   1. the REASON shortens with "…";
//   2. if it still does not fit, the reason LEAVES the row (it stays whole on the thread's line, on
//      the agent's page, and in the line's title, which always says all of it);
//   3. only then the SOUL shortens with "…".
// The state's word and the glyph never shrink and are never pushed out. Why: on a roster where
// every session was lost the reason is the same on every row, and the soul tells the rows apart.
// ONE GUARD: a reason in the WARNING tone asks a person to look, so it is not the first to go:
// there the soul gives way, and the reason stays whole.
//
// Step 2 cannot be done by shrinking: it is a MEASURED fit. The line measures itself (its own
// width, and the widths of its own parts), so it holds at every depth of the tree and at every
// width with no number per depth.
import { useLayoutEffect, useRef, useState } from "react";
import { TMUX, TmuxMark } from "./tmux";

/** The least room a shortened reason is worth, in the line's own em: a few letters and the "…". Under it the reason leaves. */
export const REASON_MIN_EM = 4;

/**
 * Whether the reason stays on the line. Pure. `line`: the line's width; `others`: the width of
 * every other part at its FULL size (the state, the soul unshortened, the glyph, the separators,
 * the reason's own separator among them); `reason`: the reason's full width; `least`: the least
 * room a shortened reason is worth. It stays when the room left for it holds it whole, or holds
 * at least `least` of it (it is then shortened with "…").
 */
export function reasonStays({ line, others, reason, least }: { line: number; others: number; reason: number; least: number }): boolean {
  return line - others >= Math.min(reason, least);
}

const outer = (element: Element): number => {
  const style = getComputedStyle(element);
  return element.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
};

export function RowFacts({
  testId,
  state,
  soul,
  reason = null,
  reasonTone,
  where,
  said: whole,
  className = "",
}: {
  testId: string;
  /** The state's word; absent on a row under a heading that says it. */
  state?: string;
  soul: string;
  /** What happened to the agent outside OATS, in two or three words; null or "": none. */
  reason?: string | null;
  /** "warning": the reason asks a person to look: it never leaves, and the soul gives way first. */
  reasonTone?: "warning" | undefined;
  /** Where it is, for an agent on tmux: `TMUX` draws bb's terminal glyph. */
  where?: string;
  /** What the line's TITLE says in the state's and the reason's place, where the row draws other words for them (a lost session: "Lost" on the row, "Stopped · session lost" in its title). */
  said?: { state?: string; reason: string | null };
  className?: string;
}) {
  const line = useRef<HTMLSpanElement>(null);
  const said = reason !== null && reason !== "";
  const warns = reasonTone === "warning";
  // Whether the reason left the row; and the reason's full width as last measured while it was drawn, for the text it was.
  const [left, setLeft] = useState(false);
  const known = useRef<{ text: string; width: number; sep: number } | null>(null);
  useLayoutEffect(() => {
    const element = line.current;
    if (element === null || !said || warns) {
      if (left) setLeft(false);
      return;
    }
    const measure = () => {
      const drawn = element.querySelector<HTMLElement>('[data-phrase="reason"]');
      const sep = element.querySelector<HTMLElement>('[data-sep="reason"]');
      if (drawn !== null && sep !== null) known.current = { text: reason, width: drawn.scrollWidth, sep: outer(sep) };
      const full = known.current !== null && known.current.text === reason ? known.current : null;
      // Not measured for this reason yet: drawn first, measured then. With no layout (nothing is drawn: a test's DOM) it stays.
      if (full === null || element.clientWidth === 0) {
        setLeft(false);
        return;
      }
      let others = full.sep;
      for (const part of Array.from(element.children)) {
        if (part === drawn || part === sep) continue;
        // The soul at its full size, shortened or not: it gives way only after the reason has left.
        others += part.getAttribute("data-phrase") === "soul" ? part.scrollWidth : outer(part);
      }
      const least = REASON_MIN_EM * (parseFloat(getComputedStyle(element).fontSize) || 12);
      setLeft(!reasonStays({ line: element.clientWidth, others, reason: full.width, least }));
    };
    measure();
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sized?.observe(element);
    return () => sized?.disconnect();
  }, [said, warns, left, reason, state, soul, where]);

  const shownReason = said && !left;
  const title = [whole === undefined ? state : whole.state, soul, whole === undefined ? (said ? reason : null) : whole.reason, where].filter((part) => part !== undefined && part !== null && part !== "").join(" · ");
  const sep = (of: string) => (
    <span data-sep={of} className="shrink-0 whitespace-pre">
      {" · "}
    </span>
  );
  return (
    <span ref={line} data-testid={testId} data-reason={!said ? undefined : left ? "left" : "shown"} title={title} className={`flex min-w-0 overflow-hidden whitespace-nowrap text-xs text-muted-foreground ${className}`}>
      {state === undefined ? null : (
        <>
          <span data-phrase="state" className="shrink-0">
            {state}
          </span>
          {/* (The line says only the row's own agent: what a closed parent hides is marked on its chevron, app/roster/fold.tsx.) */}
          {sep("soul")}
        </>
      )}
      {/* The soul shortens only where no reason is on the line to give way before it: none, one that left, or one that warns. */}
      <span data-phrase="soul" className={shownReason && !warns ? "shrink-0" : "min-w-[1.5em] shrink truncate"}>
        {soul}
      </span>
      {shownReason ? (
        <>
          {sep("reason")}
          <span data-phrase="reason" data-tone={warns ? "warning" : undefined} className={warns ? "shrink-0" : "min-w-0 shrink truncate"}>
            {reason}
          </span>
        </>
      ) : null}
      {where === undefined ? null : (
        <>
          {sep("where")}
          <span data-phrase="where" className="shrink-0">
            {where === TMUX ? <TmuxMark /> : where}
          </span>
        </>
      )}
    </span>
  );
}
