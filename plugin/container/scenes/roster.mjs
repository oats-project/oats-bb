// The roster's live scenes: the sidebar's tree, an agent's thread with its header row, the states
// of the dot, and the sidebar while OATS cannot be read. (container/live-ui.mjs says what a scene is.)
import { hostname } from "node:os";
import { showSidebar, testId, textOf, texts, visible } from "../browser.mjs";

/** The thread's own row, read once it says `state`: → `{ line, act }` (the status line's words, and its button's), or null. The read waits on the row. */
const statusOf = async (page, state) => {
  const line = testId("oats-status-line");
  const read = await page.until(
    // The words as the page lays them out (innerText of the drawn line), without the act's own.
    `(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${line}`)}); if (!e || e.getAttribute("data-state") !== ${JSON.stringify(state)}) return ""; const act = e.querySelector(${JSON.stringify(testId("oats-status-act"))})?.innerText.trim() ?? null; const all = e.innerText.replace(/\\s+/g, " ").trim(); return JSON.stringify({ line: act !== null && all.endsWith(act) ? all.slice(0, -act.length).trim() : all, act }); })()`,
    30,
  );
  return read ? JSON.parse(read) : null;
};
/** What the page shows of the thread's row when a read of it found nothing: for a failing check's line. */
const rowText = (page) => page.evaluate(textOf(testId("oats-identity-row")));

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
      // The machine is shown by the name bb gives it, which is the host's own (G1): never an id of bb's.
      check((await page.evaluate(textOf(testId("oats-workspace-line")))) === `oats · ${hostname()} · 8 agents`, `${at} the workspace line: the workspace, the machine by its name (${hostname()}), and as many agents as rows`, await page.evaluate(textOf(testId("oats-workspace-line"))));
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
      // No row's second line is cut: each is as wide as its text needs, on as many lines as it takes.
      const cut = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText)`);
      check(cut.length === 0, `${at} no row's state and soul are cut`, JSON.stringify(cut));
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
      // The thread itself says it first (S1), before anything of the sidebar is opened over it: the
      // state's word, since when the agent has waited, and what it asked.
      const needs = await statusOf(page, "needs-you");
      check(
        needs !== null && /^! Needs you · waiting .+ \(since [^)]+\) · Green light at 9f2e1c\? Second reader done\.$/.test(needs.line) && needs.act === null,
        `${at} the thread of an agent that waits says so in its own row: "Needs you", since when, and its question`,
        needs === null ? await rowText(page) : JSON.stringify(needs),
      );
      await page.shot(`a13-${viewport.name}-thread-needs`, { targets: true });
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const open = `${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`;
      const marked = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(open)}); return row?.querySelector('[data-mark][data-state="needs-you"]')?.innerText.trim() === "!" && row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.innerText.startsWith("Needs you · ") ? getComputedStyle(row).backgroundColor : ""; })()`, 30);
      const resting = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${mockups.id}"]`)})).backgroundColor`);
      check(Boolean(marked) && marked !== resting, `${at} the open row of an agent that needs you has its "!" and says "Needs you", on the open row's background`, `${marked} against ${resting}`);
      // At 1280 the sidebar is beside the thread: the image above already shows the open row. At 390 it is bb's drawer, over the thread.
      if (viewport.mobile) await page.shot(`a13-${viewport.name}-sidebar-open-row`);

      // D-037: the row of the plugin's page that is shown is the selected one, and stops being it
      // when a thread is opened from the sidebar (no reload: bb's own navigation).
      await page.goto("/plugins/oats/teams");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const current = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-pages")} button`)})].filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.innerText.trim()))`;
      const onTeams = await page.until(`(() => { const now = ${current}; return now === '["Teams"]' ? now : ""; })()`, 30);
      check(Boolean(onTeams), `${at} while the Teams page is shown its row is the selected one, and no other`, onTeams ?? (await page.evaluate(current)));
      if (viewport.mobile) await page.shot(`a13-${viewport.name}-sidebar-page-selected`);
      await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`)}).click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/threads/${release.id}")`, 15)), `${at} a thread opens from the sidebar`, await page.evaluate("location.pathname"));
      if (viewport.mobile) check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const none = await page.until(`(() => { const now = ${current}; return document.querySelector(${JSON.stringify(testId("oats-pages"))}) !== null && now === "[]" ? "none" : ""; })()`, 15);
      check(none === "none", `${at} and no page's row is selected once a thread is shown`, none ?? (await page.evaluate(current)));

      // the thread of an agent OATS stopped: "Stopped", and the act that brings it back
      const digest = threads.get("thr_digest");
      await page.goto(`/projects/${digest.projectId}/threads/${digest.id}`);
      const stopped = await statusOf(page, "stopped");
      check(stopped !== null && stopped.line === "Stopped" && stopped.act === "Start", `${at} the thread of a stopped agent says "Stopped", with Start`, stopped === null ? await rowText(page) : JSON.stringify(stopped));
      await page.shot(`a13-${viewport.name}-thread-stopped`, { targets: true });

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
      // Two failures are two words (S11), in the thread's own row and in the sidebar's.
      const unreachable = threads.get("thr_mockups");
      await page.goto(`/projects/${unreachable.projectId}/threads/${unreachable.id}`);
      const cut = await statusOf(page, "unreachable");
      check(cut !== null && cut.line === "Unreachable" && cut.act === "Retry", `${at} the thread of an agent the kernel cannot reach says "Unreachable", with Retry`, cut === null ? await rowText(page) : JSON.stringify(cut));
      await page.shot(`a16-${viewport.name}-thread-unreachable`, { targets: true });

      const failed = threads.get("thr_harvest");
      await page.goto(`/projects/${failed.projectId}/threads/${failed.id}`);
      const ended = await statusOf(page, "error");
      check(ended !== null && ended.line === "Failed · Its session ended" && ended.act === "Restart", `${at} the thread of an agent whose session fell back to a shell says "Failed", "Its session ended", with Restart`, ended === null ? await rowText(page) : JSON.stringify(ended));
      await page.shot(`a16-${viewport.name}-thread-failed`, { targets: true });

      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const factsOf = (id) => `(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${id}"] ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
      const words = await page.until(`(() => { const rows = [${factsOf(unreachable.id)}, ${factsOf(failed.id)}]; return rows[0].startsWith("Unreachable · ") && rows[1].startsWith("Failed · ") ? JSON.stringify(rows) : ""; })()`, 30);
      check(Boolean(words), `${at} in the sidebar the two rows say "Unreachable" and "Failed", each beside its mark`, words ?? (await page.evaluate(`JSON.stringify([${factsOf(unreachable.id)}, ${factsOf(failed.id)}])`)));
      // And the agent whose bb thread is gone stays in the roster (S3).
      const gone = await page.until(`(document.querySelector(${JSON.stringify(`${testId("oats-agent-row-threadless")}[data-instance="weekly-digest-helper"] ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`, 30);
      check(gone === "Stopped · oats-expert · its bb thread is gone", `${at} the agent whose bb thread is gone stays in the roster, and says so`, gone ?? (await page.evaluate(textOf(testId("oats-tree")))));
      // At 1280 the image of the failed thread already shows the sidebar's rows; at 390 they are in bb's drawer.
      if (viewport.mobile) await page.shot(`a16-${viewport.name}-states`);
    },
  },
  {
    stage: "no-oats",
    name: "stale: OATS cannot be read after it was: the notice, the last observation, the tree as last read",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
      // A titled notice in a person's words, with the age of what is still shown and Retry.
      const notice = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-unreadable"))}); const t = e?.querySelector("h3")?.innerText ?? ""; return t === ${JSON.stringify(`OATS is not installed on ${hostname()}`)} ? JSON.stringify({ title: t, code: e.getAttribute("data-code"), text: e.innerText.replace(/\\s+/g, " "), retry: [...e.querySelectorAll("button")].some((b) => b.innerText.trim() === "Retry"), settings: [...e.querySelectorAll("a")].some((a) => a.innerText.trim() === "Open settings") }) : ""; })()`, 30);
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
      // (The home's own controls are measured when the home is rebuilt, in its piece: no size check on this image.)
      await page.shot(`a14-${viewport.name}-home`);
    },
  },
];
