// The lifecycle's slots: Stop, Start, Restart and Retire in every thread's menu, as commands of
// bb's palette with a shortcut each (rebound in bb's Keyboard settings), as buttons another
// feature places (`AgentActs`), and the overlay that draws their dialogs. Every way in opens the
// act's dialog: nothing runs on one press.
import { useEffect, useState } from "react";
import type { PluginAppBuilder, PluginCommandRegistration, PluginCommandShortcut, PluginThreadAction, PluginThreadActionItemInput } from "@get-bb/plugin-sdk/app";
import type { Agent, AgentState, Node } from "../../model/types";
import { state } from "../../model/view";
import { useOats } from "../oats";
import { onWindowReset } from "../store";
import { failureWords, HELD_REASON } from "../roster/unreadable";
import type { Oats } from "../oats";
import { Button, DisabledReason } from "../ui";
import { ActsOverlay, openAct } from "./acts";
import { notify } from "../ui";
import { agentName, STATE } from "../ui/words";
import { cannotAct, NO_TARGET } from "./words";
import type { Verb } from "./words";

export { askPlan, asked, openAct, run } from "./acts";
export type { Verb } from "./words";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = { stop: "Square", start: "Play", restart: "RotateCcw", retire: "Trash2", oats: "Bot" } as const;

/** Idle, and the kernel says that no harness is loaded for it (`running: false`): the row's "not loaded". It does not run. */
const unloaded = (state: AgentState, agent: Agent): boolean => state === "idle" && agent.running === false;

/**
 * The four acts, in the order every place lists them: the name on a button (the Desktop's, with
 * "…": it opens a dialog), the entry in bb's own thread menu (where bb's Stop sits beside ours,
 * hence "(OATS)"), the command's title and its default shortcut (the Desktop's letters after its
 * leader: X, R, S, D; bb's own chord in the leader's place), and the states it applies to.
 */
export const ACTS: readonly {
  verb: Verb;
  button: string;
  menu: string;
  command: string;
  key: string;
  icon: string;
  destructive: boolean;
  when: (state: AgentState, agent: Agent) => boolean;
}[] = [
  { verb: "stop", button: "Stop…", menu: "Stop agent (OATS)", command: "OATS: Stop agent…", key: "x", icon: ICON.stop, destructive: false, 
    // An agent that runs is stopped. So is one that runs outside OATS (the state "outside": OATS
    // recorded it stopped and the kernel reports its harness running): Stop asks the provider to
    // stop it again. README, "Outside OATS".
    when: (state) => state === "working" || state === "idle" || state === "needs-you" || state === "outside",
  },
  {
    verb: "start",
    button: "Start…",
    menu: "Start agent (OATS)",
    command: "OATS: Start agent…",
    key: "s",
    icon: ICON.start,
    destructive: false,
    // An agent that does not run can be started: one whose session ended, one that is stopped, and
    // one the kernel calls stopped while bb holds a question on its thread (it then counts as
    // needing you, so the kernel's word is asked too). The thread's own row offers Start for the
    // same agents. And one that is IDLE WITH NO HARNESS LOADED (the kernel's own word, `running:
    // false`, beside a session that is there: "Idle · not loaded"): its row says that it does not
    // run, so Start opens, and the dialog says that it begins a new conversation.
    when: (state, agent) => state === "error" || state === "stopped" || agent.runtimeState === "stopped" || unloaded(state, agent),
  },
  { verb: "restart", button: "Restart…", menu: "Restart agent (OATS)", command: "OATS: Restart agent…", key: "r", icon: ICON.restart, destructive: false, when: (state) => state !== "stopped" && state !== "outside" },
  { verb: "retire", button: "Retire…", menu: "Retire agent (OATS)", command: "OATS: Retire agent…", key: "d", icon: ICON.retire, destructive: true, when: () => true },
];
const shortcut = (key: string): PluginCommandShortcut => ({ key, alt: true, shift: true });

/**
 * The acts that apply to an agent now, and why they are held when they are (the roster is the last
 * one read). For any agent the roster names, with a bb thread or without one (its thread gone, or
 * an agent on tmux): its state is the model's one rule (`state`). Start and Restart are offered for
 * an agent on bb alone: they end on the agent's new bb thread, and an agent on tmux has none.
 */
export function actsFor(oats: Oats, instance: string): { verb: Verb; label: string; destructive: boolean; held: string | null }[] {
  if (oats.phase !== "ready") return [];
  const agent = oats.nodeByInstance.get(instance)?.agent ?? oats.agents.find((each) => each.instance === instance);
  if (agent === undefined) return [];
  const now = oats.nodeByInstance.get(instance)?.state ?? state(agent, null);
  const held = oats.stale !== null ? HELD_REASON : null;
  return ACTS.filter((act) => act.when(now, agent) && (agent.backend === "bb" || act.verb === "stop" || act.verb === "retire")).map((act) => ({ verb: act.verb, label: act.button, destructive: act.destructive, held }));
}

/**
 * The acts of one agent as buttons, for a place that shows that agent (the instance panel, the
 * agent's own page): the ones that apply to its state, each opening its dialog; off, with the
 * reason beside them, while the roster is the last one read. It reads the roster itself and needs
 * nothing mounted above it (the dialogs are the app overlay's). Nothing where no act applies, and
 * for an agent the roster does not name.
 */
export function AgentActs({ instance }: { instance: string }) {
  const oats = useOats();
  const acts = actsFor(oats, instance);
  if (acts.length === 0) return null;
  const held = acts[0]!.held;
  return (
    <div data-testid="oats-agent-acts" className="flex min-w-0 flex-wrap items-center gap-2">
      {acts.map((act) => (
        <Button key={act.verb} data-testid={`oats-agent-act-${act.verb}`} disabled={act.held !== null} onClick={() => openAct(act.verb, instance)}>
          {act.label}
        </Button>
      ))}
      {held === null ? null : <DisabledReason>{held}</DisabledReason>}
    </div>
  );
}

/** How long the first read may take before the menus say that OATS is being read: a normal start flashes no entry onto every menu. */
const READING_AFTER_MS = 1_000;

type ActionData = { oats: Oats; /** the first read has been in flight for more than READING_AFTER_MS */ slow: boolean };
function useActionData(): ActionData {
  const oats = useOats();
  const reading = oats.phase === "loading";
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!reading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), READING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reading]);
  return { oats, slow };
}

/**
 * The roster as the overlay last drew it, for a command: bb asks a command whether it applies, and
 * runs it, outside React, with the thread in view alone.
 */
let roster: Oats | null = null;
onWindowReset(() => {
  roster = null;
});
function Overlay() {
  roster = useOats();
  return <ActsOverlay />;
}
const nodeIn = (threadId: string | null): Node | undefined => (roster?.phase === "ready" && threadId !== null ? roster.nodeByThread.get(threadId) : undefined);

/** A command's key was pressed for the agent of the thread in view: open the act's dialog, or say in one line why it cannot act. */
function runCommand(verb: Verb, threadId: string | null): void {
  const node = nodeIn(threadId);
  // One line about the key that was pressed, not the failure of an act: it leaves by itself.
  const say = (title: string) => notify({ tone: "hint", title });
  // Whose thread it is is known only from a roster that was read: until then the line says what the thread's menu says.
  if (roster === null || roster.phase === "loading") return say("OATS agents: reading…");
  if (roster.phase === "failed") return say(`OATS agents: can't be read. ${failureWords(roster, roster.machine).title}.`);
  if (node === undefined) return say(NO_TARGET);
  if (roster.stale !== null) return say(`Stop, Start, Restart and Retire come back when OATS is read again.`);
  const { state, agent } = node;
  // (An agent that runs outside OATS runs: its harness does, whatever OATS recorded. Never "is stopped" of it.)
  // And never "is already running" of a row that says no harness is loaded.
  const why = cannotAct(verb, agent.instance, { running: (state === "working" || state === "idle" || state === "needs-you" || state === "outside") && !unloaded(state, agent), known: state !== "unreachable" });
  // The menu's own rule decides; the sentence says why in the Desktop's words where it has one.
  if (!ACTS.find((act) => act.verb === verb)!.when(state, agent)) return say(why ?? `${agentName(agent.instance)} can't be ${verb === "stop" ? "stopped" : verb === "start" ? "started" : "restarted"} now.`);
  openAct(verb, agent.instance);
}

/**
 * Each act as a command of bb's palette, with a default shortcut a person rebinds in bb's Keyboard
 * settings (the Desktop's D-174, with bb's own keys: no leader). It acts on the agent whose thread
 * is in view. It is listed everywhere, as on the Desktop: where it cannot act (no thread in view, a
 * thread that is no agent's, a state the act does not apply to) its key says why in one line, and
 * never does nothing.
 */
export const commands: readonly PluginCommandRegistration[] = ACTS.map((act) => ({
  id: `agent-${act.verb}`,
  title: act.command,
  defaultShortcut: shortcut(act.key),
  run: (context) => runCommand(act.verb, context.threadId),
}));

/**
 * The OATS entries are a group of their own in bb's thread menus, which bb sets apart with a
 * separator: by the SDK's string order of groups it stands after bb's organize group and before
 * bb's settings and lifecycle groups (Stop, Archive, Delete), so that "Retire agent (OATS)" never
 * stands directly over bb's Delete. The SDK allows no more: bb's own entries cannot be taken out
 * of an agent's menu, nor asked to confirm.
 */
export const OATS_GROUP = "3_oats";

export function register(app: PluginAppBuilder): void {
  // The group's first row names the agent the entries act on, and its state: a menu covers the row
  // it was opened from (at a phone's width, most of the list), and a person checks the target here.
  // bb's menus have no heading: it is a row that is off.
  app.slots.experimental_threadAction({
    id: "agent",
    // (bb also lists a thread action where a person picks a row's quick actions, by this title: it says what the row is.)
    title: "OATS agent's name and state",
    icon: ICON.oats,
    group: OATS_GROUP,
    order: -1,
    useData: useActionData,
    item: ({ thread, data }: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null => {
      const node = data.oats.phase === "ready" ? data.oats.nodeByThread.get(thread.id) : undefined;
      return node === undefined ? null : { label: `${agentName(node.agent.instance)} · ${STATE[node.state].word}`, icon: ICON.oats, disabled: true, run: () => undefined };
    },
  });

  // One lifecycle action each in every thread menu, shown only on a thread that is an OATS agent
  // and only in the states it applies to. Each goes through OATS, so a stopped agent stays stopped.
  ACTS.forEach((act, order) => {
    app.slots.experimental_threadAction({
      id: act.verb,
      title: act.menu,
      icon: act.icon,
      group: OATS_GROUP,
      order,
      useData: useActionData,
      item: (input: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null => {
        const { oats } = input.data;
        if (oats.phase !== "ready") return null;
        const node = oats.nodeByThread.get(input.thread.id);
        if (node === undefined || !act.when(node.state, node.agent)) return null;
        const variant = act.destructive ? "destructive" : "default";
        // On the last roster read, while OATS cannot be read, the acts are HELD (the Desktop's rule):
        // the entry stays where it was, off, with the reason, so that a person sees that the act
        // exists and when it comes back, and does not reach for bb's own Stop. The notice has Retry.
        if (oats.stale !== null) return { label: act.menu, icon: act.icon, variant, disabled: true, detail: HELD_REASON, run: () => undefined };
        return { label: act.menu, icon: act.icon, variant, run: () => openAct(act.verb, node.agent.instance) };
      },
    });
  });
  for (const command of commands) app.commands.register(command);

  // With no roster at all (never read, or being read for the first time) which thread is an agent is
  // not known: every thread's menu then has ONE entry, off, that says so and why. Never silence:
  // without it only bb's own Stop, Archive and Delete would be there.
  app.slots.experimental_threadAction({
    id: "unreadable",
    title: "OATS agents",
    icon: ICON.oats,
    group: OATS_GROUP,
    order: 4,
    useData: useActionData,
    item: ({ data }: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null => {
      const { oats, slow } = data;
      if (oats.phase === "failed") {
        return { label: "OATS agents: can't be read", detail: failureWords(oats, oats.machine).title, icon: ICON.oats, disabled: true, run: () => undefined };
      }
      if (oats.phase === "loading" && slow) return { label: "OATS agents: reading…", icon: ICON.oats, disabled: true, run: () => undefined };
      return null;
    },
  });

  // Draws the dialog of each act, wherever it was asked from.
  app.slots.experimental_appOverlay({ id: "acts", component: Overlay });
}
