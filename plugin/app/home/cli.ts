// Where the installed `oats` stands (the home's one verb, `homeCli`), read once when the home is
// first seen (once more, by itself, when that read failed and the roster reads) and again when a
// person asks ("Check again", after an install). Read by a call of its
// own, not by a kept query: the home has to know when a check ENDS, also when its answer is the
// same as before (a kept query hands back the same object then, and says nothing).
//
// The sidebar reads it too, the same way, when IT is first seen: its "New agent" is held by the
// same rule as the home's (app/workspace/pages.ts `newAgentHeld`), and the sidebar is on screen
// before any home is. The ANSWER is one for the window, whoever read it: a check a person asks on
// the home moves the sidebar's button with the home's. (Each place still asks once itself; the
// server keeps the version, so that is one `oats version`.)
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contract";
import { attempt, errorMessage, type Result } from "../store";

export type Cli = Result<"homeCli">;

// The window's one answer: the last one any place read.
let known: Cli | undefined;
const heard = new Set<() => void>();
const say = (answer: Cli | undefined) => {
  known = answer;
  for (const hear of heard) hear();
};
const hearCli = (hear: () => void) => {
  heard.add(hear);
  return () => void heard.delete(hear);
};
const knownCli = () => known;
/** Forgets the window's answer (a test's reset: a module's state outlives a mounted tree). */
export const forgetCli = (): void => say(undefined);

/**
 * `cli`: the last answer, undefined before the first one and while none was ever read (a read that
 * failed keeps what an earlier one answered). `checking`: a check a person asked for is under way.
 * `failure`: why the last read failed, null when it answered. `unchecked`: no version was ever
 * read, and the home's own second try failed too: the home then says so, with Check again.
 * `check()`: asks the server to read OATS again (it drops the version it keeps), then reads.
 *
 * `rosterRead`: whether the roster is read. A first read of the version that fails is tried once
 * more by the home itself, once the roster is read (a roster that reads proves `oats` runs, so a
 * version read that failed alone is worth one more try); never more than once, and never on a timer.
 */
export function useCli(enabled: boolean, rosterRead: boolean): { cli: Cli | undefined; checking: boolean; failure: string | null; unchecked: boolean; check(): void } {
  const rpc = useRpc<typeof rpcContract>();
  const cli = useSyncExternalStore(hearCli, knownCli);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** How the home's own reads stand: none asked, the first under way, the first failed, the second under way, the second failed (answered: `cli` holds it). */
  const [own, setOwn] = useState<"none" | "first" | "first-failed" | "second" | "second-failed">("none");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** One read of the version. → whether it answered. */
  const read = useCallback(
    (): Promise<boolean> =>
      attempt(() => rpc.call("homeCli", null)).then(
        (answer) => {
          // The answer is the window's, also when the place that asked has left the screen.
          say(answer);
          if (alive.current) setFailure(null);
          return true;
        },
        (cause: unknown) => {
          // The home keeps what it knew of the CLI, and says that the check failed where it shows a notice.
          if (alive.current) setFailure(errorMessage(cause));
          return false;
        },
      ),
    [rpc],
  );
  // The step is kept beside the state too, read where the effect decides: an effect run twice
  // before the state is drawn again (a strict-mode mount, a render between) must not ask twice.
  const step = useRef(own);
  const move = (next: typeof own) => {
    step.current = next;
    setOwn(next);
  };
  useEffect(() => {
    if (!enabled) return;
    if (step.current === "none") {
      move("first");
      void read().then((answered) => {
        if (alive.current && !answered) move("first-failed");
      });
    } else if (step.current === "first-failed" && rosterRead) {
      move("second");
      void read().then((answered) => {
        if (alive.current && !answered) move("second-failed");
      });
    }
    // `own` is a dependency so that the effect runs again once the first read is seen to have failed.
  }, [enabled, own, rosterRead, read]);
  const check = useCallback(() => {
    if (checking) return;
    setChecking(true);
    const again = () => read();
    void attempt(() => rpc.call("refresh", null))
      .then(again, again)
      .finally(() => {
        if (alive.current) setChecking(false);
      });
  }, [checking, read, rpc]);
  return { cli, checking, failure, unchecked: cli === undefined && own === "second-failed", check };
}
