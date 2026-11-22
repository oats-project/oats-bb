// The panel's two parts of its own: what the patterns of app/ui.tsx (the UX standard, section 3)
// have no component for. Everything else the panel draws is one of those.
import { Fragment } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "../ui";
import { DETAIL_WITHHELD, NOT_NOTE_TEXT, UNSAFE, shown } from "../ui/text";
import { markText } from "./words";

/** Every character that is no text (a control, a bidi override): drawn as U+FFFD, as the display filter draws one. */
const NOT_TEXT = new RegExp(NOT_NOTE_TEXT.source, "gu");

/**
 * A path as text: a line may end after a slash, so a long path breaks between its segments and
 * never inside a name. Withheld whole when the path as given looks like a secret (its segments
 * alone would not show it); a character that is no text is drawn as U+FFFD.
 */
export function PathText({ path }: { path: string }) {
  if (UNSAFE.test(path)) return <>{DETAIL_WITHHELD}</>;
  return (
    <>
      {path.split("/").map((segment, index) => (
        <Fragment key={index}>
          {index === 0 ? null : (
            <>
              /<wbr />
            </>
          )}
          {segment.replace(NOT_TEXT, "\uFFFD")}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A path, whole (a long one breaks between its segments), then what belongs to it and its Copy,
 * named for what it copies. The path drawn is the path copied, character for character, but for a
 * character that is no text, and a path that looks like a secret, which is withheld whole; what is
 * copied is the path as the kernel gave it.
 */
export function PathLine({ path, copyName, tag, testId }: { path: string; copyName: string; tag?: ReactNode; testId: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <span data-testid={testId} className="min-w-0 break-words font-mono text-xs text-foreground">
        <PathText path={path} />
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
