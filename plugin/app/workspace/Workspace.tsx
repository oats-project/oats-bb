// The Workspace page's frame: its tab strip (Souls, Capabilities, Teams, Machines: the tabs this
// release shows, in the Desktop's order, Souls and Capabilities with their count as the Desktop's
// tabs have it) over the tab's own content. A tab is a route: a press navigates.
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useRead } from "../store";
import type { Oats } from "../oats";
import { RosterNotice } from "../roster/unreadable";
import { shown } from "../ui/text";
import { Button, Loading, Notice, Page, Tabs } from "../ui";
import type { TabItem } from "../ui";
import { PAGES, usePagesShown } from "./pages";
import type { WorkspaceTab } from "./pages";

const PANEL = "oats-workspace-panel";

export function Frame({ tab, testId, children }: { tab: WorkspaceTab; /** the tab's own test id (`oats-souls-page`, …) */ testId: string; children: ReactNode }) {
  const navigate = useBbNavigate();
  const pages = usePagesShown();
  // The counts are the tabs' own reads (one read per method for the whole window: the tab that is open shares it).
  const souls = useRead("souls", { enabled: pages.has("souls") }).data?.souls.length;
  const capabilities = useRead("capabilities", { enabled: pages.has("capabilities") }).data?.capabilities.length;
  const counts: Partial<Record<WorkspaceTab, number | undefined>> = { souls, capabilities };
  const tabs: TabItem<WorkspaceTab>[] = PAGES.filter((page) => pages.has(page.path)).map((page) => {
    const n = counts[page.path];
    return { id: page.path, label: page.title, ...(n === undefined ? {} : { count: n }) };
  });
  return (
    <Page testId={testId}>
      {/* One tab alone is no strip: the page is that tab. */}
      {tabs.length > 1 ? <Tabs label="Workspace" tabs={tabs} value={tab} onChange={(id) => navigate.toPluginPanel(id)} panelId={PANEL} /> : null}
      <div id={PANEL} role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `${PANEL}-tab-${tab}` : undefined} className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </Page>
  );
}

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
  return (
    <>
      {roster ? <RosterNotice oats={oats} /> : null}
      {read.status === "error" && !unread ? (
        <Notice title="OATS could not be read" tone="error" details={read.error} actions={<Button data-testid="oats-read-retry" onClick={read.retry}>Retry</Button>} />
      ) : read.data === undefined && read.status === "loading" ? (
        <Loading>Reading…</Loading>
      ) : null}
    </>
  );
}

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
      const room = element.clientWidth;
      const pen = room === 0 ? null : document.createElement("canvas").getContext("2d");
      if (pen === null) return setFits(null);
      pen.font = getComputedStyle(element).font;
      const wide = (words: string) => pen.measureText(words).width;
      if (wide(whole) <= room) return setFits(null);
      const words = whole.split(" ");
      // The most words that fit with "…" after them.
      let low = 0;
      let high = words.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (wide(`${words.slice(0, middle).join(" ")}…`) <= room) low = middle;
        else high = middle - 1;
      }
      setFits(low === 0 ? null : `${words.slice(0, low).join(" ").replace(/[\s,;:.(-]+$/, "")}…`);
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
