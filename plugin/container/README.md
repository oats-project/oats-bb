# The plugin's test container

bb, its npm packages and this plugin's dependencies are installed and run only in a container:
never `npm install` on the host. One command does everything:

```sh
plugin/container/ci.sh            # image, installs, typecheck, unit tests, build, live tests, the real run
plugin/container/ci.sh unit       # typecheck, unit tests and the build
plugin/container/ci.sh live       # the live tests
plugin/container/ci.sh real       # the run against a real OATS kernel and the bb session provider
plugin/container/ci.sh pi         # the pi run: a pi agent launched from the New agent form (not part of the first line)
```

The paths here are from the repository's root; the scripts find the plugin by their own place, so
they run from any directory. CI runs the stages of the first line as jobs side by side, each on a
runner of its own (`.github/workflows/plugin.yml`: `plugin-unit`; the live stage as two, `test` in
bb's light theme and `plugin-live-dark` in its dark one; `plugin-real`), and the pi run as one more
(`plugin-pi`), so each line after the first installs and builds what it needs by itself.
`LIVE_THEMES=light` (or `dark`) makes the live stage draw one theme, as each of CI's two live jobs
does; with none named it draws both, as `ci.sh live` and `ci.sh all` do on a machine.
`LIVE_PILOT_IMAGES=1`, by hand only and never in CI, takes the images of the pilot's six screens as a
fresh install shows them: the plugin's `pages` stays at its default (the home and the Workspace
page's four tabs) through every stage, and only those screens' scenes run. It is a pass for images: a check that asserts another
page's link or tile does not hold in it, and the gate is the run without it.
In a scene, `showSidebar(page, viewport)` opens every parent of the roster's tree (the children are
collapsed when the page loads), so a scene reads a child's row as a person who opened it;
`showSidebar(page, viewport, { fold: "asLoaded" })` leaves the tree as the page drew it: the fold's
own scenes, and the image of the sidebar as a fresh install shows it (`a13-<width>-sidebar`).
`LIVE_ONLY_STAGES="tmux-roster"` (stage names, commas between), by hand only and never in CI, runs
those stages alone: a look at one screen in minutes, never a gate.
`LIVE_ONLY_SCENE="words of a scene's name"` runs the scenes whose name holds them, alone, and
`LIVE_REPEAT=10` each that many times in every view: by hand only, to show whether a check that
failed once is the scene's or the product's. A scene is given `snapshot()`: the server's roster as
the app gets it now, so that it waits on the roster it needs and not on a number of seconds.
`LIVE_WINDOW_LOADS=<n>` (by hand; passed into the container by name) makes the scene "a window that
loads right after a change …" load n windows a view, where the gate loads two: a count of how
often a window that loads while the server may still be reading a change ends on the roster with
it (it must be all of them; which millisecond the load falls in is chance, so many loads say more).

The container gets `--cpus 2 --memory 6g`, no mount, no port, no Docker socket and nothing of the
host's home; the plugin's directory goes in through `tar` and the artefacts come out to
`plugin/container/out/` (ignored by git). A run that fails also keeps bb's own logs and crash
reports there, cut short, under `bb-logs/` (`real/bb-logs.sh`, `real/README.md`): never the
plugin's own log file, and nothing of bb's data. bb's logs name threads and environments by their
ids, and carry the text of an error and what a plugin's worker printed on its standard error:
after a failed run by hand on a person's own roster (`LOCAL_STATUS`, below), `out/bb-logs/` is as
private as that run's images. The artefacts have an owner (`out/.owner`: the OATS
instance that ran, else the user; `ARTEFACTS_OWNER` to name one): the first to run in a checkout
owns `out/`, and a run by another (a reviewer attached to an author's tree) leaves `out/` as it is
and writes to `out.<owner>/` beside it, so that nobody's images are deleted under them. A run
claims its directory when it starts. An `out/` from before this rule has no owner: the next run
takes it. The real run (`real/`, its own README) has a container
of its own with the same limits, started after the first is gone, and its artefacts are in
`plugin/container/real/out/`. bb runs sovereign: no account, `BB_TELEMETRY=false`, bound to loopback.

| File | Runs | Does |
|---|---|---|
| `Dockerfile` | `docker build` | node 22, chromium (the live tests' browser), procps and tmux (the real run's one agent on the tmux backend), fd-find and ripgrep (which pi would else download by itself); no bb and no npm package |
| `ci.sh` | on the host | builds the image, starts the container, copies the plugin's directory in, reads the repository's bb pin, runs the scripts below, copies `out/` back, removes the container |
| `setup.sh` | in the container | bb-app at the pinned version, from its lock (`locked-install.sh bb-app`); `npm ci` |
| `locked-install.sh` | in the container | installs a tool from its committed lock (`locks/<tool>/`, `locks/README.md`) with `npm ci` and links its commands onto the PATH: nothing is resolved at run time |
| `relock.sh` | on the host | writes a tool's lock again (`relock.sh bb-app`, `relock.sh pi`): when its pin moves, and before a release; `relock.sh plugin` writes the plugin's own lock after `package.json` changed, keeping the versions it holds |
| `no-pi-tools-fetch.sh` | in the container, at the pi run's setup and end | fails when pi does not find `fd` and `rg` on the PATH, or fetched them by itself (it would download their latest releases from github.com): the image holds both |
| `no-toolchain-fetch.sh` | in the container, after each build and install of the plugin | fails when bb fetched its build toolchain from npm (a `toolchain-*` directory in its data): the proof that bb built with the locked one |
| `unit.sh` | in the container | `tsc --noEmit`, `vitest run`, the shell test of the real run's wait for a bb plugin's command, `bb plugin build` |
| `live.sh` | in the container | starts bb-app, makes a deployment and a bb project in it, installs the fake `oats` and the plugin, and checks L1, L2, L3, A14 (backend), A15, G1 and A15b (below); runs `live-ui.mjs` when the app is in the tree |
| `live-ui.mjs`, `browser.mjs`, `contrast.mjs` | in the container | the app's live checks (A13, A14, A16) with screenshots at two widths in bb's light and dark themes, the small DevTools-protocol driver of the image's Chromium they use, and the contrast check run at each screenshot (below) |
| `scenes/<feature>.mjs` | by `live-ui.mjs` | each feature's live scenes: what a page is asked and where its screenshots are taken (below) |
| `real/` | its own container | the real run: bb-app, OATS from npm, the bb session provider, Claude Code on a mock model and the plugin (`real/README.md`) |
| `real/pi/` | that container, started with `REAL_PI=1` | the pi run: the same setup and kernel, with pi, the OATS bridge for pi and a mock model, and a pi agent launched from the New agent form (`real/pi/README.md`) |
| `real/mail/` | by hand only, five containers of its own | the mail part: aweb's local stack (four containers) and one client with a real OATS kernel, the real messaging layer and bb with the plugin; it reads an agent's Mail tab and checks that nothing was marked read. In neither `ci.sh all` nor CI (`real/mail/README.md`) |
| `files.mjs` | by the live stage and the real and pi runs | the files one process of a run writes and another reads while it runs: a whole file is written beside its place and renamed into it (`atomicWrite`: the fake oats' settings, the recording wrapper's settings, pi's `settings.json` in the pi run, Claude Code's state before the tmux part), and a log another process appends to is read by its complete lines (`completeLines`: the fake oats' log, the mocks' request logs). A whole file a process that is not ours writes is read by a wait for a whole one (`wholeJson`: Claude Code's state, before the tmux part). The wrapper's records are written the same way by the wrapper itself |
| `images.mjs` | by `live-ui.mjs` and the real run | finds the images of a run that are the same image: none may be in the live checks; in the real run, only two of one state |
| `fake-oats.mjs` | as `oats` | prints the recorded answer of the verb it is asked and logs each call; the verbs it knows and their files are each feature's `test/fixtures/<feature>/verbs.json`; a JSON file beside it sets a verb's output, exit code, delay, or makes it start a child of its own |

The bb version: `ci.sh` reads the one line of `bb-version` at the repository's root when that file
exists and hands it to `setup.sh` as `BB_VERSION`; with no such file, or run by hand in a
container, `setup.sh` takes `devDependencies["bb-app"]` of `package.json`. A pin that differs from
`package.json`'s stops the run: the unit tests and the build would use one bb and the live tests
another.

The live checks of the backend:

- **L1** the installed plugin reads the deployment through the host entry (`bb plugin rpc call oats snapshot`).
- **L2** with the poll off (no RPC for 50 s), one line appended to `<deployment>/.agents/events/` makes the server run `oats status`: the host watch, the `changed` signal, the reread. The proof is the fake's call log.
- **L3** an `oats status` slower than the kernel's 20 s limit is the typed `OATS_TIMEOUT` in the snapshot, about 20 s after the read starts (counted from the start of the read that `refresh` answers, its `at`, so a read the server had in front of it is not in the time): bb's retry of a retryable host call does not cut it short. The check asserts the code and the time; a second `status` in the fake's log is the server's next reread, started after the first ended. Before it sets the slow `oats`, the check waits until no `oats` is alive: a read asked for during the read before it (the poll's tick) starts at once when that one ends, and would otherwise meet the slow `oats` first and put 20 s in front of the check's own read.
- **A14** (the backend's part) with `oats` removed, the snapshot says what is missing and bb's own lists answer; with `oats` back, the snapshot is back.
- **A15** `bb plugin reload oats` while a fake `oats` sleeps and holds a child of its own: neither process is left.
- **G1** the README's install route: `bb plugin install git:<repository>@<ref> --subdirectory plugin`, from a local repository that holds this tree as `plugin/`. A git install gets the manifest's `dependencies` only, so this fails when something the build needs is left in `devDependencies`.
- **A15b** the same as A15 when bb itself is stopped.

The live checks of the app, each at 1280x800 and 390x800, in bb's light theme and again in its dark
theme. `live-ui.mjs` is the harness: it makes bb's threads, sets what the fake `oats` answers, opens
the pages and counts the checks. What a page is asked is in `scenes/<feature>.mjs`, one file per
feature of the plugin (`../README.md`, "One module per feature"): its default export is a list of
scenes `{ stage, name, run }`. A stage is a state of the fake `oats`: `fixtures` (A13: the fixtures
as they are), `detached` (A16) and `no-oats` (A14). For each stage, in each theme and at each
viewport, one page runs that stage's scenes, feature by feature. A feature whose scenes need
another state exports `stages` beside its list (`live-ui.mjs` says how). A new screen or state of
the app gets its scene in its feature's file in the same change: the contrast check only sees what
a scene draws.

What a scene has to work with (`live-ui.mjs` and `browser.mjs` say each in full):

- **Healthy threads.** `live.sh` gives bb a provider it can run: Claude Code, at the real run's
  version, on the real run's mock model (`real/mock-anthropic.mjs`; no login, nothing spent). The
  fixture threads are made on it, and the run checks that each one's turn was answered and bb
  shows it idle before any image is taken: an image of a thread shows a healthy one. Two of them
  are then given a turn that the mock model holds open (`MOCK-HOLD:live-ui-working`): the threads
  of the fixtures' two working agents (`thr_redesign`, `thr_mockups`), since an agent on a bb
  thread works when bb has a turn running on it. The hold is taken per stage. A scene on either
  thread sees bb "active", and a message told to one is not answered. A stage that tells a thread
  a message of its own says so (`tellsAThread: true` on the stage; `home-stopped-asks` is named in
  `live-ui.mjs`): the hold is lifted for it, both threads are waited for idle, and its scenes see
  the two agents idle. `live-ui.mjs`'s `finally` lifts the hold whatever was thrown. Each thread
  is waited for by name. bb starts the eight turns at once on a cold Claude Code, and a thread
  has been seen to stay "pending" (a turn in bb's queue) with the others long idle; why is not
  known. One that is not idle after 120 s is reported (a `NOTE`,
  with what bb says of it), deleted and made again once. A thread that is still not idle fails
  the run, with every thread's name and status, what bb says of the ones that are not idle, and
  the end of bb's and the mock model's logs.
- **`page.clock(at)`** runs the page with its clock at an instant (`"2026-11-21T20:21:00.000Z"`),
  from the next navigation on, going on at the real pace; `page.clock(null)` gives the real clock
  back. For a scene on recorded answers, whose times are older than the run: call it with the
  recording's own time and clear it in a `finally`. Only `Date` in the page's documents moves: the
  plugin's server and OATS keep the real clock, and so do, in the page, a formatter called with no
  date, a worker and `performance.now()`.
- **`page.press(key)`** sends a real key ("Tab", "Shift+Tab", "Enter", "Escape", an arrow): it
  moves the focus and closes a dialog as a person's key does. `FOCUSED` names what holds the focus.
  So a scene can open a menu, walk a dialog's focus order, and take the image of a dialog before
  its act, while it runs, after it and refused.
- **`page.shot(name, { targets: true })`** also checks that every control of the plugin in the
  page is at least 32 px high, 44 at the phone's width (a link inside a sentence is text, not a
  control).
- **`record(changes)`** makes a change as the kernel records one (the fake's status with
  `changes` by instance, and a line in the deployment's event log) and answers when: the freshness
  scenes time from it to the row or the count on screen, 3 s at most.
- **No two images of a run are the same image** (`images.mjs`), checked at the end. A run that
  draws one theme (`LIVE_THEMES`, as each of CI's two live jobs does) compares that theme's images
  with each other: a light image is then never compared with a dark one. That the theme asked for
  is the one bb draws is checked at every screenshot.

Beside the features' scenes, `scenes/patterns.mjs` reads the pattern book (`/plugins/oats/patterns`,
`../README.md`, "The patterns: one component each"): every pattern in each of its states, the menu
open, a confirmation before its act, in progress, done, refused and with another agent's plan.

- **A13** the sidebar with the tree, an agent's thread with its header row, the thread of an agent
  that needs you (the thread's own row says "Needs you", how long and its question; in the sidebar
  its row is the open one, with its "!"), the thread of a stopped agent ("Stopped", Start), the home (its badge
  shows 3) and its reply box with a message typed (Send enabled), the Workspace page's four tabs,
  and a soul's page (its facts, its capabilities, its agents, New agent).
- **TM** a deployment that is mostly tmux agents (stage `tmux-roster`, the agents in
  `tmux-roster.mjs`): three agents on bb threads and nineteen on tmux over seven souls, five of them
  waiting, two stopped with OATS, two whose session was lost, some with a parent. The real run holds one tmux-backed agent (`real/parts/lost.mjs`), not a
  deployment of them, so the nineteen rows are not recorded as a set: each is the one row the kernel printed for a tmux home
  (`test/fixtures/roster/status.json`, kernel-fix-developer) with its name, home, window, soul group
  and parent changed, the claim the kernel printed for another agent on the waiting ones, and
  what the kernel says of the session (`running`, `runtimeState`, `sessionEnd`) taken from the
  RECORDED tmux row of its kind (`test/fixtures/lifecycle/tmux-row-{running,stopped,lost}.json`,
  OATS 0.70.5): one that runs has `running: true` and no word; one stopped with OATS `running:
  false`, the word "shell" and `sessionEnd: "stopped"`; one whose session was lost `running:
  false`, no word and `sessionEnd: "lost"`. These rows are DERIVED, not recorded. The scene
  holds: every one is a row that says its state, its soul and "tmux" (the longest row, "Stopped · oats-contrib-developer · session lost · tmux", is ONE line: the reason shortens, then leaves the row, and only then the soul shortens; the state and the glyph never; and with every session lost every row keeps that order); the foot counts every
  agent that waits; no row is over three lines (the name on one or two, cut only after the
  second; the second block on one line); the
  selected row of a bb-thread agent with a name longer than two lines holds it cut after the
  second, whole in its title; the last row and the foot can be scrolled into view; a row opens
  its agent's own page.
  The stage also holds the ONE TREE and its fold: as the page loads the roots alone are drawn,
  every root that has agents under it with its chevron closed (four of them on tmux), and the two
  closed tmux parents that hide a waiting agent carry its mark; then every parent is opened by its
  chevron and each tmux agent that has a parent is under it, one step in, a child's child two.
  A scene of its own draws the PILOT'S OWN ROSTER SHAPE (`tmux-roster.mjs` `PILOT_ROSTER`: eight
  agents on tmux and none on a thread, every session lost, one a child of another; made-up names,
  derived rows like the stage's): seven rows and one closed parent as the page loads; opened, the
  child under it; closed again with the child waiting, the parent first, saying what it is itself
  and carrying the child's mark; opened, the child second. A scene may draw a roster of its own
  (`tmuxStatus(as, roster)`) and puts the stage's back. In the pilot's image pass
  (`LIVE_PILOT_IMAGES`, by hand) that scene archives the test container's own threads for its
  images and puts them back (`ownThreads`): bb's own pane may then differ in the views after it.
- **LR**, by hand only, never in CI: `LOCAL_STATUS=<path> container/ci.sh live` draws ONE stage,
  `local-roster`, from an `oats status --json` answer of a real deployment, with the release's
  default pages (the setting `pages` left as a fresh install has it, unset with bb's own `plugin
  config oats unset pages`, as in the stage `pages-default` and the real run's default-pages
  images: an unset setting is what is proven to hide the other pages, not the value "home"), and
  nothing else of the live run's scenes. The file is copied to the
  container's `/tmp`, never into the tree; the stage archives the run's own bb threads first
  (and puts them back), so that what stands under the roster is what that deployment's bb would
  show; the log holds counts only, on every path (a file that is no JSON, a roster that does not
  arrive, a failed contrast check print no name); the images are in `container/out/`
  (`local-roster-<width>-sidebar[-dark].png`), which git ignores: they stay with whoever ran it.
- **A14** with `oats` removed after it was read: the roster stays as last read under the notice
  ("OATS is not installed on …", "Read <age>. Acts are off.", Retry, Open settings; what to do,
  the code and the message under its Details); a thread opens from it and its own row says the
  same on one line, with its act off; the home keeps its cards under the same notice.
- **A16** an agent whose thread bb does not have: its soul's page says of it what the roster says ("archived in bb" or "deleted in bb"), and
  Retire opens the plan dialog with the kernel's plan. Then the two states no fixture row is in,
  each in the thread's own row and in the sidebar's: an agent the kernel cannot reach
  ("Unreachable", Retry) and one whose session fell back to a shell ("Failed", "session ended",
  Restart); and the agent whose bb thread is gone, which stays in the
  roster and says "deleted in bb".
  With A13's rows, all six states are drawn, each with its word.
- **A13**, a tmux agent's terminal (`scenes/terminal.mjs`, on the fixtures): the page of the tmux agent
  that runs has Terminal over its attach command; pressed, bb is asked for a terminal on the command the
  server answered (the fake `oats` by its absolute path) and refuses it (the fixtures' home is not on
  the disk), and the page says "Terminal did not open." with its fold: the command, and bb's own words. The live checks have no
  tmux: that the tab comes up attached, takes keys and is one per agent is the real run's
  (`real/parts/on-tmux.mjs`).
- **OUTA**, **OUT**, **OUTH**, **OUTQ** (`scenes/outside.mjs`, in the order they run; stages of its own) every row of the table of
  "Outside OATS" (`../README.md`) on the sidebar's rows, on each thread's line and on the agent's
  own page. OUT, one roster: stopped with its thread archived, stopped on an open thread, the
  kernel's `outsideOats`, a session lost with its thread archived and with its thread deleted,
  failed, unreachable; and the home's card of the agent that runs outside OATS, counted as the
  roster's foot counts it. OUTH: the three rows that read "not running" side by side (an operator's
  stop, a session lost, idle with no harness loaded), asserting the state word and the
  tone of each, that the lost one and the one that is not loaded say "message to continue" and
  have no Start… on their line, and that Start… on the page of the one that is not loaded opens
  the lifecycle's Start dialog, which says first that a message in the thread carries the
  conversation on. OUTA:
  the three agents whose thread bb has archived, side by side (an operator's stop: plain, with its
  soul; a session lost, and an agent that still runs: the warning mark and "may still run"), and
  the archived thread's own row of the one that still runs. OUTQ:
  the first roster while bb holds a question on the thread of the agent that runs outside OATS.
  What bb says of a thread is true in bb: the stage archives the threads it says
  are archived (and unarchives them when it ends), and the deleted one is an id bb has no thread
  of. bb's question is a real one (the mock model asks it, once, when OUTQ is entered), answered
  when that stage ends. The scenes also assert: every row's state word is one of the set; a row
  with a reason is two lines, never three; how soon the kernel's report is on the thread's line
  (3 s at most); what bb 0.50.1 itself shows of an archived thread opened from its row (the
  conversation, no composer, "Thread is archived" and its own Unarchive); and that the agent's
  page keeps its header small, with this feature's block first under the tabs.

**The theme** is bb's own appearance choice, not the browser's colour scheme. bb 0.50.1 keeps it in
the browser's storage under the key `bb.theme` (`light`, `dark` or `system`: what its Settings,
Appearance writes) and puts the class `dark` on the document's root when it loads; no server
setting and no `bb settings` key holds it. `browser.mjs` sets that key before any script of bb
runs, and each check asserts the theme bb then draws. The screenshots are
`<check>-<width>x<height>-<scene>.png` in the light theme and `…-dark.png` in the dark one (in
`container/out/`, kept as CI artefacts).

**The contrast check** runs at every screenshot, in the theme of that page, and fails the run: each
text the plugin draws there reads at 4.5:1 or more against its effective background, and each
mark at 3:1 or more against what is behind it (the WCAG contrast ratio, from the computed
colours). It covers every rendered element with text of its own inside the plugin's elements
(`data-testid="oats-…"`: the sidebar block and tree, the thread's row, the home's
cards and lists, the Workspace page's tabs, the New agent form with its refusal and its preview, the plan dialog,
and the buttons that are enabled in a scene: default, primary and destructive), what a field
shows (the typed value of an input or a textarea, the chosen option of a select, or the
placeholder of an empty one), and the marks (a state's in each of its seven states, a toned dot, a row's mark). A failing scene
prints every distinct row that fails. What it checks is
what is in the page when the screenshot is taken, on screen or not: at 390 wide bb keeps its
closed drawer mounted in some loads and not in others, so the sidebar's texts and dots are counted
in some scenes that do not show them, and a line's counts can differ between two runs of one
scene. It cannot see: hover, focus and other states the
page is not in (a failed call's error line, the "Starting…" line, a spawn's problems: no scene
brings them up; they use the same token as the form's refusal, which one does); a disabled
control (skipped, as WCAG does); the options of an open select (the browser draws them); borders,
icons and focus rings; the text of a `display: contents` element (it has no box, so it is skipped
as not rendered); `::before` and `::after` content (generated text is no text node); a background that is an image or a gradient (reported and failed, never
guessed); what a non-ancestor draws over a text; and bb's own UI. `contrast.mjs` says how it
computes.

The plugin's colours are bb's tokens only (`app/ui.tsx`). Where a state needs a colour, it is one
of bb's tokens for coloured text on a surface (`warning-text`, `success-foreground`,
`destructive-text`). As a dot's fill they hold 3:1 against the surface in both themes, on an open
or hovered row too; bb's fill tokens (`attention` and `success` in the light theme, `destructive`
in the dark one) and a fixed palette colour (`amber-500`, `green-500`) do not. As text they hold
4.5:1 on a page or a dialog (a refusal is `destructive-text`), but not on an open row
(`warning-text` reads 4.35:1 there in the light theme): a row's texts, the "?" of an agent that
needs you among them, are `foreground` or `muted-foreground`. `bg-destructive` is left only as the
fill of the destructive button, under `destructive-foreground` text.

To work in a container for a while:

```sh
KEEP=1 NAME=bb-plugin-dev plugin/container/ci.sh unit
# after an edit: copy the tree in again (from plugin/), then run what you need
tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out . | docker exec -i -u node bb-plugin-dev tar -x -C /home/node/plugin
docker exec -u node -w /home/node/plugin bb-plugin-dev npx vitest run test/kernel
docker exec -u node -w /home/node/plugin bb-plugin-dev bash container/live.sh
docker rm -f bb-plugin-dev
```

`ci.sh` also copies the bb session provider's two manifests (`oats-package/oats-package.json`,
`oats-package/capabilities/oats-bb/oats.json`) beside the plugin, to `/home/node/oats-package/`:
`test/kernel-compat.test.ts` holds the plugin's OATS floor against theirs. A container made by hand
needs them there too.

## Only inside the checks' container

The entry scripts here CHANGE THE MACHINE THEY RUN ON: `live-ui.mjs` renames `oats` and `claude` and
sets bb's concurrency limit; the setups install bb, Claude Code, the kernel and pi for the user and
write the user's settings; the real run removes and makes a workspace. They are for the checks'
container alone. Run by mistake on a person's machine, each REFUSES before it touches anything:

    refused: live-ui.mjs runs only inside the container of the oats-bb plugin checks (it changes the machine it runs on); start it with plugin/container/ci.sh, never by hand

(exit 97). The guard is one line at the very top of each: `. "$(dirname "$0")/guard.sh"` in a shell
script, `import "./guard.mjs";` as the first import of a `.mjs`.

**The mark** is a file that only the image built from this directory's `Dockerfile` carries,
`/etc/oats-bb-checks-image`. A file and not an environment variable: the scripts start their own
processes with a bare environment (`env -i`), and a variable is inherited by whatever a person's
shell starts. Not `/.dockerenv`: every container has that one, a person's too.

Guarded: `setup.sh`, `live.sh`, `live-ui.mjs`, `locked-install.sh`, `real/setup.sh`,
`real/workspace.sh`, `real/scenario.mjs`, `real/pi/setup.sh`, `real/pi/scenario.mjs`,
`real/mail/inside.sh`, `real/mail/check.mjs`. NOT guarded, and why: the four that run on the host
and start the container (`ci.sh`, `real/run.sh`, `real/mail/run.sh`, `relock.sh`: they write their
own `out/` alone); and the tools that change nothing but the directory they are handed, or only
read, which unit tests run on any machine (`unit.sh`, the two `no-…-fetch.sh`, `fake-oats.mjs`,
the mocks, `real/oats-record.mjs`, `real/bb-logs.sh`, `real/bb-plugin-command.sh`).
`test/container-guard.test.ts` holds the lists: it runs each guarded script in a made-up home that
holds a `claude`, an `oats` and settings, with the mark made absent, and reads that nothing of it
changed; a new script of this directory must be put in one of the lists.

**A container made from an older image has no mark**: build the image again (`ci.sh` does) before
you run a guarded script in it.

## The busy workspace: every screen's worst case

The stage `busy` (`live-ui.mjs`, `busyStage`) answers the ONE shared busy set
(`test/fixtures/busy/`, its README: sixty agents four levels deep, 52 of them on bb threads, eleven
asking, 24 souls, 37 automations, seven teams, five machines, names of sixty characters, and one
agent with a long conversation, a full board and a full page of mail). Every screen has a worst-case twin here, and it
is the one judged first.

**To add your screen's busy scene**: one more scene in your feature's file under `scenes/`, with
`stage: "busy"`, and its images named `busy-<view>-<what>`. Nothing else: no fixture of your own, no
stage of your own. The fake `oats` answers `status`, `souls`, `teams`, `server list`, `schedule
list`, `trigger list` and `operation run messaging:mail` from the set for the stage's length. (The
set holds ONE agent's mail, the busy chat's: the mail read answers it for EVERY agent.) A verb the set does not hold (yours)
answers its recorded fixture as always; if your screen needs a busy answer of it, the answer goes
INTO the set, made by its generator from your recorded answer (`test/fixtures/busy/generate.mjs`,
whose test holds that every busy row is a recorded row with only names, ids, times and relations
varied): ask the set's owner, never shape one beside it.

What the stage does when it starts. It takes under three minutes (about seventy seconds when it
was built), and its `NOTE BUSY` line says the seconds of each part in every run's log:
1. the busy chat's thread is made and its ten turns are had with the mock model (`say.json`,
   `real/mock-anthropic.mjs`);
2. every busy agent on bb with no turn to run gets a thread of this run, an idle fork of a fixture
   thread, titled as the provider titles it (bb's limit of running threads is raised BEFORE any
   thread is made: a fork that has to wait fails in bb 0.50.1, "Stored queued message … is
   malformed", HTTP 500, because the wait of a thread with no message cannot be stored);
3. the three agents that FAILED AT THEIR START get a thread that did: Claude Code is taken away
   for the length of their spawns, the model named (with none, bb asks the harness for its
   default and refuses the spawn), and bb's record of each is checked: an error and never a turn;
   they are read again once Claude Code is back;
4. each agent the set says runs gets a thread of its own whose first turn is HELD open (bb, not
   the kernel, says that an agent on a thread works). bb holds a new turn in line once as many
   threads run as the host has processors (its built-in "concurrency limit": two in this
   container), and everything made after waits behind it: the stage raises the host's limit for
   its length, at its very start (`bb concurrency-limit host <id> <n>`), and puts bb's own back
   (`auto`), which is read back;
5. the thread of each agent whose session was lost on bb is archived, and so are the fixtures' own
   agents' threads; bb's request for a star is turned off (the chat alone is ten prompts).
When it leaves, each thing it changed is put back and READ: the held turns are answered (no
thread of its own is active), its threads are archived, bb says of the host's limit what it said
before, the star request is turned on again (bb's answer to that is checked), the fixtures' threads are back and the fake `oats` answers
the fixtures' roster again, which is waited for. A run that is killed while Claude Code is away
finds where it was at its next start and puts it back.

A busy scene MEASURES what the worst-case rule asks and the screen does not yet do, and prints it
as a `NOTE` (the roster's: rows, names cut, New agent on the screen): a number in every run's log,
not a failure, until its mend is ruled.

By hand: `LIVE_ONLY_STAGES=busy` runs the stage alone.

## Against a real kernel

`real/` holds the other run: the plugin against a real OATS kernel and the bb session provider,
with Claude Code on a mock model, in the same image. It is where the recorded fixtures come from.
It is the last stage of `ci.sh all`, in a container of its own; `real/README.md` says what it
does, which kernel it runs and how to run another.

```sh
plugin/container/ci.sh real       # or: plugin/container/real/run.sh
```

Where the host's Docker DNS forwarder is unreliable, pass a resolver:
`DOCKER_RUN_ARGS="--dns 1.1.1.1" plugin/container/ci.sh`.
