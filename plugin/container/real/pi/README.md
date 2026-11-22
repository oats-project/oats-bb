# The pi run: a pi agent, launched from the New agent form

The real run (`../README.md`) launches Claude Code only, on the kernel the fixtures were recorded
at. This directory is a second run, for one question: **can a person launch a pi agent on bb from
the plugin's New agent form, and does the plugin then show what that agent needs?** It runs in the
same container, with the same setup and workspace, on the kernel a pi deployment runs, with what
pi needs added.

```sh
plugin/container/ci.sh pi         # or: REAL_PI=1 plugin/container/real/run.sh
```

It is not part of `ci.sh all`: CI runs it as a job of its own (`.github/workflows/plugin.yml`,
`pi`), so the main run's time does not grow. It changes nothing of the main run: it records no
fixture (`UPDATE_FIXTURES=1` is refused), and its artefacts are in `real/pi/out/` (or
`real/pi/out.<owner>/`: `../../README.md`): the run's log is what `run.sh` prints, and beside it
are the images, `answers/` (what the kernel printed for the form's preview and spawn),
`kernel.json` and `bridge.json` (what npm says of the two tarballs), `doctor.txt`, `bb.out`,
`pi-mock.out` and `pi-mock-requests.jsonl` (the model requests). A run takes about four minutes.

The first recorded run is of 2026-11-22: OATS 0.70.3 from npm (`@awebai/oats@0.70.3`, gitHead
`38217e1ddb0356d5b9a2c16d1b0d1e304bca365f`), `@awebai/oats-pi@0.70.3`, pi 1.5.2
(`@earendil-works/pi-coding-agent`), bb-app at the root `bb-version` (0.50.1), the bb session
provider of this checkout, no aweb. It was also the first run of the plugin against a kernel newer
than 0.70.0.

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_NPM`, `KERNEL_INTEGRITY` | `0.70.3`, that tarball's integrity | as the main run's; the kernel of this run |
| `OATS_PI_INTEGRITY` | the integrity of `@awebai/oats-pi@0.70.3`, for that version; none for another | the bridge's tarball, checked before pi installs it; what pi installed is then compared with that tarball, file by file. The bridge's VERSION is never chosen: it is the installed kernel's (the two are released together and tested only as a pair). A kernel that is on no release has no bridge, and this run stops there |
| `PI_VERSION` | `1.5.2` | pi: the version the bb session provider is checked against |
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

Everything a person does, the run does in a browser, in the New agent form; after each act it
reads `oats status --json` (the real `oats`), bb and the mock's log, and each check prints what it
read.

- **P0** The plugin reads the deployment on this kernel; bb reports its pi provider ready; bb's pi
  configuration lists the bridge at the kernel's version and nothing else; the plugin's harness
  list holds pi.
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
- **P5** The plugin stops the agent and retires it.

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
  when asked again. It is the provider's documented limit (its README, "Stopping"). The run waits
  for that pi to leave before it retires, and prints how long it waited (53 s in the first run).
- **The claim of a dialog reads `running: true`** in `oats status` while the dialog is open (the
  thread is in its turn), as the question Claude Code asks does in the main run.
