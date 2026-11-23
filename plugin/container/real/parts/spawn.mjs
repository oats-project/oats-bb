// Spawn's part of the real run (parts/README.md). The scenario's own part A spawns an agent
// through the plugin; this part holds what the New agent form adds to that: the harnesses the bb
// session provider declares, as the plugin reads them for the form and for the Start and Restart
// dialogs (`oats capabilities show oats.bb --json`), kept as the feature's fixture.
export default async (run) => {
  const { step, check, act, recorded, fixtures } = run;

  step("Spawn: the harnesses the bb session provider declares, read through the plugin");
  const list = act("the provider's harnesses", "spawnHarnesses", null);
  const call = recorded(["capabilities", "show"]);
  check(JSON.stringify(call.argv) === JSON.stringify(["capabilities", "show", "oats.bb", "--json"]), "the plugin asked the kernel for the bb capability as the deployment resolves it, and nothing else", JSON.stringify(call.argv));
  const declared = JSON.parse(call.stdout).result?.sessionProviders?.bb?.harnesses;
  check(Array.isArray(declared) && declared.length > 0 && JSON.stringify(list?.harnesses) === JSON.stringify(declared), "the plugin's list is the one the provider's manifest declares, in its order", JSON.stringify({ plugin: list?.harnesses, kernel: declared }));
  check(typeof list?.hostId === "string" && list.hostId !== "", "with the bb machine that holds the deployment, where bb's own model list is asked", JSON.stringify(list?.hostId));
  fixtures.keep("spawn/capabilities-show-bb.json", call.stdout);
};
