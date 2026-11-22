// The New agent form, a page of its own (`/plugins/oats/new-agent`, and `/new-agent/<soul>` with a
// soul chosen): the OATS Desktop's Spawn dialog, in its order and its words. The soul first, then
// the opening instruction, the harness and the model (the harness interface, v4), the
// relationship and the name; beside them, standing, "What will be created": the kernel's own
// preview for exactly the values on screen (`oats spawn … --preview`), read again as they change.
// Spawn applies the decision that preview showed, and no other: the kernel refuses one that moved.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { SpawnFacts } from "../../contract/spawn";
import { PREVIEW_FOOT, spawnProblem } from "../../model/spawn";
import type { SpawnProblem } from "../../model/spawn";
import { newKey } from "../keys";
import { useOats } from "../oats";
import { HELD_REASON, RosterNotice } from "../roster/unreadable";
import { errorMessage, onWindowReset, useRead } from "../store";
import type { Contract, Result as Answer } from "../store";
import { Button, DisabledReason, Fact, Facts, Field, INPUT, Loading, Notice, Page, Result, Section, Segmented } from "../ui";
import { refusalCode, shown } from "../ui/text";
import { agentName } from "../ui/words";
import { Choice } from "./Choice";
import { MODEL_DEFAULT, resolvedLabel, SOUL_DEFAULT, useHarnesses, useModelSuggestions } from "./models";
import * as W from "./words";

type Soul = Answer<"souls">["souls"][number];
type Input = Parameters<ReturnType<typeof useRpc<Contract>>["call"]>[1] extends never ? never : { soul: string; name?: string; task: string; harness?: string; model?: string; relation?: { kind: "child" | "sibling" | "parent"; to: string } };

/** How long the form waits after the last change before it asks for the preview again. */
export const PREVIEW_DEBOUNCE_MS = 400;
/** In the model's select: the entry that opens the field for a typed id. */
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

/** A failed call as the kernel's code and message (the server words a refusal `<code>: <message>`). */
function reasonOf(cause: unknown): { code: string | null; message: string | null } {
  const text = errorMessage(cause);
  const code = refusalCode(text);
  return { code, message: code === null ? text : text.slice(code.length + 2) };
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

/** A fact's value: its parts in a line, then each second line (where it came from, what else) under it. */
function Parts({ parts }: { parts: SpawnFacts["facts"][number]["parts"] }) {
  const first = parts.filter((part) => part.sub !== true);
  const under = parts.filter((part) => part.sub === true);
  return (
    <>
      <span>
        {first.map((part, index) => (
          <span key={index} className={part.mono ? "break-all font-mono text-xs" : part.muted ? "text-muted-foreground" : undefined}>
            {piece(part.text)}
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

/** The facts of a preview, as the Desktop's column lists them. */
function Created({ facts }: { facts: SpawnFacts }) {
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
            <span className={fact.muted ? "text-muted-foreground" : fact.label === "Home" ? "break-all" : undefined}>{shown(fact.text)}</span>
          </Fact>
        ))}
        {facts.facts.map((fact) => (
          <Fact key={fact.label} label={fact.label}>
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
                  {slot.module === null ? (
                    <span className="text-muted-foreground">none</span>
                  ) : (
                    <>
                      <span>{shown(slot.module.name)}</span>
                      <span className="block text-xs text-muted-foreground">{[slot.module.source, slot.module.why].filter((part) => part !== "").map(shown).join(" · ")}</span>
                    </>
                  )}
                </Fact>
              ))}
            </Facts>
          </Section>
          {facts.modules.caps.length === 0 ? null : (
            <Section title="Capabilities" n={facts.modules.caps.length} testId="oats-spawn-caps">
              <ul className="flex flex-col gap-1 text-sm">
                {facts.modules.caps.map((module) => (
                  <li key={module.name} className="min-w-0 break-words">
                    <span>{shown(module.name)}</span>
                    <span className="block text-xs text-muted-foreground">{[module.source, module.why].filter((part) => part !== "").map(shown).join(" · ")}</span>
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
  const latest = useRef<{ key: string | null; input: Input | null }>({ key, input });
  latest.current = { key, input };
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
            setRefused({ key, problem: spawnProblem(reasonOf(cause), "preview") });
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
  const resolved = preview?.facts.resolved ?? null;
  const suggestions = useModelSuggestions(harness !== "" ? harness : (resolved?.harness ?? null));

  // ---- Spawn ----
  const [phase, setPhase] = useState<"idle" | "waiting" | "spawning">("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<SpawnProblem | null>(null);
  const intent = useRef<{ of: string; key: string } | null>(null);
  const pressed = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback(
    (shownPreview: Preview, asked: Input) => {
      // The same values and the same decision asked again are the same intent: the kernel answers it once.
      const of = `${shownPreview.key}\n${shownPreview.revision}`;
      if (intent.current === null || intent.current.of !== of) intent.current = { of, key: newKey() };
      setPhase("spawning");
      setStatus(null);
      setFailure(null);
      setFlight({ soul: asked.soul });
      Promise.resolve()
        .then(() => rpc.call("spawn", { ...asked, key: intent.current!.key, revision: shownPreview.revision }))
        .then(
          (answer) => {
            setFlight(null);
            intent.current = null;
            if (!alive.current) return;
            setPhase("idle");
            setStatus(W.created(agentName(answer.instance)));
            navigate.toThread(answer.threadId);
          },
          (cause: unknown) => {
            setFlight(null);
            if (!alive.current) return;
            const problem = spawnProblem(reasonOf(cause), "spawn");
            setPhase("idle");
            setFailure(problem);
            // The decision moved, and nothing was created: what will be created is read again.
            if (problem.next === "review-again") {
              intent.current = null;
              setAgain((n) => n + 1);
            }
          },
        );
    },
    [rpc, navigate],
  );

  // A press made before the preview of these values answered is kept, and goes on when it does.
  useEffect(() => {
    if (phase !== "waiting") return;
    if (pressed.current !== key) {
      pressed.current = null;
      setPhase("idle");
      setStatus(W.CHANGED);
      return;
    }
    if (preview !== null && input !== null) {
      pressed.current = null;
      apply(preview, input);
    } else if (refusal !== null) {
      pressed.current = null;
      setPhase("idle");
    }
  }, [phase, key, preview, refusal, input, apply]);
  // A status about the values that were on screen goes when they change.
  useEffect(() => {
    setFailure(null);
    setStatus((now) => (now === W.CHANGED ? now : null));
  }, [key]);

  const busy = phase !== "idle" || inFlight !== null;
  const reason = held ? HELD_REASON : inFlight !== null && phase === "idle" ? W.inProgress(shown(inFlight.soul)) : off !== null ? off : refusal !== null ? (nameRefusal !== null ? W.OFF.name : W.OFF.refused) : null;
  const canPress = reason === null && !busy;
  const press = () => {
    if (!canPress || input === null || key === null) return;
    if (status === W.CHANGED) setStatus(null);
    if (preview !== null) apply(preview, input);
    else {
      pressed.current = key;
      setPhase("waiting");
    }
  };
  const checkResult = failure !== null && failure.next === "check-result";
  const cancel = () => window.history.back();

  // ---- focus and keys ----
  const fields = useRef<HTMLDivElement>(null);
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
    // Mod+Enter spawns, from any field (the Desktop's chord). Its Mod+digit chords to a field are
    // not the form's: in a browser tab the browser keeps them; Tab walks the fields in their order.
    if (event.key !== "Enter" || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    press();
  };

  // ---- drawing ----
  const title = chosen === undefined ? W.TITLE : W.titleFor(shown(chosen.name), oats.phase === "ready" ? shown(oats.deployment.workspace) : null);
  let column: ReactNode;
  if (chosen === undefined) column = <p className="text-sm text-muted-foreground">{W.COLUMN_NO_SOUL}</p>;
  else if (held) column = settled === null ? null : <Created facts={settled.facts} />;
  else if (refusal !== null && nameRefusal === null)
    column = (
      <Notice title={W.REFUSED_TITLE} tone="error" code={refusal.code} details={refusal.detail} actions={<Button onClick={() => setAgain((n) => n + 1)}>Retry</Button>}>
        <p>{refusal.sentence}</p>
      </Notice>
    );
  else if (off !== null || nameRefusal !== null) column = <p className="text-sm text-muted-foreground">{W.COLUMN_FIX_FIRST}</p>;
  else if (preview !== null) column = <Created facts={preview.facts} />;
  // Until the values on screen are answered for, the last facts stay, marked as being read again.
  else if (settled !== null) column = <Created facts={settled.facts} />;
  else column = <Loading>{W.READING}</Loading>;
  const updating = reading && chosen !== undefined && !held && settled !== null;

  const spawnWord = phase === "spawning" ? W.SPAWNING : phase === "waiting" ? W.CHECKING : checkResult ? W.CHECK_RESULT : W.SPAWN;
  return (
    <Page testId="oats-new-agent-page">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the form's own keys, as the Desktop's dialog has them */}
      <div className="flex min-w-0 flex-col gap-4" onKeyDown={onKeyDown}>
        <h1 data-testid="oats-spawn-title" className="break-words text-base font-semibold">
          {title}
        </h1>
        <RosterNotice oats={oats} />
        {/* While OATS cannot be read the roster's notice says so, alone: never a second one for the same cause. */}
        {souls.status === "error" && list === undefined && !held ? (
          <Notice title="The souls could not be read" tone="error" code={refusalCode(souls.error)} details={souls.error} actions={<Button onClick={souls.retry}>Retry</Button>} />
        ) : null}
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <form
            data-testid="oats-spawn-form"
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              press();
            }}
          >
            <fieldset ref={fields as never} disabled={held || phase === "spawning"} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
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
                  options={(list ?? []).map((candidate) => ({ id: candidate.name, label: shown(candidate.name), detail: candidate.spawnable ? shown(candidate.description) : W.SOUL_CANNOT }))}
                  onChange={setSoul}
                />
              </Field>
              <Field label={W.TASK_LABEL} optional>
                <textarea data-testid="oats-spawn-task" data-field="task" rows={4} className={`${INPUT} py-2`} value={task} placeholder={W.TASK_PLACEHOLDER} onChange={(event) => setTask(event.target.value)} />
              </Field>
              {harnesses.choice ? (
                <Field label={W.HARNESS_LABEL}>
                  <Choice
                    testId="oats-spawn-harness"
                    field="harness"
                    value={harness}
                    placeholder={SOUL_DEFAULT}
                    filterLabel={W.FILTER_HARNESSES}
                    options={[{ id: "", label: resolvedLabel(SOUL_DEFAULT, harness === "" ? (resolved?.harness ?? null) : null), detail: W.HARNESS_DEFAULT_DETAIL }, ...harnesses.options]}
                    onChange={setHarness}
                  />
                </Field>
              ) : null}
              <Field label={W.MODEL_LABEL} hint={suggestions.note}>
                <Choice
                  testId="oats-spawn-model"
                  field="model"
                  value={modelPick}
                  placeholder={MODEL_DEFAULT}
                  filterLabel={W.FILTER_MODELS}
                  options={[
                    { id: "", label: W.modelDefaultLabel(MODEL_DEFAULT, model === "" && resolved !== null ? resolved.model : undefined) },
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
              <div data-testid="oats-spawn-relation" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                <span id="oats-spawn-relation-label">{W.RELATION_LABEL}</span>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {/* The four words stay whole: where they do not fit in a row, the row scrolls. */}
                  <div className="min-w-0 max-w-full overflow-x-auto [&_[role=radio]]:whitespace-nowrap">
                    <Segmented label={W.RELATION_LABEL} options={W.RELATIONS} value={relation} onChange={setRelation} />
                  </div>
                  {relation === "unrelated" ? null : (
                    <div className="min-w-40 flex-1">
                      <Choice
                        testId="oats-spawn-relative"
                        aria-label={W.whichInstance(relation)}
                        aria-describedby="oats-spawn-relation-line"
                        value={relative}
                        disabled={agents.length === 0}
                        placeholder={W.CHOOSE_INSTANCE}
                        filterLabel={W.FILTER_INSTANCES}
                        options={agents.map((agent) => ({ id: agent.instance, label: agentName(agent.instance), detail: shown(agent.soul) }))}
                        onChange={setRelativeTo}
                      />
                    </div>
                  )}
                </div>
                <span id="oats-spawn-relation-line" aria-live="polite" data-testid="oats-spawn-relation-line">
                  {relation !== "unrelated" && agents.length === 0 ? W.NO_INSTANCES : W.relationLine(relation, relative === "" ? "" : agentName(relative))}
                </span>
              </div>
              <Field label={W.NAME_LABEL} optional hint={nameFault !== null || nameRefusal !== null ? null : name === "" ? W.NAME_EMPTY : <>Instance name: <strong className="font-semibold text-foreground">{name}</strong></>} error={nameFault ?? nameRefusal?.sentence ?? null}>
                <input data-testid="oats-spawn-name" data-field="name" className={INPUT} value={typedName} placeholder={W.NAME_PLACEHOLDER} autoComplete="off" spellCheck={false} onChange={(event) => setTypedName(event.target.value)} />
              </Field>
            </fieldset>
            <p data-testid="oats-spawn-mode" className="text-xs text-muted-foreground">
              {W.MODE_LINE}
            </p>
            {failure === null ? null : (
              <Result title={checkResult ? W.SPAWN_UNKNOWN_TITLE : W.SPAWN_FAILED_TITLE} tone={checkResult ? "unknown" : "failed"} code={failure.code}>
                <p>{failure.sentence}</p>
                {failure.detail === null ? null : (
                  <details data-testid="oats-spawn-details" className="text-xs text-muted-foreground">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center md:min-h-8">Details</summary>
                    <p className="break-words">{shown(failure.detail)}</p>
                  </details>
                )}
              </Result>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button data-testid="oats-spawn-cancel" onClick={cancel} disabled={phase === "spawning"}>
                {W.CANCEL}
              </Button>
              <Button type="submit" variant="primary" data-testid="oats-spawn-submit" aria-keyshortcuts={`${mac ? "Meta" : "Control"}+Enter`} title={`${W.SPAWN} (${mac ? "⌘" : "Ctrl+"}Enter)`} aria-busy={phase !== "idle"} disabled={!canPress}>
                {spawnWord}
              </Button>
              {reason === null ? null : <DisabledReason>{reason}</DisabledReason>}
              <span role="status" data-testid="oats-spawn-status" className="text-xs text-muted-foreground">
                {status ?? (reason === null && reading && settled === null && chosen !== undefined ? W.READING : "")}
              </span>
            </div>
          </form>
          <aside data-testid="oats-spawn-preview" aria-label="Spawn preview" aria-busy={updating} className="flex min-w-0 flex-col gap-3">
            <h2 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{W.COLUMN_TITLE}</span>
              {updating ? (
                <span role="status" data-testid="oats-spawn-updating" className="font-normal normal-case">
                  {W.UPDATING}
                </span>
              ) : null}
            </h2>
            {column}
            {chosen === undefined ? null : <p className="text-xs text-muted-foreground">{PREVIEW_FOOT}</p>}
          </aside>
        </div>
      </div>
    </Page>
  );
}
