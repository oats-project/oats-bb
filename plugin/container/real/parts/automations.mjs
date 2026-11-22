// Automations in the real run: the plugin's reads against the real kernel. A person adds a local
// schedule and a local trigger on the command line (the plugin's own acts are sub-pieces of their
// own); the plugin's lists hold them as the kernel's own `oats schedule list` and
// `oats trigger list` do, and a trigger's state is read for the id the list names.
//
// The feature's fixtures are not made here: they are a recording of their own, on a deployment
// with workspace automations, a trigger source and runs (test/fixtures/automations/record/).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default async (run) => {
  const { step, check, act, oats, recorded, rpc, OUT } = run;
  step("Automations: the lists and a trigger's state, read through the plugin");

  const file = (name, definition) => {
    const path = join(OUT, name);
    writeFileSync(path, JSON.stringify(definition));
    return path;
  };
  const added = (what, ...argv) => {
    const answer = oats(...argv);
    check(answer.exit === 0, `${what} (oats ${argv.slice(0, 3).join(" ")})`, answer.stdout + answer.stderr);
  };
  added("a person adds a local schedule that launches a bb agent", "schedule", "add", "real-run-digest", "--file",
    file("automations-schedule.json", { id: "real-run-digest", kind: "spawn", cron: "0 7 * * *", tz: "UTC", enabled: true, agent: "oats-developer", backend: "bb", yolo: true, description: "The real run's schedule", task: "Say hello, then stop." }), "--json");
  added("a person adds a local pull-request trigger", "trigger", "add", "--file",
    file("automations-trigger.json", { id: "real-run-prs", kind: "trigger", enabled: true, on: { source: "github.pull_request", repo: "github.com/acme/app", events: ["opened"], poll: "2m" }, spawn: { soul: "oats-developer", task: "Look at {repo}#{number}.", backend: "bb", yolo: true } }), "--json");

  // The lists are kept beside the roster read they were made with: a new read of OATS renews them.
  rpc("refresh");
  const lists = act("the plugin reads both lists", "automations");
  const kernel = (kind) => JSON.parse(oats(kind, "list", "--json").stdout).result;
  const ids = (rows) => rows.map((row) => row.qualifiedId ?? row.id).sort();
  if (lists !== undefined) {
    check(lists.schedule.ok === true && lists.trigger.ok === true, "both lists are the kernel's answers, not refusals", JSON.stringify([lists.schedule.ok ? "ok" : lists.schedule, lists.trigger.ok ? "ok" : lists.trigger]));
    check(JSON.stringify(recorded(["schedule", "list"]).argv) === JSON.stringify(["schedule", "list", "--json"]) && JSON.stringify(recorded(["trigger", "list"]).argv) === JSON.stringify(["trigger", "list", "--json"]),
      "the plugin ran `oats schedule list --json` and `oats trigger list --json`, and nothing more", JSON.stringify([recorded(["schedule", "list"]).argv, recorded(["trigger", "list"]).argv]));
    if (lists.schedule.ok && lists.trigger.ok) {
      const schedules = lists.schedule.list.rows;
      const triggers = lists.trigger.list.rows;
      check(JSON.stringify(schedules.map((row) => row.id).sort()) === JSON.stringify(ids(kernel("schedule").schedules)), "the plugin's schedules are the kernel's own list's", JSON.stringify(schedules.map((row) => row.id)));
      check(JSON.stringify(triggers.map((row) => row.id).sort()) === JSON.stringify(ids(kernel("trigger").triggers)), "the plugin's triggers are the kernel's own list's", JSON.stringify(triggers.map((row) => row.id)));
      const digest = schedules.find((row) => row.id === "local/real-run-digest");
      check(digest !== undefined && digest.run === "spawn" && digest.backend === "bb" && digest.yolo === true && digest.runsHere === true && digest.group === "here" && digest.description === "The real run's schedule" && digest.soul?.name === "oats-developer",
        "the schedule's row: a spawn on bb in full mode, placed on this computer by the kernel, with its summary and its soul", JSON.stringify(digest));
      const scheduler = lists.schedule.list.scheduler;
      check(scheduler !== null && typeof scheduler.installed === "boolean" && typeof scheduler.active === "boolean", "the list says what the host scheduler is", JSON.stringify(scheduler));
      check(lists.oats !== null && lists.oats.features.includes("automations") && lists.oats.automationsApi === 1, "the plugin knows this OATS serves automations, from the kernel's own version", JSON.stringify(lists.oats && { version: lists.oats.version, automationsApi: lists.oats.automationsApi }));
    }
  }

  const state = act("the plugin reads the trigger's recorded state", "triggerStatus", { id: "local/real-run-prs" });
  if (state !== undefined) {
    check(JSON.stringify(recorded(["trigger", "status"]).argv) === JSON.stringify(["trigger", "status", "local/real-run-prs", "--json"]), "the plugin ran `oats trigger status local/real-run-prs --json`", JSON.stringify(recorded(["trigger", "status"]).argv));
    check(Array.isArray(state.fired) && state.fired.length === 0 && state.source === null, "a trigger that never polled has fired nothing", JSON.stringify(state));
  }
  const unknown = rpc("triggerStatus", { id: "local/not-a-trigger" });
  check(unknown.ok === false && /is not a trigger of this OATS deployment's current list/.test(unknown.message ?? ""), "an id the list does not name is refused before any process starts", JSON.stringify(unknown));

  // Left as it was found.
  added("the schedule is removed again", "schedule", "remove", "real-run-digest", "--json");
  added("the trigger is removed again", "trigger", "remove", "real-run-prs", "--json");
};
