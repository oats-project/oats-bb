// When OATS cannot be read: the one Notice every place shows, in a person's words, with the acts
// that help (the UX standard, section 3; the design of the unreadable state). The same component
// for every place that draws the roster or a count from it: the sidebar, the home, a soul's page,
// Teams and Machines (`RosterNotice`), and a confirmation asked meanwhile; the thread's row says its
// title in one line. With a roster still shown (stale) it says how old that roster is. What to do
// in a sentence, the code and the kernel's own message are one press away, under Details.
import { useEffect, useSyncExternalStore } from "react";
import { experimental_usePluginId as usePluginId } from "@get-bb/plugin-sdk/app";
import { codes, isKernelCode } from "../../kernel/result";
import { firstLine, THREADS_FAILED } from "../oats";
import type { Oats } from "../oats";
import { useNow } from "./now";
import { Button, LINK, Notice, TARGET } from "../ui";
import { shown } from "../ui/text";
import { readAge, showingRead } from "../ui/words";

export type Failure = { code: string; message: string };

/**
 * A failure in a person's words: a title, a sentence (drawn under Details, with the code and the
 * kernel's or the plugin's own message), and whether the plugin's settings can mend it. `machine`
 * is the machine's name where it is known. A kernel refusal's first line is said after "OATS says:".
 * plugin/WORDS.md holds which of these are the Desktop's and which are the plugin's.
 */
export function failureWords(failure: Failure, machine: string | null): { title: string; sentence: string | null; settings: boolean; retry: boolean } {
  const on = machine === null ? "this machine" : shown(machine);
  switch (failure.code) {
    case codes.notFound:
      return { title: `OATS is not installed on ${on}`, sentence: "Install OATS there, or set the path to oats in the plugin's settings.", settings: true, retry: true };
    case codes.noDeployment:
      return { title: `No OATS deployment found on ${on}`, sentence: "Open a bb project inside the deployment, or set its directory in the plugin's settings.", settings: true, retry: true };
    case codes.chooseHost:
      return { title: "Choose the machine that holds your agents", sentence: "This bb server has more than one machine.", settings: true, retry: false };
    case codes.hostNotFound:
      return { title: `Couldn't reach ${on}`, sentence: "The machine in the plugin's settings is not one of this bb server's.", settings: true, retry: true };
    case codes.noHost:
    case codes.hostUnreachable:
      return { title: `Couldn't reach ${on}`, sentence: null, settings: false, retry: true };
    case codes.timeout:
      return { title: `OATS did not answer on ${on}`, sentence: "It took more than 20 s.", settings: false, retry: true };
    case THREADS_FAILED:
      return { title: "bb could not list its threads", sentence: "So the OATS agents cannot be matched to them.", settings: false, retry: true };
    default:
      if (isKernelCode(failure.code)) return { title: "OATS could not read this deployment", sentence: `OATS says: ${shown(firstLine(failure.message))}`, settings: false, retry: true };
      return { title: "OATS could not be read", sentence: null, settings: false, retry: true };
  }
}

/** The plugin's own codes for "OATS cannot be read at all": no `oats`, no deployment, no machine, no answer. */
const UNREADABLE: ReadonlySet<string> = new Set([codes.notFound, codes.noDeployment, codes.chooseHost, codes.hostNotFound, codes.noHost, codes.hostUnreachable, codes.timeout]);
/** Whether a refusal's code says OATS itself cannot be read (so the place shows this notice, not the refusal's raw line). */
export const isUnreadable = (code: string | null): boolean => code !== null && UNREADABLE.has(code);

/** The settings of this plugin, in bb's own settings (a route of bb's, not of the plugin's SDK: README). */
export function useSettingsHref(): string {
  return `/settings/plugins/${encodeURIComponent(usePluginId())}`;
}

/**
 * While the roster shown is the last one read, the OATS acts are HELD (the Desktop's rule, D-085):
 * the one sentence that says so, in the notice. Design carries the rest: every OATS act is drawn
 * off, and the notice's own button (Retry, or Open settings where only the settings mend it) is
 * the way out. plugin/WORDS.md holds it, and the sentences it replaced.
 */
export const HELD = "Acts are off.";
export const HELD_REASON = "Comes back when OATS is read again";

/**
 * The Notice: the ONE drawing of "OATS cannot be read". `at` is when what is still shown was read
 * (the roster kept as last read): the notice then says its age, once and in one form ("Read
 * <age>."), and that the acts are off; left out when nothing is shown. `compact` is the same
 * words on one wrapping line, for the thread's own row: the title, the age, "Acts are off.", Retry.
 */
export function Unreadable({ failure, machine, at, now, onRetry, compact = false, inSidebar = false }: { failure: Failure; machine: string | null; at?: string; now?: number; onRetry: () => void; compact?: boolean; inSidebar?: boolean }) {
  const words = failureWords(failure, machine);
  const settings = useSettingsHref();
  // A PAGE that draws the full notice over a roster kept as last read says so (whoever draws it:
  // the home, a soul's page, Teams), so that the sidebar beside it says one line and not the same
  // notice a second time. The sidebar's own notice (`inSidebar`) and the thread row's line do not count.
  const fullOnPage = !compact && !inSidebar && at !== undefined;
  useEffect(() => {
    if (!fullOnPage) return;
    pagesWithNotice += 1;
    tell();
    return () => {
      pagesWithNotice -= 1;
      tell();
    };
  }, [fullOnPage]);
  if (compact) {
    return (
      <div role="alert" data-testid="oats-unreadable" data-code={failure.code} data-compact="" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground">
        <span className="font-semibold text-destructive-text">{words.title}</span>
        {at === undefined ? null : <span className="min-w-0 text-muted-foreground">{`${showingRead(readAge(at, now))} ${HELD}`}</span>}
        {words.retry ? (
          <span className="ml-auto shrink-0">
            <Button onClick={onRetry}>Retry</Button>
          </span>
        ) : words.settings ? (
          <a className={`${TARGET} ${LINK} ml-auto inline-flex shrink-0 items-center`} href={settings}>
            Open settings
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="oats-unreadable" data-code={failure.code}>
      <Notice
        title={words.title}
        tone="error"
        // (A kernel refusal's sentence is its own first line: the message under it holds that line already.)
        details={[isKernelCode(failure.code) ? null : words.sentence, `${failure.code}: ${failure.message}`]}
        actions={
          <>
            {words.retry ? <Button onClick={onRetry}>Retry</Button> : null}
            {words.settings ? (
              <a className={`${TARGET} ${LINK} inline-flex items-center`} href={settings}>
                Open settings
              </a>
            ) : null}
          </>
        }
      >
        {/* How old what is still shown is, then that the acts are off: one line, as on the thread's row. */}
        {at === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            {showingRead(readAge(at, now))} <span data-testid="oats-held">{HELD}</span>
          </p>
        )}
      </Notice>
    </div>
  );
}

/**
 * For a place that draws something of the roster: nothing while the roster is the one just read;
 * the Notice when OATS cannot be read, with the age of what the place still shows when it is the
 * last roster read. The place draws it above what it keeps.
 */
export function RosterNotice({ oats }: { oats: Oats }) {
  const now = useNow();
  if (oats.phase === "failed") return <Unreadable failure={oats} machine={oats.machine} onRetry={oats.retry} />;
  if (oats.phase === "ready" && oats.stale !== null) return <Unreadable failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />;
  return null;
}

// ---- one full notice on a screen ----
// The sidebar and a page are drawn side by side. While a page shows the full notice over what it
// keeps, the sidebar says ONE line (how old the roster is, and Retry): `LastObservation`.
let pagesWithNotice = 0;
const noticeWatchers = new Set<() => void>();
const tell = () => {
  for (const watcher of noticeWatchers) watcher();
};
// (Nothing is reset with the window: each notice counts itself in when it mounts and out when it
// unmounts, and a count set to zero under a mounted page would go below it.)
/** Whether a page drawn now shows the full notice over a roster kept as last read. */
export function usePageShowsNotice(): boolean {
  return useSyncExternalStore(
    (watcher) => {
      noticeWatchers.add(watcher);
      return () => noticeWatchers.delete(watcher);
    },
    () => pagesWithNotice > 0,
  );
}

/** The sidebar's one line beside a page's full notice: "Read 2 min ago.", and Retry (or the settings, where only they mend it). */
export function LastObservation({ failure, machine, at, now, onRetry }: { failure: Failure; machine: string | null; at: string; now: number; onRetry: () => void }) {
  const words = failureWords(failure, machine);
  const settings = useSettingsHref();
  return (
    <div role="status" data-testid="oats-last-observation" data-code={failure.code} title={words.title} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-xs text-muted-foreground">
      <span className="min-w-0">{showingRead(readAge(at, now))}</span>
      {words.retry ? (
        <span className="ml-auto shrink-0">
          <Button onClick={onRetry}>Retry</Button>
        </span>
      ) : words.settings ? (
        <a className={`${TARGET} ${LINK} ml-auto inline-flex shrink-0 items-center`} href={settings}>
          Open settings
        </a>
      ) : null}
    </div>
  );
}
