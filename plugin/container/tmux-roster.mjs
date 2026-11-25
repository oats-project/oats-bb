// The agents of the live stage "tmux-roster" (live-ui.mjs `tmuxRoster` builds their rows; scenes/roster.mjs reads what is drawn of them).
export const TMUX_ROSTER = {
  bb: ["release-070-maintainer", "redesign-ui-lead", "desktop-mockups-developer"],
  // One agent on a bb thread carries a long name in this stage, longer than two lines of a row, so that a SELECTED row with a name on two lines, cut after the second, is drawn.
  renamed: { "desktop-mockups-developer": "desktop-mockups-developer-for-the-overnight-redesign-sweep-of-every-page-panel-and-dialog" },
  tmux: [
    // [instance, soul, parent, how]: "running", "waiting" (running, with a claim), "stopped" (stopped with OATS) or "lost" (its session ended without OATS stopping it: the row a host that was restarted prints for every tmux agent)
    ["kernel-fix-developer", "oats-developer", null, "running"],
    ["bb-plugin-lead", "oats-product-expert", null, "waiting"],
    ["bb-plugin-roster-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["bb-plugin-panel-developer", "oats-developer", "bb-plugin-lead", "waiting"],
    ["bb-plugin-dialogs-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["bb-plugin-form-developer", "oats-developer", "bb-plugin-lead", "stopped"],
    ["bb-plugin-outside-developer", "oats-developer", "bb-plugin-lead", "running"],
    ["roster-round-3-reviewer", "oats-developer", "bb-plugin-roster-developer", "lost"],
    ["setup-maintainer", "oats-maintainer", null, "waiting"],
    ["release-notes-helper", "oats-maintainer", "setup-maintainer", "running"],
    ["catalog-pins-helper", "oats-maintainer", "setup-maintainer", "stopped"],
    ["desktop-sidebar-developer", "oats-desktop-developer", null, "running"],
    ["desktop-terminal-developer", "oats-desktop-developer", null, "running"],
    ["desktop-overnight-sweep-with-a-long-name-helper", "oats-desktop-developer", "desktop-sidebar-developer", "waiting"],
    ["knowledge-weekly-harvester", "knowledge-harvester", null, "running"],
    ["knowledge-backfill-helper", "knowledge-harvester", "knowledge-weekly-harvester", "lost"],
    ["ranker-v4-probe", "research-expert", null, "running"],
    ["ranker-ablation-probe", "research-expert", null, "waiting"],
    ["docs-site-expert", "oats-expert", null, "running"],
    ["overnight-sweep-developer", "oats-contrib-developer", null, "lost"], // (a long soul: the longest row there is, "Stopped · session lost · <soul> · <glyph>")
  ],
};

// The pilot's own roster SHAPE, for a scene of the stage "tmux-roster" (scenes/roster.mjs): eight
// agents on tmux and none on a bb thread, every session lost (what a host that was restarted
// prints), one of them a child of another. The names are made up: the shape alone is the pilot's.
export const PILOT_ROSTER = {
  bb: [],
  renamed: {},
  tmux: [
    ["alder-lead", "oats-product-expert", null, "lost"],
    ["birch-developer", "oats-developer", null, "lost"],
    ["cedar-developer", "oats-developer", null, "lost"],
    ["dogwood-maintainer", "oats-maintainer", null, "lost"],
    ["elm-reviewer", "oats-developer", "cedar-developer", "lost"],
    ["fir-helper", "knowledge-harvester", null, "lost"],
    ["gorse-probe", "research-expert", null, "lost"],
    ["hazel-developer", "oats-desktop-developer", null, "lost"],
  ],
};
