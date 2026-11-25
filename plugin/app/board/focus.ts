// Where the focus lands when a place leads a person to an agent's open question on its Board tab
// (the thread line's "Answer"): the first option that can be pressed, else the question's zone
// itself, in the agent's PANEL (never a home's card). Once it is drawn: the panel may be opening,
// and the board is read. Tried for about a second, then left. (A leaf of the board: it imports
// nothing, so a feature the board itself imports can call it.)
export function focusBoardQuestion(tries = 10): void {
  const zone = document.querySelector<HTMLElement>('[data-testid="oats-panel"] [data-testid="oats-board-questions"]');
  if (zone !== null) {
    const target = zone.querySelector<HTMLElement>('[data-testid="oats-board-answer"]:not([disabled])') ?? zone;
    zone.scrollIntoView?.({ block: "nearest" });
    target.focus();
    return;
  }
  if (tries > 0) window.setTimeout(() => focusBoardQuestion(tries - 1), 100);
}
