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

## The instance panel

| Thing | The Desktop says | The plugin says | Why |
|---|---|---|---|
| An inspection the installed OATS answered and the reader cannot read (the Soul tab, `app/panel/refusal-words.ts`) | "The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and retry." | "The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry." | It is the plugin that reads it, not the Desktop. |
| A question's answer: what happens on a press (`app/panel/board-words.ts`) | the answer is typed on the terminal's input line; "Typed on the input line: press Enter in the terminal to send it." | a dialog shows the exact line with **Send answer**; then "Sent to the agent as its next input. The question stays until the agent clears it." | A bb thread has no terminal and no input line to type on: the answer goes as the agent's next input, after the person confirmed the line. |
| A prompt of the harness is open, so answers are off | "The agent's terminal is showing a prompt: answer it there first." | "The agent's thread is showing a prompt: answer it there first." | In bb the agent is a thread, not a terminal. |
| The question zone's key hint | "1–N put the answer on the input line · Enter there sends it · c the context · Esc back to the terminal" | "1–N choose an answer · ← → the other questions · c the context" | No input line and no terminal to go back to; a number opens the dialog. |
| History or a context in a shape the reader cannot read | "History came in a shape this Desktop can't read." / "The context came in a shape this Desktop can't read." | "… this plugin can't read." | It is the plugin that reads it. |
