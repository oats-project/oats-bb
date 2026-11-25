// The Workspace page's frame: its tab strip (Souls, Capabilities, Teams, Machines: the tabs this
// release shows, in the Desktop's order, Souls and Capabilities with their count as the Desktop's
// tabs have it) over the tab's own content. A tab is a route: a press navigates.
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useRead } from "../store";
import { Page, Tabs } from "../ui";
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
