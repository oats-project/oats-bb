// The pages the plugin's setting `pages` shows where it is not set: ONE list, read by the server
// (the setting's declared default, which bb shows in the field: server/core.ts) and by the app
// (what an unset or cleared value stands for: app/workspace/pages.ts). The home, and the Workspace
// page's four tabs; Automations is not in it.
export const DEFAULT_PAGES = "home, souls, capabilities, teams, machines";
