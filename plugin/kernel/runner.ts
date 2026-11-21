// Runs one `oats` command for a feature's verb: the argv it built, run (kernel/run.ts), and the
// answer read with its schema into the plugin's types. No bb and no React import.
import { answerOf, type AnswerOptions } from "./envelope.js";
import type { Result } from "./result.js";
import type { Processes } from "./run.js";

/** How long each verb may run before it is stopped. */
export type Timeouts = { read: number; preview: number; act: number; long: number };
export const timeouts: Timeouts = {
  /** The spec's limit for `oats status`; the other reads share it. */
  read: 20_000,
  /** The kernel gives a preview's own checks 20 s. */
  preview: 45_000,
  /** A stop waits for the harness to exit; a start launches one. */
  act: 120_000,
  /** A spawn or a retire runs the capabilities' hooks; the host RPC cap is 30 minutes. */
  long: 25 * 60_000,
};

export type OatsOptions = {
  /** The binary: an absolute path, or `oats` to be found on PATH. */
  bin: string;
  /** The deployment directory: every `oats` runs with it as its cwd. */
  cwd: string;
  processes: Processes;
  env?: NodeJS.ProcessEnv;
  /** Overrides the limits above; tests use it. */
  timeouts?: Partial<Timeouts>;
};

export class Runner {
  readonly #options: OatsOptions;
  readonly timeouts: Timeouts;

  constructor(options: OatsOptions) {
    this.#options = options;
    this.timeouts = { ...timeouts, ...options.timeouts };
  }

  /** `argv` is the command's words, or the refusal of an input: a refused one starts no process. */
  async run<Value>(
    argv: Result<string[]> | string[],
    parse: (document: unknown) => Result<Value>,
    timeoutMs: number,
    signal?: AbortSignal,
    options: AnswerOptions = {},
  ): Promise<Result<Value>> {
    const checked: Result<string[]> = Array.isArray(argv) ? { ok: true, value: argv } : argv;
    if (!checked.ok) return checked; // refused before any process starts
    const { bin, cwd, processes, env } = this.#options;
    const outcome = await processes.run({ bin, argv: checked.value, cwd, timeoutMs, signal, env });
    const document = answerOf(outcome, bin, options);
    return document.ok ? parse(document.value) : document;
  }
}
