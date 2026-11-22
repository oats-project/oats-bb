// The Automations page as a bb page: /plugins/oats/automations, with the tab and the open row in
// its route (…/schedules, …/triggers, …/triggers/<id>), so Back and a link both work. It reads
// the two lists through the plugin's server and a trigger's recorded state when its page opens;
// View.tsx draws them.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { NO_AUTOMATIONS } from "../../contract/automations";
import type { AutomationKind, AutomationRow, TriggerStatus } from "../../contract/automations";
import { codes } from "../../kernel/result";
import { attempt, errorMessage, useRead } from "../store";
import type { Contract, Result } from "../store";
import { Page } from "../ui";
import { useActs } from "./acts";
import { PAGE_REREAD_MS, useAutomations } from "./read";
import { KINDS, View } from "./View";
import type { Gate, ListRead } from "./View";
import { capabilitySource, TITLES } from "./words";
import type { FileTarget } from "./words";

export const PATH = "automations";
const SEGMENT: Record<AutomationKind, string> = { schedule: "schedules", trigger: "triggers" };

/** The route under the page: which tab, and which row's page is open. */
export function routeOf(subPath: string): { kind: AutomationKind; openId: string | null } {
  let segments: string[];
  try {
    segments = subPath.split("/").filter((segment) => segment !== "").map(decodeURIComponent);
  } catch {
    // An address that does not decode names nothing: the page's start.
    segments = [];
  }
  const kind = KINDS.find((candidate) => SEGMENT[candidate] === segments[0]) ?? "schedule";
  return { kind, openId: segments.length > 1 ? segments.slice(1).join("/") : null };
}
export const subPathOf = (kind: AutomationKind, openId: string | null = null): string => (openId === null ? SEGMENT[kind] : `${SEGMENT[kind]}/${openId}`);

/**
 * Why a list cannot be shown at all, in the Desktop's words where it has them: no `oats` on the
 * machine, or an OATS from before the lists (the server says which). The server's own message
 * (which machine, what to install or set) and its code follow the title.
 */
export function gateOf(kind: AutomationKind, answer: { code: string; message: string } | null): Gate | null {
  const title = TITLES[kind];
  if (answer === null) return null;
  if (answer.code === codes.notFound) return { title: `${title} need the OATS CLI`, detail: answer.message, code: answer.code };
  if (answer.code === NO_AUTOMATIONS) return { title: `${title} need OATS 0.29 or later`, detail: `Update OATS to see the workspace's ${title.toLowerCase()} and this computer's own, and where each one runs.`, code: answer.code };
  return null;
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
  const { kind, openId } = routeOf(subPath);

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
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void read.refresh().finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  };
  const answer = read.data?.[kind];
  const gate = gateOf(kind, answer !== undefined && !answer.ok ? answer : null);

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
        const said = errorMessage(error);
        const lead = /^([A-Z][A-Z0-9_]*): /.exec(said);
        const failure = lead === null ? { code: null, message: said } : { code: lead[1]!, message: said.slice(lead[0].length) };
        setStatus((before) => (before !== null && before.id === openId ? { ...before, error: failure } : { id: openId, value: null, readAt: null, error: failure }));
      },
    );
    return () => {
      asked.current += 1;
    };
  }, [kind, openId, at, statusRetry]);
  const mine = status !== null && status.id === openId ? status : null;

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
  const onOpen = useCallback((id: string | null) => navigate.toPluginPanel(PATH, { subPath: subPathOf(kind, id) }), [kind, navigate]);

  const descriptions = read.data?.oats?.features.includes("automation-descriptions") ?? false;
  const list = reads[kind].list;
  const acts = useActs({
    rpc,
    refresh,
    summaries: descriptions,
    onOpen: (row) => navigate.toPluginPanel(PATH, { subPath: subPathOf(row.kind, row.id) }),
    onOpenFile,
    hostId,
    onRemoved: (row) => {
      if (openId === row.id) navigate.toPluginPanel(PATH, { subPath: subPathOf(row.kind) });
    },
  });

  return (
    <Page testId="oats-automations-page">
      {acts.dialog}
      <View
        rowActs={acts}
        rowParts={(row) => acts.rowParts(row, now, list?.host.name ?? null)}
        schedulerAction={acts.schedulerAction}
        result={acts.result}
        kind={kind}
        onKind={(next) => navigate.toPluginPanel(PATH, { subPath: subPathOf(next) })}
        reads={reads}
        gate={gate}
        now={now}
        onRefresh={refresh}
        refreshing={refreshing}
        openId={openId}
        onOpen={onOpen}
        status={mine?.value ?? null}
        statusFailure={mine === null || mine.error === null ? null : { ...mine.error, readAt: mine.value === null ? null : mine.readAt, onRetry: () => setStatusRetry((n) => n + 1) }}
        onOpenFile={onOpenFile}
        hostId={hostId}
        canOpenCapability={canOpenCapability}
        onOpenCapability={onOpenCapability}
      />
    </Page>
  );
}
