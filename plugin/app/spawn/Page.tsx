// The New agent form, a page of its own (`/plugins/oats/new-agent`, and `/new-agent/<soul>` with a
// soul chosen): the OATS Desktop's Spawn dialog, in its order and its words. The soul first, then
// the opening instruction, the harness and the model (the harness interface, v4), the
// relationship and the name; then, standing, "What will be created": the kernel's own preview for
// exactly the values on screen (`oats spawn … --preview`), read again as they change.
//
// What a press can do is held to what the screen shows:
//   - Spawn is off until the preview of the values on screen is drawn, and applies the decision
//     that preview showed and no other (its revision goes with the call): the kernel refuses one
//     that moved, and nothing is created;
//   - while a spawn is in flight, and once it created the agent, the fields and Spawn are held:
//     one press makes one agent;
//   - where the outcome is not known, the fields stay held and the one act is Check result, which
//     asks again under the same key: the kernel replays the spawn it made, or makes the one it
//     did not, never a second.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { isUnconfirmed } from "../../contract/shared";
import type { rpc as spawnRpc, SpawnFacts } from "../../contract/spawn";
import { bbDefaultModel, modelCheck, MODEL_HELD, spawnProblem, withoutDefault } from "../../model/spawn";
import type { SpawnProblem, SpawnReason } from "../../model/spawn";
import { newKey } from "../keys";
import { openAgentPage } from "../home/agent-tab";
import { useOats } from "../oats";
import { startOutcome } from "../outside/threads";
import { RosterNotice } from "../roster/unreadable";
import { errorMessage, onWindowReset, useRead } from "../store";
import type { Contract, Result as Answer } from "../store";
import { notify } from "../ui";
import { Button, DisabledReason, Disclosure, Fact, Facts, Field, INPUT, Loading, Notice, Page, Result, Section, Segmented } from "../ui";
import { refusalCode, refusalLines, shown } from "../ui/text";
import { agentName } from "../ui/words";
import { Choice } from "./Choice";
import { BB_PROVIDER, MODEL_DEFAULT, resolvedLabel, SOUL_DEFAULT, useHarnesses, useHarnessStates, useModelSuggestions } from "./models";
import * as W from "./words";

type Soul = Answer<"souls">["souls"][number];
/** What a person chose, as the form's preview and its spawn take it. */
type Input = z.infer<(typeof spawnRpc)["spawnPlan"]["input"]>;

/** How long the form waits after the last change before it asks for the preview again. */
export const PREVIEW_DEBOUNCE_MS = 400;
/** In the model's choice: the entry that opens the field for a typed id. */
const CUSTOM = "__custom__";
/** The kernel's refusals that are about the name: said under the name itself. */
const NAME_REFUSALS = new Set(["E_INSTANCE_NAME_INVALID", "E_INSTANCE_NAME_TAKEN"]);

/** The soul the route names: the whole remainder, each segment percent-decoded (`<package>/<soul>` is two). */
function soulOf(subPath: string): string {
  return subPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/**
 * A failed call as a code and a message. The server words a refusal of the kernel's
 * `<code>: <message>`. A refusal with no such code is the plugin's own "this input cannot be
 * used" (bb's code `invalid`: nothing was asked of the kernel); a call that failed with neither
 * never reached an answer, and what it did is not known. The kernel's marker that it could not
 * confirm what is left comes with the refusal, beside its text (contract/shared.ts `isUnconfirmed`).
 */
function reasonOf(cause: unknown): SpawnReason {
  const text = errorMessage(cause);
  const code = refusalCode(text);
  const unconfirmed = isUnconfirmed(cause); // whatever the text leads with
  if (code !== null) return { code, message: text.slice(code.length + 2), unconfirmed };
  const refused = typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "invalid";
  return { code: refused ? "INVALID_INPUT" : "PLUGIN_RPC_FAILED", message: text, unconfirmed };
}

// A spawn can take minutes, and goes on when its page is left: the window remembers the one in
// flight, so that the form, opened again meanwhile, says so and starts no second one beside it.
let flight: { soul: string } | null = null;
const flightWatchers = new Set<() => void>();
const setFlight = (next: { soul: string } | null) => {
  flight = next;
  for (const watcher of flightWatchers) watcher();
};
onWindowReset(() => setFlight(null));
function useFlight(): { soul: string } | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const watcher = () => redraw((n) => n + 1);
    flightWatchers.add(watcher);
    return () => void flightWatchers.delete(watcher);
  }, []);
  return flight;
}

/** The ids of the fields' marks: what an off Spawn is described by (aria-describedby), the word said once. */
const MARK = { soul: "oats-spawn-soul-mark", model: "oats-spawn-model-mark", name: "oats-spawn-name-mark" } as const;
/**
 * The ids of what is IN VIEW for a hold that has no mark: the field that is empty, the column (its refusal), the
 * roster's notice. An off Spawn is described by it too (aria-describedby): no word is added to the screen, and for a
 * screen reader the button is never just dimmed (the review of part 7).
 */
const SAYS = { soul: "oats-spawn-soul-field", modelId: "oats-spawn-model-id-field", relative: "oats-spawn-relative-choice", column: "oats-spawn-column", held: "oats-spawn-roster-notice", absent: "oats-spawn-no-bb" } as const;
/** How long Spawn waits for bb's list of models before it goes without it (the wait a thread's start is given too). */
const MODELS_WAIT_MS = 10_000;
type Preview = { key: string; input: Input; facts: SpawnFacts; revision: string };
type Refused = { key: string; problem: SpawnProblem };

/** A part of a line through the display filter, with the blank it leads or ends with kept: the parts are read as one line. */
const piece = (text: string): string => `${/^\s/u.test(text) ? " " : ""}${shown(text)}${/\s$/u.test(text) ? " " : ""}`;
/** A commit where a version would be (a package taken from a repository): its first seven characters, the whole one as the title. */
const COMMIT = /\b[0-9a-f]{40}\b/g;

/**
 * A value that holds a path, a branch or an id: it may break after "/" and after "-", and nowhere
 * inside a word. A commit is drawn short.
 */
function Breakable({ text }: { text: string }) {
  const whole = COMMIT.test(text) ? text : undefined;
  COMMIT.lastIndex = 0;
  const parts = text.replace(COMMIT, (commit) => commit.slice(0, 7)).split(/(?<=[/-])/u);
  return (
    <span title={whole} className="[font-variant-ligatures:none]">
      {parts.map((part, index) => (
        // One part between two places the value may break (the break is before it, never inside): a scene checks that each is on one line.
        <Fragment key={index}>
          {index === 0 ? null : <wbr />}
          <span data-part="">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Who the agent is started under, with the other agent by its name as words, as everywhere the
 * plugin draws an agent: the kernel's answer names it by its instance ("child of api-2").
 */
const related = (parts: SpawnFacts["facts"][number]["parts"]): SpawnFacts["facts"][number]["parts"] =>
  parts.map((part) => ({ ...part, text: part.text.replace(/^((?:child|sibling|parent) of) (\S+)$/u, (_whole, kind: string, instance: string) => `${kind} ${agentName(instance)}`) }));

/** A fact's value: its parts in a line, then each second line (where it came from, what else) under it. */
function Parts({ parts }: { parts: SpawnFacts["facts"][number]["parts"] }) {
  const first = parts.filter((part) => part.sub !== true);
  const under = parts.filter((part) => part.sub === true);
  return (
    <>
      <span>
        {first.map((part, index) => (
          <span key={index} className={part.mono ? "font-mono text-xs" : part.muted ? "text-muted-foreground" : undefined}>
            <Breakable text={piece(part.text)} />
          </span>
        ))}
      </span>
      {under.map((part, index) => (
        <span key={index} className="block text-xs text-muted-foreground">
          {shown(part.text)}
        </span>
      ))}
    </>
  );
}

/** A capability of the preview: its name, then where it is from and why it is there. */
function Module({ module }: { module: { name: string; source: string; why: string } }) {
  const from = [module.source, module.why].filter((part) => part !== "").map(shown).join(" · ");
  return (
    <>
      <span>
        <Breakable text={shown(module.name)} />
      </span>
      {from === "" ? null : (
        <span className="block text-xs text-muted-foreground">
          <Breakable text={from} />
        </span>
      )}
    </>
  );
}

/** The rows of the column that stay in view: the ones a person decides on. Every other row is under its one fold. */
const IN_VIEW: ReadonlySet<string> = new Set(["Works in", "Harness", "Access", "Relationship"]);

/** A fact of who the agent is (its name, its home): a value that may be muted, and a title for what was cut short. */
function Identity({ fact }: { fact: SpawnFacts["identity"][number] }) {
  return (
    <Fact label={fact.label} title={fact.title === undefined ? undefined : shown(fact.title)}>
      <span className={fact.muted ? "text-muted-foreground" : undefined}>
        <Breakable text={shown(fact.text)} />
      </span>
    </Fact>
  );
}

/**
 * The facts of a preview, as the Desktop's column lists them. `machine` is the machine that holds
 * the deployment, where the agent runs: the roster's fact, said after where it works.
 */
function Created({ facts, machine }: { facts: SpawnFacts; machine: string | null }) {
  // In view: what a person decides on (the name, where it works, the harness and its model, the access it runs
  // with, who it is started under). Everything else is one press away, under the column's ONE fold.
  const [name, ...identity] = facts.identity;
  const inView = facts.facts.filter((fact) => IN_VIEW.has(fact.label)).map((fact) => ({ ...fact, parts: fact.parts.filter((part) => part.sub !== true) }));
  // Where the harness came from is a second line of its row: under the fold, as the row's own.
  const cameFrom = facts.facts.filter((fact) => IN_VIEW.has(fact.label) && fact.parts.some((part) => part.sub === true)).map((fact) => ({ label: fact.label, parts: fact.parts.filter((part) => part.sub === true).map((part) => ({ ...part, sub: false })) }));
  const others = facts.facts.filter((fact) => !IN_VIEW.has(fact.label));
  const soul = others.filter((fact) => fact.label === "Soul");
  const rest = others.filter((fact) => fact.label !== "Soul");
  const folded = [...soul, ...(machine === null ? [] : [{ label: W.RUNS_ON, parts: [{ text: machine }] }]), ...cameFrom, ...rest];
  const more = identity.length > 0 || folded.length > 0 || facts.modules !== null;
  return (
    <>
      {facts.warnings.map((lines, index) => (
        <Notice key={index} title={W.WARNING_TITLE} tone="warning">
          {lines.map((line, at) => (
            <p key={at}>{shown(line)}</p>
          ))}
        </Notice>
      ))}
      <Facts>
        {name === undefined ? null : <Identity fact={name} />}
        {inView.map((fact) => (
          <Fact key={fact.label} label={fact.label}>
            <Parts parts={fact.label === "Relationship" ? related(fact.parts) : fact.parts} />
          </Fact>
        ))}
      </Facts>
      {!more ? null : (
        <Disclosure summary={W.COLUMN_DETAILS} testId="oats-spawn-more">
          <div className="flex min-w-0 flex-col gap-3">
          <Facts>
            {identity.map((fact) => (
              <Identity key={fact.label} fact={fact} />
            ))}
            {folded.map((fact) => (
              <Fact key={`${fact.label}-${fact.parts[0]?.text ?? ""}`} label={fact.label}>
                <Parts parts={fact.parts} />
              </Fact>
            ))}
          </Facts>
      {facts.modules === null ? null : (
        <>
          <Section title="Core capabilities" testId="oats-spawn-core">
            <Facts>
              {facts.modules.core.map((slot) => (
                <Fact key={slot.layer} label={slot.label}>
                  {slot.module === null ? <span className="text-muted-foreground">none</span> : <Module module={slot.module} />}
                </Fact>
              ))}
            </Facts>
          </Section>
          {facts.modules.caps.length === 0 ? null : (
            <Section title="Capabilities" n={facts.modules.caps.length} testId="oats-spawn-caps">
              <ul className="flex flex-col gap-1 text-sm">
                {facts.modules.caps.map((module) => (
                  <li key={module.name} className="min-w-0">
                    <Module module={module} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
          </div>
        </Disclosure>
      )}
    </>
  );
}

export function NewAgentPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const oats = useOats();
  const souls = useRead("souls");
  const harnesses = useHarnesses();
  const harnessState = useHarnessStates();
  const inFlight = useFlight();

  // ---- the values ----
  const [soul, setSoul] = useState(() => soulOf(subPath));
  useEffect(() => setSoul(soulOf(subPath)), [subPath]);
  const [task, setTask] = useState("");
  const [harness, setHarness] = useState("");
  const [modelPick, setModelPick] = useState("");
  const [modelTyped, setModelTyped] = useState("");
  const [relation, setRelation] = useState<W.RelationKind>("unrelated");
  const [relativeTo, setRelativeTo] = useState("");
  const [typedName, setTypedName] = useState("");

  const list = souls.data?.souls;
  const chosen: Soul | undefined = list?.find((candidate) => candidate.name === soul);
  const unknownSoul = soul !== "" && list !== undefined && chosen === undefined;
  const name = W.nameSent(typedName);
  const nameFault = W.nameFault(name);
  const model = modelPick === CUSTOM ? modelTyped.trim() : modelPick;
  const agents = oats.phase === "ready" ? oats.agents : [];
  // An instance that left the roster is no longer one to relate to.
  const relative = relation !== "unrelated" && agents.some((agent) => agent.instance === relativeTo) ? relativeTo : "";
  // While OATS cannot be read, the form is held like the acts: the roster's own notice says so.
  const held = oats.phase === "failed" || (oats.phase === "ready" && oats.stale !== null);
  const machine = oats.phase === "ready" ? shown(oats.deployment.machine) : null;

  /**
   * Which field keeps these values from being asked of the kernel; null when they can be. No sentence says it beside
   * Spawn: the field is empty in view (its placeholder says what it wants) or carries its own mark.
   */
  // A deployment with no bb session provider: nothing can be spawned on bb there. The form says so once (its notice),
  // asks the kernel for no preview (it would be refused for the bb backend), and holds its fields and Spawn.
  const absent = harnesses.absent;
  const off: "absent" | "soul" | "cannot" | "name" | "model" | "relation" | null =
    absent !== null ? "absent" : chosen === undefined ? "soul" : !chosen.spawnable ? "cannot" : nameFault !== null ? "name" : modelPick === CUSTOM && model === "" ? "model" : relation !== "unrelated" && relative === "" ? "relation" : null;
  const input: Input | null = useMemo(
    () =>
      off !== null
        ? null
        : {
            soul,
            task,
            ...(name === "" ? {} : { name }),
            ...(harness === "" || !harnesses.choice ? {} : { harness }),
            ...(model === "" ? {} : { model }),
            ...(relation === "unrelated" ? {} : { relation: { kind: relation, to: relative } }),
          },
    [off, soul, task, name, harness, harnesses.choice, model, relation, relative],
  );
  const key = input === null ? null : JSON.stringify(input);

  // ---- what will be created: the preview of exactly these values ----
  const [settled, setSettled] = useState<Preview | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [asking, setAsking] = useState(false);
  const [again, setAgain] = useState(0);
  const serial = useRef(0);
  const latest = useRef<{ key: string | null; input: Input | null; harnessField: boolean }>({ key, input, harnessField: harnesses.choice });
  latest.current = { key, input, harnessField: harnesses.choice };
  useEffect(() => {
    const ticket = ++serial.current;
    if (key === null || held) {
      setAsking(false);
      return;
    }
    setAsking(true);
    const timer = setTimeout(() => {
      const asked = latest.current;
      if (asked.input === null || asked.key !== key) return;
      Promise.resolve()
        .then(() => rpc.call("spawnPlan", asked.input!))
        .then(
          (answer) => {
            // An answer for values that are no longer on screen is dropped, never drawn under the new ones.
            if (serial.current !== ticket) return;
            setSettled({ key, input: asked.input!, facts: answer.facts, revision: answer.revision });
            setRefused(null);
            setAsking(false);
          },
          (cause: unknown) => {
            if (serial.current !== ticket) return;
            setRefused({ key, problem: spawnProblem(reasonOf(cause), "preview", { harnessField: latest.current.harnessField }) });
            setAsking(false);
          },
        );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rpc, key, held, again]);
  const preview = settled !== null && settled.key === key ? settled : null;
  const refusal = refused !== null && refused.key === key ? refused.problem : null;
  const nameRefusal = refusal !== null && NAME_REFUSALS.has(refusal.code) ? refusal : null;

  // ---- the harness and the model ----
  // What the kernel resolved, through the display filter like every text of the kernel's: a model is a soul's own text.
  const kernelResolved = preview?.facts.resolved ?? null;
  const resolved = kernelResolved === null ? null : { harness: shown(kernelResolved.harness) || null, model: shown(kernelResolved.model) || null };
  // The answer the model is read on: the kernel's for the values on screen, and, while another field's change is
  // read, the last one if it was for this soul, harness and model: the harness whose list bb gives, the mark and the
  // column stay as they are until the new answer lands.
  const modelAnswer = preview ?? (settled !== null && input !== null && settled.input.soul === input.soul && settled.input.harness === input.harness && settled.input.model === input.model ? settled : null);
  const effectiveHarness = harness !== "" ? harness : shown(modelAnswer?.facts.resolved?.harness ?? "") || null;
  const suggestions = useModelSuggestions(effectiveHarness);
  // The soul's own harness: what the kernel resolves for this soul with no harness chosen. It is kept from the
  // preview with none chosen; where none was asked for this soul (a harness picked before the soul, or kept while
  // the soul changes), it is asked once, so that the same values hold or arm Spawn whatever the order of the clicks.
  const [own, setOwn] = useState<{ soul: string; harness: string | null } | null>(null);
  useEffect(() => {
    if (kernelResolved !== null && harness === "" && soul !== "") setOwn({ soul, harness: kernelResolved.harness });
  }, [kernelResolved, harness, soul]);
  const ownKnown = own !== null && own.soul === soul;
  // An ask the kernel refused is not an answer: it is asked again when the form's values change, or with Retry.
  const ownTry = `${key}\n${again}`;
  const [ownFailed, setOwnFailed] = useState<string | null>(null);
  const ownTryNow = useRef(ownTry);
  ownTryNow.current = ownTry;
  const ownAsked = input !== null && !held && harness !== "" && harnesses.choice && !ownKnown && ownFailed !== ownTry;
  useEffect(() => {
    if (!ownAsked) return;
    let current = true;
    rpc.call("spawnPlan", { soul, task: "" }).then(
      (answer) => {
        if (current) setOwn({ soul, harness: answer.facts.resolved?.harness ?? null });
      },
      // The kernel did not answer for this soul on its own: its harness stays unknown, and a chosen one is held for a model.
      () => {
        if (current) setOwnFailed(ownTryNow.current);
      },
    );
    return () => {
      current = false;
    };
  }, [rpc, ownAsked, soul]);
  const soulHarness = ownKnown ? own.harness : null;
  // Whether a spawn may go with the model it would send (model/spawn.ts `modelCheck`): a model is required for a
  // harness the person chose that is not the soul's own, and a bare id that several of bb's listed models serve needs
  // its provider picked. That no listed model serves it is the provider's to judge, at the launch.
  // bb's list decides only once it is read and holds something: until then the kernel's answer stands.
  const modelHeld = modelCheck({ chosenHarness: harness !== "" ? harness : null, soulHarness, picked: model !== "" ? model : null, resolved: modelAnswer?.facts.resolved ?? null, listed: suggestions.status === "ready" && suggestions.models.length > 0 ? suggestions.models : null, byProvider: effectiveHarness !== null && BB_PROVIDER[effectiveHarness] === "pi" });
  // The "Required" mark waits for the soul's own harness to be known: until then Spawn is off as for any read.
  const modelMark = ownAsked && modelHeld.held === MODEL_HELD.required ? null : modelHeld.held;
  // bb's list for the harness is being read: until it answers, whether bb serves the model is not known.
  // A list bb has not given after MODELS_WAIT_MS reads as not read: Spawn goes on the kernel's answer, as where bb
  // gives no list, and the rule is read on the list if it answers later. A call of bb's that never settles does not
  // hold the form.
  const listLoading = suggestions.status === "loading";
  const [listLate, setListLate] = useState(false);
  useEffect(() => {
    setListLate(false);
    if (!listLoading) return;
    const timer = setTimeout(() => setListLate(true), MODELS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [listLoading, effectiveHarness]);
  const modelsReading = listLoading && !listLate;
  // The kernel resolved a harness and no model for it, and none is chosen: for the soul's own harness bb will start it on bb's own default.
  const unsetModel = modelHeld.held !== MODEL_HELD.required && model === "" && resolved !== null && resolved.harness !== null && resolved.model === null ? resolved.harness : null;
  // What bb says of the harness this spawn would run on, when bb cannot run it here: said under the field, before any press.
  const notReady = harnessState(effectiveHarness);

  // ---- Spawn ----
  // idle: the form can be changed. spawning: a spawn is in flight. created: it made the agent.
  // unknown: it ended without saying whether it did; only Check result can be pressed.
  // incomplete: an instance exists, and its start did not finish (or its thread is not known): nothing more to press here.
  const [phase, setPhase] = useState<"idle" | "spawning" | "created" | "unknown" | "incomplete">("idle");
  const [failure, setFailure] = useState<SpawnProblem | null>(null);
  const [made, setMade] = useState<{ instance: string; threadId: string } | null>(null);
  /** The agent was made and its thread FAILED AT ITS START in bb: bb's own reason (app/outside/threads.ts). Never "Created" of it. */
  const [unstarted, setUnstarted] = useState<{ instance: string; threadId: string; reason: string } | null>(null);
  /** The spawn that was pressed: the values and the decision the person saw, and the key that makes it one spawn however often it is asked. */
  const intent = useRef<{ input: Input; revision: string; key: string } | null>(null);
  /** The key of the last press, by its values and its decision: the same ones pressed again are the same spawn to the kernel, which answers it once. */
  const pressed = useRef<{ of: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const send = useCallback((replay: boolean) => {
    const asked = intent.current;
    if (asked === null) return;
    setPhase("spawning");
    setFailure(null);
    setFlight({ soul: asked.input.soul });
    Promise.resolve()
      .then(() => rpc.call("spawn", { ...asked.input, key: asked.key, revision: asked.revision }))
      .then(
        (answer) => {
          intent.current = null;
          // The kernel says "launched" before the thread has started in bb: "Created" is said once
          // bb's own status of the thread is past its start (or after 10 s), the form busy meanwhile.
          // A thread that FAILED AT ITS START is never called created.
          return startOutcome(sdk, answer.threadId).then((failed) => {
            setFlight(null);
            const created = agentName(answer.instance);
            if (failed !== null) {
              const open = () => void (openAgentPage(navigate, answer.instance) || navigate.toThread(answer.threadId));
              // The person left the form: told where they are, and it stays until dismissed (a failure's notification does).
              if (!alive.current) return notify({ tone: "failed", title: W.didNotStart(created), open: { label: W.OPEN, run: open } });
              // An instance exists: the form stays held, so that no second one is made from it.
              setUnstarted({ ...answer, reason: failed.detail ?? failed.message });
              setPhase("incomplete");
              return;
            }
            // Said where the person will be: in bb's own toaster, which stays when the thread opens, and
            // reaches a person who left the form meanwhile, with the way to the agent.
            notify({ tone: "done", title: W.createdNotice(created), open: { label: W.openAgent(created), run: () => navigate.toThread(answer.threadId) } });
            if (!alive.current) return;
            // Created: the form stays held, says so, and opens the agent's thread.
            setMade(answer);
            setPhase("created");
            navigate.toThread(answer.threadId);
          });
        },
        (cause: unknown) => {
          setFlight(null);
          // What is known decides what can be pressed next (model/spawn.ts `SpawnOutcome`).
          const problem = spawnProblem(reasonOf(cause), "spawn", { harnessField: latest.current.harnessField, replay });
          if (!alive.current) {
            // The person left the form: what became of the spawn is told where they are, and stays until dismissed.
            notify({ tone: problem.outcome === "refused" || problem.outcome === "unconfirmed" ? "failed" : "unknown", title: W.FAILURE_TITLE[problem.outcome], lines: [problem.outcome === "unknown" ? W.UNKNOWN_AWAY : problem.sentence, problem.code] });
            return;
          }
          setFailure(problem);
          if (problem.outcome === "unknown") {
            // Whether an agent was made is not known: the intent is kept, and only asking again under its key is offered.
            setPhase("unknown");
            return;
          }
          intent.current = null;
          if (problem.outcome === "created" || problem.outcome === "unconfirmed") {
            // An instance exists, or part of one may: the form stays held, so that no second one is made from it.
            setPhase("incomplete");
            return;
          }
          setPhase("idle");
          // The decision moved, and nothing was created: the preview that was on screen is no longer
          // one to press, and what will be created is read again.
          if (problem.next === "review-again") {
            setSettled(null);
            setAgain((n) => n + 1);
          }
        },
      );
  }, [rpc, navigate, sdk]);

  // A refusal about the values that were on screen goes when they change.
  // Only while the form can be changed: held, the values can vanish for a moment (the roster being read again) without anyone changing them.
  const phaseNow = useRef(phase);
  phaseNow.current = phase;
  useEffect(() => {
    if (phaseNow.current === "idle") setFailure(null);
  }, [key]);

  const fieldsHeld = held || phase !== "idle" || absent !== null;
  /**
   * What holds Spawn while the form can be changed; null when nothing does. Only a read in flight is SAID beside the
   * button ("Reading…"). Every other hold is said once, where it is: the roster's notice while OATS cannot be read
   * ("Acts are off."), the field that is empty or marked, the column's refusal, the button's own word for a spawn
   * that is in flight. The button is described by the mark of the field that holds it, for a screen reader.
   */
  const hold: "held" | "flight" | "absent" | "soul" | "cannot" | "name" | "model" | "relation" | "refused" | "reading" | "model-mark" | null =
    phase !== "idle"
      ? null
      : held
        ? "held"
        : inFlight !== null
          ? "flight"
          : off !== null
            ? off
            : refusal !== null
              ? nameRefusal !== null
                ? "name"
                : "refused"
              : preview === null || modelsReading || ownAsked
                ? "reading"
                : modelMark !== null
                  ? "model-mark" // the Model field's own words: it is marked with them, once
                  : null;
  const reading = hold === "reading";
  const described: Record<NonNullable<typeof hold>, string | undefined> = {
    "model-mark": MARK.model,
    name: MARK.name,
    cannot: MARK.soul,
    soul: unknownSoul ? MARK.soul : SAYS.soul,
    model: SAYS.modelId,
    relation: SAYS.relative,
    refused: SAYS.column,
    held: SAYS.held,
    absent: SAYS.absent,
    // A read in flight says "Reading…" beside the button; a spawn in flight is the button's own word.
    reading: undefined,
    flight: undefined,
  };
  // (Check result is held like the acts while OATS cannot be read: the roster's notice says so.)
  const describedBy = hold !== null ? described[hold] : phase === "unknown" && held ? SAYS.held : undefined;
  const canSpawn = phase === "idle" && hold === null && preview !== null && input !== null;
  const press = () => {
    if (phase === "unknown") {
      if (!held) send(true); // Check result: the same key, the same decision
      return;
    }
    if (!canSpawn || preview === null || input === null) return;
    const of = `${preview.key}\n${preview.revision}`;
    if (pressed.current === null || pressed.current.of !== of) pressed.current = { of, key: newKey() };
    intent.current = { input, revision: preview.revision, key: pressed.current.key };
    send(false);
  };
  const cancel = () => window.history.back();

  // ---- focus and keys ----
  const fields = useRef<HTMLFieldSetElement>(null);
  const focusOn = (target: string) => fields.current?.querySelector<HTMLElement>(`[data-field="${target}"]`)?.focus();
  // The form lands on its first field: the soul, or the instruction when the soul came with the route.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || list === undefined) return;
    landed.current = true;
    focusOn(chosen === undefined ? "soul" : "task");
  }, [list, chosen]);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const onKeyDown = (event: KeyboardEvent) => {
    // Mod+Enter spawns, from any field (the Desktop's chord), under the button's own holds. Its
    // Mod+digit chords to a field are not the form's: in a browser tab the browser keeps them; Tab
    // walks the fields in their order. Enter alone spawns nothing.
    if (event.key !== "Enter" || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    press();
  };

  // ---- drawing ----
  // A model is required of the person: the column promises no default for the harness.
  const heldHarness = modelHeld.held === MODEL_HELD.required ? (modelAnswer?.facts.resolved?.harness ?? null) : null;
  const withoutModelDefault = (facts: SpawnFacts): SpawnFacts => (heldHarness === null ? facts : { ...facts, facts: withoutDefault(facts.facts, heldHarness) });
  let column: ReactNode;
  // No soul yet: nothing will be created, and nothing is drawn (the Soul field is empty, in view).
  if (chosen === undefined) column = null;
  // Held: only the facts of the values on screen stay; those of other values are not drawn as theirs.
  else if (held) column = preview === null ? null : <Created facts={preview.facts} machine={machine} />;
  else if (refusal !== null && nameRefusal === null)
    column = (
      // The kernel's code is one press away, with its own line: "<code>: <line>" under Details.
      <Notice title={W.REFUSED_TITLE} tone="error" details={refusal.detail === null ? refusal.code : [`${refusal.code}: ${refusal.detail}`]} actions={<Button onClick={() => setAgain((n) => n + 1)}>Retry</Button>}>
        <p>{refusal.sentence}</p>
      </Notice>
    );
  // A field that is empty or marked says what is missing: the column says nothing of it.
  else if (off !== null || nameRefusal !== null) column = null;
  else if (preview !== null) column = <Created facts={withoutModelDefault(preview.facts)} machine={machine} />;
  // Until the values on screen are answered for, the last facts stay, marked as being read again.
  else if (settled !== null) column = <Created facts={modelAnswer === settled ? withoutModelDefault(settled.facts) : settled.facts} machine={machine} />;
  else column = <Loading>{W.READING}</Loading>;
  // Marked whenever something stays in the column while it is read again: the last facts, or a refusal after Retry.
  const updating = asking && chosen !== undefined && !held && (settled !== null || refusal !== null);

  // (A spawn that is in flight, pressed here before the person left and came back: the button says so itself.)
  const spawnWord = phase === "spawning" || hold === "flight" ? W.SPAWNING : phase === "created" ? W.CREATED : phase === "unknown" ? W.CHECK_RESULT : W.SPAWN;
  const harnessFailed = harnesses.status === "failed";
  return (
    <Page testId="oats-new-agent-page">
      <div role="presentation" className="flex min-w-0 flex-col gap-4" onKeyDown={onKeyDown}>
        {/* No heading in view: bb's bar over the page says "New agent", and the Soul field says the soul. */}
        <h1 data-testid="oats-spawn-title" className="sr-only">
          {W.TITLE}
        </h1>
        <div id={SAYS.held} className="empty:hidden">
          <RosterNotice oats={oats} />
        </div>
        {/* A deployment with no bb session provider: said ONCE, in a person's words; the kernel's own code and sentence under Details. Spawn is described by it. */}
        {absent === null || held ? null : (
          <div id={SAYS.absent} data-testid="oats-spawn-no-bb">
            <Notice title={W.NO_BB} details={`${absent.code}: ${absent.message}`} />
          </div>
        )}
        {/* While OATS cannot be read the roster's notice says so, alone: never a second one for the same cause. */}
        {souls.status === "error" && list === undefined && !held ? (
          <Notice title="The souls could not be read" tone="error" code={refusalCode(souls.error)} details={souls.error} actions={<Button onClick={souls.retry}>Retry</Button>} />
        ) : null}
        {/* One column at a phone's width, in the order a person needs: the fields, what will be
            created, then the buttons. From bb's wide layout up the column stands beside both. */}
        <form
          data-testid="oats-spawn-form"
          // Beside a long column the fields keep their own height, and the buttons follow them at once.
          className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr]"
          // Enter in a one-line field spawns nothing: Mod+Enter and the button do.
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset ref={fields} disabled={fieldsHeld} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 lg:col-start-1 lg:row-start-1">
            <div id={SAYS.soul} className="flex min-w-0 flex-col">
            <Field
              label={W.SOUL_LABEL}
              // (A soul's description is in the list, with its option: not again under the field.)
              hint={chosen === undefined && list !== undefined && list.length === 0 ? W.NO_SOULS : null}
              errorId={MARK.soul}
              error={unknownSoul ? W.soulUnknown(shown(soul)) : chosen !== undefined && !chosen.spawnable ? shown(chosen.problem ?? W.SOUL_CANNOT) : null}
            >
              <Choice
                testId="oats-spawn-soul"
                field="soul"
                value={chosen === undefined ? "" : soul}
                disabled={list === undefined}
                placeholder={list === undefined && souls.status === "loading" ? W.READING_SOULS : W.CHOOSE_SOUL}
                filterLabel={W.FILTER}
                options={(list ?? []).map((candidate) => ({ id: candidate.name, label: shown(candidate.name), detail: candidate.spawnable ? shown(candidate.description) : W.SOUL_CANNOT, unavailable: !candidate.spawnable }))}
                onChange={setSoul}
              />
            </Field>
            </div>
            <Field label={W.TASK_LABEL} optional>
              <textarea data-testid="oats-spawn-task" data-field="task" rows={4} className={`${INPUT} py-2`} value={task} placeholder={W.TASK_PLACEHOLDER} onChange={(event) => setTask(event.target.value)} />
            </Field>
            {/* In its place while the provider's list is read, so that nothing jumps when it arrives; gone only where there is nothing to choose. */}
            {harnesses.choice || harnesses.status === "loading" || harnessFailed ? (
              <>
                <Field
                  label={W.HARNESS_LABEL}
                  hint={harnessFailed || notReady === null ? null : notReady.sentence}
                  // (Not while the roster cannot be read: its notice holds the form and says why; the form adds no red sentence of its own under it.)
                  error={harnessFailed && !held ? W.HARNESSES_FAILED : null}
                  errorTitle={harnessFailed ? (refusalCode(harnesses.error) ?? undefined) : undefined}
                >
                  <Choice
                    testId="oats-spawn-harness"
                    field="harness"
                    value={harnesses.choice ? harness : "\u0000"}
                    disabled={!harnesses.choice}
                    placeholder={harnessFailed ? SOUL_DEFAULT : W.READING_HARNESSES}
                    filterLabel={W.FILTER}
                    options={[
                      // (The soul's own harness that bb cannot run here carries the mark an entry of the list does: the line under the field says only the way on.)
                      { id: "", label: `${resolvedLabel(SOUL_DEFAULT, harness === "" ? (resolved?.harness ?? null) : null)}${harness === "" && notReady !== null ? ` · ${notReady.mark}` : ""}` },
                      ...harnesses.options.map((option) => {
                        const state = harnessState(option.id);
                        return state === null ? option : { ...option, label: `${option.label} · ${state.mark}`, unavailable: true };
                      }),
                    ]}
                    onChange={setHarness}
                  />
                </Field>
                {/* Not while the roster cannot be read: its notice has the one Retry of the screen (app/roster/unreadable.tsx). */}
                {harnessFailed && !held ? (
                  <div>
                    <Button data-testid="oats-spawn-harness-retry" onClick={harnesses.retry}>
                      {W.RETRY_HARNESSES}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : notReady === null ? null : (
              // One harness, so no field: what bb says of it is still said, where the field would be.
              <p data-testid="oats-spawn-harness-state" className="text-xs text-muted-foreground">
                {notReady.alone}
              </p>
            )}
            <Field
              label={W.MODEL_LABEL}
              errorId={MARK.model}
              error={modelAnswer === null ? null : modelMark}
            >
              <Choice
                testId="oats-spawn-model"
                field="model"
                value={modelPick}
                // Required of the person: there is no default, so the field does not say "Default" over a mark that says
                // "Required": it says what it wants ("Choose a model…"), and its list holds no entry that sends none.
                // (By the mark: while the soul's own harness is still asked, nothing is said to be required, and the field says "Default" as it did.)
                placeholder={modelMark === MODEL_HELD.required ? W.CHOOSE_MODEL : MODEL_DEFAULT}
                filterLabel={W.FILTER}
                options={[
                  ...(modelMark === MODEL_HELD.required ? [] : [{ id: "", label: unsetModel !== null ? `${MODEL_DEFAULT} · ${bbDefaultModel(unsetModel)}` : W.modelDefaultLabel(MODEL_DEFAULT, model === "" && resolved !== null && modelHeld.held !== MODEL_HELD.required ? resolved.model : undefined) }]),
                  // The ids that serve a bare model more than once are the ones offered: one of them is what to pick.
                  ...suggestions.models.filter((option) => modelHeld.held !== MODEL_HELD.ambiguous || modelHeld.offers.includes(option.id)).map((option) => ({ id: option.id, label: shown(option.label) })),
                  // A model picked before the harness changed stays what is sent, and is said.
                  ...(modelPick !== "" && modelPick !== CUSTOM && !suggestions.models.some((option) => option.id === modelPick) ? [{ id: modelPick, label: shown(modelPick) }] : []),
                  { id: CUSTOM, label: W.MODEL_CUSTOM },
                ]}
                onChange={setModelPick}
              />
            </Field>
            {modelPick === CUSTOM ? (
              <div id={SAYS.modelId} className="flex min-w-0 flex-col">
              <Field label={W.MODEL_CUSTOM_LABEL}>
                <input data-testid="oats-spawn-model-id" className={INPUT} value={modelTyped} placeholder={W.MODEL_CUSTOM_PLACEHOLDER} autoComplete="off" spellCheck={false} onChange={(event) => setModelTyped(event.target.value)} />
              </Field>
              </div>
            ) : null}
            <div data-testid="oats-spawn-relation" className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
              <div className="flex min-w-0 flex-col gap-1">
                <span id="oats-spawn-relation-label">{W.RELATION_LABEL}</span>
                {/* The four words stay whole and on screen: closer together at a phone's width, and on a second row where one row cannot hold them. */}
                <div className="min-w-0 max-w-full [&_[role=radio]]:whitespace-nowrap max-md:[&_[role=radio]]:px-2 [&_[role=radiogroup]]:flex-wrap">
                  <Segmented label={W.RELATION_LABEL} options={W.RELATIONS} value={relation} onChange={setRelation} />
                </div>
              </div>
              {relation === "unrelated" ? null : (
                // No label over it: the option chosen above says what it is ("Child of"), and it is named for a screen reader.
                <span id={SAYS.relative} className="flex min-w-0 flex-col">
                <Choice
                  testId="oats-spawn-relative"
                  aria-label={W.whichInstance(relation)}
                  value={relative}
                  disabled={agents.length === 0}
                  placeholder={W.CHOOSE_INSTANCE}
                  filterLabel={W.FILTER}
                  options={agents.map((agent) => ({ id: agent.instance, label: agentName(agent.instance), detail: shown(agent.soul) }))}
                  onChange={setRelativeTo}
                />
                </span>
              )}
              {/* Only where the choice above cannot be made at all. */}
              <span aria-live="polite" data-testid="oats-spawn-relation-line" className="empty:hidden">
                {relation !== "unrelated" && agents.length === 0 ? W.NO_INSTANCES : null}
              </span>
            </div>
            <Field
              label={W.NAME_LABEL}
              optional
              errorId={MARK.name}
              // (The kernel's code of a refused name is what a pointer shows on its sentence.)
              error={nameFault ?? (nameRefusal === null ? null : nameRefusal.sentence)}
              errorTitle={nameFault === null && nameRefusal !== null ? nameRefusal.code : undefined}
            >
              <input data-testid="oats-spawn-name" data-field="name" className={`${INPUT} [font-variant-ligatures:none]`} value={typedName} placeholder={W.NAME_PLACEHOLDER} autoComplete="off" spellCheck={false} onChange={(event) => setTypedName(event.target.value)} />
            </Field>
          </fieldset>
          {/* Nothing to show (no soul yet, a field that is empty or marked): no heading over an empty column. */}
          {column === null ? null : (
          <aside
            id={SAYS.column}
            data-testid="oats-spawn-preview"
            aria-label="Spawn preview"
            aria-busy={updating}
            // Its facts one under the other, the label over its value: a path or a branch has the column's whole width.
            className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 [&_[data-testid=oats-fact]]:md:flex-col [&_[data-testid=oats-fact]]:md:gap-0.5 [&_[data-testid=oats-fact]>dt]:md:w-auto"
          >
            <h2 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{W.COLUMN_TITLE}</span>
              {updating ? (
                <span role="status" data-testid="oats-spawn-updating" className="font-normal normal-case">
                  {W.UPDATING}
                </span>
              ) : null}
            </h2>
            {column}
          </aside>
          )}
          <div data-testid="oats-spawn-foot" className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2 lg:self-start">
            {/* (The access the agent runs with is the column's Access row, in view of the button: not said again here.) */}
            {phase === "created" && made !== null ? (
              <Result title={W.createdTitle(agentName(made.instance))} actions={<Button data-testid="oats-spawn-open" onClick={() => navigate.toThread(made.threadId)}>{W.openAgent(agentName(made.instance))}</Button>} />
            ) : null}
            {unstarted === null ? null : (
              <Result
                title={W.didNotStart(agentName(unstarted.instance))}
                tone="failed"
                actions={
                  <Button data-testid="oats-spawn-open" onClick={() => void (openAgentPage(navigate, unstarted.instance) || navigate.toThread(unstarted.threadId))}>
                    {W.OPEN}
                  </Button>
                }
              >
                <Disclosure summary="Details" testId="oats-spawn-start-details">
                  <p className="text-xs text-muted-foreground">{shown(unstarted.reason)}</p>
                </Disclosure>
              </Result>
            )}
            {failure === null ? null : (
              <Result title={W.FAILURE_TITLE[failure.outcome]} tone={failure.outcome === "refused" || failure.outcome === "unconfirmed" ? "failed" : "unknown"}>
                <p>{failure.sentence}</p>
                {/* The kernel's code and its own lines: one press away. */}
                <Disclosure summary="Details" testId="oats-spawn-details">
                  {[shown(failure.code), ...refusalLines(failure.detail)].filter((line) => line !== "").map((line, index) => (
                    <p key={index} className="text-xs text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </Disclosure>
              </Result>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button data-testid="oats-spawn-cancel" onClick={cancel} disabled={phase === "spawning"}>
                {phase === "created" || phase === "incomplete" ? W.CLOSE : W.CANCEL}
              </Button>
              {/* A thread that failed at its start: the result has its title, Details, Open and Close, and nothing
                  that is off. The submit is not drawn there (a control that cannot be used and tells nothing new). */}
              {/* Nor where the kernel made the instance and its start is not complete: the result's title says it, and a
                  held button beside Close would be a status drawn as a control. */}
              {unstarted !== null || phase === "incomplete" ? null : (
                <Button
                  variant="primary"
                  data-testid="oats-spawn-submit"
                  aria-keyshortcuts={`${mac ? "Meta" : "Control"}+Enter`}
                  aria-busy={phase === "spawning" || hold === "flight"}
                  disabled={!(canSpawn || (phase === "unknown" && !held))}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onClick={press}
                >
                  {spawnWord}
                </Button>
              )}
              {reading ? <DisabledReason>{W.READING}</DisabledReason> : null}
            </div>
            {/* What a person waits on, announced once: the read, the spawn. */}
            <span role="status" data-testid="oats-spawn-status" className="sr-only">
              {phase === "spawning" ? W.SPAWNING : phase === "created" && made !== null ? W.createdTitle(agentName(made.instance)) : reading ? W.READING : ""}
            </span>
          </div>
        </form>
      </div>
    </Page>
  );
}
