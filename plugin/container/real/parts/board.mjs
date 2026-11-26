// The board's part of the real run (parts/README.md): an agent's questions and facts, and the one
// act the board adds, an ANSWER sent to the agent's thread.
//   1. an agent of its own on bb writes its board as an agent's own session does (`oats instance
//      board`, in its home, with the session's environment): two facts (one with an address, one
//      set three times: its history) and two questions (the first with a context);
//   2. what the plugin answers for the row's board (`board`: no command of its own) is the
//      kernel's row, with whose the claim is; the roster's row says the agent has a board and
//      that it asks;
//   3. the detail (`boardDetail`) is the kernel's own `oats inspect --home <home> --board --json`,
//      kept as the feature's fixture (test/fixtures/board/inspect-board.json);
//   4. as a person sees it: the agent's page opens on Board, with the question, its place, its
//      options and the facts; a press on an option SENDS `<id>: <option>` to the agent's thread:
//      the option reads "Sent.", the model is asked again in that agent's conversation, and the
//      text stands in the thread. Once in each view (both themes, both widths).
// Runs before the panel's part and needs nothing of it (the files' order): its agent is its own.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { completeLines } from "../../files.mjs";

const REAL = process.env.REAL ?? "/home/node/real";
const OATS = JSON.parse(readFileSync(join(REAL, "bin", "oats-record.json"), "utf8")).oats;
const NAME = "board-asks-helper";
const HOLD = "board-asks"; // never held: it only names this agent's conversation in the mock's log

export default async (run) => {
  const { step, check, note, show, until, oats, rowOf, rpc, act, recorded, fixtures, bbThread, OUT } = run;
  /** The mock's requests of this agent's conversation (its task names the hold). */
  const asked = () => {
    const file = join(REAL, "mock", "requests.jsonl");
    return existsSync(file) ? completeLines(file).map((line) => JSON.parse(line)).filter((request) => request.holds?.includes(HOLD)) : [];
  };

  step(`C board 1: an agent on bb (${NAME}) writes its board, as its own session does`);
  const task = join(OUT, `task-${NAME}.md`);
  writeFileSync(task, `Wait for instructions.\nMOCK-HOLD:${HOLD}\n`);
  const spawned = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", NAME, "--task-file", task, "--json");
  check(spawned.exit === 0, `oats spawn oats-expert --name ${NAME}`, spawned.stdout || spawned.stderr);
  if (spawned.exit !== 0) {
    note("NO BOARD IN THIS RUN: the kernel did not spawn the board's agent");
    return;
  }
  const home = JSON.parse(spawned.stdout).result.home;
  const asInstance = (...args) => spawnSync(OATS, args, { cwd: home, encoding: "utf8", env: { ...process.env, OATS_INSTANCE: NAME, OATS_INSTANCE_HOME: home } });
  const context = join(OUT, "board-question-context.txt");
  writeFileSync(context, "main is protected and moved twice today.\nThe release line is 0.1 and carries the pilot's fix.\nI will cut the branch from the one you pick.\n");
  const QUESTION = "Which base branch should the release be cut from?";
  const OPTIONS = ["main: the default", "release: the 0.1 line"];
  const words = [
    ["set", "pr", "--label", "Pull request", "--value", "#42", "--link", "https://github.com/oats-project/oats-bb/pull/42"],
    ["set", "tests", "--label", "Tests", "--value", "12", "--unit", "failing"],
    ["set", "tests", "--label", "Tests", "--value", "7", "--unit", "failing"],
    ["set", "tests", "--label", "Tests", "--value", "3", "--unit", "failing"],
    ["ask", QUESTION, "--option", OPTIONS[0], "--option", OPTIONS[1], "--context-file", context],
    ["ask", "Squash the three commits?", "--option", "Squash: one clean commit", "--option", "Merge: keep the three"],
  ];
  for (const each of words) {
    const said = asInstance("instance", "board", ...each, "--json");
    check(said.status === 0, `oats instance board ${each[0]} ${each[1]}, run in the agent's home`, said.stdout + said.stderr);
  }
  const rested = await until(`${NAME} to be at rest with the board's claim in oats status`, () => {
    const now = rowOf(NAME);
    return now !== undefined && run.atRest(now) && now.waitingOnYou?.producer === "oats.board" ? now : undefined;
  });
  if (rested === undefined) {
    note("NO BOARD IN THIS RUN: the agent never came to rest with its board's claim");
    return;
  }

  step("C board 2: the row's board, as the plugin answers it, is the kernel's row; the roster says it has a board and that it asks");
  rpc("refresh");
  const row = rowOf(NAME) ?? rested;
  const answer = act("the board of the agent", "board", { instance: NAME });
  check(answer?.supported === true && JSON.stringify(answer.board) === JSON.stringify(row.board), "the plugin's `board` is the row's board as the kernel printed it", JSON.stringify({ plugin: answer?.board, kernel: row.board }).slice(0, 900));
  check(answer?.claim?.producer === "oats.board" && answer.claim.reason === row.waitingOnYou?.reason, "and the claim is the board's own, with the kernel's reason", JSON.stringify({ plugin: answer?.claim, kernel: row.waitingOnYou }));
  check(row.board?.facts?.length === 2 && row.board?.questions?.length === 2 && row.board.questions[0].hasContext === true && row.board.questions[1].hasContext === false, "the kernel's row holds the two facts and the two questions, the first with a context", JSON.stringify(row.board).slice(0, 700));
  const snapshot = rpc("snapshot");
  const agent = snapshot.ok ? snapshot.value.agents?.find((each) => each.instance === NAME) : undefined;
  check(agent?.hasBoard === true && agent.boardAsks === true, "the roster's row of the agent says it has a board, and that it asks", JSON.stringify({ hasBoard: agent?.hasBoard, boardAsks: agent?.boardAsks }));
  fixtures.keep("board/status.json", recorded(["status"]).stdout);

  step("C board 3: the detail is the kernel's own inspection of the board, kept as the fixture");
  const detail = act("the board's detail", "boardDetail", { instance: NAME });
  const call = recorded(["inspect", "--home"], ["--board"]);
  show("argv", call.argv);
  check(call.exit === 0 && call.argv.join(" ") === `inspect --home ${home} --board --json`, "the plugin ran `oats inspect --home <the home the kernel named> --board --json`, and nothing else", call.argv.join(" "));
  const own = oats("inspect", "--home", home, "--board", "--json");
  const kernel = own.exit === 0 ? JSON.parse(own.stdout).result : null;
  const boardOf = (inspection) => inspection?.instance?.board ?? inspection?.board;
  check(kernel !== null && JSON.stringify(boardOf(detail?.inspection)) === JSON.stringify(boardOf(kernel)), "the plugin's `boardDetail` holds the board the kernel's own inspection holds", JSON.stringify({ plugin: boardOf(detail?.inspection), kernel: boardOf(kernel) }).slice(0, 900));
  const held = boardOf(kernel);
  check(held?.facts?.find((fact) => fact.key === "tests")?.history?.map((each) => each.value).join(",") === "12,7,3" && typeof held?.questions?.[0]?.context === "string" && held.questions[0].context.includes("main is protected"), "the kernel's detail holds the fact's three values, oldest first, and the first question's context", JSON.stringify(held).slice(0, 900));
  fixtures.keep("board/inspect-board.json", call.stdout);

  step("C board 4: as a person sees it: the page opens on Board; a press on an option sends the answer to the agent's thread");
  const first = row.board.questions[0];
  const ANSWER = `${first.id}: ${OPTIONS[0]}`;
  const thread = bbThread(row.session?.threadId);
  const inBoard = (id) => `[data-testid="oats-board"] [data-testid="${id}"]`;
  const flat = `(e) => (e?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
  await run.views("real-board", async ({ page, at, shot }) => {
    // At rest before each press: the turn the view before started is over.
    await until(`${NAME} at rest again`, () => (run.atRest(rowOf(NAME)) ? true : undefined));
    await page.goto(`/plugins/oats/agent/${NAME}`);
    const drawn = await page.until(`(() => { const flat = ${flat}; const q = document.querySelector(${JSON.stringify(inBoard("oats-board-question"))}); const answers = document.querySelectorAll(${JSON.stringify(inBoard("oats-board-answer"))}); if (!q || answers.length !== 2 || document.querySelectorAll(${JSON.stringify(inBoard("oats-board-spark"))}).length !== 1) return ""; return JSON.stringify({ tab: document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.trim(), place: flat(document.querySelector(${JSON.stringify(inBoard("oats-board-place"))})), question: flat(q), options: [...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-option"))})].map(flat), facts: [...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-fact"))})].map((f) => flat(f.querySelector('[data-testid="oats-board-fact-value"]')) + " | " + flat(f.querySelector('[data-testid="oats-board-fact-label"]')?.parentElement)), says: flat(document.querySelector(${JSON.stringify(inBoard("oats-board-says"))})) }); })()`, 60);
    const read = drawn ? JSON.parse(drawn) : null;
    check(
      read !== null && read.tab === "Board" && read.place === "1 of 2" && read.question === QUESTION && read.options.join(" / ") === `1 ${OPTIONS[0]} / 2 ${OPTIONS[1]}` && read.facts.join(" / ") === "#42 | Pull request · github.com / 3 failing | Tests" && read.says === "Board asks helper says",
      `${at}: the real agent's page opens on Board: the question, "1 of 2", its two options as buttons, the two facts (value over label, the address after it), one history line, and who says the address`,
      drawn ?? (await page.evaluate(`(${flat})(document.querySelector('[data-testid="oats-panel"]'))`)),
    );
    await page.until(`document.getAnimations().every((animation) => animation.playState !== "running")`, 5);
    await shot("tab");
    const before = asked().length;
    await page.evaluate(`document.querySelector(${JSON.stringify(inBoard("oats-board-answer"))}).click()`);
    const sent = await page.until(`(${flat})(document.querySelector(${JSON.stringify(inBoard("oats-board-sent"))}))`, 40);
    check(sent === "Sent.", `${at}: a press on the first option: the option reads "Sent."`, sent ?? (await page.evaluate(`(${flat})(document.querySelector('[data-testid="oats-board"]'))`)));
    const again = await until(`the model to be asked again in ${NAME}'s conversation`, () => (asked().length > before ? asked().length : undefined));
    check(again !== undefined, `${at}: the answer reached the agent's harness: the model was asked again in its conversation (${before} requests before the press, ${again ?? before} after)`);
    check((await page.evaluate(`document.querySelectorAll(${JSON.stringify(inBoard("oats-board-answer") + ":not([disabled])")}).length`)) === 0 && (await page.evaluate(`(${flat})(document.querySelector(${JSON.stringify(inBoard("oats-board-question"))}))`)) === QUESTION, `${at}: the question stays (the agent has not cleared it), and its options are off`);
    await shot("sent");
    // The text itself stands in the agent's thread, as a person's message.
    if (thread !== undefined) {
      await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
      const there = await page.until(`document.body.innerText.includes(${JSON.stringify(ANSWER)}) ? "yes" : ""`, 40);
      check(there === "yes", `${at}: the agent's thread holds the message ${JSON.stringify(ANSWER)}`);
    } else check(false, `${at}: bb has the agent's thread`, String(row.session?.threadId));
  });
};
