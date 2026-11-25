// @vitest-environment jsdom
// A row's mark (app/ui.tsx `Mark`): a dot with a name; in the colour of a refusal, or, with
// `tone="warning"`, in the colour of a state that waits on a person.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Mark } from "../../app/ui";

afterEach(cleanup);

test("left out, the tone is a failure's: the refusal's colour, and no data-tone", () => {
  render(<Mark label="Automations, a failure" />);
  const mark = screen.getByRole("img", { name: "Automations, a failure" });
  expect(mark.className).toContain("bg-destructive-text");
  expect(mark.className).not.toContain("bg-warning-text");
  expect(mark.hasAttribute("data-tone")).toBe(false);
  expect(mark.getAttribute("title")).toBe("Automations, a failure");
});

test('tone="warning": the colour of a state that waits on a person, and data-tone says so', () => {
  render(<Mark label="Automations, needs you" tone="warning" />);
  const mark = screen.getByRole("img", { name: "Automations, needs you" });
  expect(mark.className).toContain("bg-warning-text");
  expect(mark.className).not.toContain("bg-destructive-text");
  expect(mark.dataset.tone).toBe("warning");
});
