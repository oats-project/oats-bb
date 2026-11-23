# The pi run: a pi agent, launched from the New agent form

The real run (`../README.md`) launches Claude Code only. This directory is a second run, for one question: **can a person launch a pi agent on bb from
the plugin's New agent form, and does the plugin then show what that agent needs?** It runs in the
same container, with the same setup and workspace and on the same kernel, with what pi needs
added.

```sh
plugin/container/ci.sh pi         # or: REAL_PI=1 plugin/container/real/run.sh
```

It is not part of `ci.sh all`: CI runs it as a job of its own (`.github/workflows/plugin.yml`,
`plugin-pi`, the fourth beside `plugin-unit`, `test` and `plugin-real`), so the main run's time does
not grow. It changes nothing of the main run: it records no
fixture (`UPDATE_FIXTURES=1` is refused), and its artefacts are in `real/pi/out/` (or
`real/pi/out.<owner>/`: `../../README.md`): the run's log is what `run.sh` prints, and beside it
are the images, `answers/` (what the kernel printed for the form's preview and spawn, and for the
two refusals the run makes),
`kernel.json`, `bridge.json` and `pi.json` (what npm says of the three tarballs), `doctor.txt`, `bb.out`,
`pi-mock.out` and `pi-mock-requests.jsonl` (the model requests). A run takes about four minutes.

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

Images, in bb's light theme and its dark one (`…-dark.png`), at 1280x800 and 390x800:
`real-pi-form-…-preview` (and `-fields` at the phone's width, where the form is two screens),
`real-pi-idle-…-thread`, `real-pi-needs-you-…-home` and `-thread`, `real-pi-question-…-home` and
`-thread`. No two are the same image.

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
