// The helpers the slots print with.
import { describe, expect, test } from "vitest";
import { age, clean, count, homeTail, needsYouLabel } from "../../app/format";

describe("format", () => {
  test("clean drops control characters and bidi overrides, and keeps newlines, tabs and markup as text", () => {
    expect(clean("a\u001b[31mred\u0007\u0000b")).toBe("a[31mredb");
    expect(clean("line 1\n\tline 2")).toBe("line 1\n\tline 2");
    expect(clean("\u202egnp.exe\u2066x\u2069")).toBe("gnp.exex");
    expect(clean("<b>bold</b> & é 日本")).toBe("<b>bold</b> & é 日本");
  });
  test("homeTail keeps the last two segments", () => {
    expect(homeTail("/abs/deployment/agents/oats-developer/instances/dev-a")).toBe("…/instances/dev-a");
    expect(homeTail("/home/dev-a")).toBe("/home/dev-a");
    expect(homeTail("/a/b/c/")).toBe("…/b/c");
  });
  test("age is the largest whole unit; unreadable instants give null", () => {
    const now = Date.parse("2026-11-19T12:30:00.000Z");
    expect(age("2026-11-19T12:29:40.000Z", now)).toBe("just now");
    expect(age("2026-11-19T12:22:00.000Z", now)).toBe("8 min ago");
    expect(age("2026-11-19T09:30:00.000Z", now)).toBe("3 h ago");
    expect(age("2026-11-16T12:30:00.000Z", now)).toBe("3 d ago");
    expect(age("2026-11-19T13:00:00.000Z", now)).toBe("just now"); // a clock ahead of ours
    expect(age("yesterday-ish", now)).toBeNull();
    expect(age(null, now)).toBeNull();
  });
  test("counts and the needs-you label agree in number", () => {
    expect([count(0, "agent"), count(1, "agent"), count(2, "agent")]).toEqual(["0 agents", "1 agent", "2 agents"]);
    expect(count(1, "child", "children")).toBe("1 child");
    expect([needsYouLabel(0), needsYouLabel(1), needsYouLabel(3)]).toEqual(["nothing needs you", "1 agent needs you", "3 agents need you"]);
  });
});
