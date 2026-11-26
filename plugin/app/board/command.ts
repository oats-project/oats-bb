// The board's ONE command: "Board", for the agent of the thread in view. bb takes a plugin's
// commands once, when it starts, with titles that never change: so there is one, with a fixed
// title, and nothing per question. bb asks whether it applies, and runs it, outside React, with
// the thread in view and that surface's side panel alone: it is listed only on an agent's thread
// whose row says the agent has a board (a fact or an open question), and it turns the agent's
// panel to Board, the focus on the tab. On a plugin's page there is no thread in view (the
// agent's own page shows its Board tab already), so it is not listed there, nor at the phone's
// width, where bb has no side panel.
import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { nodeIn } from "../lifecycle";
import { showPanelTab } from "../panel/Panel";
import { HOME_TAB } from "../roster/IdentityRow";
import { focusBoardQuestion } from "./focus";
import { BOARD } from "./words";

export const command: PluginCommandRegistration = {
  id: "agent-board",
  title: BOARD.tab,
  isAvailable: (context) => nodeIn(context.threadId)?.agent.hasBoard === true,
  run: (context) => {
    const agent = nodeIn(context.threadId)?.agent;
    if (agent === undefined || agent.hasBoard !== true) return;
    // The tab first: the panel that opens now opens on it (the press is FOR this agent), and one that is open turns to
    // it. Where the board asks, the focus goes to the question's ZONE once it is drawn (never to an option: the focus
    // does not land by itself on a control that sends); a board with facts alone has nothing to answer: the tab.
    const asks = agent.boardAsks === true;
    showPanelTab("board", { focus: !asks, for: agent.instance });
    context.experimental_panel.openTab({ tab: HOME_TAB });
    if (asks) focusBoardQuestion();
  },
};
