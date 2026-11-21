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
    expect(one).toEqual({ at: snapshot.at, root: printed.root, ...lead });
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
});
