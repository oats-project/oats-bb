// An instance's recorded lifecycle activity (`oats instance events`): read only when a person asks
// (Load activity), read again on Refresh activity, never in the background. Address history as
// the kernel recorded it, never the current runtime state. As the OATS Desktop's "Reported
// lifecycle activity" (packages/desktop/renderer/instance-events-view.mjs).
import { useState } from "react";
import type { PanelEvents } from "../../kernel/panel-events";
import { Button, Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import { ACTIVITY, LOAD, LOADED, NO_EVENTS, PROVENANCE, READING, RECENT, REFRESH, claimLine, eventFacts, eventTitle, incomplete, incompleteLine, producerLine, setupLine, sourcesLine, summaryLine, windowLine } from "./events-words";
import { usePanelEvents } from "./read";
import { CommandState } from "./state";

function Events({ events }: { events: PanelEvents }) {
  return (
    <>
      <p data-testid="oats-panel-activity-summary" className="m-0 break-words text-foreground">
        {shown(summaryLine(events))}
      </p>
      <Disclosure summary={RECENT} testId="oats-panel-activity-list">
        <p className="m-0 text-xs text-muted-foreground">{windowLine(events)}</p>
        {incomplete(events) ? (
          <p data-testid="oats-panel-activity-incomplete" className="m-0 text-xs font-semibold text-foreground">
            {incompleteLine(events)}
          </p>
        ) : null}
        <p className="m-0 break-words text-xs text-muted-foreground">{shown(sourcesLine(events))}</p>
        {events.waitingClaims.length === 0 ? null : (
          <ul data-testid="oats-panel-activity-claims" className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-foreground">
            {events.waitingClaims.map((claim) => (
              <li key={claim.producer}>{shown(claimLine(claim))}</li>
            ))}
          </ul>
        )}
        {events.events.length === 0 ? <p className="m-0 text-muted-foreground">{NO_EVENTS}</p> : null}
        {/* Newest first. */}
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {[...events.events].reverse().map((event, index) => (
            <li key={index} data-testid="oats-panel-event" className="flex min-w-0 flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
              <strong className="text-foreground">{shown(eventTitle(event.kind))}</strong>
              <time dateTime={event.at} className="text-xs tabular-nums text-muted-foreground">
                {shown(event.at)}
              </time>
              <span className="text-xs text-muted-foreground">{shown(producerLine(event))}</span>
              <Facts>
                {eventFacts(event).map((fact) => (
                  <Fact key={fact.label} label={fact.label}>
                    {shown(fact.value)}
                  </Fact>
                ))}
                {event.setup === null ? null : (
                  <Fact label="Setup">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {event.setup.map((hook, at) => (
                        <span key={at} className="flex min-w-0 flex-col">
                          <span>{shown(setupLine(hook))}</span>
                          {hook.log === null ? null : <span className="break-all text-xs text-muted-foreground">{shown(hook.log)}</span>}
                        </span>
                      ))}
                    </span>
                  </Fact>
                )}
              </Facts>
            </li>
          ))}
        </ol>
        <p className="m-0 text-xs text-muted-foreground">{PROVENANCE}</p>
      </Disclosure>
    </>
  );
}

export function Activity({ instance }: { instance: string }) {
  const [asked, setAsked] = useState(false);
  const read = usePanelEvents(instance, asked);
  return (
    <Section title={ACTIVITY} testId="oats-panel-activity">
      {/* Nothing is read until a person asks: the kernel reads two logs for it. */}
      {!asked ? null : <CommandState read={read} reading={READING} failed="The recorded activity could not be read" />}
      {read.data === undefined ? null : <Events events={read.data} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="oats-panel-activity-load"
          disabled={asked && read.fetching}
          onClick={() => {
            if (asked) read.retry();
            else setAsked(true);
          }}
        >
          {asked ? REFRESH : LOAD}
        </Button>
        {asked && read.status === "ready" && !read.fetching ? (
          <span role="status" className="text-xs text-muted-foreground">
            {LOADED}
          </span>
        ) : null}
      </div>
    </Section>
  );
}
