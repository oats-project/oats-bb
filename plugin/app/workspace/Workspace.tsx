// The Workspace page's frame: its tab strip (Souls, Capabilities, Teams, Machines: the tabs this
// release shows, in the Desktop's order, Souls and Capabilities with their count as the Desktop's
// tabs have it) over the tab's own content. A tab is a route: a press navigates.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { onWindowReset, useRead } from "../store";
import type { Oats } from "../oats";
import { RosterNotice } from "../roster/unreadable";
import { shown } from "../ui/text";
import { Button, Loading, Mark, Notice, Page, Tabs } from "../ui";
import type { TabItem } from "../ui";
import { PAGES, usePagesShown } from "./pages";
import type { WorkspaceTab } from "./pages";

const PANEL = "oats-workspace-panel";

/**
 * The strip held the focus when a tab was last chosen. A tab is a ROUTE, and each route is a page of
 * its own: choosing one takes the strip that held the focus out of the page, and the keyboard would
 * be left nowhere (Left and Right would move one tab and stop). The tab's page that is drawn next
 * puts the focus on its own selected tab.
 */
let stripHeldFocus = false;
onWindowReset(() => {
  stripHeldFocus = false;
});

/** The kernel's code for a team that has no id on the messaging provider yet (`oats teams`' problems). */
export const TEAM_UNMAPPED = "team-unmapped";

export function Frame({ tab, testId, found, head, children }: { tab: WorkspaceTab; /** the tab's own test id (`oats-souls-page`, …) */ testId: string; /** how many rows the tab shows now, where a search narrows it: its count then reads "N of M" */ found?: number; /** what stays with the strip at the page's top while the rows scroll under it: the tab's search field */ head?: ReactNode; children: ReactNode }) {
  const navigate = useBbNavigate();
  const pages = usePagesShown();
  // The counts are the tabs' own reads (one read per method for the whole window: the tab that is open shares it).
  const souls = useRead("souls", { enabled: pages.has("souls") }).data?.souls.length;
  const capabilities = useRead("capabilities", { enabled: pages.has("capabilities") }).data?.capabilities.length;
  // The Teams tab is marked while the default team has no address: nothing can be spawned until it has one (the Desktop's dot on that tab).
  const blocked = (useRead("teams", { enabled: pages.has("teams") }).data?.problems ?? []).some((problem) => problem.code === TEAM_UNMAPPED && problem.isDefault);
  const counts: Partial<Record<WorkspaceTab, number | undefined>> = { souls, capabilities };
  const tabs: TabItem<WorkspaceTab>[] = PAGES.filter((page) => pages.has(page.path)).map((page) => {
    const n = counts[page.path];
    const narrowed = page.path === tab && found !== undefined && n !== undefined && found !== n;
    return {
      id: page.path,
      label: page.title,
      ...(n === undefined || narrowed ? {} : { count: n }),
      ...(narrowed ? { mark: <span data-testid="oats-tab-found" className="font-normal text-muted-foreground">{`${found} of ${n}`}</span> } : {}),
      ...(page.path === "teams" && blocked ? { mark: <Mark label="Teams: the default team has no address yet" /> } : {}),
    };
  });
  useEffect(() => {
    const selected = document.getElementById(`${PANEL}-tab-${tab}`);
    // The strip scrolls sideways inside itself where its tabs do not fit (long counts at a phone's width): the selected tab is brought into view.
    selected?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (!stripHeldFocus) return;
    stripHeldFocus = false;
    selected?.focus();
  }, [tab]);
  return (
    <Page testId={testId}>
      {/* The strip, and the tab's search under it, stay at the page's top: the rows scroll under them (a long list
          never takes the controls off the screen). The head covers the page's own padding above it. */}
      <div data-testid="oats-workspace-head" className="sticky top-0 z-10 -mx-4 -mt-4 flex min-w-0 flex-col gap-3 bg-background px-4 pt-4 pb-1 empty:hidden">
      {/* One tab alone is no strip: the page is that tab. */}
      {tabs.length > 1 ? (
        <Tabs
          label="Workspace"
          tabs={tabs}
          value={tab}
          onChange={(id) => {
            if (id === tab) return;
            stripHeldFocus = document.activeElement?.getAttribute("role") === "tab";
            navigate.toPluginPanel(id);
          }}
          panelId={PANEL}
        />
      ) : null}
      {head ?? null}
      </div>
      <div id={PANEL} role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `${PANEL}-tab-${tab}` : undefined} className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </Page>
  );
}

/**
 * A capability's name as a list shows it: without OATS's own prefix ("aweb" for `oats.aweb`); another prefix stays.
 * The whole id is the row's title, and stands on the capability's own page.
 */
export const capabilityName = (id: string): string => (id.startsWith("oats.") && id.length > 5 ? id.slice(5) : id);
/** Capabilities in a list's order: the one most souls have first; of two that as many have, by their id. */
export const bySouls = <T extends { id: string; souls: number }>(capabilities: readonly T[]): T[] => [...capabilities].sort((a, b) => b.souls - a.souls || a.id.localeCompare(b.id));

/** From how many rows a list has a search field: a short list needs none (the ruling on the pages' audit). */
export const FILTER_FROM = 12;

/** Whether `text` holds every word of `query`, in any case: the lists' one rule for a search. */
export const matches = (query: string, ...texts: readonly (string | null | undefined)[]): boolean => {
  const whole = texts.filter((text): text is string => typeof text === "string").join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((word) => word !== "").every((word) => whole.includes(word));
};

/**
 * What a tab draws before its rows: the roster's ONE notice while OATS cannot be read (the counts
 * and the agents are then the last read); else, for the tab's own read: "Reading…" in the rows'
 * place, or, where that read failed, a notice in a person's words with Retry, the kernel's or the
 * host's own message one press away (never the raw message as the page's face). Null: the rows are
 * there to draw. One notice on a screen: while the roster's stands, the tab's own is not drawn.
 */
export function Before({ oats, read, roster = true }: { oats: Oats; read: { status: string; data: unknown; error: string | null; retry(): void }; /** false: the tab draws nothing of the roster, and says nothing of it */ roster?: boolean }) {
  const unread = roster && (oats.phase === "failed" || (oats.phase === "ready" && oats.stale !== null));
  // A read that failed is read again with every roster read, and on Retry. While that read is on its way the notice
  // STAYS, with what the last read said: it does not give way to "Reading…" and come back (a notice that blinks).
  // Only a notice that was DRAWN is kept: under the roster's own notice the tab draws none, so none appears, new and
  // with an old message, in the moment the roster is readable again and the tab's read is still on its way.
  const failed = useRef<string | null>(null);
  if (unread || read.data !== undefined) failed.current = null;
  if (read.status === "error" && !unread) failed.current = read.error ?? "";
  const error = read.status === "error" ? read.error : read.data === undefined ? failed.current : null;
  // The failed read is on its way again (a roster read, or Retry pressed): Retry is off until it answers, so a press is seen.
  const again = read.status === "loading" && error !== null;
  return (
    <>
      {roster ? <RosterNotice oats={oats} /> : null}
      {error !== null && !unread ? (
        <Notice title="OATS could not be read" tone="error" details={error} actions={<Button data-testid="oats-read-retry" disabled={again} onClick={read.retry}>Retry</Button>} />
      ) : read.data === undefined && read.status === "loading" ? (
        <Loading>Reading…</Loading>
      ) : null}
    </>
  );
}

/** A mark that would be left dangling before the "…": a space, a comma, an opening bracket or quote, a dash, a slash, a dot between facts. */
const DANGLING = /[\s,;:.([{\-–—/·"'“‘]+$/;
/**
 * As much of `text` as fits `room`, cut at a WORD with "…" after it; the whole text where it fits;
 * null where not even its first word does (the page then cuts it at the line's end). `wide` is the
 * width of a text in the line's own font. Pure: the lists' one rule for a one-line text.
 */
export function cutAtWord(text: string, room: number, wide: (words: string) => number): string | null {
  if (wide(text) <= room) return text;
  const words = text.split(" ");
  // The most words that fit with "…" after them.
  let low = 0;
  let high = words.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (wide(`${words.slice(0, middle).join(" ")}…`) <= room) low = middle;
    else high = middle - 1;
  }
  if (low === 0) return null;
  const kept = words.slice(0, low).join(" ").replace(DANGLING, "");
  return kept === "" ? null : `${kept}…`;
}

/** One pen for every line's measure (a canvas is never drawn: it only measures text). Null where the page cannot measure (no layout: a unit test). */
let pen: CanvasRenderingContext2D | null | undefined;
const penOf = (): CanvasRenderingContext2D | null => (pen === undefined ? (pen = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")) : pen);

/**
 * A text on ONE line of a list, as much of it as the line holds: where it does not fit it ends at a
 * WORD, with "…" (never mid-word: the ruling's R3); the whole text is the line's title, and is on
 * the thing's own page. The words that fit are measured (the line's own font, on a canvas) and
 * measured again when the line's width changes. Where nothing can be measured (no layout: a unit
 * test), and where not even the first word fits, the whole text is given to the page, which cuts it
 * at the line's end.
 */
export function OneLine({ text, testId }: { text: string; testId: string }) {
  const whole = shown(text);
  const line = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = line.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      // (`clientWidth` is rounded: one pixel less, so that a cut measured inside the rounding never passes the line's end.)
      const room = element.clientWidth - 1;
      const measure = room <= 0 ? null : penOf();
      if (measure === null) return setFits(null);
      measure.font = getComputedStyle(element).font;
      setFits(cutAtWord(whole, room, (words) => measure.measureText(words).width));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(element);
    return () => watch.disconnect();
  }, [whole]);
  return (
    <span ref={line} data-testid={testId} title={whole} className="block min-w-0 truncate text-xs text-muted-foreground">
      {fits ?? whole}
    </span>
  );
}
