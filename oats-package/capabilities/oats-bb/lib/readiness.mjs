// Is this bb fit to run an OATS home? (contract items 6a, 7, 8.) One set of checks, read by
// `oats readiness` (the provider's check command) and run by every launch before it
// touches anything. Each finding is {code, message, status}; `status` is the readiness
// wire's word for it (needs-configuration, authorization-required or unavailable).
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { bbClient } from "./bb.mjs";
import { ProviderError, bounded, isObject, someOf } from "./errors.mjs";
import { exposedListeners } from "./exposure.mjs";
import { harnessRefusal, permissionMode, sandboxRefusal, sandboxedModeRefusal } from "./mode.mjs";
import { currentSandbox, gapList, missingRemedy, readLaunchRecord, readSandbox } from "./local-settings.mjs";
import { TRUST_VALUES, isLoopbackHost, loopbackOrigin, portOf } from "./settings.mjs";
import { isLive } from "./threads.mjs";

// Each read's own cap. Every read is also cut at the call's deadline (`left`), so a bb
// that hangs still gets a named problem inside the kernel's time, never a killed check.
const HTTP_TIMEOUT_MS = 4_000;
const PROVIDER_STATE_TIMEOUT_MS = 6_000;
// bb's provider health words (bb plugins/provider-claude-code provider-maintenance).
const PROVIDER_STATUS = { not_installed: "needs-configuration", unsupported_version: "needs-configuration", unauthenticated: "authorization-required", expired: "authorization-required", unknown: "unavailable" };

const HTTP_MAX_BYTES = 256 * 1024;

/** GET a JSON document from bb, read-only: a loopback address (the callers pass only
 *  origins that passed loopbackOrigin), no redirect followed, bounded in time and in size.
 *  Resolves { ok: true, value } or { ok: false, message }; never throws. */
async function getJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  // The time limit is a timer of this process's own, not AbortSignal.timeout: that one
  // does not keep the process alive, and on Node 20 a fetch whose connection is dropped as it is accepted
  // never settles, so the process ended, with status 0 and no answer, while it waited.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(new DOMException("timed out", "TimeoutError")), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url, { method: "GET", signal: limit.signal, redirect: "error", headers: { accept: "application/json" } });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, message: `HTTP ${response.status}` }; }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > HTTP_MAX_BYTES) return { ok: false, message: `an answer larger than ${HTTP_MAX_BYTES} bytes` };
      chunks.push(chunk);
    }
    try { return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; }
    catch { return { ok: false, message: "an answer that is not JSON" }; }
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message;
    return { ok: false, message: error?.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : cause ? `${error.message} (${cause})` : String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Every reason this bb must not run a home now, in the order a person would fix them.
 *  → { problems, server, daemon, bb, listable, credential } (the addresses as origins,
 *  null when refused; `listable` when bb's CLI runs and its server answers; `credential`
 *  names where bb's Claude takes its credential from, when bb reports it ready). */
export async function backendProblems(settings, { deadline = Date.now() + 16_000, env = process.env, http = getJson, exposure = exposedListeners } = {}) {
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

  let server = null, daemon = null, cliRuns = settings.version == null, credential = null;
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
      return { problems, server, daemon, bb, listable: false, credential };
    }
  }
  if (daemon) {
    // The server's /health answers before the host daemon is up; threads need the daemon.
    const status = await http(`${daemon}/status`, left(HTTP_TIMEOUT_MS));
    if (!status.ok) {
      add("E_BACKEND_UNREACHABLE", "unavailable", `bb's host daemon at ${daemon} does not answer (${status.message}): start bb-app, or set settings.oats.bb.daemon`);
    } else if (!isObject(status.value) || typeof status.value.connected !== "boolean") {
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} answered a /status this provider cannot read (no "connected": true or false)`);
    } else if (status.value.connected !== true) {
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} is not connected to its server yet`);
    } else if (!usableOrigin(status.value.serverUrl)) {
      // Without the server the daemon names, nothing says it serves this one. An address
      // that is no http(s) origin names none.
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} answered a /status this provider cannot read (no "serverUrl" that is an http or https address)`);
    } else if (server && !sameServer(status.value.serverUrl, server)) {
      add("E_BACKEND_NOT_READY", "needs-configuration", `the host daemon at ${daemon} serves ${new URL(status.value.serverUrl).origin}, not settings.oats.bb.server ${server}: point both settings at one bb`);
    }
  }
  if (server) {
    const state = await http(`${server}/api/v1/system/providers/state?providerId=claude-code`, left(PROVIDER_STATE_TIMEOUT_MS));
    const provider = state.ok && isObject(state.value) && Array.isArray(state.value.providers)
      ? state.value.providers.find((entry) => isObject(entry) && entry.providerId === "claude-code") : null;
    if (!provider || typeof provider.status !== "string") {
      add("E_BACKEND_NOT_READY", "unavailable", `bb did not report its claude-code provider's status (${state.ok ? "no claude-code entry" : state.message})`);
    } else if (provider.status !== "ready") {
      const hint = typeof provider.loginCommand === "string" && PROVIDER_STATUS[provider.status] === "authorization-required" ? `: run \`${provider.loginCommand}\` as bb's user, or give bb's server the credential in its environment` : "";
      const detail = typeof provider.statusMessage === "string" && provider.statusMessage ? ` (${provider.statusMessage.slice(0, 300)})` : "";
      add("E_BACKEND_NOT_READY", PROVIDER_STATUS[provider.status] ?? "unavailable", `bb reports its claude-code provider as ${provider.status}${detail}${hint}`);
    } else {
      // Where the credential comes from, by bb's own report; never the credential, and
      // no account name.
      credential = typeof provider.accountEmail === "string" && provider.accountEmail
        ? "a Claude login of bb's user"
        : "no Claude login: a credential in bb's own configuration or in the bb server's environment";
    }
  }
  return { problems, server, daemon, bb, listable: server !== null && cliRuns, credential };
}

/** Whether the server a daemon says it serves is the configured one. The daemon reports
 *  127.0.0.1 whatever loopback name the setting uses (localhost, ::1): between two
 *  loopback addresses, the port decides. */
/** Whether the value is an address a bb server can have: an http or https URL with a host. */
function usableOrigin(value) {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
}

/** The same server: the same origin, or (between loopback names, which differ only in how
 *  this machine is called) the same scheme and port. */
function sameServer(reported, server) {
  let url;
  try { url = new URL(reported); } catch { return false; }
  if (url.origin === server) return true;
  const mine = new URL(server);
  return url.protocol === mine.protocol && isLoopbackHost(url.hostname) && isLoopbackHost(mine.hostname) && portOf(url.origin) === portOf(server);
}

/** Live bb threads whose project root no longer exists: what a retire that could not
 *  reach bb, or an older kernel's retire, left behind. → warnings, one per root. */
async function orphanedThreads(bb, { exists = existsSync } = {}) {
  const [projects, threads] = [await bb.projects(), await bb.threads()];
  const warnings = [];
  for (const project of projects) {
    if (!isObject(project) || !Array.isArray(project.sources)) continue;
    const roots = project.sources.filter((source) => isObject(source) && typeof source.path === "string").map((source) => source.path);
    if (roots.length === 0 || roots.some((root) => exists(root))) continue;
    const ids = threads.filter((thread) => isLive(thread) && thread.projectId === project.id).map((thread) => thread.id);
    if (ids.length === 0) continue;
    warnings.push({ code: "session-provider-orphaned", message: `${ids.length} bb thread${ids.length > 1 ? "s" : ""} of project ${project.id} ${ids.length > 1 ? "have" : "has"} no home: the project root no longer exists. Archive ${ids.length > 1 ? "them" : "it"} in bb (bb thread archive <id>). Thread${ids.length > 1 ? "s" : ""}: ${someOf(ids)}. Root: ${someOf(roots, 1)}` });
  }
  return warnings;
}

/** Whether Claude Code's sandbox can start here. On Linux it runs commands under
 *  bubblewrap (`bwrap`); without it bb's sandboxed modes cannot auto-allow anything, and
 *  every command waits for a person in bb. Other platforms bring their own. */
export function sandboxCanStart({ platform = process.platform, path = process.env.PATH ?? "" } = {}) {
  if (platform !== "linux") return true;
  return path.split(delimiter).filter(Boolean).some((dir) => {
    try { accessSync(join(dir, "bwrap"), constants.X_OK); return true; } catch { return false; }
  });
}

/** What to say where the sandbox cannot start: a warning, never a refusal. */
function sandboxRuntimeWarning(settings, env) {
  if (sandboxCanStart({ path: env.PATH ?? "" })) return [];
  const then = settings.trust === "container"
    ? "In a team container, spawn bb agents with --yolo (bb full mode): the container is the boundary, as it is for tmux agents there"
    : "Install bubblewrap, or spawn bb agents with --yolo (bb full mode)";
  return [{ code: "session-provider-sandbox-unsupported", message: `bubblewrap (bwrap) is not on this host's PATH, so Claude's sandbox cannot start: in bb's sandboxed modes (auto, accept-edits) every command waits for a person in bb. ${then}` }];
}

/** The readiness result: {status, problems, warnings}, the shape `oats readiness` relays
 *  as a providers item. `status` is ready (no problem), needs-configuration,
 *  authorization-required or unavailable. `credential` is for a person's report only. */
export async function readinessResult(settings, options = {}) {
  const { problems, bb, listable, credential } = await backendProblems(settings, options);
  const warnings = sandboxRuntimeWarning(settings, options.env ?? process.env);
  if (listable) {
    try { warnings.push(...await orphanedThreads(bb, options)); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // bb's own lists could not be read: a bb that cannot say what runs in it is not
      // ready, whatever else answered (a launch reads the same lists first).
      problems.push({ code: "E_BACKEND_NOT_READY", status: "unavailable", message: `bb's projects and threads could not be read, so this bb cannot be used and orphaned threads were not looked for (${error.message})` });
    }
  }
  for (const problem of options.extra?.problems ?? []) problems.push(problem);
  warnings.push(...(options.extra?.warnings ?? []));
  const order = ["needs-configuration", "authorization-required", "unavailable"];
  const status = problems.length === 0 ? "ready" : order.find((word) => problems.some((problem) => problem.status === word));
  // Every line is cut to what the kernel relays.
  return { result: { status, problems: problems.map(({ code, message }) => ({ code, message: bounded(message) })), warnings: warnings.map(({ code, message }) => ({ code, message: bounded(message) })) }, credential };
}

/** What a readiness read with no planned launch says, since it cannot know the mode a
 *  launch would run in (`oats readiness`, for a soul or a home; `oats bb doctor`): the
 *  backend launches in full mode only for now. A warning: a soul that launches with yolo is
 *  ready. */
export const FULL_MODE_ONLY = Object.freeze({ code: "session-provider-full-mode-only", message: "the bb backend launches in bb's full mode only for now: a spawn or start that does not choose it (--yolo, or a launch configuration's --permission-mode bypassPermissions) would run in bb's accept-edits or auto mode, which are sandboxed, and is refused before anything starts (E_BACKEND_SANDBOXED_MODE). The rules that keep a sandboxed agent's tools off its own home's hooks and settings come with a later release of this provider" });

// Hosts that serve everyone's repositories: allowing one for a knowledge base's remote
// allows the whole forge, not only that base.
const GENERAL_FORGES = new Set(["github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "dev.azure.com", "git.sr.ht"]);

/** A team of the agent's, other than its default, whose service the deployment does not
 *  record: the launch goes on, and this says plainly what the agent then cannot do. */
function otherTeamsWarning(mode, rows, unnamed) {
  const cannot = mode === "auto" ? "in bb's auto mode that team's mail is unreachable for this agent" : "in bb's accept-edits mode every command that reaches that team's mail raises a prompt for a person in bb";
  return { code: "session-provider-sandbox-team-unreachable", message: `the deployment records no host for a team that is not this agent's default: ${cannot}. ${missingRemedy(rows)}. Missing: ${gapList(rows, unnamed)}` };
}

/** What the planned launch the kernel hands the check would meet in the sandbox: the
 *  refusal a launch in that mode would answer, as a problem; optional rows, skipped
 *  capabilities and, in full mode, the gaps, as warnings. → {problems, warnings}. */
export function plannedLaunchFindings(planned, { sandboxedModes = false } = {}) {
  const problems = [], warnings = [];
  const unsupported = harnessRefusal(planned.harness);
  if (unsupported !== null) return { problems: [{ ...unsupported, status: "needs-configuration" }], warnings };
  let mode, allowances;
  try {
    mode = permissionMode(planned.args, planned.yolo);
    // A mode the command does not launch in yet: that is the whole answer, as it is the
    // launch's own first refusal.
    const notOffered = sandboxedModes ? null : sandboxedModeRefusal(mode);
    if (notOffered !== null) return { problems: [{ ...notOffered, status: "needs-configuration" }], warnings };
    allowances = readSandbox(planned.sandbox, { sandboxed: mode !== "full" });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return { problems: [{ code: error.code, message: error.message, status: "needs-configuration" }], warnings };
  }
  const refusal = sandboxRefusal(mode, allowances);
  if (refusal !== null) problems.push({ ...refusal, status: refusal.code === "E_BACKEND_SANDBOX_UNAVAILABLE" ? "unavailable" : "needs-configuration" });
  else if (allowances.unavailable !== null) {
    warnings.push({ code: "session-provider-sandbox-unavailable", message: `the deployment's configuration could not be resolved for the sandbox (${allowances.unavailable}). The planned launch runs in full mode, which has no sandbox; a launch in auto or accept-edits would be refused` });
  } else if (allowances.missing.length + allowances.unnamed > 0) {
    warnings.push({ code: "session-provider-sandbox-host-missing", message: `the deployment records no host for some of what a sandbox would need. The planned launch runs in full mode, which has no sandbox; a launch in auto or accept-edits is refused. ${missingRemedy(allowances.missing)}. Missing: ${gapList(allowances.missing, allowances.unnamed)}` });
  }
  if (mode !== "full" && !isObject(planned.sandbox)) {
    // A kernel that hands the launch no sandbox at all: nothing will be added, and bb's
    // sandbox then blocks OATS's own commands.
    warnings.push({ code: "session-provider-sandbox-missing", message: `the planned launch runs in bb's ${mode} mode and carries no sandbox allowances: bb's sandbox will block the agent's aw (no network to the messaging server) and oats instance attention (no write to the deployment's events). Launch in full mode (--yolo), or on a kernel that hands the launch its allowances` });
  }
  if (mode !== "full" && allowances.otherTeams.length > 0) warnings.push(otherTeamsWarning(mode, allowances.otherTeams, 0));
  const optionalCount = allowances.optional.length + allowances.unnamedOptional;
  if (optionalCount > 0) {
    warnings.push({ code: "session-provider-sandbox-host-optional", message: `the deployment records no host for ${gapList(allowances.optional, allowances.unnamedOptional)}, which ${optionalCount > 1 ? "are" : "is"} optional: the launch goes on, and what needs ${optionalCount > 1 ? "them" : "it"} is blocked in bb's sandboxed modes` });
  }
  if (allowances.skipped.length + allowances.unnamedSkipped > 0) {
    const names = gapList(allowances.skipped, allowances.unnamedSkipped, { describe: (entry) => `${entry.capability}${entry.reason ? ` (${entry.reason})` : ""}`, noun: ["capability", "capabilities"] });
    warnings.push({ code: "session-provider-sandbox-skipped", message: `no sandbox host was taken for ${names}` });
  }
  return { problems, warnings };
}

/** What the provider added to the home's sandbox at its last launch, with who asked for
 *  each entry: readiness lists it (contract item 6). → warnings; none before a first
 *  launch. In full mode nothing was added, and the one thing said is which hosts the
 *  deployment lacked at that launch. */
export function sandboxWarnings(home, { planned = false } = {}) {
  let current, launched;
  try { current = currentSandbox(home); launched = readLaunchRecord(home); }
  catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return [{ code: "session-provider-sandbox-unread", message: "what the provider added to this home's sandbox could not be read: its record or .claude/settings.local.json in the home is not what the provider wrote. The next launch refuses or rewrites it" }];
  }
  const warnings = [];
  if (!planned && launched && launched.mode !== null && launched.mode !== "full" && !launched.sandboxGiven) {
    // A kernel that hands a launch no sandbox allowances: bb's sandbox then blocks OATS's
    // own commands, and nothing in the home says so but this.
    warnings.push({ code: "session-provider-sandbox-missing", message: `this home runs in bb's ${launched.mode} mode, and its launch carried no sandbox allowances: bb's sandbox blocks the agent's aw (no network to the messaging server) and oats instance attention (no write to the deployment's events). Run it in full mode (--yolo), or on a kernel that hands the launch its allowances` });
  }
  if (!planned && launched && launched.mode === "full" && launched.missing.length + launched.unnamed > 0) {
    // Only a full-mode launch records a gap (a sandboxed one is refused before any record).
    warnings.push({ code: "session-provider-sandbox-host-missing", message: `at this home's last launch the deployment recorded no host for some of what a sandbox would need. That launch ran in full mode, which has no sandbox; a launch in auto or accept-edits is refused. ${missingRemedy(launched.missing)}. Missing: ${gapList(launched.missing, launched.unnamed)}` });
  }
  if (!planned && launched && (launched.mode === "auto" || launched.mode === "accept-edits") && launched.otherTeams.length + launched.unnamedOtherTeams > 0) {
    warnings.push(otherTeamsWarning(launched.mode, launched.otherTeams, launched.unnamedOtherTeams));
  }
  if (current.domains.length > 0 || current.write.length > 0) {
    const hosts = current.domains.map((entry) => `${entry.host} (${entry.capability}${entry.setting ? `, its setting ${entry.setting}` : ""})`);
    const paths = current.write.map((entry) => `${entry.path} (the kernel)`);
    warnings.push({ code: "session-provider-sandbox", message: `in bb's sandboxed modes this home's Claude may also reach ${hosts.length ? hosts.join(", ") : "no added host"} and write ${paths.length ? paths.join(", ") : "no added path"}: what OATS's own operation needs, written by the provider into the home's .claude/settings.local.json at launch` });
    const forges = current.domains.filter((entry) => GENERAL_FORGES.has(entry.host.split(":")[0]));
    if (forges.length > 0) {
      warnings.push({ code: "session-provider-sandbox-forge", message: `${forges.map((entry) => `${entry.host} (${entry.capability})`).join(", ")} ${forges.length > 1 ? "are general forges" : "is a general forge"}: allowing it opens every repository there to this agent's commands, not only the one it was allowed for` });
    }
  }
  if (current.mismatch > 0) {
    // The home is writable by its own agent: say that the two disagree, and print nothing
    // of what either holds beyond what passed the checks above.
    warnings.push({ code: "session-provider-sandbox-mismatch", message: `${current.mismatch} entr${current.mismatch > 1 ? "ies" : "y"} of the provider's sandbox record in this home ${current.mismatch > 1 ? "are" : "is"} not in .claude/settings.local.json, or not an exact host or path: the record or the file was changed after the launch. Read the file itself for what the sandbox allows now; the next launch rewrites both` });
  }
  return warnings;
}
