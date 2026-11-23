// From what the kernel printed during the real run to the files of test/fixtures/<feature>/: the same JSON
// document, printed with one space of indentation like the other fixtures, with two substitutions
// and no other edit:
//   - paths: the deployment directory is /abs/deployment, the run's own directory /abs/real, and
//     the container user's home /abs/home;
//   - the container's host name is "machine" (the kernel's answers recorded so far hold none).
// Everything else stays as recorded: bb's thread and project ids, start ids, plan and decision
// revisions, commit ids, times, byte counts. No field is added, removed or reordered.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class Fixtures {
  #out;
  #substitutions;
  #kept = [];

  /** `substitutions`: [recorded, written] pairs, applied in this order (a longer path before its prefix). */
  constructor({ out, substitutions }) {
    this.#out = out;
    this.#substitutions = substitutions.filter(([recorded]) => recorded !== "");
  }

  #written(value) {
    let out = JSON.stringify(value, null, 1);
    for (const [recorded, written] of this.#substitutions) out = out.replaceAll(recorded, written);
    return `${out}\n`;
  }

  /** Keeps what the kernel printed, to be written as `file`. */
  keep(file, text) {
    this.#kept.push({ file, value: JSON.parse(text), bytes: text.length });
  }

  /** Keeps what the kernel printed as the member `key` of the one object written as `file`. */
  keepIn(file, key, text) {
    let entry = this.#kept.find((kept) => kept.file === file);
    if (entry === undefined) {
      entry = { file, value: {}, bytes: 0 };
      this.#kept.push(entry);
    }
    entry.value[key] = JSON.parse(text);
    entry.bytes += text.length;
  }

  /** What was kept for `file`, as the kernel printed it (before the substitutions). */
  kept(file) {
    const entry = this.#kept.find((kept) => kept.file === file);
    if (entry === undefined) throw new Error(`fixtures: nothing was kept for ${file}`);
    return entry.value;
  }

  /** Writes every kept answer. → one line per file. */
  write() {
    return this.#kept.map(({ file, value, bytes }) => {
      // `file` is `<feature>/<name>.json`, as test/fixtures/ holds it.
      mkdirSync(dirname(join(this.#out, file)), { recursive: true });
      writeFileSync(join(this.#out, file), this.#written(value));
      return `${file} (${bytes} bytes as printed)`;
    });
  }
}

/** The fields of a status row that the session side decides: the backend, the thread, and whether it runs. */
export const SESSION_FIELDS = ["backend", "tmux", "session", "open", "running", "runtimeState", "runtimeError", "sessionEnd"];

/**
 * test/fixtures/roster/status.json is the design's sample (its agents, parents, identities and claims are
 * not this run's). This gives each of its bb rows the session-side fields of a row the real kernel
 * printed for an agent in the same state: working (SAMPLE_WORKING), idle, or stopped by OATS. The sample's own thread
 * id, and the project of that thread in threads.json, take the place of the recorded ones; a field
 * the real row does not have is removed. Nothing else of the sample changes.
 * `recorded`: the status documents by state, as status-recorded.json holds them.
 */
/**
 * The sample's agents that WORK, by instance: the two whose threads bb's fixture (threads.json)
 * calls active. Named, never read from a row's `running`: a provider answers `running: true` for
 * an idle agent whose harness is loaded, so after a re-record that field no longer tells the two
 * apart.
 */
export const SAMPLE_WORKING = ["redesign-ui-lead", "desktop-mockups-developer"];

export function sampleStatus(sampleText, threadsText, recorded) {
  const sample = JSON.parse(sampleText);
  const { threads } = JSON.parse(threadsText);
  const firstRow = (document) => document.agents[0].instances[0];
  const real = { working: firstRow(recorded.working), idle: firstRow(recorded.idle), stopped: firstRow(recorded.stoppedByOats) };
  for (const group of sample.agents) {
    for (const row of group.instances) {
      if (row.backend !== "bb") continue;
      const threadId = row.session.threadId;
      const works = SAMPLE_WORKING.includes(row.instance);
      // The sample and bb's fixture must agree on who works: a working agent's thread has a turn running.
      const status = threads.find((thread) => thread.id === threadId)?.status;
      if (works !== (status === "active")) throw new Error(`fixtures: the sample's ${row.instance} ${works ? "works" : "does not work"}, and threads.json says its thread ${threadId} is ${JSON.stringify(status)}`);
      const from = row.runtimeState === "stopped" ? real.stopped : works ? real.working : real.idle;
      const projectId = threads.find((thread) => thread.id === threadId)?.projectId;
      if (projectId === undefined) throw new Error(`fixtures: threads.json has no thread ${threadId} for the sample's ${row.instance}`);
      const recordedProject = /\/projects\/([^/]+)\//.exec(firstRow(recorded.working).open.url)[1];
      for (const field of SESSION_FIELDS) {
        if (!(field in from)) {
          delete row[field];
          continue;
        }
        row[field] = JSON.parse(JSON.stringify(from[field]).replaceAll(from.session.threadId, threadId).replaceAll(recordedProject, projectId));
      }
    }
  }
  return JSON.stringify(sample);
}
