// The Soul tab's body: the soul as THIS instance was spawned from it (`oats inspect --home`): its
// core capabilities with why each fills its slot, every other capability with its source and why
// it is there, the capability warnings, and the commit it was spawned from. As the OATS Desktop's
// Soul tab and the instance snapshot of its soul inspector.
import type { PanelSoul, PanelSource } from "../../kernel/panel-soul";
import { Card, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import type { PanelRead } from "./read";
import { AS_SPAWNED, NO_CAPABILITIES, NO_OTHER_CAPABILITIES, coreNote, emptySlot, layerLabel, MODULES_AS_SPAWNED, sourceKind, sourceText, sourceWhole, spawnedFrom, whyTag } from "./soul-words";
import { CommandState } from "./state";
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
      <p data-testid="oats-panel-as-spawned" className="m-0 text-muted-foreground">
        {AS_SPAWNED}
      </p>
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
                    ) : core.source === null ? (
                      <span className="break-all font-mono text-xs">{shown(core.id)}</span>
                    ) : (
                      <Source source={core.source} />
                    )}
                    {core.id === null || note === null ? null : <span className="text-xs text-muted-foreground">{shown(note)}</span>}
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
          <p className="m-0 text-muted-foreground">{soul.modules === 0 ? NO_CAPABILITIES : NO_OTHER_CAPABILITIES}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {soul.capabilities.map((capability) => {
              const why = whyTag(capability);
              const off = capability.why === "off";
              return (
                <li key={capability.name} data-testid="oats-panel-capability" className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <span className={`min-w-0 break-words font-mono text-xs font-semibold ${off ? "text-muted-foreground line-through" : "text-foreground"}`}>{shown(capability.name)}</span>
                  {/* Why it is there and where it comes from, each said in words under its label: no bare tag. */}
                  <Facts>
                    <Fact label={off ? "Not here" : "Here because"}>
                      <span data-testid="oats-panel-capability-why" data-why={shown(why.label)}>
                        {shown(why.title)}
                      </span>
                    </Fact>
                    <Fact label="From">{capability.source === null ? null : <Source source={capability.source} />}</Fact>
                  </Facts>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Warnings warnings={soul.warnings} testId="oats-panel-soul-warnings" />
      <div data-testid="oats-panel-modules">
        <Facts>
          <Fact label={MODULES_AS_SPAWNED}>{String(soul.modules)}</Fact>
        </Facts>
      </div>
    </>
  );
}

/** `read` is the panel's read of `oats inspect --home` for the instance shown. */
export function SoulBody({ read, now }: { read: PanelRead<"panelSoul">; now: number }) {
  return (
    <div data-testid="oats-panel-soul-body" className="flex min-w-0 flex-col gap-4">
      <CommandState read={read} of="soul" reading="Reading the soul…" failed="The soul as spawned could not be read" now={now} />
      {/* An inspection that names no soul: the header above says what the roster knows; nothing here. */}
      {read.data === undefined || read.data.soul === null ? null : <Spawned soul={read.data.soul} />}
    </div>
  );
}
