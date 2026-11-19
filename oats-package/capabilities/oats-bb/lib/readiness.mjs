// Is this bb fit to run an OATS home? (contract items 6a, 7, 8.) One set of checks, read by
// `oats readiness` (the provider's check command) and run by every launch before it
// touches anything. Each finding is {code, message, status}; `status` is the readiness
// wire's word for it (needs-configuration, authorization-required or unavailable).
import { existsSync } from "node:fs";
import { bbClient } from "./bb.mjs";
import { ProviderError, isObject } from "./errors.mjs";
import { exposedListeners } from "./exposure.mjs";
import { TRUST_VALUES, loopbackOrigin, portOf } from "./settings.mjs";
import { isLive } from "./threads.mjs";

const HTTP_TIMEOUT_MS = 5_000;
// bb's provider health words (bb plugins/provider-claude-code provider-maintenance).
const PROVIDER_STATUS = { not_installed: "needs-configuration", unauthenticated: "authorization-required", expired: "authorization-required" };

/** GET a JSON document. Resolves { ok: true, value } or { ok: false, message }. */
export async function getJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, timeoutMs)), redirect: "error", headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message;
    return { ok: false, message: error?.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : cause ? `${error.message} (${cause})` : String(error?.message ?? error) };
  }
}

/** Every reason this bb must not run a home now, in the order a person would fix them.
 *  → { problems, server, daemon, bb, listable } (the addresses as origins, null when
 *  refused; `listable` when bb's CLI runs and its server answers). */
export async function backendProblems(settings, { deadline = Date.now() + 25_000, env = process.env, http = getJson, exposure = exposedListeners } = {}) {
  const problems = [];
  const add = (code, status, message) => problems.push({ code, message, status });
  const left = (cap) => Math.min(cap, deadline - Date.now());

  // Trust: bb's loopback port is open to every local user's processes, unlike tmux's
  // socket in its 0700 directory. Someone must have said who shares this machine.
  if (!TRUST_VALUES.includes(settings.trust)) {
    add("E_BACKEND_TRUST", "needs-configuration", settings.trust == null
      ? "settings.oats.bb.trust is not set. bb's API has no login and its loopback port is reachable by every local user's processes: set it in oats-local.yaml to single-user (this host is one person's) or container (one OATS team container with one bb server)"
      : `settings.oats.bb.trust is ${JSON.stringify(settings.trust)}; it must be single-user or container`);
  }
  if (settings.version == null) {
    add("E_BACKEND_VERSION", "needs-configuration", "settings.oats.bb.version is not set: pin the bb-app version this deployment runs (the output of `bb --version`)");
  }

  let server = null, daemon = null, cliRuns = settings.version == null;
  for (const [name, set] of [["server", (origin) => { server = origin; }], ["daemon", (origin) => { daemon = origin; }]]) {
    try { set(loopbackOrigin(settings[name], name)); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      add(error.code, "needs-configuration", error.message);
    }
  }

  const bb = bbClient({ cli: settings.cli, server: server ?? undefined, deadline, env });
  if (settings.version != null) {
    try {
      const version = await bb.version();
      cliRuns = true;
      if (version !== settings.version) {
        add("E_BACKEND_VERSION", "needs-configuration", `bb is ${version}, and settings.oats.bb.version pins ${settings.version}: install bb-app@${settings.version}, or move the pin with the image's`);
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      add("E_BACKEND_VERSION", "needs-configuration", `the bb version could not be read (${error.message})`);
    }
  }

  if (server && daemon) {
    const open = await exposure([portOf(server), portOf(daemon)]);
    if (open.length > 0) {
      add("E_BACKEND_EXPOSED", "needs-configuration", `bb answers off loopback, at ${open.join(", ")}. Its API has no login and runs commands: bind it to 127.0.0.1 (no BB_SERVER_BIND_HOST=0.0.0.0), and reach it from other devices through a Tailscale Serve route`);
    }
  }

  if (server) {
    const health = await http(`${server}/health`, left(HTTP_TIMEOUT_MS));
    if (!health.ok || !isObject(health.value) || health.value.ok !== true) {
      add("E_BACKEND_UNREACHABLE", "unavailable", `bb's server at ${server} does not answer (${health.ok ? "its /health is not ok" : health.message}): start bb-app, or set settings.oats.bb.server`);
      return { problems, server, daemon, bb, listable: false };
    }
  }
  if (daemon) {
    // The server's /health answers before the host daemon is up; threads need the daemon.
    const status = await http(`${daemon}/status`, left(HTTP_TIMEOUT_MS));
    if (!status.ok || !isObject(status.value)) {
      add("E_BACKEND_UNREACHABLE", "unavailable", `bb's host daemon at ${daemon} does not answer (${status.ok ? "its /status is not an object" : status.message}): start bb-app, or set settings.oats.bb.daemon`);
    } else if (status.value.connected !== true) {
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} is not connected to its server yet`);
    } else if (server && typeof status.value.serverUrl === "string" && originOf(status.value.serverUrl) !== server) {
      add("E_BACKEND_NOT_READY", "needs-configuration", `the host daemon at ${daemon} serves ${status.value.serverUrl}, not settings.oats.bb.server ${server}: point both settings at one bb`);
    }
  }
  if (server) {
    const state = await http(`${server}/api/v1/system/providers/state?providerId=claude-code`, left(HTTP_TIMEOUT_MS * 3));
    const provider = state.ok && isObject(state.value) && Array.isArray(state.value.providers)
      ? state.value.providers.find((entry) => isObject(entry) && entry.providerId === "claude-code") : null;
    if (!provider || typeof provider.status !== "string") {
      add("E_BACKEND_NOT_READY", "unavailable", `bb did not report its claude-code provider's status (${state.ok ? "no claude-code entry" : state.message})`);
    } else if (provider.status !== "ready") {
      const hint = typeof provider.loginCommand === "string" && PROVIDER_STATUS[provider.status] === "authorization-required" ? `: run \`${provider.loginCommand}\` as bb's user, or give bb's server the credential in its environment` : "";
      const detail = typeof provider.statusMessage === "string" && provider.statusMessage ? ` (${provider.statusMessage.slice(0, 300)})` : "";
      add("E_BACKEND_NOT_READY", PROVIDER_STATUS[provider.status] ?? "unavailable", `bb reports its claude-code provider as ${provider.status}${detail}${hint}`);
    }
  }
  return { problems, server, daemon, bb, listable: server !== null && cliRuns };
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}

/** Live bb threads whose project root no longer exists: what a retire that could not
 *  reach bb, or an older kernel's retire, left behind. → warnings, one per root. */
export async function orphanedThreads(bb, { exists = existsSync } = {}) {
  const [projects, threads] = [await bb.projects(), await bb.threads()];
  const warnings = [];
  for (const project of projects) {
    if (!isObject(project) || !Array.isArray(project.sources)) continue;
    const roots = project.sources.filter((source) => isObject(source) && typeof source.path === "string").map((source) => source.path);
    if (roots.length === 0 || roots.some((root) => exists(root))) continue;
    const ids = threads.filter((thread) => isLive(thread) && thread.projectId === project.id).map((thread) => thread.id);
    if (ids.length === 0) continue;
    warnings.push({ code: "session-provider-orphaned", message: `bb thread${ids.length > 1 ? "s" : ""} ${ids.join(", ")} of project ${project.id} ${ids.length > 1 ? "have" : "has"} no home: the project root ${roots.join(", ")} no longer exists. Archive ${ids.length > 1 ? "them" : "it"} in bb (bb thread archive <id>)` });
  }
  return warnings;
}

/** The readiness wire's result: {status, problems, warnings}. */
export async function readinessResult(settings, options = {}) {
  const { problems, bb, listable } = await backendProblems(settings, options);
  const warnings = [];
  if (listable) {
    try { warnings.push(...await orphanedThreads(bb, options)); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      warnings.push({ code: "session-provider-orphans-unchecked", message: `bb's threads could not be listed, so orphaned threads were not looked for (${error.message})` });
    }
  }
  const order = ["needs-configuration", "authorization-required", "unavailable"];
  const status = problems.length === 0 ? "ready" : order.find((word) => problems.some((problem) => problem.status === word));
  return { status, problems: problems.map(({ code, message }) => ({ code, message })), warnings };
}
