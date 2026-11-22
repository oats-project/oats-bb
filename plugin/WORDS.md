# Words

The plugin uses the OATS Desktop's words for every act, state, label, notice and refusal (the UX
standard, section 2). This file holds each place where bb's nature, or the plugin's, changes a word:
what the Desktop says, what the plugin says, and why. Nothing else is reworded.

The tables the plugin copies from the Desktop whole are named in the header of the file that holds
them: `app/ui/text.ts` (the display filter), `app/ui/words.ts` (the needs-input words and times, an
instance's name as words).

| Thing | The Desktop says | The plugin says | Why |
|---|---|---|---|
| The state of an agent, as a word beside its mark | no word: the dot alone, named "running", "stopped" or "status unknown" for a screen reader | **Working**, **Idle**, **Needs you**, **Stopped**, **Failed**, **Unreachable**, each beside its mark | The standard: a state is always a mark and its word. bb's kernel rows say more than running or not: a session that fell back to a shell (Failed) and one the kernel cannot reach (Unreachable). |
| The accessible name of a state's mark that stands alone | "running", "stopped", "status unknown", "Needs input" | the same four; "failed" and "unreachable" for the two states the Desktop does not draw | The Desktop's names where it has one. |
| An agent the kernel does not call running | "status unknown" (a grey bullseye) | **Idle** (named "status unknown") | On bb the kernel reports an agent that waits between turns as neither running nor stopped: it is there and not working, which a person reads as idle. |
| Automations: the notice that the host scheduler is off | "The scheduler is not running on this computer, so nothing here runs until it is enabled." (one sentence in a banner) | title **The scheduler is not running on this computer**, then "Nothing here runs until it is enabled." | The standard's notice has a title: the sentence's first clause is the title, the rest follows. No word is changed. |
| Automations: the notice that this computer has no host name | "This computer has no host name, so it runs none of the workspace's schedules. Name it in this deployment's local settings to take on the ones assigned to it." | title **This computer has no host name**, then "It runs none of the workspace's schedules. Name it in this deployment's local settings to take on the ones assigned to it." | The same: a title, then the rest of the Desktop's sentence. |
| Automations: a list that could not be read | the kernel's message alone, in the error colour | title **Schedules could not be read** (or **Triggers …**), the kernel's message under it, its code after, Retry | The standard: a person's words first, the kernel's code after. The Desktop has no sentence of its own here. |

## The roster: the sidebar, the thread's row, the confirmations

| Thing | The Desktop says | The plugin says | Why |
|---|---|---|---|
| OATS cannot be read: the notice's title (`app/roster/unreadable.tsx`) | "Couldn't reach <host>" for a server that does not answer; the kernel's message alone for the rest | a title per cause, in a person's words (**OATS is not installed on <machine>**, **OATS did not answer on <machine>**, **OATS could not read this deployment**, **No OATS deployment found on this machine**, **bb could not list its threads**…), then one sentence of what to do, the code after the words, the kernel's message under Details | The plugin reads OATS through bb's host, so it has causes the Desktop has not (no `oats` on the machine, no deployment chosen, bb's own thread list); the standard asks for a person's words first and the code after. |
| The roster kept while OATS cannot be read | "Last observation — <age>" over the roster, "showing what was read <age>" | the same two, the Desktop's words | none: said here because the acts differ (next row). |
| Acts on a roster that is the last one read | held ("actions held") | offered, each with the detail "as of <age>" | Every act of the plugin goes to the kernel first, which plans it or refuses it on what it knows now; a confirmation is titled with the agent the kernel's plan names. |
| An agent the kernel refuses as one it does not know (a stop plan or a retire plan refused with E_SESSION_UNKNOWN) | **Forget…** on a row its server no longer lists | the row says **Not in OATS any more** in its state's place until the next roster; the confirmation says "<name> is not in OATS any more", "Nothing was changed." Any other act on such an agent shows the kernel's refusal as it is. | bb has no server-side roster to forget from: the next read of `oats status`, made right after every act, drops the row. |
| The thread's row, an agent that waits with no claim of the kernel's | (no such case: the Desktop has no session of its own) | **bb shows its question in this thread** | The question is bb's own pending interaction; the kernel recorded no claim. |
| The thread's row, an agent whose session ended in a shell | "Its session ended" in the instance panel | **Failed** · **Its session ended**, with Restart | The Desktop's words; the state's word beside them is the plugin's (first table). |
| The thread's row, an agent the kernel cannot reach | the kernel's message | **Unreachable** · **OATS says: <the kernel's message>**, with Retry | Who says it is named, since bb also speaks in that place. |
| A row of an agent with no bb thread | the row is the instance, whatever runs it | "<state> · <soul> · **runs in tmux**", or "… · **its bb thread is gone**" | In bb an agent is a thread; one without a thread is said to be so, and opens its own page. |
| Nobody waits | "Nothing needs you." | the same | none. |
| The act that makes an agent | **New agent** | the same, a button at the roster's foot | none. |
| The plugin's pages in the sidebar | one **Workspace** row (a page with tabs) | the heading **Workspace** over a row per page | bb's pages are routes, not tabs of one page; the Workspace page with its tabs is a later piece. |

## The instance panel

| Thing | The Desktop says | The plugin says | Why |
|---|---|---|---|
| An inspection the installed OATS answered and the reader cannot read (the Soul tab, `app/panel/refusal-words.ts`) | "The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and retry." | "The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry." | It is the plugin that reads it, not the Desktop. |
