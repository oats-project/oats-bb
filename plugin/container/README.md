# The plugin's test container

bb, its npm packages and this plugin's dependencies are installed and run only in a container:
never `npm install` on the host. One command does everything:

```sh
plugin/container/ci.sh            # image, installs, typecheck, unit tests, build, live tests, the real run
plugin/container/ci.sh unit       # typecheck, unit tests and the build
plugin/container/ci.sh live       # the live tests
plugin/container/ci.sh real       # the run against a real OATS kernel and the bb session provider
```

The paths here are from the repository's root; the scripts find the plugin by their own place, so
they run from any directory. CI runs the three stages of the first line as three jobs side by side,
each on a runner of its own (`.github/workflows/plugin.yml`: `plugin-unit`, `test` for the live
stage, `plugin-real`), so each of the last three lines installs and builds what it needs by itself.

The container gets `--cpus 2 --memory 6g`, no mount, no port, no Docker socket and nothing of the
host's home; the plugin's directory goes in through `tar` and the artefacts come out to
`plugin/container/out/` (ignored by git). The artefacts have an owner (`out/.owner`: the OATS
instance that ran, else the user; `ARTEFACTS_OWNER` to name one): the first to run in a checkout
owns `out/`, and a run by another (a reviewer attached to an author's tree) leaves `out/` as it is
and writes to `out.<owner>/` beside it, so that nobody's images are deleted under them. A run
claims its directory when it starts. An `out/` from before this rule has no owner: the next run
takes it. The real run (`real/`, its own README) has a container
of its own with the same limits, started after the first is gone, and its artefacts are in
`plugin/container/real/out/`. bb runs sovereign: no account, `BB_TELEMETRY=false`, bound to loopback.

| File | Runs | Does |
|---|---|---|
| `Dockerfile` | `docker build` | node 22, chromium (the live tests' browser) and procps; no bb and no npm package |
| `ci.sh` | on the host | builds the image, starts the container, copies the plugin's directory in, reads the repository's bb pin, runs the scripts below, copies `out/` back, removes the container |
| `setup.sh` | in the container | `npm install -g bb-app@<the pinned version>`, `npm ci` |
| `unit.sh` | in the container | `tsc --noEmit`, `vitest run`, the shell test of the real run's wait for a bb plugin's command, `bb plugin build` |
| `live.sh` | in the container | starts bb-app, makes a deployment and a bb project in it, installs the fake `oats` and the plugin, and checks L1, L2, L3, A14 (backend), A15, G1 and A15b (below); runs `live-ui.mjs` when the app is in the tree |
| `live-ui.mjs`, `browser.mjs`, `contrast.mjs` | in the container | the app's live checks (A13, A14, A16) with screenshots at two widths in bb's light and dark themes, the small DevTools-protocol driver of the image's Chromium they use, and the contrast check run at each screenshot (below) |
| `scenes/<feature>.mjs` | by `live-ui.mjs` | each feature's live scenes: what a page is asked and where its screenshots are taken (below) |
| `real/` | its own container | the real run: bb-app, OATS from npm, the bb session provider, Claude Code on a mock model and the plugin (`real/README.md`) |
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
- **L3** an `oats status` slower than the kernel's 20 s limit is the typed `OATS_TIMEOUT` in the snapshot, about 20 s after the read starts (the check allows the pause between two reads, and one read of the poll, before it): bb's retry of a retryable host call does not cut it short. The check asserts the code and the time; a second `status` in the fake's log is the server's next reread, started after the first ended.
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
  shows it idle before any image is taken: an image of a thread shows a healthy one. Each thread
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
- **No two images of a run are the same image** (`images.mjs`), checked at the end.

Beside the features' scenes, `scenes/patterns.mjs` reads the pattern book (`/plugins/oats/patterns`,
`../README.md`, "The patterns: one component each"): every pattern in each of its states, the menu
open, a confirmation before its act, in progress, done, refused and with another agent's plan.

- **A13** the sidebar with the tree, an agent's thread with its header row, the thread of an agent
  that needs you (the thread's own row says "Needs you", since when and its question; in the sidebar
  its row is the open one, with its "!"), the thread of a stopped agent ("Stopped", Start), the home (its badge
  shows 3) and its reply box with a message typed (Send enabled), the four pages, and a soul's
  page with the spawn form: empty, with a name it refuses, and with a name and a task it takes
  and their preview (Preview and Spawn enabled).
- **A14** with `oats` removed after it was read: the roster stays as last read under the notice
  ("OATS is not installed on …", "Showing what was read <age>.", that the acts are held, Retry,
  Open settings); a thread opens from it and its own row says the same on one line, with its act
  off; the home keeps its cards under the same notice.
- **A16** an agent whose thread bb does not have: its soul's page says "thread missing", and
  Retire opens the plan dialog with the kernel's plan. Then the two states no fixture row is in,
  each in the thread's own row and in the sidebar's: an agent the kernel cannot reach
  ("Unreachable", Retry) and one whose session fell back to a shell ("Failed", "Its session
  ended", Restart); and the agent whose bb thread is gone, which stays in the roster and says so.
  With A13's rows, all six states are drawn, each with its word.

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
cards and lists, the four pages, the spawn form with its refusal and its preview, the plan dialog,
and the buttons that are enabled in a scene: default, primary and destructive), what a field
shows (the typed value of an input or a textarea, the chosen option of a select, or the
placeholder of an empty one), and the marks (a state's in each of its six states, a toned dot, a row's mark). A failing scene
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
