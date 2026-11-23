// The home's verb on the server: where the installed oats stands, from the version read every feature shares.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

const version = (fields: Record<string, unknown>) => ({ stdout: JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.70.5", desktopApi: 1, ...fields }) });

describe("homeCli", () => {
  it("the recorded oats is a tested one: its release and the version of its answers, picked, and nothing else of what the kernel printed", async () => {
    backend = await startBackend();
    // The recorded `oats version --json` (test/fixtures/roster/version.json) is of the kernel the real run pins: at or above the floor, within the tested minor.
    const recorded = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "roster", "version.json"), "utf8")) as { version: string; desktopApi: number };
    expect(await backend.rpc("homeCli", null)).toEqual({ version: recorded.version, desktopApi: recorded.desktopApi, state: "tested" });
    // the one version read of the server: asked again, no second process
    await backend.rpc("homeCli", null);
    expect((await backend.verbs()).filter((verb) => verb === "version")).toEqual(["version"]);
  });

  it.each([
    [{ version: "0.69.9" }, { version: "0.69.9", desktopApi: 1, state: "older" }],
    // below the floor, inside the tested minor: the plugin does not work with it
    [{ version: "0.70.4" }, { version: "0.70.4", desktopApi: 1, state: "older" }],
    [{ version: "0.70.7" }, { version: "0.70.7", desktopApi: 1, state: "tested" }],
    [{ version: "0.71.0" }, { version: "0.71.0", desktopApi: 1, state: "newer" }],
    [{ version: "0.74.0", desktopApi: 2 }, { version: "0.74.0", desktopApi: 2, state: "newer-api" }],
    [{ version: "next" }, { version: "next", desktopApi: 1, state: "unknown" }],
  ])("%j is %j", async (fields, answer) => {
    backend = await startBackend({ verbs: { version: version(fields) } });
    expect(await backend.rpc("homeCli", null)).toEqual(answer);
  });

  it("an oats that answers no version the plugin can read is unknown; one that cannot be run is refused as it was", async () => {
    backend = await startBackend({ verbs: { version: { stdout: "oats 0.61.0\n" } } });
    expect(await backend.rpc("homeCli", null)).toEqual({ version: null, desktopApi: null, state: "unknown" });
    await backend.dispose();
    backend = await startBackend({ verbs: { version: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_LOCAL_MISSING", message: "no oats-local.yaml at or above this directory" } }), exit: 1 } } });
    await expect(backend.rpc("homeCli", null)).rejects.toThrow(/E_LOCAL_MISSING/);
  });
});
