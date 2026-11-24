// The Soul tab's body: the soul as THIS instance was spawned from it (`oats inspect --home`): its
// core capabilities, every other capability with why it is there in a word, the capability
// warnings, and the commit it was spawned from. A row opens (its mark turns) to why it is there in
// a sentence and where it comes from: one fold per row, closed until pressed. As the OATS Desktop's
// Soul tab and the instance snapshot of its soul inspector.
import type { PanelSoul, PanelSource } from "../../kernel/panel-soul";
import { Button, Card, Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import type { PanelRead } from "./read";
import { NO_CAPABILITIES, coreNote, emptySlot, layerLabel, sourceKind, sourceText, sourceWhole, spawnedFrom, whyTag } from "./soul-words";
import { CommandState, mendable, offersRetry } from "./state";
import { Warnings } from "./Warnings";

function Source({ source }: { source: PanelSource }) {
  return (
    // A long name breaks where its words do; a commit id is short here and whole in the title.
    <span title={`${sourceKind(source)}: ${shown(sourceWhole(source))}`} className="break-words font-mono text-xs text-foreground">
      {shown(sourceText(source))}
    </span>
  );
}

function Spawned({ soul }: { soul: PanelSoul }) {
  /** What fills a core slot: its source (a package and its version), else its id as the kernel names it. */
  const what = (core: PanelSoul["core"][number]) => (core.source === null ? <span className="break-all font-mono text-xs">{shown(core.id)}</span> : <Source source={core.source} />);
  return (
    <>
      {soul.repo === null && soul.teams.length === 0 ? null : (
        // Each a labelled fact: a bare "oats-real" says nothing of what it is.
        <div data-testid="oats-panel-soul-meta">
          <Facts>
            <Fact label="Repository">{soul.repo === null ? null : shown(soul.repo)}</Fact>
            <Fact label={soul.teams.length === 1 ? "Team" : "Teams"}>{soul.teams.length === 0 ? null : shown(soul.teams.join(", "))}</Fact>
          </Facts>
        </div>
      )}
      <p data-testid="oats-panel-spawned-from" title={soul.commit === null ? undefined : shown(soul.commit)} className="m-0 text-foreground">
        {shown(spawnedFrom(soul))}
      </p>
      <Section title="Core capabilities" testId="oats-panel-core">
        <Card testId="oats-panel-core-card">
          <Facts>
            {soul.core.map((core) => {
              const note = coreNote(core);
              return (
                <Fact key={core.slot} label={layerLabel(core.slot)}>
                  <span data-testid={`oats-panel-core-${core.slot}`} className="flex min-w-0 flex-col gap-0.5">
                    {core.id === null ? (
                      <span className="text-muted-foreground">{emptySlot(core)}</span>
                    ) : note === null ? (
                      what(core)
                    ) : (
                      // Why it fills its slot is one press away, in the row itself.
                      <Disclosure row summary={what(core)} testId="oats-panel-core-why">
                        <span className="text-xs text-muted-foreground">{shown(note)}</span>
                      </Disclosure>
                    )}
                  </span>
                </Fact>
              );
            })}
          </Facts>
        </Card>
      </Section>
      {/* The count is of the capabilities the instance has: one the soul turned off is listed, not counted. */}
      <Section title="Capabilities" n={soul.capabilities.filter((capability) => capability.why !== "off").length} testId="oats-panel-capabilities">
        {soul.capabilities.length === 0 ? (
          <p className="m-0 text-muted-foreground">{NO_CAPABILITIES}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {soul.capabilities.map((capability) => {
              const why = whyTag(capability);
              const off = capability.why === "off";
              return (
                <li key={capability.name} data-testid="oats-panel-capability" className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  {/* The row: its name, and why it is there in a word (the Desktop's tag). Opened: why in a sentence, and where it comes from. */}
                  <Disclosure
                    row
                    testId="oats-panel-capability-more"
                    summary={
                      <>
                        <span className={`min-w-0 break-words font-mono text-xs font-semibold ${off ? "text-muted-foreground line-through" : "text-foreground"}`}>{shown(capability.name)}</span>
                        <span data-testid="oats-panel-capability-tag" className="shrink-0 text-xs text-muted-foreground">
                          {shown(why.label)}
                        </span>
                      </>
                    }
                  >
                    <Facts>
                      <Fact label={off ? "Not here" : "Here because"}>
                        <span data-testid="oats-panel-capability-why" data-why={shown(why.label)}>
                          {shown(why.title)}
                        </span>
                      </Fact>
                      <Fact label="From">{capability.source === null ? null : <Source source={capability.source} />}</Fact>
                    </Facts>
                  </Disclosure>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Warnings warnings={soul.warnings} testId="oats-panel-soul-warnings" />
    </>
  );
}

/** `read` is the panel's read of `oats inspect --home` for the instance shown. */
export function SoulBody({ read, now, unread }: { read: PanelRead<"panelSoul">; now: number; /** the roster cannot be read: no act of this part's own (state.tsx `CommandState`) */ unread: boolean }) {
  return (
    <div data-testid="oats-panel-soul-body" className="flex min-w-0 flex-col gap-4">
      <CommandState read={read} of="soul" reading="Reading…" failed="The soul as spawned could not be read" now={now} unread={unread} />
      {/* After a refusal that reading again cannot change as things are, the notice has no Retry: the way to read again, once it is mended, is here. */}
      {read.status === "error" && !offersRetry(read, "soul") && mendable(read, "soul") && !unread ? (
        <div>
          <Button data-testid="oats-panel-soul-again" disabled={read.fetching} onClick={read.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {/* An inspection that names no soul: the header above says what the roster knows; nothing here. */}
      {read.data === undefined || read.data.soul === null ? null : <Spawned soul={read.data.soul} />}
    </div>
  );
}
