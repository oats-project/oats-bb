// The kernel hands the provider its settings with the manifest's defaults filled in: a
// default declared in oats.json reaches the provider as a value, with nothing on it to say
// that no deployment wrote it. The provider's own tests pass raw settings, so a default that
// changes what the provider does is seen only here: every case below reads oats.json's
// defaults into the settings it checks, as the kernel does.
//
// oats-bb#88: up to 0.4.0 the manifest declared a default for `daemon` (bb's own default
// address). `daemon` and `hostDaemonPort` name one thing, so a deployment that set
// `hostDaemonPort` alone, as the README tells a second bb to, was refused at every spawn
// under a real kernel: "hostDaemonPort is … and settings.oats.bb.daemon names port 38887".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DAEMON_PORT, readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { VERSION, call, capabilityDir, fakeBackend, fakeBbIn, projectRow, runBin, scratch } from "../fixtures/harness.mjs";

const manifest = JSON.parse(readFileSync(join(capabilityDir, "oats.json"), "utf8"));
/** The manifest's defaults, by setting. */
const DEFAULTS = Object.fromEntries(Object.entries(manifest.settings).filter(([, setting]) => setting.default !== undefined).map(([key, setting]) => [key, setting.default]));
/** A deployment's own settings as the kernel hands them to the provider: over the manifest's defaults. */
const asKernel = (deployment = {}) => ({ ...DEFAULTS, ...deployment });

test("the manifest declares a default for no setting that names bb's host daemon: one would reach the provider as the deployment's own", () => {
  assert.equal(manifest.settings.daemon.default, undefined, "daemon: unset, the provider takes hostDaemonPort's address or bb's default itself");
  assert.equal(manifest.settings.hostDaemonPort.default, undefined, "hostDaemonPort: unset means bb's CLI is told no port");
  // What it does declare, so that a default added later is looked at here first.
  assert.deepEqual(Object.keys(DEFAULTS).sort(), ["cli", "server", "version"]);
});

test("nothing set: with the manifest's defaults the provider reads what it reads with none, and the daemon is bb's own default, decided by no setting", () => {
  const read = readSettings(asKernel());
  // The address the dropped default named (http://127.0.0.1:38887) is the provider's own fallback: bb's default host daemon port.
  assert.equal(DEFAULT_DAEMON_PORT, 38887);
  assert.deepEqual([read.daemon, read.daemonKey, read.hostDaemonPort], ["http://127.0.0.1:38887", null, null]);
  // Nothing else of the defaults changes a read either: but for the version pin, which only the manifest gives.
  assert.deepEqual(read, { ...readSettings({}), version: DEFAULTS.version });
});

test("daemon set by the deployment, over the manifest's defaults: it is the address, and the setting that decided it", () => {
  const read = readSettings(asKernel({ daemon: "http://127.0.0.1:40123" }));
  assert.deepEqual([read.daemon, read.daemonKey, read.hostDaemonPort], ["http://127.0.0.1:40123", "daemon", null]);
});

test("hostDaemonPort alone, over the manifest's defaults: taken, and the daemon's address follows the port (oats-bb#88)", () => {
  const read = readSettings(asKernel({ server: "http://127.0.0.1:39011", hostDaemonPort: 39012 }));
  assert.deepEqual([read.server, read.daemon, read.daemonKey, read.hostDaemonPort], ["http://127.0.0.1:39011", "http://127.0.0.1:39012", "hostDaemonPort", 39012]);
  // The two together still name one daemon: agreeing is taken, another port is refused, as before.
  assert.equal(readSettings(asKernel({ hostDaemonPort: 39012, daemon: "http://127.0.0.1:39012" })).daemonKey, "daemon");
  assert.throws(() => readSettings(asKernel({ hostDaemonPort: 39012, daemon: "http://127.0.0.1:38887" })), (error) => error.code === "E_BACKEND_SETTINGS" && /hostDaemonPort is 39012 and settings\.oats\.bb\.daemon names port 38887/.test(error.message));
});

test("on the wire, as the kernel calls it: a deployment that names its bb by server and hostDaemonPort alone is ready, launches, and its doctor reads ready", async (t) => {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "host list": { stdout: [{ id: "host_1", status: "connected" }] },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", providerId: "claude-code", status: "starting" } },
    "machine env list": { stdout: { builtInGit: { status: "not logged in" }, variables: [], inheritedVariables: [] } },
    "machine env set": { stdout: { builtInGit: { status: "not logged in" }, variables: [], inheritedVariables: [] } },
  });
  // What such a deployment writes in oats-local.yaml, and nothing of `daemon`.
  const deployment = { server: backend.server, hostDaemonPort: backend.daemonPort, trust: "single-user", dataDir: backend.dataDir, piAgentDir: backend.piAgentDir };
  assert.equal(deployment.daemon, undefined);
  const settings = asKernel(deployment);
  const checked = await call("check", { home, soul: null }, { settings, bb });
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.result.status, "ready", JSON.stringify(checked.result));
  assert.equal(checked.result.warnings.some((warning) => warning.code === "session-provider-host-daemon-port"), false);
  assert.deepEqual(backend.daemonRequests, ["/status"], "the daemon asked is the one at the port");
  const launched = await call("launch", { home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null }, { settings, bb });
  assert.equal(launched.ok, true, JSON.stringify(launched));
  // Every bb call was told the port, as with raw settings.
  assert.deepEqual([...new Set(bb.calls().map((c) => c.hostDaemonPort))], [String(backend.daemonPort)]);
  const doctor = await runBin(["doctor"], { env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }) } });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, new RegExp(`^bb session provider: ready\\n  host daemon port: ${backend.daemonPort} \\(settings\\.oats\\.bb\\.hostDaemonPort\\)\\n`));
});
