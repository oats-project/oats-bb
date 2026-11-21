// The Automations page as a bb page: /plugins/oats/automations, with the tab and the open row in
// its route (…/schedules, …/triggers, …/triggers/<id>), so Back and a link both work. It reads
// the two lists through the plugin's server and a trigger's recorded state when its page opens;
// View.tsx draws them.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { AutomationKind, AutomationRow, TriggerStatus } from "../../contract/automations";
import { codes } from "../../kernel/result";
import { attempt, useRead } from "../store";
import type { Contract, Result } from "../store";
import { Page } from "../ui";
import { fileOf } from "./Detail";
import { automationsSupported } from "./version";
import type { OatsVersion } from "./version";
import { KINDS, View } from "./View";
import type { Gate, ListRead } from "./View";
import { TITLES } from "./words";

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

/** Why a list cannot be shown at all, in the Desktop's words where it has them. */
export function gateOf(kind: AutomationKind, answer: { code: string } | null, oats: OatsVersion | null): Gate | null {
  const title = TITLES[kind];
  if (answer !== null && answer.code === codes.notFound) return { title: `${title} need the OATS CLI`, detail: null };
  if (oats !== null && !automationsSupported(oats)) {
    return { title: `${title} need OATS 0.29 or later`, detail: `Update OATS to see the workspace's ${title.toLowerCase()} and this computer's own, and where each one runs.` };
  }
  return null;
}

type Lists = Result<"automations">;
function listRead(answer: Lists[AutomationKind] | undefined, loading: boolean, failure: string | null, kept: ListRead["list"]): ListRead {
  if (answer === undefined) return { list: kept, loading, error: failure };
  // A refusal keeps its code before its message, as every refusal the plugin shows.
  return answer.ok ? { list: answer.list, loading, error: null } : { list: kept, loading, error: /^E_[A-Z0-9_]+$/.test(answer.code) ? `${answer.code}: ${answer.message}` : answer.message };
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

export function AutomationsPage({ subPath, oats = null }: PluginNavPanelProps & { oats?: OatsVersion | null }) {
  const read = useRead("automations");
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const now = useNow();
  const { kind, openId } = routeOf(subPath);

  // A list that was read stays on screen while a later read fails or is under way.
  const kept = useRef<Partial<Record<AutomationKind, ListRead["list"]>>>({});
  const loading = read.status === "loading";
  const failure = read.status === "error" ? read.error : null;
  const reads = Object.fromEntries(
    KINDS.map((id) => {
      const one = listRead(read.data?.[id], loading, failure, kept.current[id]);
      if (one.list !== undefined) kept.current[id] = one.list;
      return [id, one];
    }),
  ) as Record<AutomationKind, ListRead>;
  const answer = read.data?.[kind];
  const gate = gateOf(kind, answer !== undefined && !answer.ok ? answer : null, oats);

  // A trigger's recorded state, read once per open and again when the lists are: an answer for a
  // row that is no longer the open one changes nothing.
  const [status, setStatus] = useState<{ id: string; value: TriggerStatus } | null>(null);
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
        if (asked.current === ticket) setStatus({ id: openId, value });
      },
      () => {
        // The row's own last fire still shows.
      },
    );
    return () => {
      asked.current += 1;
    };
  }, [kind, openId, at]);

  const hostId = read.data?.hostId ?? null;
  const onOpenFile = useCallback(
    (row: AutomationRow) => {
      const file = fileOf(row);
      // Read-only, in bb's own file preview, from the machine that holds the deployment; a member
      // with no clone here opens its web page.
      if (file.path !== null && hostId !== null) navigate.experimental_openFilePreview({ target: { kind: "host", hostId, path: file.path }, location: null });
      else if (file.url !== null) navigate.openUrl(file.url);
    },
    [hostId, navigate],
  );
  const onOpen = useCallback((id: string | null) => navigate.toPluginPanel(PATH, { subPath: subPathOf(kind, id) }), [kind, navigate]);

  return (
    <Page testId="oats-automations-page">
      <View
        kind={kind}
        onKind={(next) => navigate.toPluginPanel(PATH, { subPath: subPathOf(next) })}
        reads={reads}
        gate={gate}
        now={now}
        onRefresh={read.retry}
        openId={openId}
        onOpen={onOpen}
        status={status !== null && status.id === openId ? status.value : null}
        onOpenFile={onOpenFile}
      />
    </Page>
  );
}
