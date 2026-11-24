# The pi run: a pi agent, launched from the New agent form

The real run (`../README.md`) launches Claude Code only. This directory is a second run, for one question: **can a person launch a pi agent on bb from
the plugin's New agent form, and does the plugin then show what that agent needs?** It runs in the
same container, with the same setup and workspace and on the same kernel, with what pi needs
added.

```sh
plugin/container/ci.sh pi         # or: REAL_PI=1 plugin/container/real/run.sh
```

It is not part of `ci.sh all`: CI runs it as a job of its own (`.github/workflows/plugin.yml`,
`plugin-pi`, one more beside `plugin-unit`, the two live jobs and `plugin-real`), so the main run's
time does not grow. It changes nothing of the main run: it records no
fixture (`UPDATE_FIXTURES=1` is refused), and its artefacts are in `real/pi/out/` (or
`real/pi/out.<owner>/`: `../../README.md`): the run's log is what `run.sh` prints, and beside it
are the images, `answers/` (what the kernel printed for the form's preview and spawn, for the
two refusals the run makes, and for P6's spawn and `oats status`; the last is the source of a
fixture copied by hand: "The fixture P6 is the source of", below),
`kernel.json`, `bridge.json` and `pi.json` (what npm says of the three tarballs), `doctor.txt`, `bb.out`,
`pi-mock.out` and `pi-mock-requests.jsonl` (the model requests). A run takes about five and a half
minutes (338 s from the start of `ci.sh pi` to its end, on 2026-11-24; P6 is about two of them).

The run is of 2026-11-22: OATS 0.70.5 from npm (`@awebai/oats@0.70.5`, gitHead
`e5e7a2a48db42140718948553e8272fb4e8e3ed4`), `@awebai/oats-pi@0.70.5`, pi 1.5.2
(`@earendil-works/pi-coding-agent`), bb-app at the root `bb-version` (0.50.1), the bb session
provider of this checkout, no aweb. Its first runs, the same day, were on 0.70.3: the first runs of
the plugin against a kernel newer than 0.70.0.

Its kernel is the real run's: one pin, in `../run.sh` (`KERNEL_NPM`, `KERNEL_INTEGRITY`). When that
pin moves, one thing moves here: in `setup.sh`, the bridge tarball's integrity for that version
(the bridge's version follows the kernel's by itself), with the versions named in this file. For
one run on another release, with no edit: `KERNEL_NPM=<version> KERNEL_INTEGRITY=…
OATS_PI_INTEGRITY=… plugin/container/ci.sh pi`.

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_NPM`, `KERNEL_INTEGRITY` | the main run's (`0.70.5`, that tarball's integrity) | the kernel of this run: the same pin |
| `OATS_PI_INTEGRITY` | the integrity of `@awebai/oats-pi@0.70.5`, for that version; none for another | the bridge's tarball, checked before pi installs it; what pi installed is then compared with that tarball, file by file. The bridge's VERSION is never chosen: it is the installed kernel's (the two are released together and tested only as a pair). A kernel that is on no release has no bridge, and this run stops there |
| `PI_VERSION` | `1.5.2` | pi: the version the bb session provider is checked against |
| `PI_INTEGRITY` | the integrity of `@earendil-works/pi-coding-agent@1.5.2`, for that version; none for another | pi's own tarball, checked before it is installed (that file is what is installed; its dependencies come from the registry). A mismatch stops the setup |
| the others | as the main run | `REQUIRE_REAL_FLOOR`, `KEEP`, `NAME`, `IMAGE`, `DOCKER_RUN_ARGS` |

## What is in the container, beside the main run's

| File | Runs | Does |
|---|---|---|
| `setup.sh` | by `../setup.sh` when `REAL_PI=1`, after the kernel is installed and before bb starts | installs pi; checks the bridge's tarball, installs the bridge into bb's pi configuration (`~/.pi/agent`) and compares what was installed with that tarball; stops if `@awebai/pi` is listed there; writes the mock model's provider (`models.json`); copies `ask-dialog.ts`; starts `mock-openai.mjs` |
| `mock-openai.mjs` | in the container, on 9998 | the mock model for pi: one line of text for every turn, and one tool call where a person's message says so (`MOCK-CALL:<json>`) |
| `ask-dialog.ts` | by pi, as an extension of bb's pi configuration | one tool, `ask_person`, that opens one of pi's dialogs (`ctx.ui.confirm`) |
| `scenario.mjs` | in the container | the run itself: the acts, the checks, the images |

The rest is the main run's, unchanged: the image, bb-app, the provider as a package, the workspace
and its souls (each `launch: { harness: claude }`: no soul is changed for pi), the deployment with
no launch configuration, the recording wrapper, the plugin installed from the checkout. The pages
shown are the release's default (`home` alone), as the pilot has them. What a deployment must have
for pi is in `../README.md`, "pi agents".

## What the run does

Everything a person does, the run does in a browser, in the New agent form (P1 to P4); P0b and P5
call the plugin's RPC, as its UI does. After each act it reads `oats status --json` (the real
`oats`), bb and the mock's log, and each check prints what it read.

- **P0** The plugin reads the deployment on this kernel; bb reports its pi provider ready; bb's pi
  configuration lists the bridge at the kernel's version and nothing else; the plugin's harness
  list holds pi.
- **P0b a preview the kernel refuses.** With the bridge taken out of bb's pi configuration for the
  time of one call, the plugin's preview with the harness pi is refused by the provider's own
  check of the planned launch (`E_BACKEND_NOT_READY`; a kernel from 0.70.1 refuses at the preview
  what it would refuse at the spawn), and the plugin's `spawnPlan` answers the kernel's code and
  message unchanged: what the form puts under Details, below its own sentence. This step opens no
  page. The kernel's answer is kept as `answers/spawn-preview-pi-refused.json`. The
  configuration is put back, and the next preview answers.
- **P1 the preview.** From the sidebar's New agent: a soul, the harness **pi** from the provider's
  list, the model `mock/echo` from the models bb lists for its pi provider, an instruction and a
  name. The form's column reads "Harness pi · mock/echo" from the kernel's preview; the `oats`
  call the form made carries `--harness pi --model mock/echo --backend bb --yolo --preview`, and
  the kernel's answer has the launch on pi. At each view.
- **P2 the spawn.** Spawn, once: the form opens the new agent's thread, the one the kernel names;
  `oats status` has the agent on bb, on pi; bb has a thread of its pi provider; pi asked the model
  with the opening instruction, and the thread is idle. The thread's own row says "Idle", and the
  thread shows pi's answer.
- **P3 the agent's own needs-input.** A message makes the mock have pi run `oats instance
  attention --message …` with its own shell tool. That it works is also the proof that the three
  variables of a pi launch (`OATS_INSTANCE`, `OATS_INSTANCE_HOME`, `PATH`) reached pi through
  the bb project's env. `oats status` has the claim (`producer: "agent"`); the home's card shows
  the agent's message and the thread's status line says "Needs you" with it. The agent clears it.
- **P4 a dialog's question.** A message makes the mock call `ask_person`: pi opens a confirm
  dialog, bb holds a pending interaction (`provider-pi/extension-ui`), and the bridge sets a claim
  (`producer: "oats.pi"`, `reason: "question"`, the dialog's title). The home's card shows the
  question with Yes and No, and the thread's status line says it. The last view presses Yes on the
  card: bb has no pending interaction left, pi's tool gets `true`, the claim is gone, the agent is
  idle.
- **P4b Restart holds what it cannot start.** On the pi agent's own page, Restart… opens the
  dialog; a model is typed in "Model for this start". bb lists pi's models as `<provider>/<id>`
  (the mock's: `mock/echo`, and `mock/nested/echo2`, which is only listed). `echo` and
  `nested/echo2` (bare ids: the id minus its provider) ARM Restart; `echo2` (which a listed id only
  ends in) and `nosuchmodel` are HELD: "Not found" on the field and beside the button, Restart off.
  Nothing is confirmed: the button is off and the dialog is still as it was after a press (that is
  the proof); the wrapper has no `oats session restart` and no `oats instance stop` since the
  dialog opened, and, since the wrapper writes a call's record when the call ENDS, its records are
  read once more after P5's stop for a restart; the agent still runs on its thread. The hold rests
  on bb's list as the app reads it, not on the kernel's refusal: the kernel stops the running
  session before the provider judges the model (plugin/README.md, "Restart does not stop what it
  cannot start").
- **P5** The plugin stops the agent and retires it, each from its plan: the plan's facts (what the
  dialogs word) name the pi agent, its soul, its home and bb, and no other agent. The stop leaves
  the pi thread as the provider leaves one (archived, from the provider that archives at stop, or
  open and not active), and the run says which. Between the two,
  where a pi of bb's own still works in the home (below, "What the run found"), the retire is
  asked at once: the kernel refuses it (`E_RUNTIME_QUIESCE_FAILED`, naming that pi), the plugin
  shows the refusal unchanged, nothing is removed, and the kernel's answer is kept as
  `answers/retire-pi-refused.json`, with the call's argv, exit code, stdout and stderr in
  `answers/retire-pi-refused.call.json`. With no such pi in the home the run says so in a NOTE and
  keeps neither file.

- **P6 a thread that fails at its start.** Since the provider checks a pi launch's model
  (`oats-package/capabilities/oats-bb/lib/pi-model.mjs`), a model pi does not have is refused
  before anything starts. One door is left on a real kernel: an id the provider cannot check and
  lets go. The step takes the one that holds whatever else is so, an id that ENDS IN A DATE
  (`mock/echo-20261122`: an id the provider lets go for its date; that bb holds such ids back
  from its list is the provider's own account, `lib/pi-model.mjs`, not shown here), and first
  asserts that bb's list holds no such model. In the New agent form: the harness pi, the model TYPED (Custom…), Spawn.
  The kernel says "launched" and nothing refuses; the form stays busy until bb's status of the new
  thread is past its start and then says **"<Name> did not start"**, with bb's reason under
  Details, Open and Close: no submit, nothing that says "Created", and no thread opened. Open
  leads to the agent's own page. Then, read from the kernel and from bb: WHY the id passes whatever the
  list (the provider's own rule, `piModelVerdict` of the home's copy of `pi-model.mjs`, asked with
  bb's list taken as whole: this id is "unchecked … ends in a date", and an unlisted id with no
  date is refused. In this run the provider's own word at the launch is another one, the partial
  list's, after P0b: "What the run found" below; the step does not rest on it); that nothing told
  a person (the spawn's warnings are empty, and neither answer holds the provider's word); the kernel's
  REAL ROW, a lost session's (`launched: true`, `running: false`, `runtimeState: "stopped"`,
  `sessionEnd: "lost"`, no claim, no `outsideOats`), kept whole as
  `answers/status-failed-at-start.json`; bb's thread in "error" with ONE `system/error`
  (`thread_command_failed`, "Failed to resolve Pi model …") and no `turn/started`; and no request
  of the mock for that model. At each view the plugin says "Failed": the sidebar's row
  ("Failed · <soul>"), the thread's line (the word alone, Start, and "bb says: …" under Details),
  the agent's page (Start… and Retire…, no Restart) and the home's count. It is then retired
  through the plugin, from its plan.

Images, in bb's light theme and its dark one (`…-dark.png`), at 1280x800 and 390x800:
`real-pi-form-…-preview` (and `-fields` at the phone's width, where the form is two screens),
`real-pi-idle-…-thread`, `real-pi-needs-you-…-home` and `-thread`, `real-pi-question-…-home` and
`-thread`, `real-pi-unstarted-…-thread` (its Details open) and `-page`; and one of the form's
result, `real-pi-unstarted-form-1280x800-result`. No two are the same image.

## The fixture P6 is the source of

The run writes no fixture. `answers/status-failed-at-start.json` is `oats status --json` as the
kernel printed it in P6, whole (that agent is the only one left by then). The plugin's fixture
`test/fixtures/outside/status-failed-at-start.json` is copied from it BY HAND, with the main run's
substitutions for the paths and nothing else changed; its README names each
(`../../../test/fixtures/outside/README.md`). To record it again: run this run, copy that answer,
make those substitutions.

## What the run found

- **A soul whose `launch:` names Claude, spawned with the harness pi, has no model.** The kernel's
  preview says `launch.effective.model: null` (the soul's Claude model is not carried to another
  harness), the provider then passes none, and bb's pi starts on its own default model. In this
  container that default has no login. So the run picks the model in the form. A person whose
  souls declare `launch: { harness: pi, model: … }` does not meet this.
- **A retire within about a minute of opening the agent's thread in bb can be refused.** Opening a
  pi thread makes bb list its models, for which bb starts a pi of its own in the agent's home; no
  stop ends it, and it leaves by itself. The kernel refuses to retire a home a process works in
  (`E_RUNTIME_QUIESCE_FAILED: … a process works in its home (pid … pi)`), and the retire succeeds
  when asked again. It is the provider's documented limit (its README, "Stopping"). The run asks
  once while that pi is there, keeps the refusal (P5), waits for the pi to leave and retires; it
  prints how long it waited (33 to 55 s).
- **`running` in `oats status` is true from the spawn to the stop**: it says that a harness (pi) is
  loaded, not that the agent works. It is the same while the agent is idle, while its own claim is
  set and while a dialog is open; that the agent is idle is bb's word for the thread.
- **A thread that failed at its start leaves a lost session's row** (P6): the kernel says
  `launched: true` at the spawn and then reads the home not running, "stopped", `sessionEnd:
  "lost"`. Nothing of the kernel's says that the agent never ran; the provider's warning that it
  could not check the model reaches no answer (P6 asserts it: the spawn's `warnings` are empty,
  and neither the spawn's answer nor the preview's holds that sentence). The plugin tells it from a lost session by bb's events of the thread.
- **After P0b, bb's list of pi's models may be partial, and the provider then refuses no model.**
  P0b takes the bridge out of bb's pi configuration and puts it back, after bb started; the
  provider then finds that pi's settings changed after bb started (`piListMayBePartial`), and
  where the list may be partial it lets an unlisted id go, dated or not. Seen by hand in a kept
  container of this run, at its end: `--model mock/nosuch` was launched and its thread failed at
  its start, like the dated id's. P6 does not rest on it (above).
