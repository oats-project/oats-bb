// The panel's one part of its own: what the patterns of app/ui.tsx (the UX standard, section 3)
// have no component for. Everything else the panel draws is one of those.
import { Fragment } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "../ui";

/** A path, whole (a long one breaks between its segments), then what belongs to it and its Copy, named for what it copies. */
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
            {segment}
          </Fragment>
        ))}
      </span>
      {tag}
      <CopyButton text={path} name={copyName} />
    </span>
  );
}
