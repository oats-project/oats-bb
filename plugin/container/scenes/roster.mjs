// The roster's live scenes: the sidebar's tree, an agent's thread with its header row, the states
// of the dot, and the sidebar while OATS cannot be read. (container/live-ui.mjs says what a scene is.)
import { showSidebar, testId, textOf, texts, visible } from "../browser.mjs";

export default [
  {
    stage: "fixtures",
    name: "the sidebar, an agent's thread, a thread that is no agent",
    run: async ({ page, at, viewport, threads, fixtureThreads, check, sleep }) => {
      // the sidebar with the tree
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      await page.until(visible(testId("oats-tree")), 30);
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      const expected = fixtureThreads.filter((thread) => thread.id !== "thr_plain").map((thread) => threads.get(thread.id).id);
      check(rows.length === 7 && expected.every((id) => rows.includes(id)), `${at} the tree draws the 7 bb agents, joined by bb's own thread ids`, JSON.stringify(rows));
      const child = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_mockups").id}"]`;
      check(await page.evaluate(`document.querySelector(${JSON.stringify(child)})?.className.includes("pl-6") === true`), `${at} a child is indented under its parent`);
      check((await page.evaluate(textOf(testId("oats-workspace-line")))).includes("8 agents"), `${at} the workspace line`, await page.evaluate(textOf(testId("oats-workspace-line"))));
      check((await page.evaluate(textOf(testId("oats-needs-line")))) === "! 3 need you", `${at} "3 need you", with the mark of an agent that waits`, await page.evaluate(textOf(testId("oats-needs-line"))));
      // What the image's name says: every agent a row, each with its state in a word and its soul; the
      // one that runs in tmux among them; the roster first, then who waits, New agent, the pages.
      const drawn = JSON.parse(await page.evaluate(`JSON.stringify({ facts: ${texts(`${testId("oats-tree")} ${testId("oats-row-facts")}`)}, order: [...document.querySelectorAll(${JSON.stringify(["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"].map(testId).join(", "))})].map((e) => e.getAttribute("data-testid")), marks: document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} [data-mark]`)}).length })`));
      const WORDS = /^(Needs you|Working|Idle|Stopped|Failed|Unreachable) · \S/;
      check(
        drawn.facts.length === 8 && drawn.marks === 8 && drawn.facts.every((line) => WORDS.test(line)) && drawn.facts.includes("Working · oats-developer · runs in tmux") && JSON.stringify(drawn.order) === JSON.stringify(["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"]),
        `${at} eight agents, eight rows: each its mark, its state in a word and its soul, the one in tmux among them; then who waits, New agent and the pages`,
        JSON.stringify(drawn),
      );
      const others = await page.evaluate(texts(testId("oats-other-row")));
      check(others.some((text) => text.includes("Plain bb thread")), `${at} the thread that is no agent is under Other threads`, JSON.stringify(others));
      await page.shot(`a13-${viewport.name}-sidebar`);

      // the home's badge: bb's own navigation entry for the home (the rail on desktop, the drawer on a
      // phone), never the plugin's own "3 need you" line, carries the label and draws the count
      const badge = await page.until(
        `(() => { const own = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const entry = [...document.querySelectorAll("[aria-label]")].find((e) => !own?.contains(e) && /^OATS\\b.*3 agents need you/.test(e.getAttribute("aria-label"))); if (!entry) return ""; const r = entry.getBoundingClientRect(); const drawn = [...entry.querySelectorAll("*")].some((e) => e.children.length === 0 && e.textContent.trim() === "3"); return r.width > 0 && drawn ? entry.getAttribute("aria-label") : ""; })()`,
        15,
      );
      check(Boolean(badge), `${at} bb's navigation entry for the home shows the badge 3 (${badge ?? "not found"})`, await page.evaluate(`JSON.stringify([...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter((l) => /OATS/.test(l)))`));

      // an agent's thread with its header row
      const mockups = threads.get("thr_mockups");
      await page.goto(`/projects/${mockups.projectId}/threads/${mockups.id}`);
      check(Boolean(await page.until(visible(testId("oats-identity-row")), 30)), `${at} an agent's thread shows the identity row`);
      // The image's name says a thread with its row: the row says where the agent is in words, then who it is, each fact with its label.
      const row = JSON.parse(await page.evaluate(`JSON.stringify({ status: ${textOf(testId("oats-status-line"))}, state: document.querySelector(${JSON.stringify(testId("oats-status-line"))})?.getAttribute("data-state"), facts: ${texts(`${testId("oats-identity-facts")} > *`)} })`));
      check(
        row.state === "working" && row.status === "Working" && JSON.stringify(row.facts) === JSON.stringify(["Soul oats-desktop-developer", "Under redesign-ui-lead", "Identity in default:oats.aweb.ai desktop-mockups-developer", "OATS"]),
        `${at} the row: the state in words, then the soul, the parent, the identity, each with its label, and OATS`,
        JSON.stringify(row),
      );
      // Nothing of the row is cut or scrolls out of sight: it is as wide as its place, and every part of it is inside it.
      const whole = await page.evaluate(
        `(() => { const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const box = row.getBoundingClientRect(); return row.scrollWidth <= row.clientWidth + 1 && [...row.querySelectorAll("*")].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= box.left - 1 && r.right <= Math.min(box.right, innerWidth) + 1); }); })()`,
      );
      check(whole, `${at} nothing of the row is cut or out of sight`);
      await page.shot(`a13-${viewport.name}-thread`, { targets: true });

      // the thread of an agent that needs you: its row is the open one, with the "!" and "Needs you"
      const release = threads.get("thr_release");
      await page.goto(`/projects/${release.projectId}/threads/${release.id}`);
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const open = `${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`;
      const marked = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(open)}); return row?.querySelector('[data-mark][data-state="needs-you"]')?.innerText.trim() === "!" && row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.innerText.startsWith("Needs you · ") ? getComputedStyle(row).backgroundColor : ""; })()`, 30);
      const resting = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${mockups.id}"]`)})).backgroundColor`);
      check(Boolean(marked) && marked !== resting, `${at} the open row of an agent that needs you has its "!" and says "Needs you", on the open row's background`, `${marked} against ${resting}`);
      await page.shot(`a13-${viewport.name}-thread-needs`);

      // a thread that is no agent has no row
      const plain = threads.get("thr_plain");
      await page.goto(`/projects/${plain.projectId}/threads/${plain.id}`);
      await sleep(3000);
      check(!(await page.evaluate(visible(testId("oats-identity-row")))), `${at} a thread that is no agent has no identity row`);
    },
  },
  {
    stage: "fixtures",
    name: "freshness: a change the kernel records is in the tree within 3 s",
    run: async ({ page, at, viewport, threads, check, record }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const row = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_harvest").id}"]`;
      const drawn = (state) => `document.querySelector(${JSON.stringify(`${row} [data-state="${state}"]`)}) !== null`;
      check(Boolean(await page.until(drawn("idle"), 30)), `${at} before the change the agent is drawn idle`);
      // The kernel records that the agent was stopped: its status row, and a line in the event log.
      const stopped = record({ "harvest-knowledge-helper": { running: false, runtimeState: "stopped" } });
      const shown = (await page.until(drawn("stopped"), 15)) ? Date.now() - stopped : null;
      check(shown !== null && shown <= 3000, `${at} the tree shows the agent stopped ${shown === null ? "never" : `${shown} ms`} after the kernel recorded it (3 s at most)`);
      // And back, so the scenes after this one draw the fixtures.
      const back = record();
      const again = (await page.until(drawn("idle"), 15)) ? Date.now() - back : null;
      check(again !== null && again <= 3000, `${at} and idle again ${again === null ? "never" : `${again} ms`} after the kernel recorded that (3 s at most)`);
    },
  },
  {
    stage: "detached",
    name: "the states no fixture row is in",
    run: async ({ page, at, viewport, threads, check }) => {
      const unreachable = threads.get("thr_mockups");
      await page.goto(`/projects/${unreachable.projectId}/threads/${unreachable.id}`);
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const dot = (id, state) => `document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${id}"] [data-state="${state}"]`)}) !== null`;
      const drawn = await page.until(`${dot(unreachable.id, "unreachable")} && ${dot(threads.get("thr_harvest").id, "error")}`, 30);
      check(Boolean(drawn), `${at} the tree draws the unreachable agent, on the open thread, and the agent whose session is a shell`, await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-agent-row")} [data-state]`)})].map((e) => e.getAttribute("data-state")).join(",")`));
      await page.shot(`a16-${viewport.name}-states`);
    },
  },
  {
    stage: "no-oats",
    name: "stale: OATS cannot be read after it was: the notice, the last observation, the tree as last read",
    run: async ({ page, at, viewport, threads, check, sleep }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
      // A titled notice in a person's words, with the age of what is still shown and Retry.
      const notice = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-unreadable"))}); const t = e?.querySelector("h3")?.innerText ?? ""; return /^OATS is not installed on /.test(t) ? JSON.stringify({ title: t, code: e.getAttribute("data-code"), text: e.innerText.replace(/\\s+/g, " "), retry: [...e.querySelectorAll("button")].some((b) => b.innerText.trim() === "Retry"), settings: [...e.querySelectorAll("a")].some((a) => a.innerText.trim() === "Open settings") }) : ""; })()`, 30);
      const said = notice ? JSON.parse(notice) : null;
      check(said !== null && said.code === "OATS_NOT_FOUND" && /Showing what was read /.test(said.text) && said.retry && said.settings, `${at} the notice says what is missing in a person's words, how old what is shown is, with Retry and Open settings: ${said?.title ?? ""}`, await page.evaluate(textOf(testId("oats-sidebar"))));
      const observed = await page.evaluate(textOf(testId("oats-last-observation")));
      check(/^Last observation — /.test(observed), `${at} the roster is marked as the last observation (${observed})`);
      // The roster stays: the agents as last read, joined to their threads, never bb's flat list.
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      check(rows.length >= 6 && rows.includes(threads.get("thr_release").id), `${at} the tree is still drawn, as last read (${rows.length} agents)`, JSON.stringify(rows));
      await page.shot(`a14-${viewport.name}-sidebar`);

      const target = threads.get("thr_redesign");
      await page.evaluate(`document.querySelector('${testId("oats-agent-row")}[data-sidebar-thread-id="${target.id}"]').click()`);
      const opened = await page.until(`location.pathname.endsWith("/threads/${target.id}")`, 15);
      check(Boolean(opened), `${at} a thread opens from the tree`, await page.evaluate("location.pathname"));
      // The thread's own row is still there, from the last roster, and says that it is: "as of <age>".
      const line = await page.until(`(() => { const t = ${textOf(`${testId("oats-identity-row")} ${testId("oats-status-line")}`)}; return / as of /.test(t) ? t : ""; })()`, 15);
      check(/^Working · as of (just now|\d+s ago|\d+ min ago)$/.test(line ?? ""), `${at} the open thread keeps its OATS row, from the last roster, and says how old it is`, line ?? (await page.evaluate(textOf(testId("oats-identity-row")))));
      await page.shot(`a14-${viewport.name}-thread`, { targets: true });

      // The home keeps what it showed, under the same notice.
      await page.goto("/plugins/oats/home");
      const home = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-home-page")} ${testId("oats-unreadable")}`)}); const cards = document.querySelectorAll(${JSON.stringify(testId("oats-needs-card"))}).length; return e && cards > 0 ? JSON.stringify({ title: e.querySelector("h3")?.innerText ?? "", text: e.innerText.replace(/\\s+/g, " "), cards }) : ""; })()`, 30);
      const shown = home ? JSON.parse(home) : null;
      check(shown !== null && /^OATS is not installed on /.test(shown.title) && /Showing what was read /.test(shown.text) && shown.cards === 3, `${at} the home keeps its three cards under the same notice, with the age of what it shows`, home ?? (await page.evaluate(textOf(testId("oats-home-page")))));
      await page.shot(`a14-${viewport.name}-home`, { targets: true });
    },
  },
];
