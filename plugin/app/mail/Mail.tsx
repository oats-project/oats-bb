// An agent's incoming mail, read-only: the list of what it received, newest first (who it is from,
// its subject, its age), and one message in the list's place, with Back. Nothing is sent,
// answered, deleted or marked read: the view has no act but reading again.
//
// It takes an agent's instance name and NOTHING of the place it is mounted in (today: the tab
// "Mail" of the agent's panel), so that it can be mounted elsewhere as it is.
//
// MAIL IS OTHER PEOPLE'S TEXT. Every word of a message arrives here as display lines (the adapter
// filtered them on the machine: kernel/mail.ts) and is drawn as React text: never markup, never a
// link. Nothing of a message is logged, and none of it is an attribute but the list's own keys.
import { useEffect, useRef, useState } from "react";
import type { MailMessage } from "../../kernel/mail";
import { age } from "../format";
import { useNow } from "../roster/now";
import { Button, Loading, Notice, TARGET } from "../ui";
import { readAge, showingRead } from "../ui/words";
import { useMail } from "./read";
import { MAIL, codeOf, refusalLine, senderWord, unreadLine } from "./words";

const WARN = "text-warning-text";

/** What is known of a message's sender, where it is a safety fact, after a point: nothing for a verified sender. */
function Sender({ message }: { message: MailMessage }) {
  const word = senderWord(message.sender);
  if (word === null) return null;
  return (
    <>
      {" · "}
      <span data-testid="oats-mail-sender" className={WARN}>
        {word}
      </span>
    </>
  );
}

function Row({ message, now, onOpen, focus }: { message: MailMessage; now: number; onOpen: () => void; /** the row a person came back to takes the focus */ focus: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) button.current?.focus();
  }, [focus]);
  return (
    <li className="min-w-0 border-t border-border first:border-t-0">
      <button ref={button} type="button" data-testid="oats-mail-row" onClick={onOpen} className={`${TARGET} flex w-full min-w-0 flex-col items-stretch gap-0.5 px-1 py-2 text-left hover:bg-accent`}>
        <span className="flex min-w-0 items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 break-words">
            {message.from}
            <Sender message={message} />
          </span>
          <span className="shrink-0">{age(message.at, now) ?? ""}</span>
        </span>
        <span data-testid="oats-mail-subject" className="truncate text-sm text-foreground">
          {message.subject ?? MAIL.noSubject}
        </span>
      </button>
    </li>
  );
}

function Message({ message, now, onBack }: { message: MailMessage; now: number; onBack: () => void }) {
  // The message takes the focus on its Back, as the row it came from takes it back.
  const back = useRef<HTMLDivElement>(null);
  useEffect(() => back.current?.querySelector("button")?.focus(), []);
  return (
    <article data-testid="oats-mail-message" className="flex min-w-0 flex-col gap-2">
      <div ref={back}>
        <Button variant="ghost" onClick={onBack} data-testid="oats-mail-back">
          <span aria-hidden="true">‹</span> {MAIL.back}
        </Button>
      </div>
      <header className="flex min-w-0 flex-col gap-0.5">
        <h3 className="break-words text-sm font-semibold text-foreground">{message.subject ?? MAIL.noSubject}</h3>
        <p className="text-xs text-muted-foreground">
          {age(message.at, now) ?? ""}
          <Sender message={message} />
        </p>
      </header>
      <div data-testid="oats-mail-body" className="flex min-w-0 flex-col text-sm text-foreground">
        {/* The sender's alias alone, as the message's first line: the body under it is its sender's text. */}
        <p data-testid="oats-mail-from" className="break-words">
          {message.from}
        </p>
        {message.lines.map((line, index) => (
          <p key={index} className="min-h-[1.25rem] break-words">
            {line}
          </p>
        ))}
      </div>
      {message.shortened ? (
        <p data-testid="oats-mail-shortened" className="text-xs text-muted-foreground">
          {MAIL.shortened}
        </p>
      ) : null}
    </article>
  );
}

export function Mail({ instance }: { instance: string }) {
  const mail = useMail(instance);
  const now = useNow();
  const [open, setOpen] = useState<{ instance: string; key: string } | null>(null);
  /** The row a person came back from a message to: it takes the focus once. */
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  const { held, fetching, error } = mail;
  const shown = open !== null && open.instance === instance ? (held?.messages.find((message) => message.key === open.key) ?? null) : null;

  if (shown !== null) {
    return (
      <div data-testid="oats-mail" className="flex min-w-0 flex-col gap-3">
        <Message
          message={shown}
          now={now}
          onBack={() => {
            setCameFrom(shown.key);
            setOpen(null);
          }}
        />
      </div>
    );
  }

  const failed =
    error === null ? null : (
      <Notice
        title={refusalLine(codeOf(error.text))}
        tone="error"
        // The kernel's code and its own sentence, one press away: the face is the one line.
        details={error.text}
        {...(held === null ? {} : { age: readAge(held.readAt, now) })}
        actions={
          <Button onClick={error.of === "older" ? mail.readOlder : mail.refresh} data-testid="oats-mail-retry">
            {MAIL.retry}
          </Button>
        }
      />
    );
  if (held === null) return <div data-testid="oats-mail">{failed ?? <Loading>{MAIL.reading}</Loading>}</div>;

  const readAgo = readAge(held.readAt, now);
  const old = now - held.readAt >= 60_000;
  return (
    <div data-testid="oats-mail" className="flex min-w-0 flex-col gap-2">
      {failed ?? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span role="status" data-testid="oats-mail-read" className="min-w-0 text-xs text-muted-foreground">
            {fetching === "first" ? MAIL.reading : old ? showingRead(readAgo) : ""}
          </span>
          <Button onClick={mail.refresh} disabled={fetching !== null} data-testid="oats-mail-refresh">
            {MAIL.refresh}
          </Button>
        </div>
      )}
      {held.messages.length === 0 ? (
        // No received mail in what was read. With no older page: "No mail.". With one (the pages read
        // held only mail the agent sent): no line claims there is none, and "Older" reads on.
        held.older !== null ? null : (
          <p data-testid="oats-mail-empty" className="py-2 text-sm text-muted-foreground">
            {MAIL.empty}
          </p>
        )
      ) : (
        <ul aria-label={MAIL.list} data-testid="oats-mail-list" className="flex min-w-0 flex-col">
          {held.messages.map((message) => (
            <Row key={message.key} message={message} now={now} focus={cameFrom === message.key} onOpen={() => (setCameFrom(null), setOpen({ instance, key: message.key }))} />
          ))}
        </ul>
      )}
      {held.unread.map((unread, index) => (
        <p key={index} data-testid="oats-mail-unread" className={`break-words text-xs ${WARN}`}>
          {unreadLine(unread)}
        </p>
      ))}
      {held.older === null || error?.of === "older" ? null : (
        <div className="flex justify-end">
          <Button onClick={mail.readOlder} disabled={fetching !== null} data-testid="oats-mail-older">
            {fetching === "older" ? MAIL.reading : MAIL.older}
          </Button>
        </div>
      )}
    </div>
  );
}
