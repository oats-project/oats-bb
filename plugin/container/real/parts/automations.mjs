// Automations in the real run: the plugin's reads and acts against the real kernel. A person adds
// a local schedule and a local trigger on the command line (creating one from the plugin is a
// sub-piece of its own); the plugin's lists hold them as the kernel's own `oats schedule list` and
// `oats trigger list` do, and a trigger's state is read for the id the list names.
//
// One act is not run here against the real kernel: a confirmed test of a capability source's
// trigger (`oats trigger test --run-source`), since this run's workspace holds no capability with a
// trigger source; its argv and its answer rest on the recording, which ran it for real.
//
// The feature's fixtures are not made here: they are a recording of their own, on a deployment
// with workspace automations, a trigger source and runs (test/fixtures/automations/record/).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default async (run) => {
  const { step, check, act, oats, recorded, refused, rpc, status, OUT } = run;
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

  // ---- the acts, each through the plugin, each checked in what the kernel then answers ----
  step("Automations: acting on a schedule and a trigger through the plugin");
  const schedule = (id) => JSON.parse(oats("schedule", "show", id, "--json").stdout).result?.schedule;
  const argv = (words) => JSON.stringify(recorded(words).argv);

  const off = act("turn the schedule off on this computer", "automationEnable", { kind: "schedule", id: "local/real-run-digest", enabled: false });
  check(off?.row?.enabledHere === false && schedule("real-run-digest")?.enabled === false && argv(["schedule", "disable"]) === JSON.stringify(["schedule", "disable", "local/real-run-digest", "--json"]), "the kernel holds the schedule as off, and the plugin ran `oats schedule disable local/real-run-digest --json`", JSON.stringify(off?.row && { enabledHere: off.row.enabledHere }));
  const on = act("turn it on again", "automationEnable", { kind: "schedule", id: "local/real-run-digest", enabled: true });
  check(on?.row?.enabledHere === true && schedule("real-run-digest")?.enabled === true, "the kernel holds the schedule as on again", JSON.stringify(on?.row && { enabledHere: on.row.enabledHere }));

  const described = act("change its summary", "automationDescribe", { kind: "schedule", id: "local/real-run-digest", description: "-- the real run's schedule, renamed" });
  check(described?.row?.description === "-- the real run's schedule, renamed" && schedule("real-run-digest")?.description === "-- the real run's schedule, renamed" && recorded(["schedule", "update"]).argv[3] === "--description=-- the real run's schedule, renamed",
    "the kernel holds the new summary, which travelled as one `--description=` element though it starts with dashes", argv(["schedule", "update"]));

  const tested = act("test the schedule", "automationTest", { kind: "schedule", id: "local/real-run-digest" });
  check(tested?.ok === true && tested.soul?.resolves === true && argv(["schedule", "test"]) === JSON.stringify(["schedule", "test", "local/real-run-digest", "--json"]), "the kernel finds it ready here, its soul resolving; nothing was run", JSON.stringify(tested));
  const triggerTested = act("test the pull-request trigger", "automationTest", { kind: "trigger", id: "local/real-run-prs" });
  check(triggerTested !== undefined && Array.isArray(triggerTested.problems) && !recorded(["trigger", "test"]).argv.includes("--run-source"), "the kernel answers the trigger's test (this container has no gh: its problems say so), and no --run-source was sent", JSON.stringify(triggerTested && { ok: triggerTested.ok, problems: triggerTested.problems }));
  const forced = rpc("automationTest", { kind: "trigger", id: "local/real-run-prs", runSource: true });
  check(forced.ok === false && /has no capability source for a test to run/.test(forced.message ?? ""), "a pull-request trigger's test cannot be asked to run a source", JSON.stringify(forced));

  const before = new Set(status().rows.keys());
  const ran = act("run the schedule now", "scheduleRun", { id: "local/real-run-digest" });
  const launched = [...status().rows.values()].find((row) => !before.has(row.instance));
  check(ran?.run?.outcome === "launched" && launched !== undefined && launched.backend === "bb" && launched.instance === ran.run.instance && argv(["schedule", "run"]) === JSON.stringify(["schedule", "run", "local/real-run-digest", "--json"]),
    "Run now launched a bb agent: the run's outcome is `launched`, and `oats status` holds the new instance on bb", JSON.stringify({ run: ran?.run && { outcome: ran.run.outcome, instance: ran.run.instance }, launched: launched && { instance: launched.instance, backend: launched.backend } }));

  // Check run state: the kernel's reconcile answers for a schedule whatever its last run is.
  const reconciled = act("check the schedule's run state", "scheduleReconcile", { id: "local/real-run-digest" });
  check(reconciled !== undefined && "reconciled" in reconciled && argv(["schedule", "reconcile"]) === JSON.stringify(["schedule", "reconcile", "local/real-run-digest", "--json"]),
    "the kernel answers the check of a run's state", JSON.stringify(reconciled));

  // The trigger: off and on on this computer, and its summary.
  const trigger = (id) => JSON.parse(oats("trigger", "show", id, "--json").stdout).result?.trigger;
  const triggerOff = act("turn the trigger off on this computer", "automationEnable", { kind: "trigger", id: "local/real-run-prs", enabled: false });
  check(triggerOff?.row?.enabledHere === false && trigger("real-run-prs")?.enabled === false && argv(["trigger", "disable"]) === JSON.stringify(["trigger", "disable", "local/real-run-prs", "--json"]),
    "the kernel holds the trigger as off", JSON.stringify(triggerOff?.row && { enabledHere: triggerOff.row.enabledHere }));
  const triggerOn = act("turn it on again", "automationEnable", { kind: "trigger", id: "local/real-run-prs", enabled: true });
  check(triggerOn?.row?.enabledHere === true && trigger("real-run-prs")?.enabled === true, "the kernel holds the trigger as on again", JSON.stringify(triggerOn?.row && { enabledHere: triggerOn.row.enabledHere }));
  const triggerDescribed = act("change the trigger's summary", "automationDescribe", { kind: "trigger", id: "local/real-run-prs", description: "The real run's trigger" });
  check(triggerDescribed?.row?.description === "The real run's trigger" && trigger("real-run-prs")?.description === "The real run's trigger", "the kernel holds the trigger's new summary", JSON.stringify(triggerDescribed?.row?.description));

  // A schedule that never ran is deleted through the plugin.
  added("a person adds a second schedule", "schedule", "add", "real-run-spare", "--file",
    file("automations-spare.json", { id: "real-run-spare", kind: "spawn", cron: "0 8 * * *", tz: "UTC", enabled: true, agent: "oats-developer", backend: "bb", yolo: true, task: "Nothing." }), "--json");
  rpc("refresh");
  const removed = act("delete the second schedule", "scheduleRemove", { id: "local/real-run-spare" });
  check(removed?.removed !== undefined && schedule("real-run-spare") === undefined && argv(["schedule", "remove"]) === JSON.stringify(["schedule", "remove", "local/real-run-spare", "--json"]), "the kernel no longer holds it, and the plugin ran `oats schedule remove local/real-run-spare --json`", JSON.stringify(removed));

  // This container has no service manager: the kernel refuses to install the timer, and the plugin shows that unchanged.
  refused("Enable scheduler on a computer with no service manager", "E_SCHEDULE_HOST", "schedulerEnable", null, ["schedule", "host", "install"]);

  // Left as it was found: the definitions go (the agent Run now launched is the kernel's to keep).
  added("the schedule is removed again", "schedule", "remove", "real-run-digest", "--force", "--json");
  added("the trigger is removed again", "trigger", "remove", "real-run-prs", "--json");
};
