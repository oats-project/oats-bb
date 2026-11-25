// The New agent form: a name and a task, the kernel's preview (`oats spawn --preview`), and the
// spawn of exactly that decision (a bb thread where the deployment has the bb session provider:
// `oats spawn --backend bb --yolo`; where it has none, where the kernel puts it).
import { openAgentPage } from "../home/agent-tab";
import { useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { instanceName } from "../../contract";
import { newKey } from "../keys";
import { errorMessage } from "../store";
import type { Contract, Result } from "../store";
import { Button, ErrorLine } from "../ui";
import { shown } from "../ui/text";

type Soul = Result<"souls">["souls"][number];
type Summary = Result<"spawnPreview">["summary"];

function SummaryView({ summary }: { summary: Summary }) {
  const list = (title: string, items: readonly string[], tone = "") =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        <ul className={`flex flex-col gap-0.5 ${tone}`}>
          {items.map((item, index) => (
            <li key={index} className="break-words">
              {shown(item)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div data-testid="oats-preview" className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What OATS would do</span>
      {list("Problems", summary.problems, "text-destructive-text")}
      {list("Warnings", summary.warnings)}
      {list("Modules", summary.modules)}
      {list("Teams", summary.teams)}
      {summary.launch === null ? null : list("Launch", [summary.launch])}
    </div>
  );
}

/** Name, task, Preview, Spawn in bb. One idempotency key per filled form, reused on a retry. */
function SpawnForm({ soul }: { soul: Soul }) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState<"preview" | "spawn" | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<{ of: string; key: string } | null>(null);

  // A preview answers for the input it was asked with: once that changes it is taken down.
  const edit = (setValue: (value: string) => void, value: string) => {
    setValue(value);
    setSummary(null);
  };
  const nameOk = instanceName.safeParse(name).success; // the contract's own rule
  const ready = nameOk && task.trim() !== "" && busy === null;
  const input = { soul: soul.name, name, task };

  // What the form holds now. A preview's answer is for the input it was asked with: one that
  // lands after the name or the task changed is dropped, never drawn under the new input.
  const shown = useRef("");
  shown.current = JSON.stringify(input);

  const preview = () => {
    if (!ready) return;
    const asked = shown.current;
    setBusy("preview");
    setError(null);
    rpc.call("spawnPreview", input).then(
      (answer) => {
        setBusy(null);
        if (shown.current === asked) setSummary(answer.summary);
      },
      (cause: unknown) => {
        setBusy(null);
        if (shown.current !== asked) return;
        setSummary(null);
        setError(errorMessage(cause));
      },
    );
  };
  const spawn = () => {
    if (!ready) return;
    // The same soul, name and task asked again is the same intent: the kernel answers it once.
    const of = JSON.stringify(input);
    if (intent.current === null || intent.current.of !== of) intent.current = { of, key: newKey() };
    setBusy("spawn");
    setError(null);
    rpc.call("spawn", { ...input, key: intent.current.key }).then(
      (answer) => {
        setBusy(null);
        intent.current = null;
        // An agent with no bb thread (a deployment with no bb session provider): its own page.
        if (answer.threadId === null) openAgentPage(navigate, answer.instance);
        else navigate.toThread(answer.threadId);
      },
      (cause: unknown) => {
        setBusy(null);
        setError(errorMessage(cause));
      },
    );
  };

  return (
    <form
      data-testid="oats-spawn-form"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        spawn();
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Name
        <input
          data-testid="oats-spawn-name"
          className="min-h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-subtle-foreground"
          value={name}
          autoComplete="off"
          spellCheck={false}
          placeholder="task-role, for example ranker-v3-probe"
          aria-invalid={name !== "" && !nameOk}
          onChange={(event) => edit(setName, event.target.value)}
        />
        {name !== "" && !nameOk ? (
          <span className="text-destructive-text">
            Lower-case letters, digits and dashes; starts with a letter or a digit; 63 characters at most.
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Task
        <textarea
          data-testid="oats-spawn-task"
          rows={6}
          className="rounded-md border border-border bg-background p-2 text-sm text-foreground placeholder:text-subtle-foreground"
          value={task}
          placeholder="What this agent is for."
          onChange={(event) => edit(setTask, event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="oats-spawn-preview" disabled={!ready} onClick={preview}>
          {busy === "preview" ? "Reading…" : "Preview"}
        </Button>
        <Button type="submit" variant="primary" data-testid="oats-spawn-submit" disabled={!ready}>
          {busy === "spawn" ? "Spawning…" : "Spawn in bb"}
        </Button>
      </div>
      {error === null ? null : <ErrorLine>{error}</ErrorLine>}
      {summary === null ? null : <SummaryView summary={summary} />}
    </form>
  );
}

/** What a soul's page shows under "New agent" for a soul that can be spawned: the mode, in words, and the form. */
export function NewAgent({ soul }: { soul: Soul }) {
  return (
    <>
      <p data-testid="oats-spawn-mode" className="text-xs text-muted-foreground">
        Runs in bb's full mode: no sandbox.
      </p>
      <SpawnForm soul={soul} />
    </>
  );
}
