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
        const shift = combination.startsWith("Shift+");
        const key = shift ? combination.slice(6) : combination;
        const code = KEYS[key];
        if (code === undefined) throw new Error(`browser: no key "${key}"`);
        const event = { key, code: code.code, windowsVirtualKeyCode: code.vk, modifiers: shift ? 8 : 0, ...(code.text ? { text: code.text } : {}) };
        await cdp("Input.dispatchKeyEvent", { type: code.text ? "keyDown" : "rawKeyDown", ...event });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
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
export async function showSidebar(page, viewport) {
  if (await page.until(visible(testId("oats-sidebar")), viewport.mobile ? 4 : 30)) return true;
  if (!viewport.mobile) return false;
  await page.evaluate(
    `(() => { const b = [...document.querySelectorAll("button")].find((b) => /sidebar|menu|navigation/i.test(b.getAttribute("aria-label") ?? "") && b.getBoundingClientRect().width > 0); b?.click(); return b?.getAttribute("aria-label") ?? null; })()`,
  );
  await sleep(600); // the drawer slides in
  return Boolean(await page.until(visible(testId("oats-sidebar")), 15));
}

