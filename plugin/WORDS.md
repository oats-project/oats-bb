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
| Automations: a next run that is in the past | "Next 3 h ago": `Next ${next.label}` with its relative time, whatever the time is (`packages/desktop/renderer/views/automations.mjs:434`, and a row's page at `:591`) | the same, "Next 3 h ago" | Not a difference, written here so nobody takes it for a defect of the plugin. The kernel works out the next run when it answers the list, so it is in the past only in a list kept after a read that failed, and that list says its age. |
| Automations: a run that did not happen, in Recent runs | the outcome alone ("launch failed"); the kernel's error is not shown | the outcome, then **Details**, which opens to the kernel's message and its code | An addition: why a run did not happen is the first thing a person asks. The standard: a person's words first, the kernel's one press away. |

## The instance panel

| Thing | The Desktop says | The plugin says | Why |
|---|---|---|---|
| An inspection the installed OATS answered and the reader cannot read (the Soul tab, `app/panel/refusal-words.ts`) | "The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and retry." | "The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry." | It is the plugin that reads it, not the Desktop. |
