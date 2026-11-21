# Parts of the real run

`scenario.mjs` runs, after its own parts A and B, the default export of every `<feature>.mjs`
here, in the files' order: `export default async (run) => { … }`. `run` holds the scenario's
helpers (`step`, `check`, `rpc`, `act`, `recorded`, `refused`, `oats`, `status`, `rowOf`,
`fixtures`, `evidence`, `browser`, …: the list is where `scenario.mjs` loads the parts).

A feature adds one check here for each act it adds to the plugin: the act goes through the plugin's
RPC (`run.act`), the kernel's state is read after it (`run.status()`), and what the kernel printed
is kept as the feature's fixture (`run.fixtures.keep("<feature>/<name>.json", run.recorded(…).stdout)`).
