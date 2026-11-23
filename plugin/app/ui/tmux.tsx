// "tmux", where an agent runs: bb's own terminal glyph with the accessible name "tmux", on a row
// (the sidebar's, the home's). No icon is drawn by the plugin: the glyph is the one bb's icon set
// holds under the name "Terminal" (bb-app 0.50.1; the SDK's `experimental_Icon` draws a name of
// that set). bb draws its generic glyph for a name its set does not resolve, and says nothing: so
// the mark looks once, where it is first drawn, whether "Terminal" draws the same thing as a name
// no set holds. If it does (a bb whose set has no such glyph), the WORD "tmux" stands in its place.
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

/** The name of the glyph in bb's icon set, and a name no set holds (for the look at what bb draws for one). */
export const TMUX_ICON = "Terminal";
const NO_ICON = "OatsNoSuchIcon";
export const TMUX = "tmux";

/** Whether bb's set has the glyph: null until the first mark has looked. One answer for the window. */
let resolved: boolean | null = null;
const watchers = new Set<() => void>();
const settle = (answer: boolean) => {
  if (resolved === answer) return;
  resolved = answer;
  for (const watcher of watchers) watcher();
};

/**
 * Where an agent on tmux runs, in a row: the glyph, named "tmux" for a screen reader and on hover;
 * the word where bb's set has no such glyph. `data-tmux` says which is drawn ("glyph", "word").
 */
export function TmuxMark() {
  const glyph = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const has = useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => resolved,
  );
  useLayoutEffect(() => {
    if (resolved !== null || glyph.current === null || probe.current === null) return;
    // The same drawing for "Terminal" as for a name no set holds: bb's generic glyph, so no terminal glyph.
    settle(glyph.current.innerHTML !== "" && glyph.current.innerHTML !== probe.current.innerHTML.replaceAll(NO_ICON, TMUX_ICON));
  });
  if (has === false) {
    return (
      <span data-testid="oats-tmux" data-tmux="word">
        {TMUX}
      </span>
    );
  }
  return (
    <span data-testid="oats-tmux" data-tmux="glyph" role="img" aria-label={TMUX} title={TMUX} className="inline-flex items-center align-middle">
      <span ref={glyph} aria-hidden="true" className="inline-flex">
        <Icon name={TMUX_ICON} className="size-3.5" />
      </span>
      {/* Looked at once, never seen: what bb draws for a name its set does not hold. */}
      {has === null ? (
        <span ref={probe} hidden aria-hidden="true" data-testid="oats-tmux-probe">
          <Icon name={NO_ICON} className="size-3.5" />
        </span>
      ) : null}
    </span>
  );
}

/** For a test: the answer is looked for again. */
export function forgetTmuxGlyph(): void {
  resolved = null;
}
