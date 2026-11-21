// Readiness of an instance or of its soul (`oats readiness`): the kernel's own observations, never
// launch permission. The summary up front; the four checks with their items, a provider's own
// answer, the capability warnings and the policy behind a fold. Read when shown and again on
// Refresh readiness, never in the background. As the OATS Desktop's readiness view
// (packages/desktop/renderer/readiness-view.mjs, compact).
import type { PanelReadiness } from "../../kernel/panel-readiness";
import { Button, Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import { usePanelReadiness } from "./read";
import {
  CHECKS_AND_POLICY, LOADING, NOT_PERMISSION, NO_ITEMS, POLICY_NOTE, REFRESH, TITLE, VIEW_POLICY, checkLabel, checkState, itemFacts, itemLine, itemProblems, observedLine, policyLine, providerSays,
  summaryLine, warningLine,
} from "./readiness-words";
import { CommandState } from "./state";

function Checks({ readiness }: { readiness: PanelReadiness }) {
  return (
    <>
      <p className="m-0 text-xs text-muted-foreground">{NOT_PERMISSION}</p>
      <p className="m-0 break-words text-xs text-muted-foreground">{shown(observedLine(readiness.at))}</p>
      {readiness.checks.map((check) => (
        <div key={check.key} data-testid={`oats-panel-check-${check.key}`} className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <strong className="text-foreground">{checkLabel(check.key)}</strong>
            <span className="text-xs text-muted-foreground">{shown(checkState(check))}</span>
          </div>
          {check.items.length === 0 ? <p className="m-0 text-xs text-muted-foreground">{NO_ITEMS}</p> : null}
          {check.items.map((item, index) => (
            <Disclosure key={index} summary={shown(itemLine(item))} testId="oats-panel-check-item">
              <Facts>
                {itemFacts(item).map((fact, at) => (
                  <Fact key={at} label={fact.label}>
                    {shown(fact.value)}
                  </Fact>
                ))}
              </Facts>
              {item.provider === null ? null : <p className="m-0 text-foreground">{shown(providerSays(item.provider.status))}</p>}
              {(item.provider?.warnings ?? []).map((warning, at) => (
                <p key={at} className="m-0 break-words text-xs text-muted-foreground">
                  {shown(warningLine(warning))}
                </p>
              ))}
              {itemProblems(item).map((problem, at) => (
                <p key={at} className="m-0 break-words text-xs text-foreground">
                  {shown(problem)}
                </p>
              ))}
            </Disclosure>
          ))}
        </div>
      ))}
      {readiness.warnings.length === 0 ? null : (
        <div data-testid="oats-panel-readiness-warnings" className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
          <strong className="text-foreground">Warnings</strong>
          {readiness.warnings.map((warning, index) => (
            <p key={index} className="m-0 break-words text-xs text-foreground">
              {shown([warning.capability, warning.message].filter((part) => part !== null).join(": "))}
              {warning.code === null ? null : <span className="text-muted-foreground">{` (${shown(warning.code)})`}</span>}
            </p>
          ))}
        </div>
      )}
      {readiness.policy === null ? null : (
        <Disclosure summary={VIEW_POLICY} testId="oats-panel-policy">
          <p className="m-0 text-xs text-muted-foreground">{POLICY_NOTE}</p>
          {readiness.policy.map((policy) => (
            <p key={policy.key} className="m-0 break-words text-xs text-foreground">
              {shown(policyLine(policy))}
            </p>
          ))}
        </Disclosure>
      )}
      {readiness.notes.map((note, index) => (
        <p key={index} className="m-0 break-words text-xs text-muted-foreground">
          {shown(note)}
        </p>
      ))}
    </>
  );
}

export function Readiness({ instance, of }: { instance: string; of: "instance" | "soul" }) {
  const read = usePanelReadiness(instance, of);
  return (
    <Section title={TITLE[of]} testId={`oats-panel-readiness-${of}`}>
      <CommandState read={read} reading={LOADING} failed="Readiness could not be read" />
      {read.data === undefined ? null : (
        <>
          <p data-testid="oats-panel-readiness-summary" className="m-0 font-semibold text-foreground">
            {summaryLine(read.data.summary)}
          </p>
          <Disclosure summary={CHECKS_AND_POLICY} testId="oats-panel-readiness-checks">
            <Checks readiness={read.data} />
          </Disclosure>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="oats-panel-readiness-refresh" disabled={read.fetching} onClick={read.retry}>
          {REFRESH}
        </Button>
      </div>
    </Section>
  );
}
