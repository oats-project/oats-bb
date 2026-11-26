// Readiness of an instance or of its soul (`oats readiness`): the kernel's own observations, never
// launch permission. The summary up front; the four checks with their items, a provider's own
// answer, the capability warnings and the policy behind a fold. Read once when first shown and
// again on Refresh readiness: a tab turned back to shows what was read (read.ts). As the OATS Desktop's readiness view
// (packages/desktop/renderer/readiness-view.mjs, compact).
import { useEffect, useRef, useState } from "react";
import type { PanelReadiness } from "../../kernel/panel-readiness";
import { Button, Disclosure, Fact, Facts, Section, Toned } from "../ui";
import { FRESH_MS, readAge, showingRead } from "../ui/words";
import { shown } from "../ui/text";
import { usePanelReadiness } from "./read";
import {
  CHECKS_AND_POLICY, CHECKS_PLAIN, LOADING, NOT_PERMISSION, NO_ITEMS, POLICY_NOTE, REFRESH, REFRESHING, SIGN_IN_HOW, TITLE, VIEW_POLICY, checkLabel, checkState, checkTone, contextLabel, itemFacts,
  itemLine, itemOpens, itemProblems, itemTone, observedLine, policyLine, providerSays, signIn, summaryLine, warningLine,
} from "./readiness-words";
import { PathText } from "./parts";
import { CommandState, mendable, offersRetry } from "./state";
import { Warnings } from "./Warnings";

/** A word with the mark of its tone; plainly when it has none. */
function Said({ tone, children }: { tone: "bad" | "warn" | null; children: string }) {
  return tone === null ? <>{children}</> : <Toned tone={tone}>{children}</Toned>;
}

/** What was observed: the instance's or the soul's name, and the agents root. */
type Context = { name: string; root: string };

function Checks({ readiness, of, context, now }: { readiness: PanelReadiness; of: "instance" | "soul"; context: Context | null; now: number }) {
  return (
    <>
      {context === null ? null : (
        // The path breaks between its segments, never inside a name.
        <p data-testid="oats-panel-readiness-context" className="m-0 break-words text-xs text-muted-foreground">
          {contextLabel(of, context.name)}
          <PathText path={context.root} />
        </p>
      )}
      {/* In a person's words first; then the kernel's own sentences, as the Desktop says them. */}
      <p data-testid="oats-panel-readiness-plain" className="m-0 text-foreground">
        {CHECKS_PLAIN}
      </p>
      <p className="m-0 text-xs text-muted-foreground">{NOT_PERMISSION}</p>
      <p title={readiness.at === null ? undefined : shown(readiness.at)} className="m-0 break-words text-xs text-muted-foreground">
        {observedLine(readiness.at, of, now)}
      </p>
      {readiness.checks.map((check) => (
        <div key={check.key} data-testid={`oats-panel-check-${check.key}`} className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <strong className="text-foreground">{checkLabel(check.key)}</strong>
            <span data-testid="oats-panel-check-state" className={`text-xs ${checkTone(check) === null ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
              <Said tone={checkTone(check)}>{checkState(check)}</Said>
            </span>
          </div>
          {check.items.length === 0 ? <p className="m-0 text-xs text-muted-foreground">{NO_ITEMS}</p> : null}
          {check.items.map((item, index) =>
            // An item with nothing more to say is a line, not a fold that opens on nothing.
            !itemOpens(item) ? (
              <p key={index} data-testid="oats-panel-check-item" className="m-0 break-words text-xs text-muted-foreground">
                {itemLine(item)}
              </p>
            ) : (
            <Disclosure key={index} summary={itemLine(item)} testId="oats-panel-check-item">
              <Facts>
                {itemFacts(item).map((fact, at) => (
                  <Fact key={at} label={fact.label} {...(fact.whole === null ? {} : { title: fact.whole })}>
                    {fact.value}
                  </Fact>
                ))}
              </Facts>
              {item.provider === null ? null : (
                <p className="m-0 text-foreground">
                  <Said tone={itemTone(item)}>{providerSays(item.provider.status)}</Said>
                </p>
              )}
              {signIn(item) ? <p className="m-0 text-foreground">{SIGN_IN_HOW}</p> : null}
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
            ),
          )}
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

/** `context` names what was observed, once it is known. */
export function Readiness({ instance, of, context, now, unread }: { instance: string; of: "instance" | "soul"; context: Context | null; now: number; /** the roster cannot be read: no act of this part's own (state.tsx `CommandState`) */ unread: boolean }) {
  const read = usePanelReadiness(instance, of);
  // A person's Refresh says what it does while it reads: "Refreshing…". What it read then stands in its place.
  const [refreshing, setRefreshing] = useState(false);
  const wasFetching = useRef(false);
  useEffect(() => {
    if (wasFetching.current && !read.fetching) setRefreshing(false);
    wasFetching.current = read.fetching;
  }, [read.fetching]);
  // OATS has no readiness check for this kind of agent: there is nothing to show, and the block is not drawn.
  if (read.status === "error" && !mendable(read, "readiness")) return null;
  return (
    <Section title={TITLE} testId={`oats-panel-readiness-${of}`}>
      <CommandState read={read} of="readiness" reading={LOADING} failed="Readiness could not be read" at={read.data?.at ?? null} now={now} unread={unread} />
      {read.data === undefined ? null : (
        <>
          <p data-testid="oats-panel-readiness-summary" className="m-0 font-semibold text-foreground">
            <Said tone={read.data.summary.ready ? null : read.data.summary.fail > 0 ? "bad" : "warn"}>{summaryLine(read.data.summary)}</Said>
          </p>
          <Disclosure summary={CHECKS_AND_POLICY} testId="oats-panel-readiness-checks">
            <Checks readiness={read.data} of={of} context={context} now={now} />
          </Disclosure>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* One act at a time: while the first read runs the line above says so, and after a failure that reading again can
            change, the notice's Retry is the act.
            Over what is shown the button is off while a read runs, and the words beside it say why. */}
        {(read.fetching && read.data === undefined) || offersRetry(read, "readiness") ? null : (
          <Button
            data-testid="oats-panel-readiness-refresh"
            disabled={read.fetching || unread}
            onClick={() => {
              setRefreshing(true);
              read.retry();
            }}
          >
            {REFRESH}
          </Button>
        )}
        {!refreshing || read.data === undefined ? null : (
          <span role="status" data-testid="oats-panel-readiness-status" className="text-xs text-muted-foreground">
            {REFRESHING}
          </span>
        )}
        {/* It is read once for the window, and again only on Refresh: once what is shown is older than a minute, how old it
            is, in the plugin's one form for content read earlier ("Ready" of two hours ago is not "Ready" now). Nothing
            while it is fresh, while it is read again, or under the notice of a read that failed (which says the age). */}
        {refreshing || read.fetching || read.status !== "ready" || read.readAt === null || now - read.readAt < FRESH_MS ? null : (
          <span data-testid="oats-panel-readiness-read" className="text-xs text-muted-foreground">
            {showingRead(readAge(read.readAt, now))}
          </span>
        )}
      </div>
    </Section>
  );
}
