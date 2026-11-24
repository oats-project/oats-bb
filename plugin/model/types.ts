// Pinned by the spec. No bb or React import in model/.

/** One OATS instance, as the kernel's `oats status --json` row describes it. */
export type Agent = {
  instance: string;
  soul: string;
  home: string;
  /** parentInstance */
  parent: string | null;
  /** attributedHuman; drawn as "Started by <human>" in the thread's row when parent is null */
  human: string | null;
  alias: string | null;
  team: string | null;
  address: string | null;
  /** "bb" | "tmux" | another session provider's name */
  backend: string;
  /** null from status: the kernel names them only on a local `oats session inspect` and in a spawn's answer */
  server: string | null;
  projectId: string | null;
  /** the row's session.threadId, null on a tmux row */
  threadId: string | null;
  /** The kernel's word, never inferred: endpoint activity (true: a harness is loaded; false: it is gone; null: the provider cannot tell). Not whether the agent works. */
  running: true | false | null;
  /** "unknown" | "shell" | "stopped" | "unreachable"; any other word has no meaning of its own: `state()` goes on to `running` and bb's thread */
  runtimeState: string | null;
  runtimeError: string | null;
  /** The row's startedAt: the last time OATS started it (a spawn, a session start or restart). Absent or null where the kernel's row names none. */
  startedAt?: string | null;
  waiting: { reason: string; message: string | null; since: string | null } | null;
  /**
   * The row's sessionEnd, where it has one: "stopped" for a home an operator stopped, "lost" for a
   * session that is gone and that OATS did not stop (its thread archived or deleted in bb, a host
   * that went down), "exited". Absent or null where the kernel's row names none.
   */
  sessionEnd?: string | null;
  /**
   * The kernel's report that a harness runs in a home OATS recorded stopped (feature
   * `provider-outside-oats`, OATS 0.70.5): its one code, the row's backend and a one-line message
   * that names the remedy. The row's other fields stay what OATS recorded. Absent or null: no
   * report; on a kernel without the feature its absence says nothing.
   */
  outsideOats?: OutsideOats | null;
};

export type OutsideOats = { code: "running-outside-oats"; backend: string; message: string };

/**
 * What bb says of the thread a row names:
 * - `open`: bb lists it and it is not archived (it may be hidden, or drawn by another row);
 * - `archived`: bb has it, with `archivedAt` set;
 * - `missing`: bb has no thread of that id (deleted);
 * - `none`: the row names no thread;
 * - `unknown`: bb has not answered yet, or could not.
 */
export type ThreadWhere = "open" | "archived" | "missing" | "none" | "unknown";

/** The fields of bb's sidebar thread that the model reads. */
export type BbThread = {
  id: string;
  projectId: string | null;
  displayTitle: string;
  /** epoch milliseconds, as bb gives it */
  updatedAt: number;
  isUnread: boolean;
  isArchived: boolean;
  isHidden: boolean;
  hasPendingInteraction: boolean;
  /**
   * bb's own execution status of the thread, as bb gives it ("active", "starting", "stopping",
   * "pending", "idle", "error"; a later bb may add one): what says whether an agent on this thread
   * works (model/view.ts `state`).
   */
  status: string;
  /**
   * Whether bb holds a turn in line for the thread, as bb gives it ("waiting": it will start it by
   * itself; "none"; "failed"): a thread at rest with a turn in line is one whose agent works.
   */
  queuedWork: string;
};

/**
 * `outside`: the kernel reports that a harness runs in a home OATS recorded stopped
 * (`Agent.outsideOats`): "Running outside OATS". The one state that does not come from the row's
 * `running` and `runtimeState`, which stay what OATS recorded.
 */
export type AgentState = "needs-you" | "unreachable" | "stopped" | "error" | "working" | "idle" | "outside";

export type Node = {
  agent: Agent;
  thread: BbThread;
  state: AgentState;
  depth: 0 | 1 | 2;
  children: Node[];
};

/**
 * One top row of the roster, in the ONE order every row has whatever its backend: a root of the
 * tree (an agent on its bb thread, with its children under it), or an agent with no bb thread
 * (on tmux; or one whose thread bb does not list), which is a root in that same order.
 */
export type Top = { node: Node } | { agent: Agent; where: "tmux" | "detached" };

export type View = {
  /** The roster as it is drawn, top row by top row, in its one order (model/view.ts says the rule). */
  rows: Top[];
  /** the agents tree (the roots among `rows`, in the same order) */
  roots: Node[];
  /** threads with no agent */
  others: BbThread[];
  /** agents on a session provider whose thread is archived, hidden, deleted or taken by another agent */
  detached: Agent[];
  /** agents on tmux */
  elsewhere: Agent[];
  /** The nodes of the tree that wait on a person (agents with a bb thread). */
  needsYou: Node[];
  /** Every agent that needs a person: the ones that wait on one, those with no bb thread included (on tmux, or whose thread is gone), and the ones the kernel reports running outside OATS. The one count of who needs a person. */
  needing: Agent[];
  working: Node[];
  /** state idle and the thread unread */
  finished: Node[];
};

// ---- The rows of the four pages and of the spawn preview (contract.ts holds their schemas). ----

/** One soul of `oats souls`. */
export type Soul = {
  /** the soul key: what `oats spawn` takes (`<package>/<soul>` for a package soul) */
  name: string;
  /** the roster agent name of this soul's instances: equal to their `Agent.soul` */
  agent: string;
  description: string;
  /** display text, as the kernel words it */
  origin: string;
  /** names of the capabilities the soul composes; empty when the kernel cannot say */
  capabilities: string[];
  spawnable: boolean;
  /** "<code>: <message>", the kernel's, when the soul cannot be spawned */
  problem: string | null;
};

/** One capability of `oats capabilities`. */
export type Capability = {
  id: string;
  description: string;
  origin: string;
  /** how many of this deployment's souls compose it */
  souls: number;
};

/** One team of `oats teams`. */
export type Team = {
  label: string;
  /** the provider's team id; null for a shared team that is not mapped yet */
  team: string | null;
  isDefault: boolean;
};

/** This machine, or one registered server of `oats server list`. */
export type Machine = {
  id: string;
  /** the ssh alias the kernel recorded; null for this machine */
  route: string | null;
  isThisMachine: boolean;
  /** what the kernel last recorded about it */
  note: string | null;
};

/** What `oats spawn --preview` would do, as the form draws it. */
export type SpawnSummary = {
  modules: string[];
  teams: string[];
  /** harness and model, with where the model comes from */
  launch: string | null;
  warnings: string[];
  problems: string[];
};
