// The panel's two parts of its own: what the patterns of app/ui.tsx (the UX standard, section 3)
// have no component for. Everything else the panel draws is one of those.
import { Fragment } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "../ui";
import { shown } from "../ui/text";
import { markText } from "./words";

/**
 * A path, whole (a long one breaks between its segments), then what belongs to it and its Copy,
 * named for what it copies. What is drawn goes through the display filter; what is copied is the
 * path as the kernel gave it.
 */
export function PathLine({ path, copyName, tag, testId }: { path: string; copyName: string; tag?: ReactNode; testId: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <span data-testid={testId} className="min-w-0 break-words font-mono text-xs text-foreground">
        {/* A line may end after a slash, so a long path breaks between its segments, not inside a name. */}
        {path.split("/").map((segment, index) => (
          <Fragment key={index}>
            {index === 0 ? null : (
              <>
                /<wbr />
              </>
            )}
            {shown(segment)}
          </Fragment>
        ))}
      </span>
      {tag}
      <CopyButton text={path} name={copyName} />
    </span>
  );
}

/**
 * A soul's mark: its two letters in a tile, as the Desktop draws one beside a soul's name. It
 * repeats the name beside it, so it is hidden from a screen reader. bb has no colour per soul:
 * the tile is neutral.
 */
export function SoulMark({ soul }: { soul: string }) {
  return (
    <span aria-hidden="true" data-testid="oats-soul-mark" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-foreground">
      {shown(markText(soul))}
    </span>
  );
}
