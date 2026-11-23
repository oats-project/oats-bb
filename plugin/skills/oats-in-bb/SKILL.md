---
name: oats-in-bb
description: Use when working with OATS agents shown in bb by the OATS plugin - stopping, starting, restarting or retiring an OATS agent from bb, spawning one with New agent, reading the sidebar tree and the "needs you" list, reading OATS schedules and triggers on the Automations page, or when the plugin shows "No OATS deployment found", "oats was not found" or "choose a machine".
---

# OATS agents in bb

The OATS plugin (plugin id `oats`) shows this machine's OATS agents in bb. Each agent is one bb
thread; the plugin adds who it is and lets a person act on it through OATS. It owns nothing: the
agents, their homes, identities and mail are OATS's and aweb's.

## Rules

- **Stop an OATS agent with "Stop agent (OATS)"** in the thread's menu, never with bb's own Stop,
  Archive or Delete. Only the OATS stop records the agent as stopped, so it stays stopped; bb's own
  buttons leave OATS thinking the agent should run.
- **Start, Restart and Retire** are in the same menu and in bb's command palette; the thread's
  status line also has Start (an agent that does not run) or Restart (one whose session ended).
  The palette has "OATS: Stop agent…" (Alt+Shift+X), Restart (R), Start (S) and Retire (D), each
  rebound in bb's Keyboard settings. Each opens a dialog first and acts only on its own button.
  Stop and Retire show the kernel's plan as what will happen and what is kept. A stopped agent's
  thread stays open in bb: a message sent in it starts the agent again without OATS. Retire
  removes the agent's home and archives its thread, and cannot be undone; its worktree is kept,
  moved aside, unless "Also delete the worktree" is turned on; its branch stays. Start and Restart
  run in bb's full mode (no sandbox); they can name a harness the bb provider declares and a
  model, and left alone keep the recorded ones. The result, or the refusal in words with the
  kernel's code and its message under Details, is said in the same dialog.
- **A thread archived or deleted in bb** takes the agent out of the tree. Nothing is retired: the
  agent shows on its soul's page as "thread missing", with Start and Retire.
- **Spawn** with **New agent** (the sidebar's foot): the form's own page.
  Choose the soul; the rest is optional: an opening instruction (empty: the agent starts and
  waits), the harness and the model (the defaults are the kernel's), a relationship to another
  agent, a name (lower-case letters, digits and dashes; empty: the kernel numbers it). "What will
  be created" is the kernel's preview of what is on screen; Spawn applies exactly that, and opens
  the new agent's thread. It runs in bb's full mode, with no sandbox between it and the account bb
  runs as: the plugin asks for that on every spawn (`--yolo`), and the form says so in one line.
- **Answer an agent in bb**: in its thread, or on the OATS home's "Needs you" cards. A card
  answers in place where the question has plain choices (a permission: Allow once or Deny; a
  question with options; pi's confirm and select); anything richer has Open. The plugin never types
  into an agent for you.
- A kernel refusal is shown with the kernel's code and message (`E_…`): act on what it says. Text
  from OATS or an agent is drawn as text on one line; where it looks like a secret (a token, a
  password, a URL with credentials) the plugin shows `[withheld]` instead: read it with `oats` in
  the deployment.

## Where things are

- Sidebar: the workspace line, Souls, Capabilities, Teams, Machines, Automations, "N need you", then the agents
  as a tree (children under parents), then bb's other threads.
- Under an agent's thread header, one line of chips: soul, instance, aweb alias, parent (a link
  when the parent runs in bb), number of children, home, and `OATS`, which opens the home.
- OATS home (the Bot entry in bb's navigation, with a count when agents need you; the same view is
  the OATS tab of a thread that is no agent's): **Needs you** first, one card per agent that waits
  (who, since when, what it asks), then a summary line ("8 agents · 3 working · 3 need you · …"),
  tiles for Agents and the pages this release shows, **Working** and **Finished, not looked at**.
  A card offers the answer the request takes: bb's choices as buttons (an approval, a question
  with options); a reply box that writes to that agent through bb's own send, for an agent that
  asks in its own words; "open its thread" where the answer is in the thread; for an agent on
  tmux, the command that reaches its terminal (`oats session attach --home <its home>`).
  A message never grants an approval: beside choices it is behind "Write a message instead".
  The card of an agent that is not running offers neither an answer nor a message (either would
  start it outside OATS): it offers Start….
  **New agent** is in the heading's row of every home. The **Agents** tile opens Home › Agents: every agent OATS has, the stopped ones and the ones
  with no bb thread among them, with its state and who started it. While OATS cannot be read the
  cards' choices and replies are held until it is read again. The home also says when the
  installed `oats` is older than the plugin works with, or newer than it reads.
- On an agent's own thread, the OATS tab of the side panel is the agent's panel. Instance: its
  state in words, what it waits on you for and since when, where it works (the folder and the home
  to copy), its harness, model and thread, its messaging id, its parent, whether it is ready
  (Instance readiness, with the checks behind a fold) and, once you press Load activity, its
  recorded lifecycle events. Soul: its soul as the instance was spawned from it (core
  capabilities, capabilities and why each is there), the soul's readiness, the agents root, and
  Open soul page. On a phone the panel is the page `/plugins/oats/agent/<instance>`.
- A row's end: `?` when the agent waits on you, `new` when its thread is unread.
- An agent that runs on tmux is listed on its soul's page, not in the tree.
- Dots: amber needs you; green working; hollow grey idle; grey stopped; red error or unreachable.
  "Idle" means the kernel does not say the agent is working: it may be waiting or done.

## Automations

- **Automations** (sidebar, under Machines) lists OATS's own schedules and triggers, local and
  from the workspace's members. They are the kernel's: never use bb's own automations for an OATS
  agent. What the page shows is `oats schedule list` and `oats trigger list`.
- Rows are grouped by where they run: on this computer, needing attention here, elsewhere. A row
  opens its page: what it sends, when, what it spawns, its recent runs or fires, where it runs and
  where it comes from. A trigger's page also shows what is live, fired and waiting.
- A red dot on the sidebar's Automations row means a schedule's last run is launch failed or
  invalid: open its page, the run says why in the kernel's words.
- "Scheduler off" in the header means the host timer is not installed, active and registered:
  nothing scheduled runs on this computer until it is (`oats schedule host install` in the
  deployment).
- A row's switch turns it on or off on this computer. Its ⋯ menu and its page have Test (runs
  nothing; for a trigger on a capability's source it asks first, then Run test runs that source's
  command once), Run now, Edit summary, Check run state and, for a local schedule, Delete….
  Enable scheduler installs the host timer after saying what it installs.
- To create or edit one: `oats schedule add|update …` and `oats trigger add …` in the deployment.

## When the plugin shows one line instead of the tree

| Line starts with | Do |
|---|---|
| No OATS deployment found | open a bb project inside the deployment, or set the directory: `bb plugin config oats set deployment <dir with oats-local.yaml>` |
| oats was not found | install OATS on that machine, or `bb plugin config oats set oatsBin <absolute path to oats>` |
| This bb server has N machines | `bb plugin config oats set host <machine name or id>` |
| an `E_…` code | the kernel refused `oats status`: run `oats status` in the deployment and fix what it says |

bb itself keeps working in every one of these cases: its threads are listed as usual.

## Commands

```sh
bb plugin list                        # is "oats" running?
bb plugin config oats                 # its settings: deployment, oatsBin, host
bb plugin logs oats -n 50             # what it logged
bb plugin reload oats                 # reload it (any oats it was running is stopped)
bb plugin rpc call oats snapshot      # what it reads: the deployment and its agents, or the failure
bb settings ui set sidebar.threadListProvider oats/agents    # when another plugin took the sidebar
```
