// The terminal's words (the specialist's ruling of 25 Nov 2026). No tooltip, and no sentence about
// what a terminal is.
/** The button in the Session card of a tmux agent that runs, and the entry of its row's menu: bb's own word for that tab. */
export const TERMINAL = "Terminal";
/** The ONE line when the tab did not come up, in the warning tone; the fold under it says which it was. */
export const DID_NOT_OPEN = "Terminal did not open.";
/** Under Details: the command ended before it could be shown. `status` is the exit status bb gives; null where it gives none. */
export const endedSaid = (status: number | null): string => (status === null ? "The command ended at once." : `The command ended at once, with status ${status}.`);
/** Under Details: the command runs, and bb showed no tab for it (the plugin has closed it again). */
export const DECLINED_SAID = "bb did not show it.";
/** Under Details: the plugin's server, the machine or bb refused before a command ran: its own words follow. */
export const failedSaid = (message: string): string => message;
