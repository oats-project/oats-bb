// A small driver of the image's Chromium over the DevTools protocol, with node's own WebSocket and
// no dependency, and what the live checks ask a page: used by container/live-ui.mjs (the fake
// `oats`) and container/real/scenario.mjs (the real kernel).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- a small DevTools-protocol driver

export async function launchBrowser({ chromium = "chromium", out, base }) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(
    chromium,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, ".chromium")}`, "about:blank"],
    { stdio: "ignore" },
  );
  let version;
  for (let attempt = 0; attempt < 100 && version === undefined; attempt++) {
    await sleep(200);
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      // not listening yet
    }
  }
  if (version === undefined) throw new Error(`browser: ${chromium} did not open its debugging port`);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("browser: no DevTools connection")), { once: true });
  });
  let nextId = 0;
  const waiting = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "exception");
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      waiting.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  /**
   * A page in a browser context of its own, at one viewport. `theme` ("light" or "dark") is bb's
   * own appearance choice: bb 0.50.1 keeps it in the browser's storage under `bb.theme` (what its
   * Settings, Appearance writes: "light", "dark" or "system") and, when it loads, puts the class
   * `dark` on the document's root for "dark". It is set before any script of bb runs.
   */
  async function page(viewport, { theme } = {}) {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const cdp = (method, params) => send(method, params, sessionId);
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    if (theme !== undefined) await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.protocol.startsWith("http")) localStorage.setItem("bb.theme", ${JSON.stringify(theme)});` });
    await cdp("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    if (viewport.mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    const until = async (expression, seconds = 30) => {
      const deadline = Date.now() + seconds * 1000;
      for (;;) {
        let value;
        try {
          value = await evaluate(expression);
        } catch {
          value = undefined; // the page is navigating
        }
        if (value) return value;
        if (Date.now() > deadline) return undefined;
        await sleep(250);
      }
    };
    let clockScript = null;
    return {
      evaluate,
      until,
      /**
       * The page's clock, for a scene on recorded answers: `clock("2026-11-21T20:21:00.000Z")` makes
       * `Date.now()` and `new Date()` in the page start at that instant, from the NEXT navigation on,
       * and go on at the real pace; `clock(null)` gives the real clock back, again from the next
       * navigation. A scene clears it in a `finally`, so that the next scene has the real clock.
       * Only `Date` in the page's documents moves. The plugin's server and OATS keep the real clock,
       * so an instant the server stamps itself ("as of", "showing what was read") is not one to read
       * under it; and in the page a formatter called with no date (`Intl.DateTimeFormat().format()`),
       * a worker and `performance.now()` keep the real clock too.
       */
      clock: async (at) => {
        const then = at === null ? null : Date.parse(at);
        if (then !== null && !Number.isFinite(then)) throw new Error(`browser: clock(${JSON.stringify(at)}) is not an instant`);
        if (clockScript !== null) {
          await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: clockScript });
          clockScript = null;
        }
        if (then === null) return;
        clockScript = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source: shiftedDate(then - Date.now()) })).identifier;
      },
      goto: async (path) => {
        await cdp("Page.navigate", { url: base + path });
        await until("document.readyState === 'complete'", 30);
      },
      shot: async (name) => {
        const { data } = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
        console.log(`     screenshot ${name}.png`);
      },
      /**
       * Presses a key as a person does (a real key event of the browser, which moves the focus on
       * Tab and closes a dialog on Escape): "Tab", "Shift+Tab", "Enter", "Escape", " ", an arrow.
       */
      press: async (combination) => {
        const { event, type } = keyEvent(combination);
        await cdp("Input.dispatchKeyEvent", { type, ...event });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
      },
      /** Turns the mouse wheel over a point of the page, as a person scrolls what is under the pointer (`deltaY` < 0: up). */
      wheel: async (x, y, deltaY) => {
        await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
      },
      /**
       * Holds bb's modifiers down ("Control+Shift"), as a person does to see bb's key hints, until
       * the function it returns is called (the keys are let go, last first).
       */
      hold: async (modifiers) => {
        const names = modifiers.split("+");
        let held = 0;
        for (const name of names) {
          held |= MODIFIERS[name].bit;
          await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: MODIFIERS[name].code, windowsVirtualKeyCode: MODIFIERS[name].vk, modifiers: held });
          await new Promise((resolve) => setTimeout(resolve, 1200)); // a person's hand: one key, then the next (bb shows its hints for a key that is HELD)
        }
        return async () => {
          for (const name of [...names].reverse()) {
            held &= ~MODIFIERS[name].bit;
            await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: MODIFIERS[name].code, windowsVirtualKeyCode: MODIFIERS[name].vk, modifiers: held });
          }
        };
      },
      close: () => send("Target.disposeBrowserContext", { browserContextId }),
    };
  }
  return {
    page,
    errors,
    close: async () => {
      socket.close();
      child.kill("SIGTERM");
    },
  };
}

const MODIFIERS = { Alt: { bit: 1, code: "AltLeft", vk: 18 }, Control: { bit: 2, code: "ControlLeft", vk: 17 }, Shift: { bit: 8, code: "ShiftLeft", vk: 16 } };
/** A key press as the browser's own event: "Tab", "Shift+Tab", "Control+Shift+]" (bb's next thread). A key with a modifier other than Shift types no text. */
function keyEvent(combination) {
  const parts = combination === "+" ? ["+"] : combination.split("+");
  const key = parts.pop();
  const code = KEYS[key];
  if (code === undefined) throw new Error(`browser: no key "${key}"`);
  let modifiers = 0;
  for (const name of parts) {
    if (MODIFIERS[name] === undefined) throw new Error(`browser: no modifier "${name}"`);
    modifiers |= MODIFIERS[name].bit;
  }
  const typed = code.text !== undefined && (modifiers & ~MODIFIERS.Shift.bit) === 0;
  return { type: typed ? "keyDown" : "rawKeyDown", event: { key: modifiers & MODIFIERS.Shift.bit ? (code.shifted ?? key) : key, code: code.code, windowsVirtualKeyCode: code.vk, modifiers, ...(typed ? { text: code.text } : {}) } };
}

const KEYS = {
  Tab: { code: "Tab", vk: 9 },
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Escape: { code: "Escape", vk: 27 },
  " ": { code: "Space", vk: 32, text: " " },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  "[": { code: "BracketLeft", vk: 219, shifted: "{" },
  "]": { code: "BracketRight", vk: 221, shifted: "}" },
};

// ---- what the page is asked

/** What holds the focus, as a person would name it: its test id, else its accessible name or its text. */
export const FOCUSED = `(() => { const e = document.activeElement; if (!e || e === document.body) return ""; return e.getAttribute("data-testid") || e.getAttribute("aria-label") || (e.innerText ?? "").replace(/\\s+/g, " ").trim() || e.tagName.toLowerCase(); })()`;

/**
 * The script that shifts `Date` in a page by `shift` ms (page.clock). `Date` stays a faithful Date:
 * a function on the real prototype, not a subclass, so that `Date()` without `new` answers a string,
 * a Date the browser makes itself (a structured clone, a message, a stored value) is still
 * `instanceof Date`, and its name is "Date". Only "now" moves: `new Date()` and `Date.now()`.
 */
export const shiftedDate = (shift) =>
  `(() => { const Real = Date; const shift = ${Number(shift)}; function Shifted(...args) { if (new.target === undefined) return new Real(Real.now() + shift).toString(); return Reflect.construct(Real, args.length === 0 ? [Real.now() + shift] : args, new.target); } Object.defineProperty(Shifted, "name", { value: "Date" }); Shifted.prototype = Real.prototype; Shifted.now = () => Real.now() + shift; Shifted.parse = Real.parse; Shifted.UTC = Real.UTC; Real.prototype.constructor = Shifted; globalThis.Date = Shifted; })();`;

/**
 * The plugin's controls on screen that are lower than a person can press: under `min` px (32 at
 * 1280, 44 at phone width). A link inside a sentence or a value (an inline one) is text, not a
 * control, and is not held to it. → a JSON list of "<what> <height>px"; empty when every one is high enough.
 */
const CONTROL = 'button, a[href], input, select, textarea, summary, [role="tab"], [role="radio"], [role="switch"], [role="menuitem"]';
export const lowTargets = (min) =>
  `JSON.stringify([...document.querySelectorAll('[data-testid^="oats-"]')].flatMap((root) => [root, ...root.querySelectorAll('${CONTROL}')]).filter((e, i, all) => all.indexOf(e) === i && e.matches('${CONTROL}')).filter((e) => getComputedStyle(e).display !== "inline").map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0 && r.height < ${min} - 0.5).map(([e, r]) => (e.getAttribute("data-testid") || e.getAttribute("aria-label") || (e.innerText ?? "").trim().slice(0, 30) || e.tagName.toLowerCase()) + " " + Math.round(r.height) + "px"))`;

/**
 * Every block `selector` finds that is drawn, measured for EMPTY ROOM: a block is as high as what it
 * holds. Its content boxes are the elements that hold text of their own, the controls and the marks,
 * and every FRAME in it: an element with a visible border or a background of its own (a card, a fact
 * box) is a thing a person sees, so toward its neighbours it is one box, measured to its border; and
 * its inside is measured as a block of its own (from its border to its first and last line: its
 * padding). `worst` is the largest empty gap between two vertical neighbours, in the block or in any
 * frame inside it; `edge` the largest at a top or a bottom; `boxes` each box of the block's own
 * level as [top, bottom, its first words], and `frames` the same for each frame, for a failing check
 * to print. A line stretched to ten times its height, or a row kept for something that was cut,
 * shows as a gap: no check of words can see it. What a closed fold holds is not drawn, and not measured.
 * → JSON `[{ worst, edge, height, boxes, frames }]`.
 */
const GAPS = String.raw`(root) => {
  const drawn = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && (e.checkVisibility?.() ?? true);
  const control = (e) => e.matches("button, input, textarea, select, [data-mark]");
  const seen = (color) => color !== "" && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color);
  const frame = (e) => { if (control(e)) return false; const c = getComputedStyle(e); return (["Top", "Bottom"].some((side) => parseFloat(c["border" + side + "Width"]) > 0 && c["border" + side + "Style"] !== "none" && seen(c["border" + side + "Color"])) && e.getBoundingClientRect().height > 0) || seen(c.backgroundColor); };
  const words = (e) => ((e.innerText ?? "").replace(/\s+/g, " ").trim() || e.getAttribute("placeholder") || e.tagName.toLowerCase()).slice(0, 28);
  const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), words(e)]; };
  const frames = [];
  const measure = (block) => {
    const boxes = [];
    const walk = (e) => {
      for (const child of e.children) {
        if (!drawn(child)) continue;
        if (frame(child)) { boxes.push(box(child)); frames.push(measure(child)); continue; }
        if (control(child)) { boxes.push(box(child)); continue; }
        if ([...child.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "")) boxes.push(box(child));
        walk(child);
      }
    };
    walk(block);
    const kept = boxes.filter(([top, bottom]) => bottom > top).sort((x, y) => x[0] - y[0]);
    const r = block.getBoundingClientRect();
    let reach = kept.length ? kept[0][1] : r.top;
    let worst = 0;
    for (const [top, bottom] of kept) { worst = Math.max(worst, top - reach); reach = Math.max(reach, bottom); }
    const edge = kept.length ? Math.max(kept[0][0] - r.top, r.bottom - reach) : 0;
    return { worst: Math.round(worst), edge: Math.round(edge), height: Math.round(r.height), boxes: kept };
  };
  const own = measure(root);
  return { worst: Math.max(own.worst, ...frames.map((each) => each.worst)), edge: Math.max(own.edge, ...frames.map((each) => each.edge)), height: own.height, boxes: own.boxes, frames: frames.filter((each) => each.boxes.length > 0).map((each) => ({ worst: each.worst, edge: each.edge, height: each.height, boxes: each.boxes })) };
}`;
export const gapsIn = (selector) => `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].filter((root) => root.getClientRects().length > 0).map(${GAPS}))`;
/** The most empty room a block may hold between two of its lines, or at an edge: a gap of the pattern book's, never a line's height or more. */
export const MAX_GAP = 24;
/** Whether every measured block (`gapsIn`) holds no gap over MAX_GAP, and there is at least one. */
export const tight = (measured) => measured.length > 0 && measured.every((block) => block.worst <= MAX_GAP && block.edge <= MAX_GAP);
/** The blocks that are not tight, for a failing check to print. */
export const loose = (measured) => JSON.stringify(measured.filter((block) => block.worst > MAX_GAP || block.edge > MAX_GAP));

/** On screen and not covered: the point at the element's middle (clamped to the viewport) is its own. */
export const visible = (selector) =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + Math.min(r.height / 2, 40), 0), innerHeight - 1); const top = document.elementFromPoint(x, y); return top !== null && (e.contains(top) || top.contains(e)); })()`;
export const testId = (id) => `[data-testid="${id}"]`;
export const texts = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.innerText.replace(/\\s+/g, " ").trim())`;
/**
 * The same two reads with a glyph that has a name read BY its name, as a person reads it: the
 * plugin's "tmux" mark is bb's terminal glyph, named "tmux" (app/ui/tmux.tsx), and a glyph is no
 * text of the page. The name is put in the mark for the length of the read, in one evaluation:
 * nothing is painted meanwhile. (Where the mark is the word, there is nothing to add.)
 */
const NAMED = `(read) => { const marks = [...document.querySelectorAll('[data-testid="oats-tmux"][data-tmux="glyph"]')]; const added = marks.map((mark) => mark.appendChild(document.createTextNode(mark.getAttribute("aria-label") ?? ""))); try { return read(); } finally { for (const node of added) node.remove(); } }`;
export const textsNamed = (selector) => `(${NAMED})(() => ${texts(selector)})`;
export const textOfNamed = (selector) => `(${NAMED})(() => ${textOf(selector)})`;
/** The plugin's "tmux" marks on the page, as drawn: how many are the glyph (with its name and a drawing of some size), how many the word. */
export const tmuxMarks = `JSON.stringify((() => { const marks = [...document.querySelectorAll('[data-testid="oats-tmux"]')].filter((mark) => mark.getClientRects().length > 0); const glyphs = marks.filter((mark) => mark.getAttribute("data-tmux") === "glyph"); return { marks: marks.length, glyphs: glyphs.length, named: glyphs.filter((mark) => mark.getAttribute("role") === "img" && mark.getAttribute("aria-label") === "tmux" && mark.innerText.trim() === "").length, drawn: glyphs.filter((mark) => { const drawing = mark.querySelector('[aria-hidden="true"] > *'); return drawing !== null && drawing.getBoundingClientRect().width >= 8; }).length }; })())`;
export const textOf = (selector) => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;

/**
 * Types `value` into an input or a textarea as a person does, so that React sees it (the native
 * setter, then an `input` event), and brings the field into view.
 */
export const fill = (selector, value) =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const kind = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(kind.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); e.scrollIntoView({ block: "center" }); return true; })()`;

/** At phone width the thread list is in bb's drawer: open it with bb's own toggle. */
export async function showSidebar(page, viewport, { fold = "open" } = {}) {
  const shown = await showsSidebar(page, viewport);
  // The roster's parents are closed when the page loads (the fold). A scene that reads a child's
  // row opens them, as a person does: every chevron pressed. `fold: "asLoaded"` leaves the tree as
  // the page drew it (the fold's own scene, and the image of the sidebar as a fresh install shows it).
  if (shown && fold === "open") await openParents(page);
  return shown;
}

async function showsSidebar(page, viewport) {
  if (await page.until(visible(testId("oats-sidebar")), viewport.mobile ? 4 : 30)) return true;
  if (!viewport.mobile) return false;
  await page.evaluate(
    // bb's own button, never one of the plugin's: a parent's chevron is named for its agent ("Show Desktop sidebar developer's agents"), and pressing it would open that parent, not the drawer.
    `(() => { const b = [...document.querySelectorAll("button")].find((b) => /sidebar|menu|navigation/i.test(b.getAttribute("aria-label") ?? "") && b.getBoundingClientRect().width > 0 && b.closest(${JSON.stringify(testId("oats-sidebar"))}) === null); b?.click(); return b?.getAttribute("aria-label") ?? null; })()`,
  );
  await sleep(600); // the drawer slides in
  return Boolean(await page.until(visible(testId("oats-sidebar")), 15));
}

/**
 * Presses the chevron of every closed parent of the roster's tree, one at a time, until none is
 * closed (a child that is a parent too is closed when its parent opens). Each press is WAITED
 * for: the parent says it is open before the next closed one is looked for. (Pressed in one go
 * with no wait, the page had not always drawn the first press when the second looked: the same
 * chevron was then pressed again and again.) It waits a little for the tree first: a sidebar
 * with no roster (not read, no agents) has nothing to open. → how many it pressed.
 */
export async function openParents(page) {
  await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-tree")}, ${testId("oats-no-agents")}`)}) !== null`, 5);
  const toggle = `${testId("oats-sidebar")} ${testId("oats-row-toggle")}`;
  let pressed = 0;
  for (; pressed < 200; pressed += 1) {
    const instance = await page.evaluate(`(() => { const closed = document.querySelector(${JSON.stringify(`${toggle}[aria-expanded="false"]`)}); if (!closed) return null; closed.click(); return closed.getAttribute("data-instance"); })()`);
    if (typeof instance !== "string") return pressed;
    const opened = await page.until(`[...document.querySelectorAll(${JSON.stringify(toggle)})].some((each) => each.getAttribute("data-instance") === ${JSON.stringify(instance)} && each.getAttribute("aria-expanded") === "true") ? "1" : ""`, 10);
    if (!opened) throw new Error(`openParents: the chevron of ${instance} was pressed and its parent did not open`);
  }
  return pressed;
}

