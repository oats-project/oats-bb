// Where the installed `oats` stands (the home's one verb, `homeCli`), read once when the home is
// first seen and again when a person asks ("Check again", after an install). Read by a call of its
// own, not by a kept query: the home has to know when a check ENDS, also when its answer is the
// same as before (a kept query hands back the same object then, and says nothing).
import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contract";
import { attempt, errorMessage, type Result } from "../store";

export type Cli = Result<"homeCli">;

/**
 * `cli`: the last answer, undefined before the first one and while none was ever read (a read that
 * failed keeps what an earlier one answered). `checking`: a check a person asked for is under way.
 * `failure`: why the last read failed, null when it answered.
 * `check()`: asks the server to read OATS again (it drops the version it keeps), then reads.
 */
export function useCli(enabled: boolean): { cli: Cli | undefined; checking: boolean; failure: string | null; check(): void } {
  const rpc = useRpc<typeof rpcContract>();
  const [cli, setCli] = useState<Cli | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const read = useCallback(
    () =>
      attempt(() => rpc.call("homeCli", null)).then(
        (answer) => {
          if (!alive.current) return;
          setCli(answer);
          setFailure(null);
        },
        (cause: unknown) => {
          // The home keeps what it knew of the CLI, and says that the check failed where it shows a notice.
          if (alive.current) setFailure(errorMessage(cause));
        },
      ),
    [rpc],
  );
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    void read();
  }, [enabled, read]);
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
  return { cli, checking, failure, check };
}
