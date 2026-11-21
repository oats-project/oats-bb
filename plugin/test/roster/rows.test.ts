// The kernel's own status rows, kept by the server beside the snapshot for the features that draw
// more of a row than `Agent` holds: one `oats status` for everybody.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCore, type Core } from "../../server/core.js";
import { startBackend, type Backend } from "../support/backend.js";
import { FIXTURES } from "../support/fake-oats.js";

let backend: Backend;
let core: Core;
const start = async (verbs = {}) => {
  backend = await startBackend({ verbs, load: (bb) => void (core = createCore(bb)) });
};
afterEach(() => backend.dispose());

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
  );

describe("the raw rows of the snapshot", () => {
  it("are the kernel's rows, whole, by instance, with the snapshot's instant, from the one status read", async () => {
    await start();
    const printed = JSON.parse(await readFile(join(FIXTURES, "roster/status.json"), "utf8")) as {
      root: string;
      agents: ({ instances: { instance: string }[] } & Record<string, unknown>)[];
    };
    const rows = printed.agents.flatMap(({ instances, ...agent }) => instances.map((row) => ({ row, agent })));
    const snapshot = await core.clientSnapshot();
    const held = await core.rowsOf();
    expect(held.at).toBe(snapshot.at);
    expect(held.root).toBe(printed.root);
    expect([...held.rows.keys()]).toEqual(rows.map(({ row }) => row.instance));
    for (const expected of rows) expect(held.rows.get(expected.row.instance)).toEqual(expected);
    // A field the plugin's `Agent` does not hold is there for a feature to read with its own schema:
    // of the instance's row, and of its agent group's (the soul's), which carries no instances.
    const one = await core.rowOf("redesign-ui-lead");
    const lead = rows.find(({ row }) => row.instance === "redesign-ui-lead")!;
    expect(one).toEqual({ at: snapshot.at, stale: false, root: printed.root, ...lead });
    expect(Object.keys(one.row)).toContain("open");
    expect(one.agent.name).toBe("oats-product-expert");
    expect(Object.keys(one.agent)).not.toContain("instances");
    expect(await backend.verbs()).toEqual(["status"]);
  });

  it("refuse an instance the snapshot does not name", async () => {
    await start();
    expect(await refusalOf(core.rowOf("nobody-here"))).toEqual({ code: "invalid", message: '"nobody-here" is not an agent of this OATS deployment\'s current snapshot' });
  });

  it("refuse with the kernel's code and message when the status read failed", async () => {
    await start({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NO_WORKSPACE", message: "no workspace here" } }) } });
    expect(await refusalOf(core.rowsOf())).toEqual({ code: "conflict", message: "E_NO_WORKSPACE: no workspace here" });
    expect(await refusalOf(core.rowOf("redesign-ui-lead"))).toEqual({ code: "conflict", message: "E_NO_WORKSPACE: no workspace here" });
  });

  it("a change of a printed field that the snapshot's agents do not hold is published, once; the same answer again is not", async () => {
    await start();
    const signals = () => backend.server.harness.realtimeSignals.length;
    await core.clientSnapshot();
    expect(signals()).toBe(1);
    // The same roster, with one field of one raw row changed: `open` is not a field of the plugin's `Agent`.
    const printed = JSON.parse(await readFile(join(FIXTURES, "roster/status.json"), "utf8"));
    const row = printed.agents.flatMap((group: { instances: { instance: string; open?: unknown }[] }) => group.instances).find((candidate: { instance: string }) => candidate.instance === "redesign-ui-lead");
    row.open = { label: "Open in bb", url: "http://127.0.0.1:38886/elsewhere" };
    await backend.fake.behave({ status: { stdout: JSON.stringify(printed) } });
    const before = await core.clientSnapshot();
    await core.clientRefresh();
    const after = await core.clientSnapshot();
    expect({ ...after, at: null }).toEqual({ ...before, at: null }); // the agents are the same
    expect((await core.rowOf("redesign-ui-lead")).row.open).toEqual(row.open);
    expect(signals()).toBe(2);
    await core.clientRefresh();
    expect(signals()).toBe(2);
    expect(await backend.verbs()).toEqual(["status", "status", "status"]);
  }, 20_000);

  it("while OATS cannot be read the snapshot carries the last roster, and the rows are the last ones, marked stale", async () => {
    await start();
    const read = await core.clientSnapshot();
    expect(read.ok).toBe(true);
    await backend.fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NO_WORKSPACE", message: "no workspace here" } }) } });
    await core.clientRefresh();
    const failed = await core.clientSnapshot();
    if (failed.ok || !read.ok) throw new Error("expected a roster, then a failure");
    expect([failed.code, failed.message]).toEqual(["E_NO_WORKSPACE", "no workspace here"]);
    expect(failed.last).toEqual({ at: read.at, deployment: read.deployment, agents: read.agents });
    expect(failed.at > read.at).toBe(true);
    const rows = await core.rowsOf();
    expect([rows.at, rows.stale, rows.rows.size]).toEqual([read.at, true, read.agents.length]);
    const one = await core.rowOf("redesign-ui-lead");
    expect([one.at, one.stale, one.row.instance]).toEqual([read.at, true, "redesign-ui-lead"]);
    expect(await refusalOf(core.rowOf("nobody-here"))).toEqual({ code: "invalid", message: '"nobody-here" is not an agent of this OATS deployment\'s last snapshot' });
    // The failure is published once; the same failure again is not.
    const published = backend.server.harness.realtimeSignals.length;
    await core.clientRefresh();
    expect(backend.server.harness.realtimeSignals.length).toBe(published);
    // Read again: the roster is current, and nothing is stale.
    await backend.fake.behave({});
    await core.clientRefresh();
    const back = await core.clientSnapshot();
    expect(back.ok).toBe(true);
    expect((await core.rowsOf()).stale).toBe(false);
  }, 20_000);

  it("with no roster ever read, a failure carries no last roster", async () => {
    await start({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NO_WORKSPACE", message: "no workspace here" } }) } });
    const failed = await core.clientSnapshot();
    expect(failed.ok === false && failed.last).toBeNull();
  });
});
