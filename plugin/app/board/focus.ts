// Where the focus lands when a place leads a person to an agent's open question on its Board tab
// (the thread line's "Answer"): on the question's ZONE, in the agent's PANEL (never a home's card).
// NEVER ON AN OPTION: the focus does not land by itself on a control whose press sends (an Enter
// held on "Answer", or pressed twice, would send the first option of a question nobody has read).
// In the zone the arrow keys turn the questions, and one Tab reaches the first option. Once it is
// drawn: the panel may be opening, and the board is read. Tried for about a second, then left.
// (A leaf of the board: it imports nothing, so a feature the board itself imports can call it.)
export function focusBoardQuestion(tries = 10): void {
  const zone = document.querySelector<HTMLElement>('[data-testid="oats-panel"] [data-testid="oats-board-questions"]');
  if (zone !== null) {
    zone.scrollIntoView?.({ block: "nearest" });
    zone.focus();
    return;
  }
  if (tries > 0) window.setTimeout(() => focusBoardQuestion(tries - 1), 100);
}
