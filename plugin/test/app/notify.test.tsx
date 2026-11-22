// @vitest-environment jsdom
// The toaster helper (app/ui/notify.ts) and the two additions to the confirmation: the reading
// line in a place's own words, and a result that is not confirmed.
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, Confirm, Modal, Notice, notified, notify } from "../../app/ui";
import type { ConfirmProps } from "../../app/ui";
import { resetWindow } from "../../app/store";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

afterEach(() => {
  cleanup();
  resetWindow();
  toasts.success.mockClear();
  toasts.error.mockClear();
  toasts.warning.mockClear();
});

test("a result goes to bb's toaster with its lines and its Open; it leaves by itself", () => {
  const run = vi.fn();
  notify({ tone: "done", title: "Weekly digest helper started.", lines: ["On a new thread."], open: { label: "Open Weekly digest helper", run } });
  expect(toasts.error).not.toHaveBeenCalled();
  const [title, options] = toasts.success.mock.calls[0]!;
  expect(title).toBe("Weekly digest helper started.");
  expect(options).toMatchObject({ description: "On a new thread.", action: { label: "Open Weekly digest helper" } });
  expect("duration" in options).toBe(false);
  options.action.onClick();
  expect(run).toHaveBeenCalledTimes(1);
});

test("a failure stays until it is dismissed, and is told as a failure", () => {
  notify({ tone: "failed", title: "Weekly digest helper wasn't started" });
  expect(toasts.success).not.toHaveBeenCalled();
  expect(toasts.error.mock.calls[0]).toEqual(["Weekly digest helper wasn't started", { duration: Number.POSITIVE_INFINITY }]);
});

test("a result that is not confirmed is told as a warning, never as a failure or as done, and stays until it is dismissed", () => {
  notify({ tone: "unknown", title: "Retirement accepted", lines: ["Retirement was accepted and will finish in the background."] });
  expect(toasts.success).not.toHaveBeenCalled();
  expect(toasts.error).not.toHaveBeenCalled();
  expect(toasts.warning.mock.calls[0]).toEqual(["Retirement accepted", { description: "Retirement was accepted and will finish in the background.", duration: Number.POSITIVE_INFINITY }]);
});

test("text of OATS or an agent goes through the display filter: no line break reaches bb's toast, and what looks like a secret is withheld", () => {
  notify({ tone: "failed", title: "two\nlines", lines: ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789", ""], open: { label: "Open\u202Ex", run: () => undefined } });
  const [title, options] = toasts.error.mock.calls[0]!;
  expect(title).not.toContain("\n");
  expect(options.description).toBe("[withheld]");
  expect(options.action.label).not.toContain("\u202E");
});

test("a slot test reads what was notified, in order, and a new app window starts with none", () => {
  notify({ tone: "done", title: "one" });
  notify({ tone: "failed", title: "two", lines: ["why"] });
  expect(notified().map((each) => [each.tone, each.title, each.lines])).toEqual([["done", "one", []], ["failed", "two", ["why"]]]);
  resetWindow();
  expect(notified()).toEqual([]);
});

const base: ConfirmProps = { title: "Start Weekly digest helper", about: "weekly-digest-helper", shownFor: null, happens: [], confirmLabel: "Start", phase: { kind: "reading" }, onConfirm: () => undefined, onClose: () => undefined };

test("the confirmation's reading line is the place's own where it gives one, and the pattern's where it gives none", () => {
  const { rerender } = render(<Confirm {...base} />);
  expect(screen.getByTestId("oats-loading").textContent).toBe("Reading the plan from OATS…");
  rerender(<Confirm {...base} phase={{ kind: "reading", text: "Checking instance…" }} />);
  expect(screen.getByTestId("oats-loading").textContent).toBe("Checking instance…");
});

test("a result that is not confirmed is drawn as neither done nor failed: announced, its code after its words, its next step, the focus on Close", () => {
  render(
    <Confirm
      {...base}
      shownFor="weekly-digest-helper"
      phase={{ kind: "done", tone: "unknown", title: "Result not confirmed", lines: ["OATS didn't confirm the result."], code: "OATS_TIMEOUT", actions: <Button>Check again</Button> }}
    />,
  );
  const result = screen.getByTestId("oats-result");
  expect(result.getAttribute("data-tone")).toBe("unknown");
  expect(result.getAttribute("role")).toBe("alert");
  expect(Array.from(result.querySelectorAll("h3, p")).map((node) => node.textContent)).toEqual(["Result not confirmed", "OATS didn't confirm the result.", "OATS_TIMEOUT"]);
  expect(screen.getByText("Check again")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByTestId("oats-confirm-close"));
});

test("a result that is done says no code and is not an alert; a refusal's code stands after its words", () => {
  const { rerender } = render(<Confirm {...base} shownFor="weekly-digest-helper" phase={{ kind: "done", title: "Weekly digest helper started." }} />);
  expect(screen.getByTestId("oats-result").getAttribute("data-tone")).toBe("done");
  expect(screen.getByTestId("oats-result").getAttribute("role")).toBe("status");
  rerender(<Confirm {...base} shownFor="weekly-digest-helper" phase={{ kind: "failed", title: "Weekly digest helper wasn't started", refusal: "OATS refused this start as busy. Nothing was started.", code: "E_SESSION_START_BUSY" }} />);
  expect(Array.from(screen.getByTestId("oats-result").querySelectorAll("p")).map((node) => node.textContent)).toEqual(["OATS refused this start as busy. Nothing was started.", "E_SESSION_START_BUSY"]);
});

test("a dialog that holds more than fits says so, above and below, and stops saying it where there is no more", () => {
  render(
    <Modal title="Stop Weekly digest helper?" footer={<Button>Cancel</Button>} onCancel={() => undefined}>
      <p>a long plan</p>
    </Modal>,
  );
  const body = screen.getByTestId("oats-modal-body");
  expect(screen.queryByTestId("oats-modal-above")).toBeNull();
  expect(screen.queryByTestId("oats-modal-below")).toBeNull();
  // The body's content is taller than the room a phone gives it (jsdom lays nothing out: the sizes are given).
  const sized = (scrollTop: number) => {
    Object.defineProperties(body, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 400 }, scrollTop: { configurable: true, writable: true, value: scrollTop } });
    act(() => void fireEvent.scroll(body));
  };
  sized(0);
  expect(screen.queryByTestId("oats-modal-above")).toBeNull();
  expect(screen.getByTestId("oats-modal-below").textContent).toBe("More below");
  sized(200);
  expect(screen.getByTestId("oats-modal-above").textContent).toBe("More above");
  expect(screen.getByTestId("oats-modal-below")).toBeTruthy();
  sized(500);
  expect(screen.getByTestId("oats-modal-above")).toBeTruthy();
  expect(screen.queryByTestId("oats-modal-below")).toBeNull();
});

test("a confirmation's notice stands above the plan, and only while the plan is under review", () => {
  const notice = <Notice title="Something changed since you opened this" tone="warning" />;
  const { rerender } = render(<Confirm {...base} shownFor="weekly-digest-helper" happens={["Stops its session."]} phase={{ kind: "ready" }} notice={notice} />);
  expect(screen.getByTestId("oats-confirm").firstElementChild).toBe(screen.getByTestId("oats-notice"));
  rerender(<Confirm {...base} shownFor="weekly-digest-helper" happens={["Stops its session."]} phase={{ kind: "running", doing: "Stopping…" }} notice={notice} />);
  expect(screen.queryByTestId("oats-notice")).toBeNull();
});
