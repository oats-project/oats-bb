// When OATS cannot be read: the one Notice every place shows, in a person's words, with the acts
// that help (the UX standard, section 3; the design of the unreadable state). The same component
// for every place that draws the roster or a count from it: the sidebar, the home, a soul's page,
// Teams and Machines (`RosterNotice`), and a confirmation asked meanwhile; the thread's row says its
// title in one line. With a roster still shown (stale) it says how old that roster is.
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
 * A failure in a person's words: a title, a sentence, and whether the plugin's settings can mend
 * it. `machine` is the machine's name where it is known. The kernel's or the plugin's own message
 * stays one press away (Details); a kernel refusal's first line is said after "OATS says:".
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
 * the one sentence that says so, in the notice; and the reason an act that is off carries, in a
 * menu or beside a button. It names Retry first, so that a person is not left with bb's own Stop.
 * plugin/WORDS.md holds both.
 */
export const HELD = "Press Retry: Stop, Start, Restart and Retire come back when OATS is read again.";
/** The same where the notice has no Retry, because only the plugin's settings can mend it (which machine holds the agents). */
export const HELD_SETTINGS = "Open settings: Stop, Start, Restart and Retire come back when OATS is read again.";
export const HELD_REASON = "Comes back when OATS is read again";

/**
 * The Notice: the ONE drawing of "OATS cannot be read". `at` is when what is still shown was read
 * (the roster kept as last read): the notice then says its age, once and in one form ("Showing what
 * was read <age>."), and that the acts are held; left out when nothing is shown. `compact` is the
 * same words on one wrapping line, for the thread's own row: the title, the age, the held
 * sentence, Retry.
 */
export function Unreadable({ failure, machine, at, now, onRetry, compact = false }: { failure: Failure; machine: string | null; at?: string; now?: number; onRetry: () => void; compact?: boolean }) {
  const words = failureWords(failure, machine);
  const settings = useSettingsHref();
  if (compact) {
    return (
      <div role="alert" data-testid="oats-unreadable" data-code={failure.code} data-compact="" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground">
        <span className="font-semibold text-destructive-text">{words.title}</span>
        <span className="min-w-0 text-muted-foreground">{at === undefined ? (words.sentence ?? "") : `${showingRead(readAge(at, now))} ${words.retry ? HELD : HELD_SETTINGS}`}</span>
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
        code={failure.code}
        details={failure.message}
        {...(at === undefined ? {} : { age: readAge(at, now) })}
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
        {words.sentence === null ? null : <p>{words.sentence}</p>}
        {at === undefined ? null : <p data-testid="oats-held">{words.retry ? HELD : HELD_SETTINGS}</p>}
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
