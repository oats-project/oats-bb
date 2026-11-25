// The Automations page as a bb page: /plugins/oats/automations, with the tab and the open row in
// its route (…/runs; …/schedules/<id>, …/triggers/<id>), so Back and a link both work. It reads
// the two lists and every trigger's state through the plugin's server (one read), and the open
// trigger's own state when its page opens; View.tsx draws them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { NO_AUTOMATIONS } from "../../contract/automations";
import type { AutomationKind, AutomationRow, TriggerStatus } from "../../contract/automations";
import { openAgentPage } from "../home/agent-tab";
import { openAct } from "../lifecycle/acts";
import { useOats } from "../oats";
import { state as stateOf } from "../../model/view";
import { attempt, errorMessage, useRead } from "../store";
import type { Contract, Result } from "../store";
import { HELD_REASON, isUnreadable, Unreadable } from "../roster/unreadable";
import { displayLine } from "../ui/text";
import { useActs } from "./acts";
import { HereContext } from "./here";
import { PAGE_REREAD_MS, useAutomations } from "./read";
import { KINDS, View } from "./View";
import type { Gate, ListRead, Open, Tab } from "./View";
import { capabilitySource, HERE, hereOf, refusalParts } from "./words";
import type { FileTarget, Here } from "./words";

export const PATH = "automations";
/** Why a list's acts are held while it is one that could not be read again (the UX standard, Stale). */
export const HELD = "Held until the list can be read again: what each row is now is not known.";
const SEGMENT: Record<AutomationKind, string> = { schedule: "schedules", trigger: "triggers" };

/**
 * The route under the page: which tab, and which row's page is open. `runs` is the Runs tab;
 * `schedules/<id>` and `triggers/<id>` a row's page; anything else (the page's start, and the
 * earlier `schedules` and `triggers` tabs' addresses, which a link may still hold) the list.
 */
export function routeOf(subPath: string): { tab: Tab; open: Open | null } {
  let segments: string[];
  try {
    segments = subPath.split("/").filter((segment) => segment !== "").map(decodeURIComponent);
  } catch {
    // An address that does not decode names nothing: the page's start.
    segments = [];
  }
  const kind = KINDS.find((candidate) => SEGMENT[candidate] === segments[0]);
  if (kind !== undefined && segments.length > 1) return { tab: "list", open: { kind, id: segments.slice(1).join("/") } };
  return { tab: segments[0] === "runs" ? "runs" : "list", open: null };
}
export const subPathOf = (tab: Tab, open: Open | null = null): string => (open !== null ? `${SEGMENT[open.kind]}/${open.id}` : tab === "runs" ? "runs" : "");

/**
 * Why the lists cannot be shown at all though OATS answers: an OATS from before the lists (the
 * server says so), in the Desktop's words. An OATS that cannot be read at all (no `oats`, no
 * deployment, no machine) is the plugin's one notice for that, the sidebar's (app/roster/unreadable.tsx).
 */
export function gateOf(answer: { code: string; message: string } | null, here: Here = HERE): Gate | null {
  if (answer === null || answer.code !== NO_AUTOMATIONS) return null;
  return { title: "Automations need OATS 0.29 or later", detail: `Update OATS to see the workspace's schedules and triggers and ${here.on}'s own, and where each one runs.`, code: answer.code };
}

/**
 * The page's title in bb's own header: on a row's page a breadcrumb, as bb's own Automations page
 * has one (bb draws the page's title, then the automation's name); else the page's title alone.
 * The name is the list's; until the lists are read, the id's last part.
 */
export function usePageTitle({ subPath }: PluginNavPanelProps) {
  const { open } = routeOf(subPath);
  const read = useRead("automations", { live: false });
  if (open === null) return null;
  const answer = read.data?.[open.kind];
  const row = answer !== undefined && answer.ok ? answer.list.rows.find((entry) => entry.id === open.id) : undefined;
  const name = displayLine(row?.name ?? open.id.split("/").pop()) ?? "";
  return { breadcrumbs: [{ label: name }], windowTitle: name };
}

/**
 * The title as bb's header draws it, as TEXT ONLY: bb's own draws the page's icon before its title;
 * the OATS pages' titles are words alone. On a row's page: the page's title, a slash, the
 * automation's name (cut at the header's end, as bb cuts its own: the page's head says it whole).
 * In bb's own classes for its header's title and breadcrumb.
 */
export function HeaderTitle(props: PluginNavPanelProps) {
  const title = usePageTitle(props);
  const name = title?.breadcrumbs[0]?.label ?? null;
  return (
    <div data-testid="oats-automations-title" className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
      <p className="shrink-0 truncate">Automations</p>
      {name === null ? null : (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span aria-current="page" className="min-w-0 truncate">
            {name}
          </span>
        </>
      )}
    </div>
  );
}

type Lists = Result<"automations">;
type Kept = { list: NonNullable<ListRead["list"]>; at: string };
function listRead(answer: Lists[AutomationKind] | undefined, at: string | undefined, loading: boolean, failure: string | null, kept: Kept | undefined): ListRead {
  const shown = { list: kept?.list, readAt: kept?.at ?? null };
  // The server did not answer, now or at this re-read: its own words, over what was read before.
  if (failure !== null) return { ...shown, loading, error: { code: null, message: failure } };
  if (answer === undefined || at === undefined) return { ...shown, loading, error: null };
  if (answer.ok) return { list: answer.list, readAt: at, loading, error: null };
  // The kernel's refusal, or the plugin's own lack: its message, and its code after it.
  return { ...shown, loading, error: { code: answer.code, message: answer.message } };
}

/** `now`, moving on every half minute so that "in 5 min" and "2 h ago" stay true while the page is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function AutomationsPage({ subPath }: PluginNavPanelProps) {
  const read = useAutomations(PAGE_REREAD_MS);
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const now = useNow();
  const { tab, open } = routeOf(subPath);
  const kind = open?.kind ?? null;
  const openId = open?.id ?? null;

  // A list that was read stays on screen while a later read fails or is under way.
  const kept = useRef<Partial<Record<AutomationKind, Kept>>>({});
  const loading = read.status === "loading";
  const failure = read.status === "error" ? read.error : null;
  const reads = Object.fromEntries(
    KINDS.map((id) => {
      const one = listRead(read.data?.[id], read.data?.at, loading, failure, kept.current[id]);
      if (one.list !== undefined && one.readAt !== null && one.error === null) kept.current[id] = { list: one.list, at: one.readAt };
      return [id, one];
    }),
  ) as Record<AutomationKind, ListRead>;

  // Refresh and Retry: the page says it is reading again from the press until that read settles,
  // whatever it answers (a server that does not answer twice says so twice).
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  // One read at a time, and one more behind it: an act that ends while the lists are being read
  // again (after the act before it) is still read back, whichever render its press belongs to.
  const reading = useRef(false);
  const again = useRef(false);
  const reread = useRef(read.refresh);
  reread.current = read.refresh;
  const refresh = useCallback(() => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    setRefreshing(true);
    const run = (): Promise<void> => {
      again.current = false;
      const next = () => (again.current ? run() : undefined);
      return reread.current().then(next, next);
    };
    void run().finally(() => {
      reading.current = false;
      if (mounted.current) setRefreshing(false);
    });
  }, []);
  /** The machine the page is about, by bb's name for it. */
  const machine = read.data?.machine ?? null;
  const here = useMemo(() => hereOf(machine), [machine]);
  // What both lists were refused with: one fault of OATS itself refuses both alike.
  const refusals = KINDS.map((id) => read.data?.[id]).map((answer) => (answer !== undefined && !answer.ok ? answer : null));
  const refused = refusals[0] ?? refusals[1] ?? null;
  // What takes the lists' place: an OATS without the lists, or an OATS that cannot be read at all
  // while nothing read before is shown (with a list kept, the notice goes over it and holds its acts).
  const gate = gateOf(refused, here);
  const unreadable = refused !== null && isUnreadable(refused.code) && reads.schedule.list === undefined && reads.trigger.list === undefined ? refused : null;
  // Every trigger's state, of the same read as the lists; kept while a later read of it fails, like a list.
  const keptStatuses = useRef<Result<"automations">["statuses"] & { ok: true } | null>(null);
  const answered = read.data?.statuses;
  if (answered !== undefined && answered.ok) keptStatuses.current = answered;
  const statuses = keptStatuses.current?.statuses ?? null;

  // A trigger's recorded state, read when its page opens and again when the lists are. An answer
  // for a row that is no longer the open one changes nothing. A read that fails is said, over the
  // state read before, with how old that is.
  const [status, setStatus] = useState<{ id: string; value: TriggerStatus | null; readAt: string | null; error: { code: string | null; message: string } | null } | null>(null);
  const [statusRetry, setStatusRetry] = useState(0);
  const asked = useRef(0);
  const at = read.data?.at;
  const call = useRef(rpc);
  useEffect(() => {
    call.current = rpc;
  });
  useEffect(() => {
    // Asked once the lists are here: the server reads a trigger's state only for a trigger they name.
    if (kind !== "trigger" || openId === null || at === undefined) return;
    const ticket = ++asked.current;
    attempt(() => call.current.call("triggerStatus", { id: openId })).then(
      (value) => {
        if (asked.current === ticket) setStatus({ id: openId, value, readAt: new Date().toISOString(), error: null });
      },
      (error: unknown) => {
        if (asked.current !== ticket) return;
        const failure = refusalParts(errorMessage(error));
        setStatus((before) => (before !== null && before.id === openId ? { ...before, error: failure } : { id: openId, value: null, readAt: null, error: failure }));
      },
    );
    return () => {
      asked.current += 1;
    };
  }, [kind, openId, at, statusRetry]);
  const mine = status !== null && status.id === openId ? status : null;
  // Until the open trigger's own read answers, its state is the one read beside the lists.
  const beside = kind === "trigger" && openId !== null ? (statuses?.find((entry) => entry.id === openId)?.status ?? null) : null;

  const hostId = read.data?.hostId ?? null;
  const onOpenFile = useCallback(
    (target: FileTarget) => {
      // Read-only, in bb's own file preview, from the machine that holds the deployment; a member
      // with no clone here opens its web page.
      if (target.kind === "preview") navigate.experimental_openFilePreview({ target: { kind: "host", hostId: target.hostId, path: target.path }, location: null });
      else navigate.openUrl(target.url);
    },
    [navigate],
  );
  // A source's "Open capability" resolves against the Capabilities page's own list: exactly one
  // capability of that name, or the source stays text.
  // It is read only while the page of a trigger on a capability's source is open.
  const sourced = kind === "trigger" && openId !== null && capabilitySource(reads.trigger.list?.rows.find((entry) => entry.id === openId)?.on ?? null) !== null;
  const capabilities = useRead("capabilities", { live: false, enabled: sourced }).data?.capabilities;
  const canOpenCapability = useCallback((name: string) => (capabilities ?? []).filter((capability) => capability.id === name).length === 1, [capabilities]);
  const onOpenCapability = useCallback(() => navigate.toPluginPanel("capabilities"), [navigate]);
  const onOpen = useCallback((next: Open | null) => navigate.toPluginPanel(PATH, { subPath: subPathOf(tab, next) }), [tab, navigate]);
  // The agents as the window's roster has them now: a run's agent opens its chat (bb's thread; its
  // own page where it has none), says whether it asks, and is started where it is stopped. One the
  // roster no longer lists is none of that.
  const oats = useOats();
  const ready = oats.phase === "ready" ? oats : null;
  // Every agent of the roster by its instance, with its state: the tree's own for an agent the tree draws, else the kernel's row alone (an agent with no bb thread).
  const agents = useMemo(() => {
    if (ready === null) return null;
    return new Map(ready.agents.map((agent) => [agent.instance, { agent, state: ready.nodeByInstance.get(agent.instance)?.state ?? stateOf(agent, null) }]));
  }, [ready?.agents, ready?.nodeByInstance]);
  const agentLink = useCallback(
    (instance: string) => {
      const known = agents?.get(instance);
      if (known === undefined) return null;
      const { agent } = known;
      return {
        open: () => void (agent.threadId !== null ? navigate.toThread(agent.threadId) : openAgentPage(navigate, agent.instance)),
        asks: known.state === "needs-you",
        start: known.state === "stopped" ? () => openAct("start", agent.instance) : null,
      };
    },
    [agents, navigate],
  );
  // The agent of an automation that asks: among the agents its runs made (a schedule's kept runs; a
  // trigger's fires), the first the roster says needs a person.
  const asking = useCallback(
    (row: AutomationRow): string | null => {
      if (agents === null) return null;
      const made = row.kind === "schedule" ? row.recentRuns.map((run) => run.instance) : (statuses?.find((entry) => entry.id === row.id)?.status.fired.map((fired) => fired.instance) ?? []);
      return made.find((instance): instance is string => instance !== null && agents.get(instance)?.state === "needs-you") ?? null;
    },
    [agents, statuses],
  );
  const onAnswer = useCallback((instance: string) => agentLink(instance)?.open(), [agentLink]);
  const descriptions = read.data?.oats?.features.includes("automation-descriptions") ?? false;
  const host = (reads.schedule.list ?? reads.trigger.list)?.host.name ?? null;
  const acts = useActs({
    here,
    rpc,
    refresh,
    summaries: descriptions,
    open,
    // The reason an act that is off carries is the one the roster's acts carry; the notice above the list says why.
    held: { schedule: reads.schedule.error === null ? null : HELD_REASON, trigger: reads.trigger.error === null ? null : HELD_REASON },
    onOpen: (row) => navigate.toPluginPanel(PATH, { subPath: subPathOf(tab, { kind: row.kind, id: row.id }) }),
    onOpenFile,
    hostId,
    // The row after the deleted one, else the one before it: the control a person would reach next,
    // among the rows the list shows (its filter and search applied). From a row's own page the list
    // is not drawn: its first row takes the focus once it is.
    neighbourOf: (row) => {
      const shown = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="oats-automation-row"]')).map((entry) => `${entry.dataset.kind ?? ""}:${entry.dataset.id ?? ""}`);
      const at = shown.indexOf(`${row.kind}:${row.id}`);
      const besideKey = at === -1 ? null : (shown[at + 1] ?? shown[at - 1] ?? null);
      return () => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="oats-automation-row"]'));
        return (rows.find((entry) => `${entry.dataset.kind ?? ""}:${entry.dataset.id ?? ""}` === besideKey) ?? rows[0])?.querySelector<HTMLElement>('[data-testid="oats-automation-open"]') ?? null;
      };
    },
    onRemoved: (row) => {
      if (open !== null && open.kind === row.kind && open.id === row.id) navigate.toPluginPanel(PATH, { subPath: subPathOf(tab) });
    },
  });

  const heldKinds = KINDS.some((id) => reads[id].error !== null);
  return (
    <HereContext.Provider value={here}>
      {acts.dialog}
      <View
        rowActs={acts}
        held={heldKinds ? HELD : null}
        gateNotice={unreadable === null ? null : <Unreadable failure={{ code: unreadable.code, message: unreadable.message }} machine={machine} onRetry={refresh} />}
        rowParts={(row) => acts.rowParts(row, now, host)}
        schedulerAction={acts.schedulerAction}
        result={acts.result}
        tab={tab}
        onTab={(next) => navigate.toPluginPanel(PATH, { subPath: subPathOf(next) })}
        reads={reads}
        statuses={statuses}
        gate={gate}
        now={now}
        onRefresh={refresh}
        refreshing={refreshing}
        open={open}
        onOpen={onOpen}
        status={mine?.value ?? beside}
        statusFailure={mine === null || mine.error === null ? null : { ...mine.error, readAt: mine.value === null ? null : mine.readAt, onRetry: () => setStatusRetry((n) => n + 1) }}
        onOpenFile={onOpenFile}
        canOpenCapability={canOpenCapability}
        onOpenCapability={onOpenCapability}
        agentLink={agentLink}
        asking={asking}
        onAnswer={onAnswer}
      />
    </HereContext.Provider>
  );
}
