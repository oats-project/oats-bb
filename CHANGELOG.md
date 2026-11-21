# Changelog

## 0.1.0

The first release of oats-bb: OATS agents run as bb threads, beside the kernel's tmux
backend. It contains:

- **the session provider `oats.bb`** (`oats-package/`, package `oats.bb` 0.1.0), which runs
  an OATS instance as one bb thread;
- **the OATS plugin for bb** (`plugin/`), which shows OATS agents in bb and acts on them
  through `oats`;
- **the team image for bb** (`container/`).

**It needs:**
- OATS 0.70.0 or later;
- oats.aweb 1.45.0 or later;
- bb-app 0.50.1 exactly (`bb-version`); another version is refused with `E_BACKEND_VERSION`;
- Claude Code. pi and Codex are not supported yet.

Install: [README.md, "Install"](README.md#install).

### Full mode only, and no sandbox boundary

- **bb agents run only in bb's full mode (`--yolo`), with no sandbox between the agent and the
  account bb runs as.** bb's sandboxed modes limit accidents, not a determined agent, so this
  release claims no boundary. A launch in a sandboxed mode is refused before anything starts
  (`E_BACKEND_SANDBOXED_MODE`).
- **The plugin's Spawn always asks for full mode, and doesn't ask you.** Every spawn from bb
  is `oats spawn <soul> --backend bb --yolo`. The New agent form says so in one line ("Runs in
  bb's full mode: no sandbox."), and there is no switch. A deployment needs no full-mode
  default for the plugin's Spawn.
- **Elsewhere, a spawn must choose full mode.** A spawn from the CLI or the Desktop with
  `--backend bb` needs `--yolo`, or a default launch configuration that sets `yolo: true`.
  Without one it is refused with `E_BACKEND_SANDBOXED_MODE`.
- **Start and Restart keep the mode the home was spawned with.** A home spawned without full
  mode is refused when it starts on bb, from the plugin too.
- **A full-mode launch rewrites the bb home's `.claude/settings.local.json`.** It removes
  `sandbox`, `permissions.deny` and `permissions.blockWritesOutsideWorkingDirectories` from
  that file and rewrites `env`. An entry of your own under one of those four keys is not kept.
  Every other key, such as `permissions.allow`, is left as it is.
  (README.md, "What the kernel gets", under "The sandbox").

### Evidence

Released after the plugin's real run against OATS 0.70.0 from npm, with the package's own
floor and no trial commit, on a deployment with no launch configuration (oats-bb#12, #14 and
#15, in CI). That run doesn't cover a real model, aweb mail, or bb's phone app.
