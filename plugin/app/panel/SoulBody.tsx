// The Soul tab's body: the soul as THIS instance was spawned from it (`oats inspect --home`): its
// core capabilities with why each fills its slot, every other capability with its source and why
// it is there, the capability warnings, and the commit it was spawned from. As the OATS Desktop's
// Soul tab and the instance snapshot of its soul inspector.
import type { PanelSoul, PanelSource } from "../../kernel/panel-soul";
import { Card, Chip, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";
import type { PanelRead } from "./read";
import { AS_SPAWNED, NO_CAPABILITIES, NO_OTHER_CAPABILITIES, coreNote, emptySlot, layerLabel, modulesAsSpawned, soulMeta, sourceKind, sourceText, spawnedFrom, whyTag } from "./soul-words";
import { CommandState } from "./state";
import { Warnings } from "./Warnings";

function Source({ source }: { source: PanelSource }) {
  return (
    <span title={`${sourceKind(source)}: ${shown(sourceText(source))}`} className="break-all font-mono text-xs text-foreground">
      {shown(sourceText(source))}
    </span>
  );
}

function Spawned({ soul }: { soul: PanelSoul }) {
  const meta = soulMeta(soul);
  return (
    <>
      {meta === null ? null : (
        <p data-testid="oats-panel-soul-meta" className="m-0 break-words font-mono text-xs text-muted-foreground">
          {shown(meta)}
        </p>
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
      <Section title="Capabilities" n={soul.capabilities.length} testId="oats-panel-capabilities">
        {soul.capabilities.length === 0 ? (
          <p className="m-0 text-muted-foreground">{soul.modules === 0 ? NO_CAPABILITIES : NO_OTHER_CAPABILITIES}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {soul.capabilities.map((capability) => {
              const why = whyTag(capability);
              const off = capability.why === "off";
              return (
                <li key={capability.name} data-testid="oats-panel-capability" className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`min-w-0 break-all font-mono text-xs font-semibold ${off ? "text-muted-foreground line-through" : "text-foreground"}`}>{shown(capability.name)}</span>
                    <span className="ml-auto">
                      <Chip tone={off ? "muted" : "plain"} title={shown(why.title)}>
                        {shown(why.label)}
                      </Chip>
                    </span>
                  </span>
                  {capability.source === null ? null : <Source source={capability.source} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Warnings warnings={soul.warnings} testId="oats-panel-soul-warnings" />
      <p data-testid="oats-panel-modules" className="m-0 text-xs text-muted-foreground">
        {modulesAsSpawned(soul.modules)}
      </p>
    </>
  );
}

/** `read` is the panel's read of `oats inspect --home` for the instance shown. */
export function SoulBody({ read, now }: { read: PanelRead<"panelSoul">; now: number }) {
  return (
    <div data-testid="oats-panel-soul-body" className="flex min-w-0 flex-col gap-4">
      <CommandState read={read} of="soul" reading="Reading the soul as this instance was spawned from it…" failed="The soul as spawned could not be read" now={now} />
      {/* An inspection that names no soul: the header above says what the roster knows; nothing here. */}
      {read.data === undefined || read.data.soul === null ? null : <Spawned soul={read.data.soul} />}
    </div>
  );
}
