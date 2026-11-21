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
      check((await page.evaluate(textOf(testId("oats-needs-line")))) === "3 need you", `${at} "3 need you"`, await page.evaluate(textOf(testId("oats-needs-line"))));
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
      const chips = await page.evaluate(textOf(testId("oats-identity-row")));
      check(
        ["oats-desktop-developer", "desktop-mockups-developer", "✓ desktop-mockups-developer", "parent · redesign-ui-lead", "home · …/instances/desktop-mockups-developer", "OATS"].every((chip) => chips.includes(chip)),
        `${at} the row's chips: soul, instance, alias, parent, home, OATS`,
        chips,
      );
      // By its place: the whole chip lies inside the row and inside the viewport, which is what the
      // pin is for. This does not see a chip covered by something drawn over it: `visible()` would,
      // but its probe point can land on the row beside a chip that has scrolled away, and pass.
      const chipInRow = await page.evaluate(
        `(() => { const chip = document.querySelector(${JSON.stringify(testId("oats-chip-oats"))})?.getBoundingClientRect(); const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))})?.getBoundingClientRect(); return Boolean(chip && row && chip.width > 0 && chip.left >= row.left && chip.right <= Math.min(row.right, innerWidth)); })()`,
      );
      check(chipInRow, `${at} the OATS chip is on screen, whatever the other chips' width`);
      const rowHeight = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-identity-row"))})?.getBoundingClientRect().height ?? -1`);
      check(rowHeight > 0 && rowHeight < 50, `${at} the row is one line (${Math.round(rowHeight)} px)`);
      await page.shot(`a13-${viewport.name}-thread`);

      // the thread of an agent that needs you: its row is the open one, with its dot and its "?"
      const release = threads.get("thr_release");
      await page.goto(`/projects/${release.projectId}/threads/${release.id}`);
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const open = `${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`;
      const marked = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(open)}); return row?.querySelector('[data-state="needs-you"]') && row.querySelector('[aria-hidden="true"][title="needs you"]')?.innerText.trim() === "?" ? getComputedStyle(row).backgroundColor : ""; })()`, 30);
      const resting = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${mockups.id}"]`)})).backgroundColor`);
      check(Boolean(marked) && marked !== resting, `${at} the open row of an agent that needs you has its dot and its "?", on the open row's background`, `${marked} against ${resting}`);
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
    name: "bb's threads, the line that says what is missing, a thread opens",
    run: async ({ page, at, viewport, threads, check, sleep }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
      const line = await page.until(`(() => { const t = ${textOf(testId("oats-status-line"))}; return /not found/i.test(t) ? t : ""; })()`, 30);
      check(Boolean(line), `${at} the "not found" line shows: ${line ?? ""}`, await page.evaluate(textOf(testId("oats-sidebar"))));
      const listed = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-other-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      check([...threads.values()].every((thread) => listed.includes(thread.id)), `${at} bb's threads are all listed (${listed.length})`, JSON.stringify(listed));
      check(!(await page.evaluate(visible(testId("oats-tree")))), `${at} no tree is drawn from a stale answer`);
      await page.shot(`a14-${viewport.name}-sidebar`);

      const target = threads.get("thr_redesign");
      await page.evaluate(`document.querySelector('${testId("oats-other-row")}[data-sidebar-thread-id="${target.id}"]').click()`);
      const opened = await page.until(`location.pathname.endsWith("/threads/${target.id}")`, 15);
      check(Boolean(opened), `${at} a thread opens from the list`, await page.evaluate("location.pathname"));
      await sleep(2500);
      check(!(await page.evaluate(visible(testId("oats-identity-row")))), `${at} the open thread has no OATS row while OATS cannot be read`);
      // The one scene the plugin may draw nothing in: no row, and at phone width the list is in bb's closed drawer.
      await page.shot(`a14-${viewport.name}-thread`, { plugin: false });
    },
  },
];
