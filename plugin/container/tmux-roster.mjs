// The agents of the live stage "tmux-roster" (live-ui.mjs `tmuxRoster` builds their rows; scenes/roster.mjs reads what is drawn of them).
export const TMUX_ROSTER = {
  bb: ["release-070-maintainer", "redesign-ui-lead", "desktop-mockups-developer"],
  tmux: [
    // [instance, soul, parent, "waiting" | "stopped" | "running"]
    ["kernel-fix-developer", "oats-developer", null, "running"],
    ["bb-plugin-lead", "oats-product-expert", null, "waiting"],
    ["bb-plugin-roster-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["bb-plugin-panel-developer", "oats-developer", "bb-plugin-lead", "waiting"],
    ["bb-plugin-dialogs-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["bb-plugin-form-developer", "oats-developer", "bb-plugin-lead", "stopped"],
    ["bb-plugin-outside-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["roster-round-3-reviewer", "oats-developer", "bb-plugin-roster-developer", "stopped"],
    ["setup-maintainer", "oats-maintainer", null, "waiting"],
    ["release-notes-helper", "oats-maintainer", "setup-maintainer", "running"],
    ["catalog-pins-helper", "oats-maintainer", "setup-maintainer", "stopped"],
    ["desktop-sidebar-developer", "oats-desktop-developer", null, "running"],
    ["desktop-terminal-developer", "oats-desktop-developer", null, "running"],
    ["desktop-overnight-sweep-with-a-long-name-helper", "oats-desktop-developer", "desktop-sidebar-developer", "waiting"],
    ["knowledge-weekly-harvester", "knowledge-harvester", null, "running"],
    ["knowledge-backfill-helper", "knowledge-harvester", "knowledge-weekly-harvester", "stopped"],
    ["ranker-v4-probe", "research-expert", null, "running"],
    ["ranker-ablation-probe", "research-expert", null, "waiting"],
    ["docs-site-expert", "oats-expert", null, "running"],
  ],
};
