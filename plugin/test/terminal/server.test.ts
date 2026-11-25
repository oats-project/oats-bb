// The terminal's RPC verb through the whole backend: bb's fake plugin host, the real host entry
// and the fake `oats` (test/support/backend.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

const TMUX = "kernel-fix-developer"; // the pinned roster's agent on tmux, which runs

describe("terminalCommand", () => {
  it("answers the kernel's viewer for a tmux agent that runs: by the machine's absolute path of oats, with the flags this kernel lists, on the bb machine that holds the deployment", async () => {
    backend = await startBackend();
    const answer = await backend.rpc<{ hostId: string; argv: string[]; cwd: string }>("terminalCommand", { instance: TMUX });
    const home = "/abs/deployment/agents/oats-developer/instances/kernel-fix-developer";
    expect(answer).toEqual({ hostId: "host_falcon", argv: [backend.fake.bin, "session", "attach", "--home", home, "--detach-key", "C-\\", "--no-status-line"], cwd: home });
    expect(answer.argv[0]!.startsWith("/")).toBe(true);
    // Nothing of the viewer is run by the plugin: the roster's read and the kernel's version, no more.
    expect((await backend.verbs()).sort()).toEqual(["status", "version"]);
  });

  it("refuses, before the machine is asked, an agent that has no terminal to show", async () => {
    backend = await startBackend();
    // On a bb thread: the kernel itself has none for it (E_SESSION_NO_TERMINAL).
    await expect(backend.rpc("terminalCommand", { instance: "redesign-ui-lead" })).rejects.toThrow(/does not run on tmux/);
    await expect(backend.rpc("terminalCommand", { instance: "no-such-agent" })).rejects.toThrow(/not an agent/);
    expect(await backend.verbs()).not.toContain("session");
  });

  it("refuses a tmux agent that does not run (stopped, lost, or nothing said of it)", async () => {
    /** The pinned roster with that one row changed, as the fake's answer to `oats status`. */
    const withRow = (change: Record<string, unknown>) => {
      const document = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "roster", "status.json"), "utf8")) as { agents: { instances: Record<string, unknown>[] }[] };
      for (const group of document.agents) for (const instance of group.instances) if (instance.instance === TMUX) Object.assign(instance, change);
      return { status: { stdout: JSON.stringify(document) } };
    };
    backend = await startBackend({ verbs: withRow({ running: false, runtimeState: "shell", sessionEnd: "stopped" }) });
    await expect(backend.rpc("terminalCommand", { instance: TMUX })).rejects.toThrow(/is not running/);
    await backend.dispose();
    // A session that was lost: the same.
    backend = await startBackend({ verbs: withRow({ running: false, runtimeState: null, sessionEnd: "lost" }) });
    await expect(backend.rpc("terminalCommand", { instance: TMUX })).rejects.toThrow(/is not running/);
    await backend.dispose();
    // One the kernel says nothing of (`running: null`): no session is known to be there.
    backend = await startBackend({ verbs: withRow({ running: null }) });
    await expect(backend.rpc("terminalCommand", { instance: TMUX })).rejects.toThrow(/is not running/);
  });

  // An open of the terminal is an ACT (what is typed in that tab is typed to the agent): held while
  // OATS cannot be read, also for an agent of the roster that is still shown, as Stop and Start are.
  it("is refused with why while OATS cannot be read, also for a tmux agent of the last roster read; the machine is not asked", async () => {
    backend = await startBackend();
    expect(((await backend.rpc<{ ok: boolean }>("snapshot")) as { ok: boolean }).ok).toBe(true);
    await backend.fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read" } }) } });
    await backend.rpc("refresh").catch(() => undefined);
    await expect.poll(async () => (await backend!.rpc<{ ok: boolean }>("snapshot")).ok, { timeout: 12_000 }).toBe(false);
    const failed = await backend.rpc<{ last?: { agents: { instance: string }[] } }>("snapshot");
    expect(failed.last?.agents.some((agent) => agent.instance === TMUX)).toBe(true); // still shown
    const before = (await backend.verbs()).length;
    await expect(backend.rpc("terminalCommand", { instance: TMUX })).rejects.toThrow("E_CONFIG_BROKEN: oats-local.yaml cannot be read");
    expect((await backend.verbs()).slice(before).filter((verb) => verb !== "status")).toEqual([]);
  }, 30_000);
});
