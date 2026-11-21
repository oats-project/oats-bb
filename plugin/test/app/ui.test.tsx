// @vitest-environment jsdom
// The patterns and the controls of app/ui.tsx (the UX standard, section 3), each by what a person
// and a screen reader get from it. No bb: they are plain components.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Button, Card, Code, Confirm, CopyButton, DisabledReason, Disclosure, Empty, Fact, Facts, Field, Loading, Menu, Notice, Result, SearchField, Section, Segmented, Stale, State, StateMark, StatusLine, Switch, Tabs, Toned } from "../../app/ui";
import type { ConfirmProps } from "../../app/ui";
import type { AgentState } from "../../model/types";
import { instanceDisplayName, readAge, STATE, waitedText, waitingClock, waitingDetail, waitingLabel, waitingSince } from "../../app/ui/words";

afterEach(cleanup);

const STATES: AgentState[] = ["needs-you", "working", "idle", "stopped", "error", "unreachable"];

describe("the words", () => {
  test("each state has one word and one accessible name: the standard's words, the Desktop's names", () => {
    expect(STATES.map((state) => `${STATE[state].word} / ${STATE[state].name}`)).toEqual([
      "Needs you / Needs input",
      "Working / running",
      "Idle / status unknown",
      "Stopped / stopped",
      "Failed / failed",
      "Unreachable / unreachable",
    ]);
  });

  test("an instance's name as words: dashes are spaces, the first letter is a capital, nothing else changes", () => {
    expect(instanceDisplayName("oats-expert-maintainer-lanes")).toBe("Oats expert maintainer lanes");
    expect(instanceDisplayName("tui-leader-hint-developer-2")).toBe("Tui leader hint developer 2");
    expect(instanceDisplayName("x")).toBe("X");
    expect(instanceDisplayName("already Words")).toBe("Already Words");
    expect(instanceDisplayName("a--b-")).toBe("A b");
    for (const nothing of [undefined, null, 7, "", "---", " - "]) expect(instanceDisplayName(nothing)).toBe("");
  });

  test("a claim's reason in words, never the raw reason; its detail is the message, else the reason, else nothing", () => {
    const claim = (reason: string | null, message: string | null = null) => ({ reason, message, since: null });
    expect(waitingLabel(claim("permission"))).toBe("Waiting for a tool approval");
    expect(waitingLabel(claim("question"))).toBe("Asked you a question");
    expect(waitingLabel(claim("attention"))).toBe("Asked for your attention");
    for (const unknown of [claim("toString"), claim("whatever"), claim(null), null]) expect(waitingLabel(unknown)).toBe("Needs input");
    expect(waitingDetail(claim("question", "Which branch?"))).toBe("Which branch?");
    expect(waitingDetail(claim("question"))).toBe("Asked you a question");
    expect(waitingDetail(claim("whatever"))).toBeNull();
    expect(waitingDetail(null)).toBeNull();
  });

  test("how long it has waited, and since when, next to now", () => {
    const now = new Date(2026, 10, 21, 14, 30).getTime();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect([waitedText(ago(20_000), now), waitedText(ago(12 * 60_000), now), waitedText(ago(3 * 3_600_000), now), waitedText(ago(50 * 3_600_000), now)]).toEqual(["under a minute", "12 min", "3 h", "2 d"]);
    expect(waitedText(new Date(now + 60_000).toISOString(), now)).toBe("under a minute"); // a clock ahead of ours
    expect(waitedText("not a date", now)).toBe("under a minute");
    expect(waitingClock(new Date(2026, 10, 21, 14, 3).toISOString(), now)).toBe("14:03");
    expect(waitingClock(new Date(2026, 9, 2, 9, 5).toISOString(), now)).toBe("Oct 2, 09:05");
    expect(waitingClock(new Date(2025, 9, 2, 14, 3).toISOString(), now)).toBe("2025-10-02 14:03");
    expect(waitingClock("not a date", now)).toBe("");
    expect(waitingSince(new Date(2026, 10, 21, 14, 3).toISOString(), now)).toBe("waiting 27 min (since 14:03)");
    expect(waitingSince(null, now)).toBeNull();
    expect(waitingSince("not a date", now)).toBeNull();
    expect([readAge(now - 5_000, now), readAge(ago(2 * 60_000), now), readAge(ago(3 * 3_600_000), now), readAge(ago(49 * 3_600_000), now)]).toEqual(["just now", "2 min ago", "3 h ago", "2 d ago"]);
  });
});

describe("a state", () => {
  test("is its mark and its word; the mark beside a word is hidden from a screen reader", () => {
    for (const state of STATES) {
      const { container, unmount } = render(<State state={state} />);
      expect(container.textContent).toBe(state === "needs-you" ? `!${STATE[state].word}` : STATE[state].word);
      const mark = container.querySelector(`[data-testid="oats-state"] [data-state="${state}"]`)!;
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector('[role="img"]')).toBeNull();
      unmount();
    }
  });

  test("a mark that stands alone says the state's name, or what the caller says for it", () => {
    render(
      <>
        {STATES.map((state) => (
          <StateMark key={state} state={state} />
        ))}
        <StateMark state="needs-you" name="Needs input: Asked you a question, since 14:03" />
      </>,
    );
    expect(screen.getAllByRole("img").map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Needs input",
      "running",
      "status unknown",
      "stopped",
      "failed",
      "unreachable",
      "Needs input: Asked you a question, since 14:03",
    ]);
    // The agent that waits has the Desktop's "!" in the dot's place.
    expect(screen.getAllByRole("img").map((mark) => mark.textContent)).toEqual(["!", "", "", "", "", "", "!"]);
  });

  test("the status line: the word, since when, the question, and the act; text from an agent is filtered", () => {
    render(<StatusLine state="needs-you" since="waiting 12 min (since 14:03)" detail={"Which\nbranch? token=abc123"} action={<Button>Open</Button>} />);
    const line = screen.getByTestId("oats-status-line");
    expect(line.textContent).toBe("!Needs you· waiting 12 min (since 14:03)· [withheld]Open");
    expect(within(line).getByRole("button", { name: "Open" })).toBeTruthy();
    cleanup();
    render(<StatusLine state="working" since={null} detail="" />);
    expect(screen.getByTestId("oats-status-line").textContent).toBe("Working");
  });
});

describe("facts, notices and the states of a list", () => {
  test("a fact is a label and its value, in a description list", () => {
    render(
      <Facts>
        <Fact label="Branch">agents/flaky-ci</Fact>
        <Fact label="Soul">
          <a href="/plugins/oats/souls/oats-developer">oats-developer</a>
        </Fact>
        <Fact label="Model">{null}</Fact>
        <Fact label="Harness">{""}</Fact>
      </Facts>,
    );
    // A fact with no value is left out, label and all.
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Branch", "Soul"]);
    expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual(["agents/flaky-ci", "oats-developer"]);
    expect(screen.getByRole("link", { name: "oats-developer" })).toBeTruthy();
  });

  test("a notice: its title, its sentences, the age of what is still shown, the code after the words, its acts", () => {
    const retry = vi.fn();
    render(
      <Notice title="OATS could not be read" tone="error" code="OATS_TIMEOUT" age="2 min ago" actions={<Button onClick={retry}>Retry</Button>}>
        <p>The machine did not answer in time.</p>
      </Notice>,
    );
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toBe("OATS could not be readThe machine did not answer in time.Showing what was read 2 min ago.OATS_TIMEOUTRetry");
    expect(within(notice).getByRole("heading").textContent).toBe("OATS could not be read");
    fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();
    // A notice that is no failure is announced politely, and shows no code and no age it was not given.
    render(<Notice title="No deployment is set">Choose the directory in the settings.</Notice>);
    expect(screen.getByRole("status").textContent).toBe("No deployment is setChoose the directory in the settings.");
  });

  test("empty, loading and stale each say what they are; loading and stale are announced", () => {
    render(
      <>
        <Empty action={<Button>New agent</Button>}>No agents yet.</Empty>
        <Loading>Reading your agents…</Loading>
        <Stale age="2 min ago" held="Acts are held until OATS is read again." />
        <Stale age="just now" refreshing />
      </>,
    );
    expect(screen.getByTestId("oats-empty").textContent).toBe("No agents yet.New agent");
    expect(screen.getAllByRole("status").map((said) => said.textContent)).toEqual([
      "Reading your agents…",
      "Showing what was read 2 min ago.Acts are held until OATS is read again.",
      "Refreshing… showing what was read just now.",
    ]);
  });

  test("a result: done is said politely; a failure is an alert, with the code after the words", () => {
    render(
      <>
        <Result title="Weekly digest was stopped.">
          <p>Its home and its work are kept.</p>
        </Result>
        <Result title="Weekly digest could not be stopped." tone="failed" code="E_SESSION_STOP_FAILED" actions={<Button>Try again</Button>}>
          <p>Its session did not end.</p>
        </Result>
      </>,
    );
    expect(screen.getByRole("status").textContent).toBe("Weekly digest was stopped.Its home and its work are kept.");
    expect(screen.getByRole("alert").textContent).toBe("Weekly digest could not be stopped.Its session did not end.E_SESSION_STOP_FAILEDTry again");
  });

  test("a field names its control, says it is optional, and announces its refusal; a disabled button has its reason beside it", () => {
    render(
      <>
        <Field label="Name" optional hint="OATS numbers it when you leave it empty." error="Lower-case letters, digits and dashes.">
          <input defaultValue="Bad Name" />
        </Field>
        <Button disabled>Spawn</Button>
        <DisabledReason>Reading the preview…</DisabledReason>
      </>,
    );
    expect(screen.getByLabelText(/^Name · optional/)).toBe(screen.getByRole("textbox"));
    expect(screen.getByRole("alert").textContent).toBe("Lower-case letters, digits and dashes.");
    expect(screen.getByTestId("oats-disabled-reason").textContent).toBe("Reading the preview…");
  });
});

describe("a state that is not an agent's, and a page's section", () => {
  test("a toned state is a dot and its words; the dot is hidden from a screen reader", () => {
    render(<Toned tone="warn">Wrong account here</Toned>);
    const toned = screen.getByTestId("oats-toned");
    expect([toned.getAttribute("data-tone"), toned.textContent]).toEqual(["warn", "Wrong account here"]);
    expect(toned.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(toned.querySelector('[role="img"]')).toBeNull();
  });

  test("a section is a heading, with its count where it lists things, and what is under it", () => {
    render(
      <Section title="Runs" n={3}>
        <p>the runs</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Runs3");
    expect(screen.getByTestId("oats-section").textContent).toBe("Runs3the runs");
  });
});

describe("what the panel's header and a refusal's details need", () => {
  test("a state can print the Desktop's own word for a place, with the state's mark; the status line too", () => {
    render(
      <>
        <State state="working" word="Running" />
        <StatusLine state="working" word="Running" since="42m" />
      </>,
    );
    expect(screen.getAllByTestId("oats-state").map((state) => [state.getAttribute("data-state"), state.textContent])).toEqual([
      ["working", "Running"],
      ["working", "Running"],
    ]);
    expect(screen.getByTestId("oats-status-line").textContent).toBe("Running· 42m");
  });

  test("a notice keeps the kernel's own message one press away, under Details, each of its lines whole", () => {
    render(
      <Notice title="Weekly digest could not be started" tone="error" details={"E_SESSION_START_FAILED: bb thread spawn failed\nthe provider is not signed in"}>
        Sign the provider in, then start it again.
      </Notice>,
    );
    const details = screen.getByTestId("oats-notice-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Details");
    expect(Array.from(details.querySelectorAll("p")).map((line) => line.textContent)).toEqual(["E_SESSION_START_FAILED: bb thread spawn failed", "the provider is not signed in"]);
    cleanup();
    render(<Notice title="Nothing more to say" details="" />);
    expect(screen.queryByTestId("oats-notice-details")).toBeNull();
  });

  test("a disclosure is closed until pressed, and can be controlled", () => {
    const { rerender } = render(
      <Disclosure summary="Paths" testId="paths" open={false}>
        <p>/abs/home</p>
      </Disclosure>,
    );
    const paths = screen.getByTestId("paths") as HTMLDetailsElement;
    expect(paths.open).toBe(false);
    rerender(
      <Disclosure summary="Paths" testId="paths" open>
        <p>/abs/home</p>
      </Disclosure>,
    );
    expect(paths.open).toBe(true);
  });

  test("a copy button can say more to a screen reader than its label; a card can have a second part; a kernel word is drawn as code, filtered", () => {
    render(
      <>
        <CopyButton text="/abs/home" label="Copy" name="Copy home path" />
        <Card title="Work" footer={<p>the paths</p>}>
          <p>On its own branch.</p>
        </Card>
        <p>
          Run <Code>{"oats\tstatus"}</Code>
        </p>
      </>,
    );
    expect(screen.getByRole("button", { name: "Copy home path" }).textContent).toBe("Copy");
    const card = screen.getByRole("region", { name: "Work" });
    expect(card.textContent).toBe("WorkOn its own branch.the paths");
    expect(document.querySelector("code")!.textContent).toBe("oats status");
  });
});

describe("the controls", () => {
  function TabsHarness() {
    const [value, setValue] = useState<"schedules" | "triggers" | "history">("schedules");
    return (
      <>
        <Tabs label="Automations" panelId="automations" value={value} onChange={setValue} tabs={[{ id: "schedules", label: "Schedules", count: 3 }, { id: "triggers", label: "Triggers", count: 0 }, { id: "history", label: "History" }]} />
        <div role="tabpanel" id="automations" aria-labelledby={`automations-tab-${value}`}>
          {value}
        </div>
      </>
    );
  }

  test("tabs: one is selected and in the tab order; the arrows, Home and End move the selection and the focus", () => {
    render(<TabsHarness />);
    const tabs = () => screen.getAllByRole("tab");
    const selected = () => tabs().map((tab) => tab.getAttribute("aria-selected"));
    expect(screen.getByRole("tablist", { name: "Automations" })).toBeTruthy();
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Schedules3", "Triggers0", "History"]);
    expect(selected()).toEqual(["true", "false", "false"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole("tabpanel", { name: /^Schedules/ }).textContent).toBe("schedules");
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    expect(selected()).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(tabs()[1]);
    fireEvent.keyDown(tabs()[1]!, { key: "End" });
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tabs()[2]!, { key: "ArrowRight" }); // wraps
    expect(selected()).toEqual(["true", "false", "false"]);
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(screen.getByRole("tabpanel").textContent).toBe("history");
    fireEvent.click(tabs()[1]!);
    expect(screen.getByRole("tabpanel").textContent).toBe("triggers");
  });

  test("a segmented filter is a radio group: one is checked, a click or an arrow checks another", () => {
    function Harness() {
      const [value, setValue] = useState<"all" | "workspace" | "local">("all");
      return <Segmented label="Show" value={value} onChange={setValue} options={[{ id: "all", label: "All" }, { id: "workspace", label: "Workspace" }, { id: "local", label: "Local" }]} />;
    }
    render(<Harness />);
    const radios = () => screen.getAllByRole("radio");
    const checked = () => radios().map((radio) => radio.getAttribute("aria-checked"));
    expect(screen.getByRole("radiogroup", { name: "Show" })).toBeTruthy();
    expect(checked()).toEqual(["true", "false", "false"]);
    fireEvent.click(radios()[2]!);
    expect(checked()).toEqual(["false", "false", "true"]);
    fireEvent.keyDown(radios()[2]!, { key: "ArrowLeft" });
    expect(checked()).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(radios()[1]);
  });

  test("a search field has its name, tells what is typed, and Escape clears it", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return <SearchField label="Filter schedules" value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const field = screen.getByRole("searchbox", { name: "Filter schedules" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "digest" } });
    expect(field.value).toBe("digest");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("");
  });

  test("a switch says what it switches and whether it is on; a press asks for the other", () => {
    const asked: boolean[] = [];
    const { rerender } = render(<Switch label="Weekly digest" checked={false} onChange={(next) => asked.push(next)} />);
    const control = screen.getByRole("switch", { name: /Weekly digest/ });
    expect([control.getAttribute("aria-checked"), control.textContent]).toEqual(["false", "Weekly digestOff"]);
    fireEvent.click(control);
    rerender(<Switch label="Weekly digest" checked onChange={(next) => asked.push(next)} />);
    expect([control.getAttribute("aria-checked"), control.textContent]).toEqual(["true", "Weekly digestOn"]);
    fireEvent.click(control);
    expect(asked).toEqual([true, false]);
    rerender(<Switch label="Weekly digest" checked disabled onChange={(next) => asked.push(next)} />);
    fireEvent.click(control);
    expect(asked).toEqual([true, false]);
  });

  test("a menu: its button is named, it opens on its first item, the arrows move, Escape closes and returns the focus, an item that is off says why", () => {
    const picked: string[] = [];
    render(
      <Menu
        label="Actions for Weekly digest"
        items={[
          { id: "run", label: "Run now", onSelect: () => picked.push("run") },
          { id: "edit", label: "Edit…", onSelect: () => picked.push("edit"), disabled: true, reason: "Defined in the workspace file." },
          { id: "remove", label: "Remove…", onSelect: () => picked.push("remove"), destructive: true },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "Actions for Weekly digest" });
    expect([button.getAttribute("aria-haspopup"), button.getAttribute("aria-expanded")]).toEqual(["menu", "false"]);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const items = () => screen.getAllByRole("menuitem");
    expect(items().map((item) => item.textContent)).toEqual(["Run now", "Edit…Defined in the workspace file.", "Remove…"]);
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.click(items()[1]!); // off: nothing is picked and the menu stays
    expect(picked).toEqual([]);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(items()[1]!, { key: "End" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(items()[2]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: "ArrowDown" });
    fireEvent.click(items()[0]!);
    expect(picked).toEqual(["run"]);
    expect(screen.queryByRole("menu")).toBeNull();
    // A press outside closes it.
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("a copy button copies its text and says so for two seconds; where the clipboard is absent it says that it could not", async () => {
    vi.useFakeTimers();
    try {
      const copied: string[] = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
      render(<CopyButton text="oats session attach --home /abs/home" label="Copy command" />);
      const button = screen.getByRole("button", { name: "Copy command" });
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(copied).toEqual(["oats session attach --home /abs/home"]);
      expect(button.textContent).toBe("Copied");
      act(() => void vi.advanceTimersByTime(2_000));
      expect(button.textContent).toBe("Copy command");
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(button.textContent).toBe("Couldn't copy");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a confirmation", () => {
  const base: ConfirmProps = {
    title: "Retire Weekly digest?",
    about: "weekly-digest-helper",
    shownFor: "weekly-digest-helper",
    happens: ["Its home is removed.", "Its session is stopped first."],
    kept: ["Its work tree and its branch."],
    confirmLabel: "Retire",
    destructive: true,
    phase: { kind: "ready" },
    onConfirm: () => undefined,
    onClose: () => undefined,
  };

  test("is titled with the act and the agent, says what will happen and what is kept, and names its button for the act", () => {
    render(<Confirm {...base} />);
    const dialog = screen.getByRole("dialog", { name: "Retire Weekly digest?" });
    expect(within(dialog).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Retire Weekly digest?", "What will happen", "What is kept"]);
    expect(within(dialog).getAllByRole("listitem").map((line) => line.textContent)).toEqual(["Its home is removed.", "Its session is stopped first.", "Its work tree and its branch."]);
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Retire"]);
  });

  test("the focus starts on Cancel for a destructive act and on the act otherwise, stays inside, and returns to what opened it", () => {
    function Harness({ destructive }: { destructive: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open ? <Confirm {...base} destructive={destructive} confirmLabel={destructive ? "Retire" : "Stop"} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    const { unmount } = render(<Harness destructive />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const retire = screen.getByRole("button", { name: "Retire" });
    expect(document.activeElement).toBe(cancel);
    // Tab from the last stop goes to the first, Shift+Tab from the first to the last.
    retire.focus();
    fireEvent.keyDown(retire, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(retire);
    fireEvent.keyDown(retire, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    unmount();
    render(<Harness destructive={false} />);
    fireEvent.click(screen.getByRole("button", { name: "opener" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stop" }));
  });

  test("when the control that opened it is gone, the focus goes where the caller says: the row's neighbour", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [retired, setRetired] = useState(false);
      return (
        <>
          {retired ? null : <button onClick={() => setOpen(true)}>row of the retired agent</button>}
          <button id="neighbour">the next row</button>
          {open ? <Confirm {...base} returnFocus={() => document.getElementById("neighbour")} onConfirm={() => setRetired(true)} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "row of the retired agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "the next row" }));
  });

  test("it cannot be confirmed while the plan is read, while it is blocked (the reason is beside the button), or for another agent's plan", () => {
    const confirm = vi.fn();
    const { rerender } = render(<Confirm {...base} onConfirm={confirm} phase={{ kind: "reading" }} />);
    const act = () => screen.getByTestId("oats-confirm-act") as HTMLButtonElement;
    expect(act().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Reading the plan from OATS…");
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    rerender(<Confirm {...base} onConfirm={confirm} blocked="Tick the box to discard its work." />);
    expect(act().disabled).toBe(true);
    expect(screen.getByTestId("oats-confirm-blocked").textContent).toBe("Tick the box to discard its work.");
    rerender(<Confirm {...base} onConfirm={confirm} shownFor="flaky-ci-developer" />);
    expect(act().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("This is not the plan for this agent.OATS answered for flaky-ci-developer, not for weekly-digest-helper. Nothing was done. Close this and ask again.");
    expect(screen.queryAllByRole("listitem")).toEqual([]); // the other agent's plan is not shown
    fireEvent.click(act());
    expect(confirm).not.toHaveBeenCalled();
    rerender(<Confirm {...base} onConfirm={confirm} />);
    fireEvent.click(act());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("while the act runs the dialog says so and cannot be closed; then it shows the result, or the refusal in words with the kernel's code and message", () => {
    const close = vi.fn();
    const { rerender } = render(<Confirm {...base} onClose={close} phase={{ kind: "running", doing: "Retiring…" }} />);
    expect((screen.getByTestId("oats-confirm-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("oats-confirm-act") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("oats-confirm-act").textContent).toBe("Retiring…");
    expect(document.activeElement).toBe(screen.getByRole("dialog")); // both buttons are off: the focus stays in the dialog
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("oats-modal"));
    expect(close).not.toHaveBeenCalled();
    rerender(<Confirm {...base} onClose={close} phase={{ kind: "done", title: "Weekly digest was retired.", lines: ["Its work tree is kept at /abs/kept."] }} />);
    expect(screen.getByTestId("oats-result").textContent).toBe("Weekly digest was retired.Its work tree is kept at /abs/kept.");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Close"]);
    expect(document.activeElement).toBe(screen.getByTestId("oats-confirm-close")); // the focus follows the result
    rerender(<Confirm {...base} onClose={close} phase={{ kind: "failed", title: "Weekly digest could not be retired.", refusal: "E_CHILDREN_RUNNING: a child would not stop\nstop it first", actions: <Button>Review again</Button> }} />);
    const failed = screen.getByRole("alert");
    expect(within(failed).getByRole("heading").textContent).toBe("Weekly digest could not be retired.");
    expect(Array.from(failed.querySelectorAll("span.block")).map((line) => line.textContent)).toEqual(["E_CHILDREN_RUNNING: a child would not stop", "stop it first"]);
    expect(within(failed).getByRole("button", { name: "Review again" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("oats-confirm-close"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
