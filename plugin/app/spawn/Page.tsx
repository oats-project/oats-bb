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
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpc as spawnRpc, SpawnFacts } from "../../contract/spawn";
import { bbDefaultModel, harnessLabel, PREVIEW_FOOT, spawnProblem } from "../../model/spawn";
import type { SpawnProblem } from "../../model/spawn";
import { newKey } from "../keys";
import { useOats } from "../oats";
import { HELD_REASON, RosterNotice } from "../roster/unreadable";
import { errorMessage, onWindowReset, useRead } from "../store";
import type { Contract, Result as Answer } from "../store";
import { Button, DisabledReason, Disclosure, Fact, Facts, Field, INPUT, Loading, Notice, Page, Result, Section, Segmented } from "../ui";
import { refusalCode, refusalLines, shown } from "../ui/text";
import { agentName } from "../ui/words";
import { Choice } from "./Choice";
import { MODEL_DEFAULT, resolvedLabel, SOUL_DEFAULT, useHarnesses, useHarnessStates, useModelSuggestions } from "./models";
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
 * never reached an answer, and what it did is not known.
 */
function reasonOf(cause: unknown): { code: string | null; message: string | null } {
  const text = errorMessage(cause);
  const code = refusalCode(text);
  if (code !== null) return { code, message: text.slice(code.length + 2) };
  const refused = typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "invalid";
  return { code: refused ? "INVALID_INPUT" : "PLUGIN_RPC_FAILED", message: text };
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

type Preview = { key: string; facts: SpawnFacts; revision: string };
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

/**
 * The facts of a preview, as the Desktop's column lists them. `machine` is the machine that holds
 * the deployment, where the agent runs: the roster's fact, said after where it works.
 */
function Created({ facts, machine }: { facts: SpawnFacts; machine: string | null }) {
  const rows = facts.facts.flatMap((fact) => (fact.label === "Works in" && machine !== null ? [fact, { label: W.RUNS_ON, parts: [{ text: machine }] }] : [fact]));
  if (machine !== null && !rows.some((fact) => fact.label === W.RUNS_ON)) rows.push({ label: W.RUNS_ON, parts: [{ text: machine }] });
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
        {facts.identity.map((fact) => (
          <Fact key={fact.label} label={fact.label} title={fact.title === undefined ? undefined : shown(fact.title)}>
            <span className={fact.muted ? "text-muted-foreground" : undefined}>
              <Breakable text={shown(fact.text)} />
            </span>
          </Fact>
        ))}
        {rows.map((fact) => (
          <Fact key={fact.label} label={fact.label}>
            <Parts parts={fact.label === "Relationship" ? related(fact.parts) : fact.parts} />
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
    </>
  );
}

export function NewAgentPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
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

  /** Why these values cannot be asked of the kernel yet; null when they can. */
  const off: string | null =
    chosen === undefined ? W.OFF.soul : !chosen.spawnable ? W.OFF.cannot : nameFault !== null ? W.OFF.name : modelPick === CUSTOM && model === "" ? W.OFF.model : relation !== "unrelated" && relative === "" ? W.OFF.relation : null;
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
  const [reading, setReading] = useState(false);
  const [again, setAgain] = useState(0);
  const serial = useRef(0);
  const latest = useRef<{ key: string | null; input: Input | null; harnessField: boolean }>({ key, input, harnessField: harnesses.choice });
  latest.current = { key, input, harnessField: harnesses.choice };
  useEffect(() => {
    const ticket = ++serial.current;
    if (key === null || held) {
      setReading(false);
      return;
    }
    setReading(true);
    const timer = setTimeout(() => {
      const asked = latest.current;
      if (asked.input === null || asked.key !== key) return;
      Promise.resolve()
        .then(() => rpc.call("spawnPlan", asked.input!))
        .then(
          (answer) => {
            // An answer for values that are no longer on screen is dropped, never drawn under the new ones.
            if (serial.current !== ticket) return;
            setSettled({ key, facts: answer.facts, revision: answer.revision });
            setRefused(null);
            setReading(false);
          },
          (cause: unknown) => {
            if (serial.current !== ticket) return;
            setRefused({ key, problem: spawnProblem(reasonOf(cause), "preview", { harnessField: latest.current.harnessField }) });
            setReading(false);
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
  const effectiveHarness = harness !== "" ? harness : (resolved?.harness ?? null);
  const suggestions = useModelSuggestions(effectiveHarness);
  // The kernel resolved a harness and no model for it, and none is chosen: bb will start it on bb's own default.
  const unsetModel = model === "" && resolved !== null && resolved.harness !== null && resolved.model === null ? resolved.harness : null;
  // What bb says of the harness this spawn would run on, when bb cannot run it here: said under the field, before any press.
  const notReady = harnessState(effectiveHarness);

  // ---- Spawn ----
  // idle: the form can be changed. spawning: a spawn is in flight. created: it made the agent.
  // unknown: it ended without saying whether it did; only Check result can be pressed.
  // incomplete: an instance exists, and its start did not finish (or its thread is not known): nothing more to press here.
  const [phase, setPhase] = useState<"idle" | "spawning" | "created" | "unknown" | "incomplete">("idle");
  const [failure, setFailure] = useState<SpawnProblem | null>(null);
  const [made, setMade] = useState<{ instance: string; threadId: string } | null>(null);
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
          setFlight(null);
          intent.current = null;
          if (!alive.current) return;
          // Created: the form stays held, says so, and opens the agent's thread.
          setMade(answer);
          setPhase("created");
          navigate.toThread(answer.threadId);
        },
        (cause: unknown) => {
          setFlight(null);
          if (!alive.current) return;
          // What is known decides what can be pressed next (model/spawn.ts `SpawnOutcome`).
          const problem = spawnProblem(reasonOf(cause), "spawn", { harnessField: latest.current.harnessField, replay });
          setFailure(problem);
          if (problem.outcome === "unknown") {
            // Whether an agent was made is not known: the intent is kept, and only asking again under its key is offered.
            setPhase("unknown");
            return;
          }
          intent.current = null;
          if (problem.outcome === "created") {
            // An instance exists: the form stays held, so that no second one is made from it.
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
  }, [rpc, navigate]);

  // A refusal about the values that were on screen goes when they change.
  useEffect(() => setFailure(null), [key]);

  const fieldsHeld = held || phase !== "idle";
  const reason =
    phase !== "idle"
      ? null
      : held
        ? HELD_REASON
        : inFlight !== null
          ? W.inProgress(shown(inFlight.soul))
          : off !== null
            ? off
            : refusal !== null
              ? nameRefusal !== null
                ? W.OFF.name
                : W.OFF.refused
              : preview === null
                ? W.READING
                : null;
  const canSpawn = phase === "idle" && reason === null && preview !== null && input !== null;
  const press = () => {
    if (phase === "unknown") {
      send(true); // Check result: the same key, the same decision
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
  const title = chosen === undefined ? W.TITLE : W.titleFor(shown(chosen.name), oats.phase === "ready" ? shown(oats.deployment.workspace) : null);
  let column: ReactNode;
  if (chosen === undefined) column = <p className="text-sm text-muted-foreground">{W.COLUMN_NO_SOUL}</p>;
  else if (held) column = settled === null ? null : <Created facts={settled.facts} machine={machine} />;
  else if (refusal !== null && nameRefusal === null)
    column = (
      <Notice title={W.REFUSED_TITLE} tone="error" code={refusal.code} details={refusal.detail} actions={<Button onClick={() => setAgain((n) => n + 1)}>Retry</Button>}>
        <p>{refusal.sentence}</p>
      </Notice>
    );
  else if (off !== null || nameRefusal !== null) column = <p className="text-sm text-muted-foreground">{W.COLUMN_FIX_FIRST}</p>;
  else if (preview !== null) column = <Created facts={preview.facts} machine={machine} />;
  // Until the values on screen are answered for, the last facts stay, marked as being read again.
  else if (settled !== null) column = <Created facts={settled.facts} machine={machine} />;
  else column = <Loading>{W.READING}</Loading>;
  // Marked whenever something stays in the column while it is read again: the last facts, or a refusal after Retry.
  const updating = reading && chosen !== undefined && !held && (settled !== null || refusal !== null);
  /** The column holds the kernel's answer for the values on screen: only then is its foot true. */
  const resolvedNow = chosen !== undefined && (preview !== null || (held && settled !== null));

  const spawnWord = phase === "spawning" ? W.SPAWNING : phase === "created" ? W.CREATED : phase === "unknown" ? W.CHECK_RESULT : phase === "incomplete" ? W.INCOMPLETE : W.SPAWN;
  const harnessFailed = harnesses.status === "failed";
  return (
    <Page testId="oats-new-agent-page">
      <div role="presentation" className="flex min-w-0 flex-col gap-4" onKeyDown={onKeyDown}>
        <h1 data-testid="oats-spawn-title" className="break-words text-base font-semibold">
          {title}
        </h1>
        <RosterNotice oats={oats} />
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
            <Field
              label={W.SOUL_LABEL}
              hint={chosen === undefined ? (list !== undefined && list.length === 0 ? W.NO_SOULS : null) : chosen.description === "" ? null : shown(chosen.description)}
              error={unknownSoul ? W.soulUnknown(shown(soul)) : chosen !== undefined && !chosen.spawnable ? shown(chosen.problem ?? W.SOUL_CANNOT) : null}
            >
              <Choice
                testId="oats-spawn-soul"
                field="soul"
                value={chosen === undefined ? "" : soul}
                disabled={list === undefined}
                placeholder={list === undefined && souls.status === "loading" ? W.READING_SOULS : W.CHOOSE_SOUL}
                filterLabel={W.FILTER_SOULS}
                options={(list ?? []).map((candidate) => ({ id: candidate.name, label: shown(candidate.name), detail: candidate.spawnable ? shown(candidate.description) : W.SOUL_CANNOT, unavailable: !candidate.spawnable }))}
                onChange={setSoul}
              />
            </Field>
            <Field label={W.TASK_LABEL} optional>
              <textarea data-testid="oats-spawn-task" data-field="task" rows={4} className={`${INPUT} py-2`} value={task} placeholder={W.TASK_PLACEHOLDER} onChange={(event) => setTask(event.target.value)} />
            </Field>
            {/* In its place while the provider's list is read, so that nothing jumps when it arrives; gone only where there is nothing to choose. */}
            {harnesses.choice || harnesses.status === "loading" || harnessFailed ? (
              <>
                <Field
                  label={W.HARNESS_LABEL}
                  hint={harnessFailed || notReady === null ? null : notReady.sentence}
                  error={harnessFailed ? W.harnessesFailed(refusalCode(harnesses.error)) : null}
                >
                  <Choice
                    testId="oats-spawn-harness"
                    field="harness"
                    value={harnesses.choice ? harness : "\u0000"}
                    disabled={!harnesses.choice}
                    placeholder={harnessFailed ? SOUL_DEFAULT : W.READING_HARNESSES}
                    filterLabel={W.FILTER_HARNESSES}
                    options={[
                      { id: "", label: resolvedLabel(SOUL_DEFAULT, harness === "" ? (resolved?.harness ?? null) : null), detail: W.HARNESS_DEFAULT_DETAIL },
                      ...harnesses.options.map((option) => {
                        const state = harnessState(option.id);
                        return state === null ? option : { ...option, label: `${option.label} · ${state.mark}`, unavailable: true };
                      }),
                    ]}
                    onChange={setHarness}
                  />
                </Field>
                {harnessFailed ? (
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
                {notReady.sentence}
              </p>
            )}
            <Field
              label={W.MODEL_LABEL}
              hint={
                unsetModel === null && suggestions.note === null ? null : (
                  <>
                    {unsetModel === null ? null : <span className="block">{W.modelUnset(harnessLabel(unsetModel))}</span>}
                    {suggestions.note === null ? null : <span className="block">{suggestions.note}</span>}
                  </>
                )
              }
            >
              <Choice
                testId="oats-spawn-model"
                field="model"
                value={modelPick}
                placeholder={MODEL_DEFAULT}
                filterLabel={W.FILTER_MODELS}
                options={[
                  { id: "", label: unsetModel !== null ? `${MODEL_DEFAULT} · ${bbDefaultModel(unsetModel)}` : W.modelDefaultLabel(MODEL_DEFAULT, model === "" && resolved !== null ? resolved.model : undefined) },
                  ...suggestions.models.map((option) => ({ id: option.id, label: shown(option.label) })),
                  // A model picked before the harness changed stays what is sent, and is said.
                  ...(modelPick !== "" && modelPick !== CUSTOM && !suggestions.models.some((option) => option.id === modelPick) ? [{ id: modelPick, label: shown(modelPick) }] : []),
                  { id: CUSTOM, label: W.MODEL_CUSTOM, detail: W.MODEL_CUSTOM_PLACEHOLDER },
                ]}
                onChange={setModelPick}
              />
            </Field>
            {modelPick === CUSTOM ? (
              <Field label={W.MODEL_CUSTOM_LABEL}>
                <input data-testid="oats-spawn-model-id" className={INPUT} value={modelTyped} placeholder={W.MODEL_CUSTOM_PLACEHOLDER} autoComplete="off" spellCheck={false} onChange={(event) => setModelTyped(event.target.value)} />
              </Field>
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
                <Field label={W.WHICH_INSTANCE}>
                  <Choice
                    testId="oats-spawn-relative"
                    aria-label={W.whichInstance(relation)}
                    value={relative}
                    disabled={agents.length === 0}
                    placeholder={W.CHOOSE_INSTANCE}
                    filterLabel={W.FILTER_INSTANCES}
                    options={agents.map((agent) => ({ id: agent.instance, label: agentName(agent.instance), detail: shown(agent.soul) }))}
                    onChange={setRelativeTo}
                  />
                </Field>
              )}
              <span aria-live="polite" data-testid="oats-spawn-relation-line">
                {relation !== "unrelated" && agents.length === 0 ? W.NO_INSTANCES : W.relationLine(relation, relative === "" ? "" : agentName(relative))}
              </span>
            </div>
            <Field
              label={W.NAME_LABEL}
              optional
              hint={
                nameFault !== null || nameRefusal !== null ? null : name === "" ? (
                  W.NAME_EMPTY
                ) : (
                  <>
                    Instance name: <strong className="font-semibold text-foreground [font-variant-ligatures:none]">{name}</strong>
                  </>
                )
              }
              error={nameFault ?? (nameRefusal === null ? null : `${nameRefusal.sentence} (${nameRefusal.code})`)}
            >
              <input data-testid="oats-spawn-name" data-field="name" className={`${INPUT} [font-variant-ligatures:none]`} value={typedName} placeholder={W.NAME_PLACEHOLDER} autoComplete="off" spellCheck={false} onChange={(event) => setTypedName(event.target.value)} />
            </Field>
          </fieldset>
          <aside
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
            {resolvedNow ? <p className="text-xs text-muted-foreground">{PREVIEW_FOOT}</p> : null}
          </aside>
          <div data-testid="oats-spawn-foot" className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2 lg:self-start">
            <p data-testid="oats-spawn-mode" className="text-xs text-muted-foreground">
              {W.MODE_LINE}
            </p>
            {phase === "created" && made !== null ? (
              <Result title={W.createdTitle(agentName(made.instance))} actions={<Button data-testid="oats-spawn-open" onClick={() => navigate.toThread(made.threadId)}>{W.openAgent(agentName(made.instance))}</Button>}>
                <p>{W.OPENING}</p>
              </Result>
            ) : null}
            {failure === null ? null : (
              <Result title={failure.outcome === "unknown" ? W.SPAWN_UNKNOWN_TITLE : failure.outcome === "created" ? W.SPAWN_INCOMPLETE_TITLE : W.SPAWN_FAILED_TITLE} tone={failure.outcome === "refused" ? "failed" : "unknown"} code={failure.code}>
                <p>{failure.sentence}</p>
                {failure.next === "review-again" && preview !== null ? <p data-testid="oats-spawn-reread">{W.READ_AGAIN}</p> : null}
                {failure.detail === null ? null : (
                  <Disclosure summary="Details" testId="oats-spawn-details">
                    {refusalLines(failure.detail).map((line, index) => (
                      <p key={index} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </Disclosure>
                )}
              </Result>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button data-testid="oats-spawn-cancel" onClick={cancel} disabled={phase === "spawning"}>
                {phase === "created" || phase === "incomplete" ? W.CLOSE : W.CANCEL}
              </Button>
              <Button
                variant="primary"
                data-testid="oats-spawn-submit"
                aria-keyshortcuts={`${mac ? "Meta" : "Control"}+Enter`}
                aria-busy={phase === "spawning"}
                disabled={!(canSpawn || phase === "unknown")}
                onClick={press}
              >
                {spawnWord}
              </Button>
              {phase === "idle" || phase === "unknown" ? (
                <kbd data-testid="oats-spawn-key" aria-hidden="true" className="rounded border border-border px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                  {mac ? "⌘ Enter" : "Ctrl+Enter"}
                </kbd>
              ) : null}
              {reason === null ? null : <DisabledReason>{reason}</DisabledReason>}
            </div>
            {/* What a person waits on, announced once: the read, the spawn. */}
            <span role="status" data-testid="oats-spawn-status" className="sr-only">
              {phase === "spawning" ? W.SPAWNING : phase === "created" && made !== null ? W.createdTitle(agentName(made.instance)) : reason === W.READING ? W.READING : ""}
            </span>
          </div>
        </form>
      </div>
    </Page>
  );
}
