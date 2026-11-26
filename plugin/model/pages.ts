// The pages the plugin's setting `pages` shows where it is not set: ONE list, read by the server
// (the setting's declared default, which bb shows in the field: server/core.ts) and by the app
// (what an unset or cleared value stands for: app/workspace/pages.ts). The home, and the Workspace
// page's four tabs, and Automations: every page the plugin has.
export const DEFAULT_PAGES = "home, automations, souls, capabilities, teams, machines";
