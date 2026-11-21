// The provider's settings (`settings.oats.bb`): where bb is, which bb, and who can reach it.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fail, isObject } from "./errors.mjs";

const DEFAULT_SERVER = "http://127.0.0.1:38886";
const DEFAULT_DAEMON = "http://127.0.0.1:38887";
const DEFAULT_CLI = "bb";
export const TRUST_VALUES = Object.freeze(["single-user", "container"]);

const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** True for the hosts that can only name this machine's loopback: 127.0.0.0/8, ::1 and
 *  `localhost`. Nothing is resolved: a name that needs DNS is not loopback here. */
export function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase();
  return host === "localhost" || host === "[::1]" || host === "::1" || LOOPBACK_V4.test(host);
}

/** A bb address as its origin (`http://127.0.0.1:38886`), or a refusal: E_BACKEND_SETTINGS
 *  when it is not a plain http(s) origin, E_BACKEND_EXPOSED when it names a host off
 *  loopback (bb's API has no login: the provider only ever talks to it on loopback).
 *  A refusal never repeats the value: a URL may carry a user and a password. */
export function loopbackOrigin(value, name) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.${name} is not a URL (the value is not shown: it could hold a credential)`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.${name} must be an http or https URL (the value is not shown: it could hold a credential)`);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    const extra = [url.username || url.password ? "a user or password" : null, url.pathname !== "/" && url.pathname !== "" ? "a path" : null, url.search ? "a query" : null, url.hash ? "a fragment" : null].filter(Boolean).join(", ");
    throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.${name} must be a bare origin (scheme, host and port), and it has ${extra} (the value is not shown: it could hold a credential)`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw fail("E_BACKEND_EXPOSED", `settings.oats.bb.${name} names ${url.hostname}, which is not loopback: bb's API has no login, so this provider reaches bb only on 127.0.0.1, ::1 or localhost (a Tailscale Serve route in front of a loopback bb is fine)`);
  }
  return url.origin;
}

export function portOf(origin) {
  const url = new URL(origin);
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/** The settings with their defaults, shapes checked. `trust` and `version` stay as given
 *  (possibly absent): readiness names what is missing. The addresses are checked where
 *  they are used, so a refusal there carries its own code. */
export function readSettings(raw) {
  if (raw !== undefined && raw !== null && !isObject(raw)) throw fail("E_BACKEND_SETTINGS", "settings.oats.bb must be a map");
  const given = raw ?? {};
  const text = (key, fallback) => {
    const value = given[key];
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.${key} must be a string`);
    return value;
  };
  const cli = text("cli", DEFAULT_CLI);
  if (/[\\/]/.test(cli) && !isAbsolute(cli)) throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.cli must be a command name on PATH or an absolute path, got ${JSON.stringify(cli)}`);
  // bb's data directory (bb-app's --data-dir): bb does not say where it is. Its default
  // is `.bb` in the home of the user that runs bb, who is the user this provider runs as.
  // Read only for a launch in a sandboxed mode, which checks its shape there: a value
  // that is wrong holds up no other verb.
  const dataDir = text("dataDir", join(homedir(), ".bb")).replace(/(?<=.)\/+$/, "");
  return {
    server: text("server", DEFAULT_SERVER),
    daemon: text("daemon", DEFAULT_DAEMON),
    version: text("version", null),
    trust: text("trust", null),
    cli,
    dataDir,
  };
}
