// @vitest-environment jsdom
// One press is one read, counted where it costs: at the `oats` PROCESS. The view is mounted on the
// whole backend (bb's fake plugin host, the real server and host entries, the fake `oats` printing
// the recorded mail: test/support/backend.ts), so each read the view asks for is a process the
// fake logs. bb mounts its side panel's content a second time now and then, a fraction of a second
// after it opens: that mount must start none.
import { afterEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Mail } from "../../app/mail";
import { FRESH_MS } from "../../app/ui/words";
import { handlers, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  resetApp();
  vi.useRealTimers();
  await backend?.dispose();
  backend = undefined;
});

const AGENT = "redesign-ui-lead";
const NOW = Date.parse("2026-11-25T12:15:00.000Z");
/** The `oats` processes started for the mail read, by the fake's own log. */
const processes = async (): Promise<number> => (await (backend as Backend).fake.calls()).filter((call) => call.verb === "operation run messaging:mail").length;
/** The view, mounted at `at` by the window's clock, its read going through the whole backend to a process. */
function mount(at: number) {
  vi.useFakeTimers({ now: at, toFake: ["Date"] });
  return renderSlot<{ instance: string }, Contract>({ component: Mail }, { instance: AGENT }, { rpc: handlers({ mail: (input) => (backend as Backend).rpc("mail", input) }) });
}
/** Long enough for a read the view had started to reach the fake `oats` (a real wait: only the date is the test's). */
const settle = () => new Promise((done) => setTimeout(done, 400));

test("a view mounted again INSIDE the bound starts NO `oats` process: the press's one read is the only one", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  backend = await startBackend();
  const first = mount(NOW);
  await first.findByTestId("oats-mail-list");
  expect(await processes()).toBe(1);
  first.unmount();
  // bb's second mount of its side panel: 300 ms after the first.
  const again = mount(NOW + 300);
  await again.findByTestId("oats-mail-list");
  await settle();
  expect(await processes()).toBe(1);
  again.unmount();
  // And once more, one millisecond short of the bound.
  const last = mount(NOW + FRESH_MS - 1);
  await last.findByTestId("oats-mail-list");
  await settle();
  expect(await processes()).toBe(1);
}, 30_000);

test("a view mounted again AFTER the bound starts one `oats` process, and only one", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  backend = await startBackend();
  const first = mount(NOW);
  await first.findByTestId("oats-mail-list");
  expect(await processes()).toBe(1);
  first.unmount();
  const later = mount(NOW + FRESH_MS);
  await later.findByTestId("oats-mail-list");
  await waitFor(async () => expect(await processes()).toBe(2), { timeout: 10_000 });
  await settle();
  expect(await processes()).toBe(2);
}, 30_000);
