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
    return {
      evaluate,
      until,
      goto: async (path) => {
        await cdp("Page.navigate", { url: base + path });
        await until("document.readyState === 'complete'", 30);
      },
      shot: async (name) => {
        const { data } = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
        console.log(`     screenshot ${name}.png`);
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

// ---- what the page is asked

/** On screen and not covered: the point at the element's middle (clamped to the viewport) is its own. */
export const visible = (selector) =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + Math.min(r.height / 2, 40), 0), innerHeight - 1); const top = document.elementFromPoint(x, y); return top !== null && (e.contains(top) || top.contains(e)); })()`;
export const testId = (id) => `[data-testid="${id}"]`;
export const texts = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.innerText.replace(/\\s+/g, " ").trim())`;
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

