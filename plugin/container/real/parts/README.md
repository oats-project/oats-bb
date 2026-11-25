# Parts of the real run

`scenario.mjs` runs, after its own parts A and B, the default export of every `<feature>.mjs`
here, in the files' order: `export default async (run) => { … }`. `run` holds the scenario's
helpers (`step`, `check`, `rpc`, `act`, `recorded`, `refused`, `oats`, `status`, `rowOf`,
`fixtures`, `evidence`, `browser`, …: the list is where `scenario.mjs` loads the parts).

A feature adds one check here for each act it adds to the plugin: the act goes through the plugin's
RPC (`run.act`), the kernel's state is read after it (`run.status()`), and what the kernel printed
is kept as the feature's fixture (`run.fixtures.keep("<feature>/<name>.json", run.recorded(…).stdout)`).

A feature also takes the images of its own screens here, on the run's real agents, so that a
piece's image set holds real-run images of what it changes:
`await run.views("<scene>", async ({ page, at, viewport, theme, shot }) => { … })` calls the
function once per view (bb's light and dark themes, at each width) with a page of that view;
navigate, wait on what is read (`page.until`), check it (`run.check(ok, \`${at} …\`, whatRead)`),
then `await shot("<name>")`, which saves `<scene>-<width>x<height>-<name>[-dark].png` with the
run's other images. One state per scene, the same in both themes.

The order is the files' order, and two parts depend on it: `on-tmux.mjs` (a tmux agent's
terminal) runs after `lost.mjs`, which prepares the container for an agent on tmux; and
`tagged.mjs` must stay the last. It pins
the run's provider by a scratch tag, so that the kernel prints a release's version for it, and
every read of a later part would see that pin. A part's images need a scene name of their own
(the run's end compares all images: two scenes of different states must not be the same image),
and a part that changes the recording wrapper's delays puts them back (`wrapper({})`).

