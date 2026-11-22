// Capability warnings, as `oats inspect` and `oats readiness` report them: a capability composes,
// and one hook it declares never runs here. Not an error: it blocks nothing and changes no ready
// state. One presentation wherever they show (the Desktop's `createWarningsList`).
import type { PanelWarning } from "../../kernel/panel-read";
import { Disclosure, Fact, Facts, Section } from "../ui";
import { shown } from "../ui/text";

export function Warnings({ warnings, testId }: { warnings: readonly PanelWarning[]; testId: string }) {
  if (warnings.length === 0) return null;
  return (
    <Section title="Warnings" n={warnings.length} testId={testId}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {warnings.map((warning, index) => (
          <li key={index} data-testid="oats-panel-warning" className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground">
              <span>Warning</span>
              {warning.capability === null ? null : <span className="break-all font-mono font-normal">{shown(warning.capability)}</span>}
            </span>
            <span className="break-words text-foreground">{shown(warning.message)}</span>
            {warning.code === null && warning.path === null ? null : (
              <Disclosure summary="Details" testId="oats-panel-warning-details">
                <Facts>
                  <Fact label="Code">{warning.code === null ? null : shown(warning.code)}</Fact>
                  <Fact label="Path">{warning.path === null ? null : shown(warning.path)}</Fact>
                </Facts>
              </Disclosure>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
