// An instance's recorded lifecycle activity (`oats instance events`): read only when a person asks
// (Load activity), read again on Refresh activity, never in the background. Address history as
// the kernel recorded it, never the current runtime state. As the OATS Desktop's "Reported
// lifecycle activity" (packages/desktop/renderer/instance-events-view.mjs).
import { useState } from "react";
import type { PanelEvents } from "../../kernel/panel-events";
import { Button, Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import {
  ACTIVITY, HISTORY_PLAIN, LAST_OBSERVATION, LOAD, LOADED, NO_EVENTS, PROVENANCE, PROVENANCE_PLAIN, READING, RECENT, REFRESH, claimLine, differedLines, eventFacts, eventTitle, incomplete, incompleteLine, producerLine, setupLine,
  sourcesLine, summaryLine, windowLine,
} from "./events-words";
import { usePanelEvents } from "./read";
import { CommandState } from "./state";
import { whenText } from "./words";

function Events({ events, now }: { events: PanelEvents; now: number }) {
  return (
    <>
      <p data-testid="oats-panel-activity-summary" className="m-0 break-words text-foreground">
        {summaryLine(events, now)}
      </p>
      <Disclosure summary={RECENT} testId="oats-panel-activity-list">
        {/* In a person's words first; then the kernel's own sentence for it, as the Desktop says it. */}
        <p data-testid="oats-panel-activity-plain" className="m-0 text-foreground">
          {HISTORY_PLAIN}
        </p>
        <p className="m-0 text-xs text-muted-foreground">{windowLine(events)}</p>
        {incomplete(events) ? (
          <p data-testid="oats-panel-activity-incomplete" className="m-0 text-xs font-semibold text-foreground">
            {incompleteLine(events)}
          </p>
        ) : null}
        <p className="m-0 break-words text-xs text-muted-foreground">{sourcesLine(events)}</p>
        {events.waitingClaims.length === 0 ? null : (
          <ul data-testid="oats-panel-activity-claims" className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-foreground">
            {events.waitingClaims.map((claim) => (
              <li key={claim.producer} title={shown(claim.since)}>
                {claimLine(claim, now)}
              </li>
            ))}
          </ul>
        )}
        {events.events.length === 0 ? (
          <p data-testid="oats-panel-activity-none" className="m-0 text-muted-foreground">
            {NO_EVENTS}
          </p>
        ) : null}
        {/* Newest first. */}
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {[...events.events].reverse().map((event, index) => {
            const differed = event.differed === null ? null : differedLines(event.differed);
            return (
              <li key={index} data-testid="oats-panel-event" className="flex min-w-0 flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <strong className="text-foreground">{eventTitle(event.kind)}</strong>
                {/* The plugin's one form for an instant; the kernel's own text of it is the title. */}
                <time dateTime={event.at} title={shown(event.at)} className="text-xs tabular-nums text-muted-foreground">
                  {whenText(event.at, now)}
                </time>
                <span className="text-xs text-muted-foreground">{producerLine(event)}</span>
                <Facts>
                  {eventFacts(event).map((fact) => (
                    <Fact key={fact.label} label={fact.label}>
                      {fact.value}
                    </Fact>
                  ))}
                  {event.setup === null ? null : (
                    <Fact label="Setup">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {event.setup.map((hook, at) => (
                          <span key={at} className="flex min-w-0 flex-col">
                            <span>{setupLine(hook)}</span>
                            {hook.log === null ? null : <span className="break-all text-xs text-muted-foreground">{shown(hook.log)}</span>}
                          </span>
                        ))}
                      </span>
                    </Fact>
                  )}
                </Facts>
                {differed === null ? null : (
                  // What the terminal showed is quoted under the words that say whose text it is, never inside a sentence of the plugin's.
                  <div data-testid="oats-panel-event-differed" className="flex min-w-0 flex-col gap-1">
                    <span className="text-foreground">{differed.leadIn}</span>
                    {differed.lines.map((line) => (
                      <span key={line.leadIn} className="flex min-w-0 flex-col">
                        <span className="text-xs text-muted-foreground">{line.leadIn}</span>
                        <span className="break-all border-l-2 border-border pl-2 font-mono text-xs text-foreground">{line.text}</span>
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">{differed.detail}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="m-0 text-xs text-foreground">{PROVENANCE_PLAIN}</p>
        <p className="m-0 text-xs text-muted-foreground">{PROVENANCE}</p>
      </Disclosure>
    </>
  );
}

export function Activity({ instance, now }: { instance: string; now: number }) {
  // Whether a person asked for a read since this section came on the page. The section leaves the
  // page when its tab turns and what was read stays with bb: coming back reads nothing, and shows
  // it as what it is, the last observation, with Refresh activity.
  const [asked, setAsked] = useState(false);
  // The read is on only while it holds no answer (read.ts), so asking with one held starts nothing by itself.
  const read = usePanelEvents(instance, asked);
  const held = read.data !== undefined;
  const ask = () => {
    if (asked || held) read.retry();
    setAsked(true);
  };
  return (
    <Section title={ACTIVITY} testId="oats-panel-activity">
      {/* Nothing is read until a person asks: the kernel reads two logs for it. */}
      {asked ? <CommandState read={read} of="activity" reading={READING} failed="The recorded activity could not be read" now={now} /> : null}
      {read.data === undefined ? null : <Events events={read.data} now={now} />}
      <div className="flex flex-wrap items-center gap-2">
        {/* One act at a time: while the first read runs the line above says so, and after a failure its Retry is the act.
            Over what is shown the button is off while a read runs, and the words beside it say why. */}
        {(read.fetching && !held) || (asked && read.status === "error") ? null : (
          <Button data-testid="oats-panel-activity-load" disabled={read.fetching} onClick={ask}>
            {held || asked ? REFRESH : LOAD}
          </Button>
        )}
        {/* A read again over what is shown says so, in the words of the first read; after a failed one the line above says it. */}
        {held && (read.fetching ? read.status === "ready" : !asked || read.status === "ready") ? (
          <span role="status" data-testid="oats-panel-activity-status" className="text-xs text-muted-foreground">
            {read.fetching ? READING : asked ? LOADED : LAST_OBSERVATION}
          </span>
        ) : null}
      </div>
    </Section>
  );
}
