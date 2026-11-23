// The kernel's report through the whole backend: bb's fake plugin host, the real host entry and the
// fake `oats` (test/support/backend.ts). The feature has no verb of its own: the snapshot carries it.
import { afterEach, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend.js";
import { OUTSIDE_STATUS, outsideDocument } from "./rows.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

type Snapshot = { ok: boolean; agents: { instance: string; running: boolean | null; runtimeState: string | null; sessionEnd?: string | null; outsideOats?: unknown }[] };
const REPORT = {
  code: "running-outside-oats", backend: "bb",
  message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
};

describe("the snapshot", () => {
  it("carries the kernel's report of a home OATS stopped whose harness runs, on a kernel that lists provider-outside-oats; the row stays what OATS recorded; from the one status read", async () => {
    backend = await startBackend({ verbs: { status: { file: OUTSIDE_STATUS } } });
    const snapshot = await backend.rpc<Snapshot>("snapshot");
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]).toMatchObject({ instance: "flaky-ci-2-developer", running: false, runtimeState: "stopped", sessionEnd: "stopped", outsideOats: REPORT });
    expect(await backend.verbs()).toEqual(["status"]);
  });

  it("says nothing of it on an OATS that does not list the feature, for the same row", async () => {
    backend = await startBackend({ verbs: { status: { stdout: JSON.stringify(outsideDocument(false)) } } });
    const snapshot = await backend.rpc<Snapshot>("snapshot");
    expect(snapshot.agents[0]).toMatchObject({ instance: "flaky-ci-2-developer", running: false, runtimeState: "stopped", sessionEnd: "stopped" });
    expect("outsideOats" in snapshot.agents[0]!).toBe(false);
  });

  it("the pinned roster's rows carry none, and the stopped one its sessionEnd", async () => {
    backend = await startBackend();
    const { agents } = await backend.rpc<Snapshot>("snapshot");
    expect(agents.filter((agent) => "outsideOats" in agent)).toEqual([]);
    expect(agents.filter((agent) => agent.sessionEnd != null).map((agent) => [agent.instance, agent.sessionEnd])).toEqual([["weekly-digest-helper", "stopped"]]);
  });
});
