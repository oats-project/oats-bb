---
name: oats-in-bb
description: Use when working with OATS agents shown in bb by the OATS plugin - stopping, starting, restarting or retiring an OATS agent from bb, spawning one from a soul's page, reading the sidebar tree and the "needs you" list, reading OATS schedules and triggers on the Automations page, or when the plugin shows "No OATS deployment found", "oats was not found" or "choose a machine".
---

# OATS agents in bb

The OATS plugin (plugin id `oats`) shows this machine's OATS agents in bb. Each agent is one bb
thread; the plugin adds who it is and lets a person act on it through OATS. It owns nothing: the
agents, their homes, identities and mail are OATS's and aweb's.

## Rules

- **Stop an OATS agent with "Stop agent (OATS)"** in the thread's menu, never with bb's own Stop,
  Archive or Delete. Only the OATS stop records the agent as stopped, so it stays stopped; bb's own
  buttons leave OATS thinking the agent should run.
- **Start, Restart and Retire** are in the same menu. Stop and Retire show the kernel's plan and
  ask once. Retire removes the agent's home; its work tree and branch are kept unless the plan says
  otherwise.
- **A thread archived or deleted in bb** takes the agent out of the tree. Nothing is retired: the
  agent shows on its soul's page as "thread missing", with Start and Retire.
- **Spawn** from a soul's page (Souls, pick a soul, name, task, Preview, Spawn in bb). The name is
  lower-case letters, digits and dashes. The new agent opens in its own thread. It runs in bb's
  full mode, with no sandbox between it and the account bb runs as: the plugin asks for that on
  every spawn (`--yolo`), and the form says so in one line.
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
  a tab in a thread's side panel): Needs you, Working, Finished and not looked at. On the page, a
  reply box sends a message to the agent you pick, through bb's own send.
- On an agent's own thread, the OATS tab of the side panel is the agent's panel. Instance: its
  state in words, what it waits on you for and since when, where it works (the folder and the home
  to copy), its harness, model and thread, its messaging id, its parent, whether it is ready
  (Instance readiness, with the checks behind a fold) and, once you press Load activity, its
  recorded lifecycle events. Soul: its soul as the instance was spawned from it (core
  capabilities, capabilities and why each is there), the soul's readiness, the agents root, and
  Open soul page. On a phone the panel is the page `/plugins/oats/agent/<instance>`.
- A row's end: `?` when the agent waits on you, `new` when its thread is unread.
- An agent that runs on tmux is listed on its soul's page, not in the tree.
- When something happened to an agent outside OATS, its row and its thread's line say what and
  what to do: "Its conversation is archived in bb" (a stopped agent: Start makes a new thread, and
  its row opens the old one to read); "Archived in bb" (its thread was archived while it ran: its
  process still runs; Stop it, then Start it); "Deleted in bb" (Start it for a new thread);
  "Running outside OATS" in a warning (OATS recorded it stopped and it runs, because a message was
  sent in its thread: Stop or Start it through OATS). Never answer such an agent in bb's composer.
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
