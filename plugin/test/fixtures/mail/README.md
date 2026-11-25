# The mail read's fixtures

Each file but `verbs.json` and `calls.json` is one answer of the REAL kernel and the REAL messaging
layer to `oats operation run messaging:mail --home <abs> --arg limit=<n> [--arg cursor=…] --json`,
whole, printed with one space of indentation. `calls.json` holds, per file, the argv the answer was
given for and the process's exit code. `verbs.json` is the fake's list (`../README.md`).

**Every word of mail in them was made up for the recording**: the aliases (`mail-reader`,
`mail-writer`, `mail-empty`, `mail-none`, `mail-old`), the teams (`mailspike`, `wider`), the
namespace (`mailspike.test`), the subjects and the bodies. No file is taken from a real workspace,
and none may ever be: mail is other people's text.

## How they were recorded

On 2026-11-25, in containers and with no account, by the recipe that
`plugin/container/real/mail/README.md` keeps:

- aweb's own local stack (awebai/aweb at 6a460770f9cafc142b20473f11bcf3b49ce81395: postgres,
  redis, awid, aweb), with no port on the host;
- one client container with `@awebai/oats@0.70.5` and `@awebai/aw@1.36.59` from npm, the packages
  `oats.framework` v1.26.0 and `oats.aweb` v1.48.0, and Claude Code with the aweb channel plugin
  (a spawn refuses without the harness's package; no agent was launched and nothing logged in);
- a team made by `oats aweb setup --create`, and agents spawned with `--no-launch` that mailed each
  other with `aw mail send`.

**Nothing was marked read**: `aw mail inbox --count-only` in the reading agent's home said 3 unread
before the reads and 3 after.

## The substitutions, and no other edit

- The paths, as in `../README.md`: the deployment is `/abs/deployment`, the run's directory
  `/abs/real`, the container user's home `/abs/home`.
- **The five recorded identities** (`did:key:…`, each an agent's public key) are cut to
  `did:key:placeholder-1` … `did:key:placeholder-5`, the same placeholder for the same identity in
  every file. The answers hold no signature and no other key material.

Message and conversation ids, times, the cursor and byte counts are as recorded, and the tests hold
them as literals: a new recording changes both.

## The files

| File | What was asked, of whom |
|---|---|
| `mail.json` | `mail-reader`: three received messages and one it sent. The second is a 300 KB body, which the messaging layer cut to 16384 bytes and marked `truncated: true`. The first is the hostile one: markup and a link in the subject and the body, a bidi override, a zero-width space, a control character, and a line shaped like a credential (`password: not-a-real-one`: not one) |
| `mail-first-page.json`, `mail-older-page.json` | the same mail in pages of two: the first names the cursor, the second was read with it |
| `mail-none.json` | `mail-empty`, an agent nobody wrote to |
| `mail-two-teams.json` | `mail-reader` after it joined a second team (`wider`) and got one message there |
| `mail-identity-missing.json`, `mail-identity-unreadable.json` | the same, with the second team's identity directory moved aside, then made unreadable, for the one call: `identities[].error`, and the other team's mail. The messaging layer names neither the alias nor the identity of one it could not read: both are `""` |
| `refused-no-messaging.json` | `mail-none`, an agent of a soul with `messaging: none`: `E_OPERATION_UNAVAILABLE` |
| `refused-messaging-too-old.json` | `mail-old`, an agent spawned on `oats.aweb` v1.45.0, which has no mail operation: `E_OPERATION_UNKNOWN` |
| `refused-aw-too-old.json` | `mail-reader`, with `aw` 1.36.33 first on the PATH for the one call: `E_AW_TOO_OLD` |
| `refused-no-identity.json` | `mail-empty`, with its one identity moved aside for the one call: `E_MAIL_UNREADABLE` |
| `refused-bad-cursor.json`, `refused-bad-limit.json` | a cursor that is none, and `limit=0`: `E_BAD_ARGS` |

## What the stage could not produce

An unverified sender and a failed signature; the identity errors `no-mail-read`,
`threads-unreadable`, `conversation-unreadable` and `too-many-threads`; `E_MAIL_TOO_LARGE`; a read
that runs out of time; a body over the bound that the messaging layer did not cut. **No file here
is shaped by hand for them.** A test of one takes a recorded answer and changes ONE named field in
its own code, and its name says so (`../../mail/kernel.test.ts`); the refusals with no recording are
tested as the refusal's code and a sentence the test writes.
