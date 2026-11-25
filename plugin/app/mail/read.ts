// The read of one agent's mail: when the view is shown, on Refresh and on Older, and at no other
// time: never on the roster's poll, never on `oats/changed`, never on a timer. Each read is one
// `aw` call per identity of the agent, over the network, and it marks nothing read.
//
// What was read is kept for the app window, by instance: a view shown again shows it at once, and
// reads again behind it. Every read carries a serial: an answer that is not of the latest read of
// the view that asked (another agent now, a newer Refresh, a view that is gone) is dropped.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { MailMessage, MailPage, MailUnread } from "../../kernel/mail";
import { attempt, errorMessage, onWindowReset, type Contract } from "../store";

/** What is held of one agent's mail. */
export type Held = {
  /** the received mail read so far, newest first: the first page, then each older page asked for */
  messages: MailMessage[];
  /** of the last page read: the teams whose mail, or some of it, could not be read (the messaging layer says it per read) */
  unread: MailUnread[];
  /** the cursor of the next older page; null: none */
  older: string | null;
  /** when the first page was received, by this window's clock */
  readAt: number;
};
export type MailRead = {
  held: Held | null;
  /** the read in flight: the first page (again), or an older one */
  fetching: "first" | "older" | null;
  /** the last read's refusal, as the server words it; null after a read that answered */
  error: { text: string; of: "first" | "older" } | null;
  /** Reads the first page again. */
  refresh(): void;
  /** Reads the page after the last one held. */
  readOlder(): void;
};

const kept = new Map<string, Held>();
/**
 * The read of an agent's first page that is on its way, by instance: a view shown while one is in
 * flight (the tab turned away from and back to) takes that one's answer and starts no second
 * process. Each is an `oats` that may run for minutes, with one `aw` call per identity.
 */
const flying = new Map<string, Promise<MailPage>>();
onWindowReset(() => {
  kept.clear();
  flying.clear();
});

const merged = (held: Held, page: MailPage): Held => {
  const known = new Set(held.messages.map((message) => message.key));
  return { ...held, messages: [...held.messages, ...page.messages.filter((message) => !known.has(message.key))], unread: page.unread, older: page.older };
};

export function useMail(instance: string): MailRead {
  const rpc = useRpc<Contract>();
  const [state, setState] = useState<{ instance: string; held: Held | null; fetching: MailRead["fetching"]; error: MailRead["error"] }>(() => ({ instance, held: kept.get(instance) ?? null, fetching: "first", error: null }));
  const serial = useRef(0);
  const read = useCallback(
    (of: "first" | "older") => {
      const held = kept.get(instance) ?? null;
      const cursor = of === "older" ? (held?.older ?? null) : null;
      if (of === "older" && cursor === null) return;
      const mine = ++serial.current;
      setState({ instance, held, fetching: of, error: null });
      const ask = () => attempt(() => rpc.call("mail", { instance, older: cursor }));
      let asked: Promise<MailPage>;
      if (of === "older") asked = ask();
      else {
        asked = flying.get(instance) ?? ask();
        if (!flying.has(instance)) {
          const mine = asked;
          flying.set(instance, mine);
          const landed = () => void (flying.get(instance) === mine && flying.delete(instance));
          mine.then(landed, landed);
        }
      }
      void asked.then(
        (page) => {
          if (serial.current !== mine) return;
          const before = kept.get(instance);
          const next: Held = of === "older" && before !== undefined ? merged(before, page) : { messages: page.messages, unread: page.unread, older: page.older, readAt: Date.now() };
          kept.set(instance, next);
          setState({ instance, held: next, fetching: null, error: null });
        },
        (cause: unknown) => {
          if (serial.current !== mine) return;
          setState({ instance, held: kept.get(instance) ?? null, fetching: null, error: { text: errorMessage(cause), of } });
        },
      );
    },
    [instance, rpc],
  );
  // Shown (and shown for another agent): one read of the first page. Gone: its answer is dropped.
  useEffect(() => {
    read("first");
    return () => {
      serial.current += 1;
    };
  }, [read]);
  const refresh = useCallback(() => read("first"), [read]);
  const readOlder = useCallback(() => read("older"), [read]);
  // Another agent since the last draw: nothing of the one before is shown while the effect starts its read.
  if (state.instance !== instance) return { held: kept.get(instance) ?? null, fetching: "first", error: null, refresh, readOlder };
  return { held: state.held, fetching: state.fetching, error: state.error, refresh, readOlder };
}
