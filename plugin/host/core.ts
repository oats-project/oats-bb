// What every feature's host module builds on: the `oats` processes of this worker, the kernel for
// one call, and the worker's lifecycle. A feature's handlers are in host/<feature>.ts; host.ts
// composes them.
//
// bb reaps no child of a plugin on reload or stop (B1): every `oats` runs in its own process group
// with the call's signal, and every group still running is killed when the worker's lifecycle
// signal aborts and in `dispose`.
import { isAbsolute } from "node:path";
import type { ExperimentalHostRpcHandlers, PluginRpcContract } from "@get-bb/plugin-sdk";
import type { hostSignals } from "../contract/index.js";
import { codes, createOats, Processes, type Oats, type Result } from "../kernel/index.js";

/** How long the list of souls a spawn is checked against is reused. */
const SOULS_TTL_MS = 30_000;

export type Base = { deployment: string; oatsBin: string };
type Lifecycle = { lifecycle: { signal: AbortSignal } };
/** The handlers of one feature's host verbs. */
export type Handlers<Contract extends PluginRpcContract> = ExperimentalHostRpcHandlers<Contract, typeof hostSignals>;
export type HostCore = ReturnType<typeof createHostCore>;

export function createHostCore() {
  const processes = new Processes();
  const souls = new Map<string, { at: number; names: string[] }>();
  let lifecycleBound = false;

  /** Kills every `oats` when the worker goes away (idle eviction, reload, disable, daemon stop). */
  const bind = (context: Lifecycle) => {
    if (lifecycleBound) return;
    lifecycleBound = true;
    context.lifecycle.signal.addEventListener("abort", () => void processes.killAll(), { once: true });
  };

  const refuse = (message: string): Result<never> => ({ ok: false, error: { code: codes.invalidInput, message } });

  /** The kernel for this call: the deployment is its cwd, and the binary is `oats` or an absolute path. */
  const kernel = (base: Base): Result<Oats> => {
    if (!isAbsolute(base.deployment)) return refuse("the deployment must be an absolute directory");
    if (base.oatsBin !== "" && !isAbsolute(base.oatsBin)) return refuse("the oatsBin setting must be an absolute path to `oats`, or empty");
    return { ok: true, value: createOats({ bin: base.oatsBin === "" ? "oats" : base.oatsBin, cwd: base.deployment, processes }) };
  };

  /** The names `oats souls` lists: a spawn is checked against them before its process starts. */
  const knownSouls = async (base: Base, oats: Oats, signal: AbortSignal): Promise<Result<string[]>> => {
    const cacheKey = `${base.deployment}\0${base.oatsBin}`;
    const cached = souls.get(cacheKey);
    if (cached && Date.now() - cached.at < SOULS_TTL_MS) return { ok: true, value: cached.names };
    const listed = await oats.souls(signal);
    if (!listed.ok) return listed;
    return { ok: true, value: rememberSouls(base, listed.value.souls) };
  };
  const rememberSouls = (base: Base, listed: readonly { name: string }[]): string[] => {
    const names = listed.map((soul) => soul.name);
    souls.set(`${base.deployment}\0${base.oatsBin}`, { at: Date.now(), names });
    return names;
  };

  /** One verb: binds the worker's lifecycle, and runs `use` with the kernel of this call, or refuses its base. */
  const run = async <Value>(base: Base, context: Lifecycle, use: (oats: Oats) => Promise<Result<Value>>): Promise<Result<Value>> => {
    bind(context);
    const oats = kernel(base);
    return oats.ok ? use(oats.value) : oats;
  };

  return { bind, run, knownSouls, rememberSouls, dispose: () => processes.killAll() };
}
