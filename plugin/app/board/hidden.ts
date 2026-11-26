// The facts a person hid, on this computer alone: by agent and key, with the value the fact had
// when it was hidden, so that it shows again when the agent says something new (the Desktop's
// rule). Kept in the browser's storage, read and written whole, bounded. The kernel's `unset` is
// the agent's: nothing here reaches OATS.
import { useCallback, useSyncExternalStore } from "react";

const STORE = "oats.bb.board.hidden";
const MAX_AGENTS = 200;
const MAX_KEYS = 12;
type Held = Record<string, Record<string, string>>;

const listeners = new Set<() => void>();
/** The parsed store, kept while the stored text is the same: a read during a draw must answer the same object for the same store. */
let cache: { text: string | null; held: Held } = { text: null, held: {} };

/** The browser's storage, or null where this window has none (a private mode that refuses it): nothing is hidden then, and nothing can be kept. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(): Held {
  const text = storage()?.getItem(STORE) ?? null;
  if (text === cache.text) return cache.held;
  let held: Held = {};
  try {
    const parsed: unknown = text === null ? {} : JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const [agent, keys] of Object.entries(parsed).slice(0, MAX_AGENTS)) {
        if (typeof keys !== "object" || keys === null || Array.isArray(keys)) continue;
        const kept: Record<string, string> = {};
        for (const [key, value] of Object.entries(keys).slice(0, MAX_KEYS)) if (typeof value === "string") kept[key] = value;
        held[agent] = kept;
      }
    }
  } catch {
    // What is stored is no JSON (another program's, or cut short): read as nothing hidden.
    held = {};
  }
  cache = { text, held };
  return held;
}

function write(held: Held): void {
  const text = JSON.stringify(held);
  let kept = true;
  try {
    storage()?.setItem(STORE, text);
  } catch {
    // The storage is full or refuses: the fact stays hidden for this window only.
    kept = false;
  }
  cache = { text: kept ? text : cache.text, held };
  for (const listener of listeners) listener();
}

const NONE: ReadonlyMap<string, string> = new Map();
const maps = new WeakMap<Record<string, string>, ReadonlyMap<string, string>>();
/** The hidden facts of one agent: from a fact's key to the value it was hidden at. */
function hiddenOf(instance: string): ReadonlyMap<string, string> {
  const keys = read()[instance];
  if (keys === undefined) return NONE;
  let map = maps.get(keys);
  if (map === undefined) {
    map = new Map(Object.entries(keys));
    maps.set(keys, map);
  }
  return map;
}

/** The facts of `instance` hidden on this computer, with `hide(key, value)` and `showAll()`. */
export function useHiddenFacts(instance: string): { hidden: ReadonlyMap<string, string>; hide(key: string, value: string): void; showAll(): void } {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  const hidden = useSyncExternalStore(subscribe, () => hiddenOf(instance), () => NONE);
  const hide = useCallback(
    (key: string, value: string) => {
      const held = { ...read() };
      const keys = { ...(held[instance] ?? {}), [key]: value };
      // The newest first, within the bounds: an agent's oldest hidden keys, and the oldest agents, fall out.
      const next: Held = { [instance]: Object.fromEntries(Object.entries(keys).slice(-MAX_KEYS)) };
      for (const [agent, kept] of Object.entries(held)) if (agent !== instance && Object.keys(next).length < MAX_AGENTS) next[agent] = kept;
      write(next);
    },
    [instance],
  );
  const showAll = useCallback(() => {
    const held = { ...read() };
    delete held[instance];
    write(held);
  }, [instance]);
  return { hidden, hide, showAll };
}

/** For the tests: nothing is hidden, and the store is read again. */
export function forgetHidden(): void {
  storage()?.removeItem(STORE);
  cache = { text: null, held: {} };
  for (const listener of listeners) listener();
}
