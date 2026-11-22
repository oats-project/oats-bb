// Readiness of an instance or of its soul (`oats readiness`): the kernel's own observations, never
// launch permission. The summary up front; the four checks with their items, a provider's own
// answer, the capability warnings and the policy behind a fold. Read once when first shown and
// again on Refresh readiness: a tab turned back to shows what was read (read.ts). As the OATS Desktop's readiness view
// (packages/desktop/renderer/readiness-view.mjs, compact).
import { useEffect, useRef, useState } from "react";
import type { PanelReadiness } from "../../kernel/panel-readiness";
import { Button, Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import { usePanelReadiness } from "./read";
import {
  CHECKS_AND_POLICY, LOADING, NOT_PERMISSION, NO_ITEMS, POLICY_NOTE, REFRESH, REFRESHING, TITLE, UPDATED, VIEW_POLICY, checkLabel, checkState, itemFacts, itemLine, itemProblems, observedLine,
  policyLine, providerSays, summaryLine, warningLine,
} from "./readiness-words";
import { CommandState } from "./state";
import { Warnings } from "./Warnings";

function Checks({ readiness, of, context }: { readiness: PanelReadiness; of: "instance" | "soul"; context: string | null }) {
  return (
    <>
      {context === null ? null : (
        <p data-testid="oats-panel-readiness-context" className="m-0 break-all text-xs text-muted-foreground">
          {context}
        </p>
      )}
      <p className="m-0 text-xs text-muted-foreground">{NOT_PERMISSION}</p>
      <p className="m-0 break-words text-xs text-muted-foreground">{observedLine(readiness.at, of)}</p>
      {readiness.checks.map((check) => (
        <div key={check.key} data-testid={`oats-panel-check-${check.key}`} className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <strong className="text-foreground">{checkLabel(check.key)}</strong>
            <span className="text-xs text-muted-foreground">{checkState(check)}</span>
          </div>
          {check.items.length === 0 ? <p className="m-0 text-xs text-muted-foreground">{NO_ITEMS}</p> : null}
          {check.items.map((item, index) => (
            <Disclosure key={index} summary={itemLine(item)} testId="oats-panel-check-item">
              <Facts>
                {itemFacts(item).map((fact, at) => (
                  <Fact key={at} label={fact.label}>
                    {fact.value}
                  </Fact>
                ))}
              </Facts>
              {item.provider === null ? null : <p className="m-0 text-foreground">{providerSays(item.provider.status)}</p>}
              {(item.provider?.warnings ?? []).map((warning, at) => (
                <p key={at} className="m-0 break-words text-xs text-muted-foreground">
                  {warningLine(warning)}
                </p>
              ))}
              {itemProblems(item).map((problem, at) => (
                <p key={at} className="m-0 break-words text-xs text-foreground">
                  {problem}
                </p>
              ))}
            </Disclosure>
          ))}
        </div>
      ))}
      <Warnings warnings={readiness.warnings} testId={`oats-panel-readiness-warnings-${of}`} />
      {readiness.policy === null ? null : (
        <Disclosure summary={VIEW_POLICY} testId="oats-panel-policy">
          <p className="m-0 text-xs text-muted-foreground">{POLICY_NOTE}</p>
          {readiness.policy.map((policy) => (
            <p key={policy.key} className="m-0 break-words text-xs text-foreground">
              {policyLine(policy)}
            </p>
          ))}
        </Disclosure>
      )}
      {readiness.notes
        .map((note) => shown(note))
        .filter((note) => note !== "")
        .map((note, index) => (
          <p key={index} className="m-0 break-words text-xs text-muted-foreground">
            {note}
          </p>
        ))}
    </>
  );
}

/** `context` is the line that names what was observed (readiness-words.ts `contextLine`), once it is known. */
export function Readiness({ instance, of, context, now }: { instance: string; of: "instance" | "soul"; context: string | null; now: number }) {
  const read = usePanelReadiness(instance, of);
  // A person's Refresh says what it does: "Refreshing…" while it reads, then that it is updated.
  const [refreshed, setRefreshed] = useState<"no" | "reading" | "updated">("no");
  const wasFetching = useRef(false);
  useEffect(() => {
    if (wasFetching.current && !read.fetching && refreshed === "reading") setRefreshed(read.status === "ready" ? "updated" : "no");
    wasFetching.current = read.fetching;
  }, [read.fetching, read.status, refreshed]);
  return (
    <Section title={TITLE[of]} testId={`oats-panel-readiness-${of}`}>
      <CommandState read={read} of="readiness" reading={LOADING} failed="Readiness could not be read" at={read.data?.at ?? null} now={now} />
      {read.data === undefined ? null : (
        <>
          <p data-testid="oats-panel-readiness-summary" className="m-0 font-semibold text-foreground">
            {summaryLine(read.data.summary)}
          </p>
          <Disclosure summary={CHECKS_AND_POLICY} testId="oats-panel-readiness-checks">
            <Checks readiness={read.data} of={of} context={context} />
          </Disclosure>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="oats-panel-readiness-refresh"
          disabled={read.fetching}
          onClick={() => {
            setRefreshed("reading");
            read.retry();
          }}
        >
          {REFRESH}
        </Button>
        {refreshed === "no" || read.data === undefined ? null : (
          <span role="status" data-testid="oats-panel-readiness-status" className="text-xs text-muted-foreground">
            {refreshed === "reading" ? REFRESHING : UPDATED}
          </span>
        )}
      </div>
    </Section>
  );
}
