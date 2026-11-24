// What every slot reads: the kernel's snapshot (through the plugin's server) joined to bb's own
// live thread list. bb's thread fields cost no `oats` call.
import { useGone } from "./roster/gone";
import { useMemo } from "react";
import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isKernelCode } from "../kernel/result";
import type { Agent, Node, ThreadWhere, View } from "../model/types";
import { flatten, view } from "../model/view";
import { useThreadWhere } from "./outside/threads";
import { useRead } from "./store";

/**
 * The app's own code for a snapshot call that did not answer at all. Like the plugin's other
 * codes it does not start with `E_`, so it is never taken, or printed, as a kernel refusal.
 */
export const RPC_FAILED = "PLUGIN_RPC_FAILED";

/** The app's own code for bb's thread list failing: the join has nothing to join to. */
export const THREADS_FAILED = "BB_THREADS_FAILED";

export type Deployment = { root: string; workspace: string; machine: string };

export type Oats = {
  /** bb's threads, as bb reports them; listed whatever OATS answers. */
  threads: readonly PluginSidebarThread[];
  threadById: ReadonlyMap<string, PluginSidebarThread>;
  retry(): void;
  /**
   * The soul to print for an agent: the key of the matching soul (`<package>/<soul>` for a
   * package soul) once the souls are read, else the roster's name for it.
   */
  soulOf(agent: Agent): string;
} & (
  | { phase: "loading" }
  /** No snapshot: `code` is the server's, or RPC_FAILED when the call itself failed. */
  /** `machine`: the machine `oats` was looked for on, by the name bb gives it; null when none was chosen (or the call itself failed). */
  | { phase: "failed"; code: string; message: string; machine: string | null }
  | {
      phase: "ready";
      /**
       * Null: this is the roster as just read. Else it is the LAST roster read, kept while OATS
       * cannot be read: why it cannot (`code`, `message`), and when what is shown was read (`at`).
       * Every place then draws the roster as last read, marked with its age.
       */
      stale: { code: string; message: string; at: string } | null;
      /** The server's stamp of the roster the window holds (the snapshot's `at`): rosters are compared by it, never by the window's clock. */
      at: string;
      deployment: Deployment;
      agents: readonly Agent[];
      view: View;
      /** Agents of this roster the kernel has since refused as ones it does not know: "not in OATS any more" until the next roster. */
      gone: ReadonlySet<string>;
      /**
       * What bb itself says of the thread an agent's row names: "open" for a thread bb lists; for
       * one it does not, bb's answer by id (archived, or no such thread), "unknown" until bb has
       * answered (app/outside/threads.ts). The outside feature's reasons read it (app/outside/say.ts); the state function does not.
       */
      whereOf(agent: Agent): ThreadWhere;
      /** Every drawn node by its thread id, and by its instance. */
      nodeByThread: ReadonlyMap<string, Node>;
      nodeByInstance: ReadonlyMap<string, Node>;
    }
);

export function useOats(): Oats {
  const read = useRead("snapshot");
  // Only for the souls' names: the Souls page keeps this read fresh, a status change does not.
  const souls = useRead("souls", { live: false }).data?.souls;
  const sidebar = useSidebarThreads();
  const threads = sidebar.threads;
  // What the server last answered; kept by the read when the call itself fails after it.
  const snapshot = read.data;
  // The roster to draw: the one just read, or the last one the server keeps while OATS cannot be read.
  const roster = snapshot === undefined ? undefined : snapshot.ok ? snapshot : (snapshot.last ?? undefined);

  const threadById = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  // bb's sidebar lists active threads only: of the agents whose thread it does not list, bb is asked
  // by id which it has archived (one request; none when it lists every agent's thread).
  const whereOf = useThreadWhere(roster?.agents, threadById, roster?.at ?? "");
  const joined = useMemo(() => {
    if (roster === undefined) return null;
    const v = view(roster.agents, threads);
    const nodes = flatten(v.roots);
    return {
      view: v,
      nodeByThread: new Map(nodes.map((node) => [node.thread.id, node])),
      nodeByInstance: new Map(nodes.map((node) => [node.agent.instance, node])),
    };
  }, [roster, threads]);

  const gone = useGone(roster?.at ?? null);
  const soulNames = useMemo(() => new Map((souls ?? []).map((soul) => [soul.agent, soul.name])), [souls]);
  const soulOf = (agent: Agent) => soulNames.get(agent.soul) ?? agent.soul;
  const base = { threads, threadById, retry: read.retry, soulOf };
  // Why OATS cannot be read now, if it cannot: the call to the plugin's server failed, or the server says so.
  const failure =
    read.status === "error" ? { code: RPC_FAILED, message: read.error } : snapshot !== undefined && !snapshot.ok ? { code: snapshot.code, message: snapshot.message } : null;
  const machine = snapshot !== undefined && !snapshot.ok ? (snapshot.machine ?? null) : null;
  if (roster === undefined) {
    if (failure !== null) return { ...base, phase: "failed", ...failure, machine };
    return { ...base, phase: "loading" };
  }
  // Until bb has listed its threads nothing can be joined: an empty list would make every agent
  // look like one whose thread is missing.
  if (sidebar.status === "error") {
    return { ...base, phase: "failed", code: THREADS_FAILED, message: "bb could not list its threads, so the OATS agents cannot be matched to them.", machine: null };
  }
  if (sidebar.status !== "ready" || joined === null) return { ...base, phase: "loading" };
  return { ...base, phase: "ready", stale: failure === null ? null : { ...failure, at: roster.at }, at: roster.at, deployment: roster.deployment, agents: roster.agents, gone, whereOf, ...joined };
}

/** The first line of a message: what the sidebar's one status line has room for. */
export function firstLine(message: string): string {
  const line = message.split(/\r?\n/).find((part) => part.trim() !== "");
  return line === undefined ? message.trim() : line.trim();
}

/**
 * The one line a failed snapshot is shown as. A kernel refusal keeps the kernel's code before its
 * message; the plugin's own codes have messages that are whole sentences by themselves.
 */
export function failureLine(failure: { code: string; message: string }): string {
  const line = firstLine(failure.message);
  return isKernelCode(failure.code) ? `${failure.code}: ${line}` : line;
}
