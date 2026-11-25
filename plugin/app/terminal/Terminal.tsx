// "Terminal": the button of a tmux agent that runs, on its own page. It opens bb's Terminal tab on
// the kernel's viewer of the agent's session (open.ts), and says ONE line where the tab did not
// come up, with a fold that says which it was.
import { useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import type { rpcContract } from "../../contract";
import { errorMessage } from "../store";
import { Button } from "../ui";
import { Disclosure } from "../ui/patterns";
import { agentName } from "../ui/words";
import { openTerminal, TerminalLeft, type Opened, type TerminalIo } from "./open";
import { commandSaid, DECLINED_SAID, DID_NOT_OPEN, endedSaid, LEFT_SAID, TERMINAL } from "./words";

type Failed = { command: string | null; said: string; /** a terminal the press made is still there: bb refused to close it */ left: boolean };

/** The tab's title: the agent's name as the plugin says it everywhere. It is also how its tab is found again. */
export const terminalTitle = (instance: string): string => agentName(instance);

/**
 * `held`: the roster is the last one read, or the place reads "Reading…": the button is off with
 * the page's other acts, with no reason of its own. (It is on the agent's PAGE alone: bb shows a
 * terminal for a plugin page, never for a click in the sidebar; and the row of an agent on tmux,
 * which has no bb thread, has no menu: a click on it opens this page.)
 */
export function TerminalButton({ instance, held }: { instance: string; held: boolean }) {
  const sdk = useSdk();
  const nav = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failed | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // One press is one open: the ref holds a second press of the same moment, before the button is drawn off.
  const going = useRef(false);
  const open = async () => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setFailed(null);
    let command: string | null = null;
    let outcome: Opened | { kind: "failed"; message: string; left: boolean };
    try {
      const answered = await rpc.call("terminalCommand", { instance });
      // The page left meanwhile: nothing is created for a page that is no longer there.
      if (!alive.current) {
        going.current = false;
        return;
      }
      command = commandSaid(answered.argv);
      const io: TerminalIo = {
        list: (args) => sdk.terminals.list(args),
        create: (args) => sdk.terminals.create(args),
        get: (args) => sdk.terminals.get(args),
        close: (args) => sdk.terminals.close(args),
        show: (terminalId) => nav.experimental_openTerminal({ terminalId }),
      };
      outcome = await openTerminal(io, answered, terminalTitle(instance));
    } catch (cause) {
      outcome = { kind: "failed", message: errorMessage(cause), left: cause instanceof TerminalLeft };
    }
    going.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (outcome.kind === "opened") return;
    setFailed({ command, said: outcome.kind === "ended" ? endedSaid(outcome.status) : outcome.kind === "declined" ? DECLINED_SAID : outcome.message, left: outcome.left });
  };
  return (
    <div data-testid="oats-terminal" className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button data-testid="oats-terminal-open" disabled={held || busy} onClick={() => void open()}>
          {TERMINAL}
        </Button>
      </div>
      {failed === null ? null : (
        <div data-testid="oats-terminal-failed" className="flex min-w-0 flex-col gap-1">
          <p data-testid="oats-terminal-said" data-tone="warning" className="m-0 text-warning-text">
            {DID_NOT_OPEN}
          </p>
          <Disclosure summary="Details" testId="oats-terminal-details">
            {failed.command === null ? null : <p className="break-all font-mono text-xs text-muted-foreground">{failed.command}</p>}
            <p className="text-xs text-muted-foreground">{failed.said}</p>
            {failed.left ? <p className="text-xs text-muted-foreground">{LEFT_SAID}</p> : null}
          </Disclosure>
        </div>
      )}
    </div>
  );
}
