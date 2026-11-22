// The facts a person hid on this computer (the Desktop's "Hide on this computer"): by agent home,
// the value each hidden fact had, in the browser's local storage. Client-side only: the kernel's
// `unset` is the agent's. A fact shows again when its value changes. Bounded: 200 homes, 12 keys
// each (the board's own bound). A storage that is full or unavailable hides for this page only.
const STORE = "oats.bb.board.hidden";
const HOMES = 200;
const KEYS = 12;

type All = Record<string, Record<string, string>>;
const session = new Map<string, Map<string, string>>();

function read(): All {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(STORE) ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as All) : {};
  } catch {
    return {}; // unreadable or unavailable storage: nothing is hidden from before
  }
}
/** → whether it was stored; when not (storage full or unavailable), `session` keeps it for this page. */
function write(all: All): boolean {
  const homes = Object.keys(all);
  for (const home of homes.slice(0, Math.max(0, homes.length - HOMES))) delete all[home];
  try {
    globalThis.localStorage?.setItem(STORE, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** By key, the value each fact of `home` was hidden at. */
export function hiddenOf(home: string): Map<string, string> {
  const out = new Map(session.get(home) ?? []);
  const stored = read()[home];
  if (typeof stored === "object" && stored !== null) for (const [key, value] of Object.entries(stored)) if (typeof value === "string") out.set(key, value);
  return out;
}
export function hideFact(home: string, key: string, value: string): void {
  const now = hiddenOf(home);
  now.set(key, value);
  const kept = new Map([...now].slice(-KEYS));
  session.set(home, kept);
  const all = read();
  delete all[home];
  all[home] = Object.fromEntries(kept);
  write(all);
}
export function showAllFacts(home: string): void {
  session.delete(home);
  const all = read();
  delete all[home];
  write(all);
}
