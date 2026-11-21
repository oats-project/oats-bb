// `oats readiness (--home <abs> | --soul <name>) --policy --json`: the kernel's own observations of
// whether an instance or a soul is ready (docs/desktop-cli-api.md "oats readiness", `readinessApi: 2`),
// read into what the panel's Readiness section draws: the four checks with their items, a provider's
// own answer as it gave it, the capability warnings and the policy. As the OATS Desktop shows them
// (packages/desktop/renderer/readiness-view.mjs at awebai/oats 95c7b43b). These are observations,
// never launch permission.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome, checkSoul } from "./input.js";
import { panelWarning, record, rows, text, warningsOf, type Row } from "./panel-read.js";
import { memberLabel } from "./panel-soul.js";
import { ok, type Result } from "./result.js";

/** The four checks, in the order they are shown. */
export const CHECKS = ["installed", "configured", "member", "providers"] as const;

const coded = z.object({ code: z.string().nullable(), message: z.string() });
export const panelReadinessItem = z.object({
  subject: z.string(),
  status: z.string(),
  required: z.boolean(),
  producer: z.string().nullable(),
  reason: z.string().nullable(),
  code: z.string().nullable(),
  /** where the item is declared (the kernel's `at`), and the configuration file a check read */
  at: z.string().nullable(),
  file: z.string().nullable(),
  /** the item's evidence as name and text; a module's origin is `Origin` */
  evidence: z.array(z.object({ name: z.string(), value: z.string() })),
  remedy: z.string().nullable(),
  /** a provider's own answer to its binding check */
  provider: z.object({ status: z.string(), problems: z.array(coded), warnings: z.array(coded) }).nullable(),
  problems: z.array(coded),
});
export const panelReadiness = z.object({
  at: z.string().nullable(),
  summary: z.object({ ready: z.boolean(), required: z.number().int(), fail: z.number().int(), unknown: z.number().int() }),
  checks: z.array(z.object({ key: z.enum(CHECKS), status: z.string(), items: z.array(panelReadinessItem) })),
  warnings: z.array(panelWarning),
  /** null: the kernel answered no policy */
  policy: z
    .array(
      z.object({
        key: z.string(),
        /** null: unknown */
        allowed: z.boolean().nullable(),
        enforced: z.boolean(),
        origin: z.string(),
        detail: z.string().nullable(),
        mode: z.string().nullable(),
      }),
    )
    .nullable(),
  notes: z.array(z.string()),
});
export type PanelReadiness = z.output<typeof panelReadiness>;
export type PanelReadinessItem = z.output<typeof panelReadinessItem>;

export function panelReadinessArgv(home: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["readiness", "--home", checked.value, "--policy", "--json"]) : checked;
}
/** `soul` must be a soul key `oats souls` lists: nothing else reaches the argv. */
export function panelSoulReadinessArgv(soul: string, known: readonly string[]): Result<string[]> {
  const checked = checkSoul(soul, known);
  return checked.ok ? ok(["readiness", "--soul", checked.value, "--policy", "--json"]) : checked;
}

const count = z.number().int().min(0);

const check = z.looseObject({ status: z.string().min(1), items: z.array(z.looseObject({ subject: z.string(), status: z.string().min(1) })) });
const answer = z.looseObject({
  readinessApi: z.literal(2),
  checks: z.looseObject({ installed: check, configured: check, member: check, providers: check }),
  summary: z.looseObject({ ready: z.boolean(), required: count, fail: count, unknown: count }),
});

const shortCommit = (value: unknown): string | null => (typeof value === "string" && /^[0-9a-f]{7,64}$/.test(value) ? value.slice(0, 7) : null);
/** A module's origin in one line: a package at its version and commit, or a member repository at its commit. */
export function originText(value: unknown): string {
  const from = record(value);
  if (from === null) return "Not reported";
  const commit = shortCommit(from.commit);
  const at = commit === null ? "" : ` @ ${commit}`;
  if (from.kind === "package") return `${`package ${text(from.package) ?? "?"} ${text(from.version) ?? ""}`.trimEnd()}${at}`;
  if (from.kind === "member") return `member ${memberLabel(text(from.repoKey) ?? "")}${at}`;
  return text(from.kind) ?? "—";
}

const codedRows = (value: unknown): { code: string | null; message: string }[] =>
  rows(value)
    .filter((row) => text(row.message) !== null)
    .map((row) => ({ code: text(row.code), message: row.message as string }));

function itemOf(item: Row & { subject: string; status: string }): PanelReadinessItem {
  const evidence: PanelReadinessItem["evidence"] = [];
  for (const [name, value] of Object.entries(record(item.evidence) ?? {})) {
    if (name === "from") evidence.push({ name: "Origin", value: originText(value) });
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") evidence.push({ name, value: String(value) });
  }
  const result = record(item.result);
  const status = result === null ? null : text(result.status);
  return {
    subject: item.subject,
    status: item.status,
    required: item.required === true,
    producer: text(item.producer),
    reason: text(item.reason),
    code: text(item.code),
    at: text(item.at),
    file: text(item.file),
    evidence,
    remedy: text(item.remedy),
    provider: result === null || status === null ? null : { status, problems: codedRows(result.problems), warnings: codedRows(result.warnings) },
    problems: codedRows(item.problems),
  };
}

export function parsePanelReadiness(document: unknown): Result<PanelReadiness> {
  const parsed = shaped(answer, document, "oats readiness");
  if (!parsed.ok) return parsed;
  const value = parsed.value as z.output<typeof answer> & Row;
  const policy = record(value.policy);
  return ok({
    at: text(value.at),
    summary: { ready: value.summary.ready, required: value.summary.required, fail: value.summary.fail, unknown: value.summary.unknown },
    checks: CHECKS.map((key) => ({ key, status: value.checks[key].status, items: value.checks[key].items.map(itemOf) })),
    warnings: warningsOf(value.warnings),
    policy:
      policy === null
        ? null
        : Object.entries(policy).flatMap(([key, entry]) => {
            const row = record(entry);
            const origin = row === null ? null : record(row.origin);
            if (row === null) return [];
            return [{ key, allowed: typeof row.allowed === "boolean" ? row.allowed : null, enforced: row.enforced === true, origin: text(origin?.kind) ?? "unknown", detail: text(origin?.detail), mode: text(row.mode) }];
          }),
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string" && note !== "") : [],
  });
}
