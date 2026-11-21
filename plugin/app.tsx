// bb.app: the OATS plugin's web UI. This file only calls each feature's `register(app)`
// (app/<feature>/index): the slots a feature registers and what they draw are in its directory;
// what they draw from is in model/ (pure), app/oats.ts and app/store.ts (the plugin's reads), and
// what they are drawn with is in app/ui.tsx and app/ui/.
// A new feature adds its directory and one line below; a slot is registered in the feature's own
// `register`. The order is the order bb lists the slots in.
//
// Icon names: each one a feature uses was checked at runtime on bb-app 0.50.1. bb draws its generic
// glyph for a name its set does not resolve, and says nothing (`Users`, `Monitor`, `Diamond`,
// `Hexagon`, `RotateCw`, `CircleStop` do not resolve). Check a new name in the running app before
// using it.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import * as automations from "./app/automations";
import * as home from "./app/home";
import * as lifecycle from "./app/lifecycle";
import * as panel from "./app/panel";
import * as roster from "./app/roster";
import * as spawn from "./app/spawn";
import * as workspace from "./app/workspace";

export default definePluginApp((app) => {
  roster.register(app);
  home.register(app);
  workspace.register(app);
  spawn.register(app);
  lifecycle.register(app);
  automations.register(app);
  panel.register(app);
});
