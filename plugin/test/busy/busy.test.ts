// THE BUSY WORKSPACE (test/fixtures/busy; the worst-case rule): the committed set is exactly what
// its generator makes, every row of it is a recorded row with only its names, ids, times and
// relations varied, it holds what the rule's busy workspace holds, and the plugin reads it.
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parseScheduleList, parseTriggerList, parseTriggerStatus } from "../../kernel/automations-read.js";
import { MAIL_PAGE, parseMail } from "../../kernel/mail.js";
import { parseStatus } from "../../kernel/roster.js";
import { parseServers, parseSouls, parseTeams } from "../../kernel/workspace.js";
// @ts-expect-error the generator is plain JavaScript, with no types of its own
import { build } from "../fixtures/busy/generate.mjs";

const BUSY = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "busy");
type Made = { row: Record<string, unknown>; from: Record<string, unknown>; swaps: [string, string][]; was: [string[], unknown][]; kind?: string };
const { files, made } = build() as { files: Record<string, unknown>; made: Record<"agents" | "souls" | "schedules" | "triggers" | "teams" | "servers" | "runs" | "facts" | "questions" | "mail" | "messages" | "conversations" | "groups" | "problems" | "triggerStates" | "capabilities" | "soulCapabilities", Made[]> };

// THE RULE IS HELD HERE, not by the generator: this file reads the recorded answers ITSELF and puts a busy row back
// with its OWN hands. Of the generator it takes only what it says it did to a row (`swaps`, `was`), which is then proven.
const FIXTURES = join(BUSY, "..");
const answer = (file: string): Record<string, unknown> => {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as Record<string, unknown>;
  return (document.result as Record<string, unknown> | undefined) ?? document;
};
const whole = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as Record<string, unknown>;
const instancesOf = (file: string) => (answer(file).agents as { instances: unknown[] }[]).flatMap((group) => group.instances);
/** Every string of a value with each `[from, to]` replaced, in order. */
const swappedBack = (value: unknown, swaps: [string, string][]): unknown =>
  typeof value === "string" ? swaps.reduce((text, [from, to]) => text.split(from).join(to), value) : Array.isArray(value) ? value.map((each) => swappedBack(each, swaps)) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, each]) => [key, swappedBack(each, swaps)])) : value;
/** A busy row put back: what was set returned to what it was (a key that was not there, removed), then every swap undone, last first. */
function putBack({ row, swaps, was }: Made): unknown {
  const back = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  for (const [path, value] of was) {
    const holder = path.slice(0, -1).reduce<Record<string, unknown>>((inner, key) => inner[key] as Record<string, unknown>, back);
    if (value === undefined) delete holder[path[path.length - 1]!];
    else holder[path[path.length - 1]!] = value;
  }
  return swappedBack(back, [...swaps].reverse().map(([from, to]) => [to, from]));
}
/** THE SOURCES: for each kind of busy row, the recorded rows it may be made from. Closed: a row from anywhere else, or from nowhere, fails. */
const board = (instancesOf("panel/status-board.json") as { board?: { facts: unknown[]; questions: unknown[] } | null }[]).find((row) => row.board)!.board!;
const recordedSchedules = answer("automations/schedule-list.json").schedules as { recentRuns?: unknown[] }[];
const recordedMail = (whole("mail/mail.json").result as { result: { mail: { messages: unknown[]; conversations: unknown[] } } }).result.mail;
const SOURCES: Record<string, unknown[]> = {
  agents: [...instancesOf("roster/status.json"), ...instancesOf("outside/status-outside.json"), ...instancesOf("outside/status-archived-while-running.json"), ...instancesOf("outside/status-failed-at-start.json"), ...instancesOf("panel/status-board.json"), whole("lifecycle/tmux-row-lost.json")],
  groups: [(answer("roster/status.json").agents as unknown[])[0]],
  facts: board.facts,
  questions: board.questions,
  souls: answer("workspace/souls.json").souls as unknown[],
  capabilities: answer("workspace/capabilities.json").capabilities as unknown[],
  // (A soul's own rows of its capabilities: what `oats souls` answers under a soul.)
  soulCapabilities: (answer("workspace/souls.json").souls as { capabilities: unknown[] | null }[]).flatMap((soul) => soul.capabilities ?? []),
  schedules: recordedSchedules,
  runs: recordedSchedules.flatMap((row) => row.recentRuns ?? []),
  triggers: answer("automations/trigger-list.json").triggers as unknown[],
  triggerStates: answer("automations/trigger-status.json").triggers as unknown[],
  teams: answer("workspace/teams.json").teams as unknown[],
  problems: answer("workspace/teams.json").problems as unknown[],
  servers: answer("workspace/servers.json").servers as unknown[],
  mail: [whole("mail/mail-first-page.json")], // the document: the recorded FIRST PAGE (it says there is more, with its cursor)
  messages: recordedMail.messages,
  conversations: recordedMail.conversations,
};

describe("the busy set", () => {
  it("is exactly what its generator makes: the same files, byte for byte, and no other", async () => {
    const committed = (await readdir(BUSY)).filter((name) => name.endsWith(".json")).sort();
    expect(committed).toEqual(Object.keys(files).sort());
    for (const [name, document] of Object.entries(files)) expect([name, await readFile(join(BUSY, name), "utf8")]).toEqual([name, `${JSON.stringify(document, null, 1)}\n`]);
    // The same set every time it is made.
    expect(JSON.stringify(build().files)).toBe(JSON.stringify(files));
  });

  it("THE RULE: every busy row, with its varied fields put back, IS a recorded row: one of the answers the fixtures hold, read here", () => {
    expect(Object.keys(made).sort()).toEqual(Object.keys(SOURCES).sort());
    let rows = 0;
    for (const [list, entries] of Object.entries(made)) {
      for (const each of entries) {
        const back = putBack(each);
        // …a row of the recorded answers of its kind (found by this file, in the files)…
        expect([list, SOURCES[list]!.some((source) => isDeepStrictEqual(source, back))]).toEqual([list, true]);
        // …and it is the row the generator says it took.
        expect(back).toEqual(each.from);
        rows += 1;
      }
    }
    expect(rows).toBeGreaterThan(480); // 60 agents, 24 groups, 24 souls, 37 automations, 200 runs, 7 teams and their problems, 5 machines, 12 facts, 9 questions, the mail's document, its 50 messages and conversations
  });

  it("what is varied is a name, an id, a time, a relation or a text, and nothing else: no row is shaped", () => {
    const ALLOWED: Record<string, string[]> = {
      agents: ["agent", "parentInstance", "relation", "relativeTo", "attributedHuman", "createdAt", "waitingOnYou.since", "waitingOnYou.message", "board", "identity"],
      facts: ["key", "label", "value", "at", "link", "unit"],
      questions: ["id", "question", "since", "options"],
      mail: ["result.result.mail.messages", "result.result.mail.conversations"],
      messages: ["subject", "threadTitle", "createdAt", "body"],
      souls: ["description", "capabilities"],
      capabilities: [],
      soulCapabilities: [],
      schedules: ["description", "task", "recentRuns", "history.stored"],
      triggerStates: [],
      groups: ["name", "instances"],
      problems: ["label"],
      conversations: ["id"],
      triggers: ["description"],
      teams: ["label", "team", "description", "default"],
      servers: ["label"],
      runs: ["scheduledFor", "startedAt"],
    };
    for (const [list, rows] of Object.entries(made)) for (const each of rows) expect([list, each.was.map(([path]) => path.join(".")).filter((path) => !ALLOWED[list]!.includes(path))]).toEqual([list, []]);
    // WHAT a field may be set TO: a value of the kind the recorded one is (a text stays a text, a number a number, and
    // NOTHING stays nothing: a team with no provider id, a description that is not there), but for the named few:
    const instances = new Set(made.agents.map((each) => each.row.instance));
    const at = (value: unknown, path: string[]) => path.reduce<unknown>((inner, key) => (inner as Record<string, unknown> | null | undefined)?.[key], value);
    const SPECIAL: Record<string, (now: unknown, was: unknown, each: Made) => boolean> = {
      // a relation: no parent, or an agent of the set; and where the recorded row says a relation, it follows the parent.
      "agents:parentInstance": (now) => now === null || instances.has(now),
      "agents:relation": (now, _was, each) => (each.row.parentInstance === null ? now === undefined : now === "child"),
      "agents:relativeTo": (now, _was, each) => (each.row.parentInstance === null ? now === undefined : now === each.row.parentInstance),
      // the one joined field (read below), and the containers (read in the files' test).
      "agents:identity": () => true,
      "agents:board": () => true,
      "groups:instances": () => true,
      // a question's options: texts, as many as it offers (two to four).
      "questions:options": (now) => Array.isArray(now) && now.length >= 2 && now.length <= 4 && now.every((option) => typeof option === "string" && option.length > 0),
      "souls:capabilities": () => true,
      "schedules:recentRuns": () => true,
      "mail:result.result.mail.messages": () => true,
      "mail:result.result.mail.conversations": () => true,
      // a team that was the default may be made not so; never the other way.
      "teams:default": (now, was) => now === was || (was === true && now === false),
    };
    for (const [list, entries] of Object.entries(made)) {
      for (const each of entries) {
        for (const [path, was] of each.was) {
          const now = at(each.row, path);
          const special = SPECIAL[`${list}:${path.join(".")}`];
          expect([list, path.join("."), special ? special(now, was, each) : typeof now === typeof was && (was === null) === (now === null)]).toEqual([list, path.join("."), true]);
        }
      }
    }
    // A TIME that was varied stays beside the recorded times of its row: a claim, a fact and a question are never before
    // the recorded one they replace; a message is never after the recorded one, nor before its agent was made.
    const chatMade = Date.parse(String(made.agents.find((each) => each.kind === "board")!.row.createdAt));
    for (const [list, path] of [["agents", ["waitingOnYou", "since"]], ["facts", ["at"]], ["questions", ["since"]]] as const) for (const each of made[list]) for (const [set, was] of each.was) if (set.join(".") === path.join(".")) expect([list, Date.parse(String(at(each.row, [...path]))) >= Date.parse(String(was))]).toEqual([list, true]);
    for (const each of made.messages) expect([Date.parse(String(each.row.createdAt)) <= Date.parse(String(each.from.createdAt)), Date.parse(String(each.row.createdAt)) > chatMade]).toEqual([true, true]);
    // (The agent was made before its oldest mail: a time of the row's that follows what the row is given.)
    expect(chatMade).toBeLessThan(Math.min(...made.messages.map((each) => Date.parse(String(each.row.createdAt)))));
    // ONE field is joined from a second recorded row, on ONE row: the busy chat's agent's messaging identity (README.md).
    const lent = made.agents.filter((each) => each.was.some(([path]) => path[0] === "identity"));
    expect(lent.map((each) => [each.kind, each.from.identity ?? null, each.row.identity])).toEqual([["board", null, { ...(made.agents.find((each) => each.from.instance === "redesign-ui-lead")!.from.identity as object), alias: lent[0]!.row.instance }]]);
    // No row is shaped: a failed agent is the kernel's recorded row of one that failed at its start (a lost session's row).
    const failed = made.agents.filter((each) => each.kind === "failed");
    expect(failed.map((each) => [each.from.instance, each.row.running, each.row.runtimeState, each.row.sessionEnd, each.row.backend])).toEqual(Array.from({ length: 3 }, () => ["pi-unstarted-developer", false, "stopped", "lost", "bb"]));
    expect((files["threads.json"] as { failedAtStart: string[] }).failedAtStart).toEqual(failed.map((each) => each.row.instance));
    // A SWAP's `from` is a value the recorded row itself holds as its name or its id (or the path segment / the phrase
    // the kernel builds from that name): a closed list per kind, as what may be set is. Never any other string of the row.
    const tail = (id: unknown) => String(id).slice(String(id).lastIndexOf("/") + 1);
    const NAMES: Record<string, (row: Record<string, unknown>) => unknown[]> = {
      agents: (row) => [row.instance, String(row.home).match(/\/agents\/[^/]+\//)?.[0], (row.session as { threadId?: unknown } | null | undefined)?.threadId],
      souls: (row) => [row.name],
      capabilities: (row) => [row.name],
      soulCapabilities: (row) => [row.name],
      schedules: (row) => [tail(row.id)],
      triggers: (row) => [tail(row.id)],
      triggerStates: (row) => [tail(row.id)],
      // (…and the agent the recorded run made, by its name and by its soul's directory: a run's agent is a relation, below.)
      runs: (row) => [row.runId, ...(SOURCES.schedules as { id: string }[]).map((schedule) => tail(schedule.id)), row.instance, String(row.home).slice(0, String(row.home).lastIndexOf("/instances/") + 1)],
      teams: (row) => [`/teams/${String(row.label)}`],
      problems: (row) => [`/teams/${String(row.label)}`, `team ${String(row.label)} `],
      servers: (row) => [row.id, `${String(row.sshHost).split(".")[0]}.invalid`],
      mail: (row) => {
        const target = (row.result as { target: { home: string; instance: string } }).target;
        return [target.instance, target.home.slice(0, target.home.lastIndexOf("/instances/") + 1)];
      },
      messages: (row) => [row.id, row.conversationId, (row.to as { alias: unknown }).alias, (row.from as { alias: unknown }).alias],
      facts: () => [],
      questions: () => [],
      conversations: () => [],
      groups: () => [],
    };
    expect(Object.keys(made).sort()).toEqual(Object.keys(NAMES).sort());
    expect(Object.keys(made).sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const [list, rows] of Object.entries(made)) {
      for (const each of rows) {
        const names = NAMES[list]!(each.from).filter((name) => typeof name === "string");
        // (Every swap TOOK, but a run's swap of its schedule's name where the recorded run does not write that name.)
        for (const [from, to] of each.swaps) expect([list, from, names.includes(from), from.length > 3, to.length > 3, JSON.stringify(each.row).includes(to) || (list === "runs" && from !== each.from.runId && from !== each.from.instance && !JSON.stringify(each.from).includes(from))]).toEqual([list, from, true, true, true, true]);
      }
    }
  });

  it("THE FILES hold nothing but those rows: every row of every list in every file is a row the rule's tests read, and what stands around the rows is the recorded document", () => {
    const recorded = (file: string): Record<string, unknown> => {
      const document = JSON.parse(readFileSync(join(BUSY, "..", file), "utf8")) as Record<string, unknown>;
      return (document.result as Record<string, unknown> | undefined) ?? document;
    };
    const rows = (list: keyof typeof made) => made[list].map((each) => each.row);
    const less = (document: unknown, ...keys: string[]) => Object.fromEntries(Object.entries(document as Record<string, unknown>).filter(([key]) => !keys.includes(key)));
    const byInstance = (list: unknown[]) => [...(list as { instance: string }[])].sort((a, b) => (a.instance < b.instance ? -1 : 1));
    // No file but these, and the two that are no kernel answer (the chat, made up and said; the threads to fail, read from the rows).
    expect(Object.keys(files).sort()).toEqual(["capabilities.json", "chat.json", "mail.json", "schedule-list.json", "servers.json", "souls.json", "status.json", "teams.json", "threads.json", "trigger-list.json", "trigger-status.json"]);
    // status.json: the recorded roster's document, with the features of the kernel that recorded the board (README); its groups; their rows.
    const status = files["status.json"] as { features: unknown; agents: { instances: Record<string, unknown>[] }[] };
    expect(less(status, "agents", "features")).toEqual(less(recorded("roster/status.json"), "agents", "features"));
    expect(status.features).toEqual(recorded("panel/status-board.json").features);
    expect(status.agents).toEqual(rows("groups"));
    expect(byInstance(status.agents.flatMap((group) => group.instances))).toEqual(byInstance(rows("agents")));
    // …and the one board: the recorded board around its facts and its questions.
    const boardOf = made.agents.filter((each) => each.was.some(([path]) => path[0] === "board"));
    expect(boardOf).toHaveLength(1);
    const board = boardOf[0]!.row.board as { facts: unknown[]; questions: unknown[] };
    expect(less(board, "facts", "questions")).toEqual(less(boardOf[0]!.from.board, "facts", "questions"));
    expect([board.facts, board.questions]).toEqual([rows("facts"), rows("questions")]);
    // souls.json, trigger-list.json, servers.json, teams.json: the recorded document around its rows.
    const souls = files["souls.json"] as { souls: unknown[] };
    expect([less(souls, "souls"), souls.souls]).toEqual([less(recorded("workspace/souls.json"), "souls"), rows("souls")]);
    // trigger-status.json: the recorded document around ONE state per busy trigger, in the triggers' order, each under its trigger's busy name.
    const states = files["trigger-status.json"] as { triggers: { id: string }[] };
    expect([less(states, "triggers"), states.triggers]).toEqual([less(recorded("automations/trigger-status.json"), "triggers"), rows("triggerStates")]);
    expect(states.triggers.map((state) => state.id)).toEqual(made.triggers.map((each) => each.row.id));
    expect(made.triggerStates.map((each) => [each.from.id, each.swaps])).toEqual(made.triggers.map((each) => [each.from.id, each.swaps]));
    // …and the ONE soul whose capabilities were set holds exactly the rows the rule's tests read: fifteen, each a recorded
    // row of that soul under a busy capability's name; and capabilities.json: the recorded document around its thirty rows.
    const fullest = made.souls.filter((each) => each.was.some(([path]) => path[0] === "capabilities"));
    expect(fullest).toHaveLength(1);
    expect([fullest[0]!.row.capabilities, rows("soulCapabilities").length]).toEqual([rows("soulCapabilities"), 15]);
    const named = new Set((rows("capabilities") as { name: string }[]).map((row) => row.name));
    expect((rows("soulCapabilities") as { name: string }[]).filter((row) => !named.has(row.name))).toEqual([]);
    const capabilities = files["capabilities.json"] as { capabilities: { layer?: string | null }[] };
    expect([less(capabilities, "capabilities"), capabilities.capabilities, capabilities.capabilities.length]).toEqual([less(recorded("workspace/capabilities.json"), "capabilities"), rows("capabilities"), 30]);
    // (Names of up to sixty characters, most of the added ones long.)
    const capabilityNames = (rows("capabilities") as { name: string }[]).map((row) => row.name);
    expect([Math.max(...capabilityNames.map((name) => name.length)) <= 60, capabilityNames.filter((name) => name.length >= 40).length >= 10, new Set(capabilityNames).size]).toEqual([true, true, 30]);
    // (A core place held by FOUR: the Workspace page names three and counts the rest.)
    expect(capabilities.capabilities.filter((row) => row.layer === "knowledge")).toHaveLength(4);
    const triggers = files["trigger-list.json"] as { triggers: unknown[] };
    expect([less(triggers, "triggers"), triggers.triggers]).toEqual([less(recorded("automations/trigger-list.json"), "triggers"), rows("triggers")]);
    const servers = files["servers.json"] as { servers: unknown[] };
    expect([less(servers, "servers"), servers.servers]).toEqual([less(recorded("workspace/servers.json"), "servers"), rows("servers")]);
    const teams = files["teams.json"] as { teams: unknown[]; problems: unknown[] };
    expect([less(teams, "teams", "problems"), teams.teams, teams.problems]).toEqual([less(recorded("workspace/teams.json"), "teams", "problems"), rows("teams"), rows("problems")]);
    // schedule-list.json: the same, and the count of triggers follows; a schedule's fifty runs are the rule's rows, in order, and its history's count follows them.
    const schedules = files["schedule-list.json"] as { schedules: { recentRuns?: unknown[]; history?: { stored?: number } }[]; triggers: { count: number } };
    const recordedSchedules = recorded("automations/schedule-list.json") as { triggers: object };
    expect([less(schedules, "schedules", "triggers"), less(schedules.triggers, "count"), schedules.triggers.count, schedules.schedules]).toEqual([less(recordedSchedules, "schedules", "triggers"), less(recordedSchedules.triggers, "count"), made.triggers.length, rows("schedules")]);
    const withRuns = made.schedules.filter((each) => each.was.some(([path]) => path[0] === "recentRuns"));
    expect(withRuns.flatMap((each) => each.row.recentRuns as unknown[])).toEqual(rows("runs"));
    for (const each of withRuns) expect((each.row.history as { stored: number }).stored).toBe((each.row.recentRuns as unknown[]).length);
    // The NEWEST of a schedule's fifty is the recorded run as it is (the row's `lastRun`, recorded, is of that run), and each older one is an hour before.
    for (const each of withRuns) {
      const runs = each.row.recentRuns as { runId: string; scheduledFor: string; startedAt: string }[];
      expect(runs[0]).toEqual(swappedBack((each.from.recentRuns as unknown[])[0], each.swaps)); // the recorded run, under the schedule's busy name, as the row's `lastRun` is
    }
    // mail.json: the one document of the rule's, and in it the rule's messages and conversations.
    expect(made.mail).toHaveLength(1);
    const mail = (files["mail.json"] as { result: { result: { mail: { messages: unknown[]; conversations: unknown[] } } } }).result.result.mail;
    expect(files["mail.json"]).toBe(made.mail[0]!.row);
    expect([mail.messages, mail.conversations]).toEqual([rows("messages"), rows("conversations")]);
    // A CONTAINER put into a row (a list, an object) is one of these, each read above or just below: never another.
    const containers = Object.entries(made).flatMap(([list, entries]) => entries.flatMap((each) => each.was.filter(([path]) => { const now = path.reduce<unknown>((inner, key) => (inner as Record<string, unknown> | undefined)?.[key], each.row); return typeof now === "object" && now !== null; }).map(([path]) => `${list}:${path.join(".")}`)));
    expect([...new Set(containers)].sort()).toEqual(["agents:board", "agents:identity", "groups:instances", "mail:result.result.mail.conversations", "mail:result.result.mail.messages", "questions:options", "schedules:recentRuns", "souls:capabilities"]);
  });

  it("holds the busy workspace of the rule: sixty agents four levels deep, eleven asking, some failed, lost and outside OATS; 24 souls; 37 automations, five failing, some with fifty runs; seven teams; five machines; names of sixty characters; a question of four lines", () => {
    const status = parseStatus(files["status.json"]);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const agents = status.value.agents;
    expect(agents).toHaveLength(60);
    expect(new Set(agents.map((agent) => agent.instance)).size).toBe(60);
    const parent = new Map(agents.map((agent) => [agent.instance, agent.parent]));
    const depth = (instance: string): number => (parent.get(instance) ? 1 + depth(parent.get(instance)!) : 0);
    expect(Math.max(...agents.map((agent) => depth(agent.instance)))).toBe(3); // four levels
    expect(agents.filter((agent) => agent.parent !== null && !parent.has(agent.parent))).toEqual([]);
    expect(agents.filter((agent) => agent.waiting !== null)).toHaveLength(11);
    // THE BUSY CHAT: one agent on bb holds a full board (twelve facts; nine questions, each on one line) and a long conversation.
    const raws = (files["status.json"] as { agents: { instances: { instance: string; backend: string; home: string; board?: { facts: { key: string }[]; questions: { id: string; question: string }[] } | null; waitingOnYou?: { message: string } | null }[] }[] }).agents.flatMap((group) => group.instances);
    const boards = raws.filter((row) => row.board);
    expect(boards.map((row) => [row.backend, row.board!.facts.length, new Set(row.board!.facts.map((fact) => fact.key)).size, row.board!.questions.length, new Set(row.board!.questions.map((question) => question.id)).size, row.board!.questions.filter((question) => question.question.split("\n").length === 4).length])).toEqual([["bb", 12, 12, 9, 9, 0]]); // (no board question of several lines: the kernel refuses a line feed there; the four-line text is a claim's)
    expect(boards[0]!.waitingOnYou?.message).toBe(boards[0]!.board!.questions[0]!.question);
    // THE BUSY BOARD IS A BOARD THE KERNEL CAN HOLD: every text inside the kernel's bounds (label 40, value 80, unit 16,
    // an option 60 with two to four of them, a question 200 on ONE line, a link 512, a key of sixteen), twelve facts and
    // nine questions; and AT a bound where the worst case wants it. (A reader drops an entry that is over, alone.)
    const fullBoard = boards[0]!.board! as unknown as { facts: { key: string; label: string; value: string; unit: string | null; link: string | null }[]; questions: { question: string; options: string[] }[] };
    const over = [
      ...fullBoard.facts.filter((fact) => !/^[a-z0-9][a-z0-9-]{0,15}$/.test(fact.key) || [...fact.label].length > 40 || [...fact.value].length > 80 || [...(fact.unit ?? "")].length > 16 || (fact.link ?? "").length > 512).map((fact) => fact.key),
      ...fullBoard.questions.filter((question) => [...question.question].length > 200 || question.question.includes("\n") || question.options.length < 2 || question.options.length > 4 || question.options.some((option) => [...option].length > 60)).map((question) => question.question.slice(0, 30)),
    ];
    expect([over, fullBoard.facts.length, fullBoard.questions.length]).toEqual([[], 12, 9]);
    expect([Math.max(...fullBoard.facts.map((fact) => fact.label.length)), Math.max(...fullBoard.questions.map((question) => question.question.length))]).toEqual([40, 200]);
    expect(fullBoard.questions.map((question) => question.options.length).sort()).toEqual([2, 2, 2, 2, 2, 2, 4, 4, 4]);
    const options = fullBoard.questions.flatMap((question) => question.options);
    expect(options.filter((option) => option.length >= 53).length).toBeGreaterThanOrEqual(12);
    const values = fullBoard.facts.map((fact) => fact.value);
    expect([values.some((value) => value.length >= 76 && value.includes(" ")), values.some((value) => value.length >= 76 && !value.includes(" "))]).toEqual([true, true]);
    expect(fullBoard.facts.filter((fact) => fact.unit === "milliseconds p95").length).toBe(1);
    expect(fullBoard.facts.filter((fact) => fact.link !== null && new URL(fact.link).hostname.length >= 100).length).toBe(1);
    const chat = files["chat.json"] as { agent: string; turns: { you: string; agent: string }[] };
    expect(chat.agent).toBe(boards[0]!.instance);
    // Its MAIL: the recorded answer of the mail read, for this agent, its received messages multiplied to a FULL page;
    // the plugin's reader takes it, and a third of the bodies is the recorded long report, cut by the messaging layer.
    const mailDocument = files["mail.json"] as { result: { target: { instance: string; home: string }; result: { mail: { messages: { subject: string; truncated: boolean; conversationId: string; to: { alias: string } }[]; conversations: { id: string }[] } } } };
    expect([mailDocument.result.target.instance, mailDocument.result.target.home]).toEqual([chat.agent, raws.find((row) => row.instance === chat.agent)!.home]);
    expect(new Set(mailDocument.result.result.mail.messages.map((message) => message.to.alias))).toEqual(new Set([chat.agent])); // each is written TO the agent it is the mail of
    // WHO WROTE THEM: the recorded sender, and busy agents with long names (in `from.alias` and in the address, one story).
    const senders = (mailDocument.result.result.mail.messages as unknown as { from: { alias: string; address: string } }[]).map((message) => message.from);
    expect(senders.every((from) => from.address.endsWith(`/${from.alias}`))).toBe(true);
    expect([senders.filter((from) => from.alias.length >= 55).length >= 30, senders.some((from) => from.alias === "mail-writer"), senders.filter((from) => from.alias !== "mail-writer").every((from) => raws.some((row) => row.instance === from.alias))]).toEqual([true, true, true]);
    const mail = parseMail(mailDocument.result);
    // HOW OLD THEY ARE: a spread, newest first: within the hour, hours, days, months, and more than a year for the oldest.
    const ages = (mailDocument.result.result.mail.messages as unknown as { createdAt: string }[]).map((message) => Date.parse(message.createdAt));
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
    const old = ages.map((at) => (ages[0]! - at) / 60_000);
    const within = (from: number, to: number) => old.filter((minutes) => minutes >= from && minutes < to).length;
    expect([old[0], within(1, 60) >= 5, within(60, 24 * 60) >= 5, within(24 * 60, 30 * 24 * 60) >= 5, within(30 * 24 * 60, 365 * 24 * 60) >= 3, within(365 * 24 * 60, Infinity) >= 1]).toEqual([0, true, true, true, true, true]);
    // THERE IS MORE: the document is the recorded first page, so the reader hands on the cursor that reads the older page ("Older" is offered).
    expect(mail.ok && mail.value.older).toBe((whole("mail/mail-first-page.json").result as { result: { mail: { nextCursor: string } } }).result.mail.nextCursor);
    expect(mail.ok && [mail.value.messages.length, new Set(mail.value.messages.map((message) => message.key)).size, mail.value.messages.filter((message) => message.shortened).length >= 15, mail.value.messages.filter((message) => (message.subject ?? "").length > 90).length >= 10]).toEqual([MAIL_PAGE, MAIL_PAGE, true, true]);
    expect(mailDocument.result.result.mail.conversations.map((row) => row.id)).toEqual(mailDocument.result.result.mail.messages.map((message) => message.conversationId));
    expect(chat.turns.length).toBeGreaterThanOrEqual(10);
    expect(new Set(chat.turns.map((turn) => turn.you)).size).toBe(chat.turns.length); // the mock model finds an answer by its message
    expect(chat.turns.filter((turn) => chat.turns.some((other) => other !== turn && other.you.includes(turn.you)))).toEqual([]);
    expect([chat.turns.some((turn) => turn.agent.includes("```")), chat.turns.some((turn) => /^- /m.test(turn.agent)), chat.turns.some((turn) => /^1\. /m.test(turn.agent)), chat.turns.filter((turn) => turn.agent.split("\n\n").length >= 3).length >= 5]).toEqual([true, true, true, true]);
    expect(agents.filter((agent) => agent.sessionEnd === "lost").length).toBeGreaterThanOrEqual(10); // seven lost, and three that failed at their start (a lost session's row)
    expect(agents.filter((agent) => agent.outsideOats !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(agents.filter((agent) => agent.backend === "bb").length).toBeGreaterThanOrEqual(50); // a workspace whose agents are mostly on bb threads
    expect(agents.filter((agent) => agent.instance.length >= 60).length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...agents.map((agent) => agent.instance.length))).toBeLessThanOrEqual(63);
    expect(agents.filter((agent) => (agent.waiting?.message ?? "").split("\n").length === 4).length).toBeGreaterThanOrEqual(2);
    // A folded parent that itself asks and hides a child that asks (the rule's open point).
    expect(agents.some((agent) => agent.waiting !== null && agents.some((child) => child.parent === agent.instance && child.waiting !== null))).toBe(true);
    // ONE soul has MANY agents: twelve of the sixty, on the soul that holds fifteen capabilities (one soul's page then
    // holds both lists at their worst): three of them ask, one's session is lost, one runs outside OATS, one is on tmux.
    const bySoul = new Map<string, typeof agents>();
    for (const agent of agents) bySoul.set(agent.soul, [...(bySoul.get(agent.soul) ?? []), agent]);
    const fullest = [...bySoul.entries()].sort((a, b) => b[1].length - a[1].length);
    expect([fullest[0]![0], fullest[0]![1].length, fullest[1]![1].length <= 3, bySoul.size]).toEqual(["oats-developer", 12, true, 24]);
    const twelve = fullest[0]![1];
    expect([twelve.filter((agent) => agent.waiting !== null).length, twelve.some((agent) => agent.sessionEnd === "lost"), twelve.filter((agent) => agent.outsideOats !== undefined).length, twelve.filter((agent) => agent.backend === "tmux").length]).toEqual([3, true, 1, 1]);
    // Every agent's soul is one the workspace lists.
    const souls = parseSouls(files["souls.json"]);
    expect(souls.ok && souls.value.souls.length).toBe(24);
    if (souls.ok) expect(agents.filter((agent) => !souls.value.souls.some((soul) => soul.agent === agent.soul)).map((agent) => agent.soul)).toEqual([]);
    const schedules = parseScheduleList(files["schedule-list.json"]);
    const triggers = parseTriggerList(files["trigger-list.json"]);
    expect(schedules.ok && triggers.ok).toBe(true);
    if (!schedules.ok || !triggers.ok) return;
    const rows = [...schedules.value.rows, ...triggers.value.rows];
    expect(rows).toHaveLength(37);
    expect(new Set(rows.map((row) => `${row.kind}:${row.id}`)).size).toBe(37);
    // FIVE FAIL, by the Automations page's rule of what is failing: a launch that failed, two definitions that cannot run
    // (one of them a trigger's), an account that is not the one it acts as, no trust. ONE more is a launch whose state
    // is unknown: a warning there, a sixth row, not a failure.
    const failed = rows.filter((row) => row.invalid !== null || row.lastRun?.outcome === "launch-failed" || row.reason === "owner-mismatch" || row.reason === "untrusted");
    expect(failed.map((row) => row.reason ?? (row.invalid !== null ? "invalid" : row.lastRun?.outcome)).sort()).toEqual(["invalid", "invalid", "launch-failed", "owner-mismatch", "untrusted"]);
    expect(rows.filter((row) => row.lastRun?.outcome === "unknown" && !failed.includes(row))).toHaveLength(1);
    // THE AGENT A RUN MADE is a relation: three runs of ONE schedule (the three after its newest) name three agents of the
    // set (one that asks, one that is stopped, one that works), by a swap of the recorded run's agent wherever the run
    // names it; every other run keeps the recorded run's agent, which is no agent of the set.
    const agentOf = new Map(made.agents.map((each) => [each.row.instance as string, each]));
    const named = made.runs.filter((each) => agentOf.has(each.row.instance as string));
    expect(named.map((each) => [agentOf.get(each.row.instance as string)!.kind, each.row.home])).toEqual(["ask", "stopped", "work"].map((kind) => [kind, made.agents.find((each) => each.kind === kind)!.row.home]));
    const withFifty = made.schedules.filter((each) => each.was.some(([path]) => path[0] === "recentRuns"));
    expect(named.map((each) => (withFifty[0]!.row.recentRuns as unknown[]).indexOf(each.row))).toEqual([1, 2, 3]);
    for (const each of made.runs.filter((run) => !named.includes(run))) expect(each.row.instance).toBe(each.from.instance);
    // ONE long instruction, on that schedule: the recorded instruction, twelve times, numbered. No other row's instruction is varied.
    const longTask = made.schedules.filter((each) => each.was.some(([path]) => path[0] === "task"));
    expect(longTask).toEqual([withFifty[0]]);
    expect(longTask[0]!.row.task).toBe(Array.from({ length: 12 }, (_, line) => `${line + 1}. ${String(longTask[0]!.from.task)}`).join("\n\n"));
    // Every busy trigger has its state (the Runs tab's fires, a trigger's page), and the plugin reads it.
    const busyTriggers = (files["trigger-list.json"] as { triggers: { id: string; on?: { source?: string | null } | null }[] }).triggers;
    expect(busyTriggers.map((row) => parseTriggerStatus(files["trigger-status.json"], row.id, row.on?.source ?? null).ok)).toEqual(busyTriggers.map(() => true));
    const raw = (files["schedule-list.json"] as { schedules: { recentRuns?: { runId: string }[] }[] }).schedules;
    expect(raw.filter((row) => row.recentRuns?.length === 50).length).toBeGreaterThanOrEqual(3);
    for (const row of raw.filter((each) => each.recentRuns?.length === 50)) expect(new Set(row.recentRuns!.map((run) => run.runId)).size).toBe(50);
    expect(rows.filter((row) => (row.description ?? "").length > 150 && !(row.description ?? "").includes("\n")).length).toBeGreaterThanOrEqual(10);
    const teams = parseTeams(files["teams.json"]);
    expect(teams.ok && teams.value.teams.length).toBe(7);
    const machines = parseServers(files["servers.json"]);
    expect(machines.ok && machines.value.machines.length).toBe(5);
  });

  it("names no person and no place of a person's: what it adds to the recorded answers is made up, and the person a recorded row names is not carried into the set", () => {
    expect(new Set(made.agents.map((each) => each.row.attributedHuman).filter((human) => typeof human === "string"))).toEqual(new Set(["ada"]));
    expect(Object.values(files).map((document) => JSON.stringify(document)).filter((text) => /joan|reyero/i.test(text))).toEqual([]);
    const added = [...made.agents, ...made.souls, ...made.schedules, ...made.triggers, ...made.teams, ...made.servers].flatMap((each) => each.swaps.map(([, to]) => to));
    expect(added.length).toBeGreaterThan(100);
    // (The two names are the committer's own, public on every commit of this repository: no name it does not already carry is listed here.)
    expect(added.filter((name) => /\/home\/|@|joan|reyero/i.test(name))).toEqual([]);
  });
});
