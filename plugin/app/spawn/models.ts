// The harness and model choice, for every place that offers it: the New agent form and the Start
// and Restart dialogs (the harness interface: specs' bb-plugin-harness-interface, v4).
//
//   - The harnesses are the ones the bb session provider declares (`spawnHarnesses`, one read).
//     With one in the list no choice is shown and none is passed.
//   - A harness's model suggestions are bb's own: what bb can launch for that harness's bb
//     provider on the machine that holds the deployment, asked WITHOUT a project (a per-project
//     listing starts a pi in the agent's home, which blocks its retire for about a minute). There
//     is no kernel verb for them. With none reported the field is "Default" plus free text.
//
// What the kernel cannot launch it refuses at the preview, in its own words: nothing here decides.
import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { harnessLabel } from "../../model/spawn";

export { harnessLabel };
import { useRead } from "../store";

/**
 * The bb provider that runs each harness, as the bb session provider maps them (oats-bb
 * oats-package/capabilities/oats-bb/lib/mode.mjs BB_PROVIDER). A harness this does not know has no
 * model list to ask for.
 */
export const BB_PROVIDER: Readonly<Record<string, string>> = { claude: "claude-code", pi: "pi" };

/** A harness as a choice: its id (what `--harness` takes) and its name for a person. */
export type HarnessOption = { id: string; label: string };
/**
 * The harness choice. `choice` is false when there is nothing to choose (one harness, or none
 * declared): the field is then not drawn and no `--harness` is passed. `hostId` is the machine
 * bb's model list is asked of.
 */
export type Harnesses = {
  status: "loading" | "ready" | "failed";
  options: HarnessOption[];
  choice: boolean;
  hostId: string | null;
  error: string | null;
  /** false: the deployment has no bb session provider: a spawn there is not a bb thread (nothing of bb's is offered for it: no harness, no model list). */
  provider: boolean;
  /** The harnesses the kernel launches itself: what a spawn that is not a bb thread may name. */
  kernel: HarnessOption[];
  /** The workspace pins the bb session provider and it is not synced yet: the kernel's own code and sentence; null otherwise. */
  unsynced: { code: string; message: string } | null;
  retry(): void;
};
/** The first entry of the harness field: selected at the start, and nothing is passed while it is. */
export const SOUL_DEFAULT = "The soul's default";
/** The first entry of a Start or Restart's harness field. */
export const KEEP_HARNESS = "Keep the recorded harness";
/** The first entry said with what the kernel resolved, once a preview answered: "The soul's default: pi". */
export const resolvedLabel = (first: string, harness: string | null): string => (harness === null ? first : `${first}: ${harnessLabel(harness)}`);

/** The harnesses the bb session provider declares, read once for the window and shared. */
export function useHarnesses(): Harnesses {
  const read = useRead("spawnHarnesses", { live: false });
  const ids = read.data?.harnesses ?? [];
  return {
    status: read.status === "ready" ? "ready" : read.status === "error" ? "failed" : "loading",
    options: ids.map((id) => ({ id, label: harnessLabel(id) })),
    choice: ids.length > 1,
    hostId: read.data?.hostId ?? null,
    provider: read.data?.provider !== false,
    kernel: (read.data?.kernelHarnesses ?? []).map((id) => ({ id, label: harnessLabel(id) })),
    unsynced: read.data?.unsynced ?? null,
    error: read.status === "error" ? read.error : null,
    retry: read.retry,
  };
}

/** A model bb can launch: its id (what `--model` takes) and bb's name for it. */
/** `provider`: the bb provider's own provider of the model (bb's `routeProviderId`: for pi, the `<provider>` its id begins with); null where bb names none. */
export type ModelOption = { id: string; label: string; provider: string | null };
/** The first entry of the model field: selected at the start, and no `--model` is passed while it is. */
export const MODEL_DEFAULT = "Default";
export type ModelSuggestions = { status: "loading" | "ready"; models: ModelOption[] };

/** bb's answer as suggestions: each model once by its id, in bb's order; ids that could be read as an option are left out. */
export function modelOptions(answer: unknown): ModelOption[] {
  const listed = typeof answer === "object" && answer !== null && Array.isArray((answer as { models?: unknown }).models) ? (answer as { models: unknown[] }).models : [];
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const entry of listed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { model, displayName, routeProviderId } = entry as { model?: unknown; displayName?: unknown; routeProviderId?: unknown };
    if (typeof model !== "string" || model === "" || model.startsWith("-") || model.includes("\0") || seen.has(model)) continue;
    seen.add(model);
    options.push({ id: model, label: typeof displayName === "string" && displayName !== "" && displayName !== model ? `${displayName} · ${model}` : model, provider: typeof routeProviderId === "string" && routeProviderId !== "" ? routeProviderId : null });
  }
  return options;
}

/**
 * bb's models for a harness (`null`: none chosen, nothing is asked), on the machine that holds the
 * deployment. Asked again when the harness changes; an answer for a harness that is no longer the chosen one is dropped. A harness
 * with no bb provider, a machine not known yet, and a list bb could not give all read as no
 * suggestion: the field stays "Default" plus free text, and says so.
 */
export function useModelSuggestions(harness: string | null): ModelSuggestions {
  const sdk = useSdk();
  // The machine that holds the deployment comes with the harness list, which every place that offers a model has read.
  const list = useRead("spawnHarnesses", { live: false });
  const hostId = list.data?.hostId ?? null;
  const providerId = harness === null ? undefined : BB_PROVIDER[harness];
  const [answer, setAnswer] = useState<{ of: string; models: ModelOption[] } | null>(null);
  const of = providerId === undefined || hostId === null ? null : `${hostId}\n${providerId}`;
  useEffect(() => {
    if (of === null || providerId === undefined || hostId === null) return;
    let current = true;
    const none = () => {
      if (current) setAnswer({ of, models: [] });
    };
    // No projectId: the machine's own list, never a listing that starts a harness in a project.
    sdk.providers.models({ hostId, providerId, preferCached: true }).then((listed) => {
      if (current) setAnswer({ of, models: modelOptions(listed) });
    }, none);
    return () => {
      current = false;
    };
  }, [sdk, of, providerId, hostId]);
  // The machine is not known until the harness list is read: until then nothing is said to be missing.
  if (providerId !== undefined && hostId === null && list.status === "loading") return { status: "loading", models: [] };
  if (of === null) return { status: "ready", models: [] };
  if (answer === null || answer.of !== of) return { status: "loading", models: [] };
  return { status: "ready", models: answer.models };
}

// ---- whether bb can run a harness here ----
// The provider declares the harnesses it can launch; whether bb on this machine HAS the bb provider
// a harness runs on (installed, signed in) is bb's own fact: `sdk.system.providerStates`, the state
// bb shows in its own settings. The bb session provider refuses a launch on a provider bb reports
// as not ready (E_BACKEND_NOT_READY), after the spawn was decided: the form says it at the choice.
// Read, never guessed: while bb has not answered, or for a state the plugin does not know, nothing is said.

/** What bb says of a harness's bb provider when it is not ready to run; null when it is ready, or not known. */
/**
 * `sentence` is for under a Harness field, where the harness's entry carries the `mark` (the fault)
 * and another can be picked: the way on, alone. `alone` is for a form that has no such field (one
 * harness declared): the fault and the way on, with no word of picking another: a sentence names
 * only a control that exists.
 */
export type HarnessState = { mark: string; sentence: string; alone: string } | null;
// (Under the field the harness's entry carries the mark, which says the fault: the sentence says only the way on.)
const notReady = (mark: string, what: string, how: string): { mark: string; sentence: string; alone: string } => ({ mark, sentence: `${how}, or pick another.`, alone: `${what}, so a spawn on it is refused. ${how}.` });
const NOT_READY: Record<string, (name: string) => { mark: string; sentence: string; alone: string }> = {
  not_installed: (name) => notReady("not installed in bb", `bb has not installed ${name} on this machine`, "Install it in bb’s settings"),
  unauthenticated: (name) => notReady("not signed in in bb", `bb is not signed in to ${name} on this machine`, "Sign in to it in bb’s settings"),
  expired: (name) => notReady("sign-in expired in bb", `bb’s sign-in to ${name} has expired on this machine`, "Sign in to it again in bb’s settings"),
  unsupported_version: (name) => notReady("too old for bb", `bb needs a newer ${name} than the one on this machine`, "Update it in bb’s settings"),
};
/** bb's answer as a state per bb provider id; a provider bb does not list, or a state it calls ready or unknown, has none. */
export function providerStates(answer: unknown): Map<string, string> {
  const listed = typeof answer === "object" && answer !== null && Array.isArray((answer as { providers?: unknown }).providers) ? (answer as { providers: unknown[] }).providers : [];
  const states = new Map<string, string>();
  for (const entry of listed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { providerId, status } = entry as { providerId?: unknown; status?: unknown };
    if (typeof providerId === "string" && typeof status === "string") states.set(providerId, status);
  }
  return states;
}
/**
 * For each harness, what bb says when its bb provider is not ready on the machine that holds the
 * deployment: `stateOf(harness)`. Asked once the machine is known; a failed or pending read says nothing.
 */
export function useHarnessStates(): (harness: string | null) => HarnessState {
  const sdk = useSdk();
  const list = useRead("spawnHarnesses", { live: false });
  const hostId = list.data?.hostId ?? null;
  const [answer, setAnswer] = useState<{ of: string; states: Map<string, string> } | null>(null);
  useEffect(() => {
    if (hostId === null) return;
    let current = true;
    Promise.resolve()
      .then(() => sdk.system.providerStates({ hostId }))
      .then(
        (states) => {
          if (current) setAnswer({ of: hostId, states: providerStates(states) });
        },
        () => undefined, // bb did not say: nothing is marked
      );
    return () => {
      current = false;
    };
  }, [sdk, hostId]);
  return (harness) => {
    if (harness === null || answer === null || answer.of !== hostId) return null;
    const providerId = BB_PROVIDER[harness];
    const status = providerId === undefined ? undefined : answer.states.get(providerId);
    return status !== undefined && Object.hasOwn(NOT_READY, status) ? NOT_READY[status]!(harnessLabel(harness)) : null;
  };
}
