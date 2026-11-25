// `oats version --json`: the kernel's release and features, read once by the server for every feature.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codes, createOats, Processes } from "../../kernel/index.js";
import { parseVersion } from "../../kernel/roster.js";
import { createCore, type Core } from "../../server/core.js";
import { startBackend, type Backend } from "../support/backend.js";
import { FIXTURES, installFakeOats } from "../support/fake-oats.js";

const recorded = async () => JSON.parse(await readFile(join(FIXTURES, "roster/version.json"), "utf8")) as { version: string; desktopApi: number; features: string[] };
/** The `<name>Api` numbers OATS 0.70.5 prints. */
const APIS = {
  desktopApi: 1,
  automationsApi: 1,
  workspaceApi: 2,
  instanceGitApi: 1,
  spawnApplyApi: 1,
  soulsApi: 2,
  lifecycleApi: 1,
  readinessApi: 2,
  spawnPreviewApi: 2,
  eventsApi: 2,
  scheduleHistoryApi: 3,
  scheduleApi: 2,
  operationsApi: 2,
  capabilityShowApi: 1,
  readerApi: 1,
  boardApi: 1,
};

describe("the kernel's version", () => {
  it("is read with `oats version --json` in the deployment: the release, the JSON answers' version, the features", async () => {
    const fake = await installFakeOats();
    const processes = new Processes();
    try {
      const version = await createOats({ bin: fake.bin, cwd: fake.deployment, processes }).version();
      const printed = await recorded();
      expect(version).toEqual({ ok: true, value: { version: "0.70.5", desktopApi: 1, features: printed.features, apis: APIS, harnesses: ["pi", "claude", "codex"], sessionBackends: ["tmux"] } });
      expect(printed.features).toContain("session-providers");
      const [call] = await fake.calls();
      expect(call?.argv).toEqual(["version", "--json"]);
      expect(call?.cwd).toBe(fake.deployment);
    } finally {
      await processes.killAll();
      await fake.remove();
    }
  });

  it("a kernel that lists no features, or names no JSON version, is read as having none", () => {
    expect(parseVersion({ version: "0.41.0", sessionViewer: { prefixScroll: false }, someApi: "2" })).toEqual({ ok: true, value: { version: "0.41.0", desktopApi: null, features: [], apis: {}, harnesses: [], sessionBackends: [] } });
  });

  it("an answer with no version is the typed error of a document the plugin cannot read", () => {
    const answer = parseVersion({ features: [] });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.code).toBe(codes.badAnswer);
  });
});

describe("the server's one read of it", () => {
  let backend: Backend;
  let core: Core;
  afterEach(() => backend.dispose());

  it("is shared: every feature that asks gets the same answer from one `oats version`", async () => {
    backend = await startBackend({ load: (bb) => void (core = createCore(bb)) });
    const [one, two] = await Promise.all([core.versionOf(), core.versionOf()]);
    const again = await core.versionOf();
    expect(one).toEqual({ version: "0.70.5", desktopApi: 1, features: (await recorded()).features, apis: APIS, harnesses: ["pi", "claude", "codex"], sessionBackends: ["tmux"] });
    expect(two).toBe(one);
    expect(again).toBe(one);
    expect(await backend.verbs()).toEqual(["version"]);
  });

  it("a refusal is the kernel's code and message, and is not kept: the next ask reads again", async () => {
    backend = await startBackend({
      verbs: { version: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NODE_UNSUPPORTED", message: "Node 18 is not supported" } }) } },
      load: (bb) => void (core = createCore(bb)),
    });
    const refused = await core.versionOf().then(
      () => null,
      (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
    );
    expect(refused).toEqual({ code: "conflict", message: "E_NODE_UNSUPPORTED: Node 18 is not supported" });
    await backend.fake.behave({});
    expect((await core.versionOf()).version).toBe("0.70.5");
    expect(await backend.verbs()).toEqual(["version", "version"]);
  });
});
