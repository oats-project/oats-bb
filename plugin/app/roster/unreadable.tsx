// When OATS cannot be read: the one Notice every place shows, in a person's words, with the acts
// that help (the UX standard, section 3; the design of the unreadable state). The same component
// for the sidebar, the identity row, the home and the pages; with a roster still shown (stale) it
// says how old that roster is.
import { experimental_usePluginId as usePluginId } from "@get-bb/plugin-sdk/app";
import { codes, isKernelCode } from "../../kernel/result";
import { firstLine, THREADS_FAILED } from "../oats";
import { Button, LINK, Notice, TARGET } from "../ui";
import { shown } from "../ui/text";
import { readAge } from "../ui/words";

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
 * The Notice. `at` is when what is still shown was read (a stale roster); left out when nothing is
 * shown. `testId` wraps it so a place's test finds its own.
 */
export function Unreadable({ failure, machine, at, now, onRetry }: { failure: Failure; machine: string | null; at?: string; now?: number; onRetry: () => void }) {
  const words = failureWords(failure, machine);
  const settings = useSettingsHref();
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
      </Notice>
    </div>
  );
}
