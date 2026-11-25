# The mail part of the real run

That a person can read an agent's mail in bb, and that reading marks nothing read, shown with the
real things: a real OATS kernel, the real messaging layer (`oats.aweb`) and real `aw`, against
aweb's own local stack, with two agents that mail each other, and bb with the plugin installed.

**It is run BY HAND, and CI does NOT run it.** It is in neither `ci.sh all` nor
`.github/workflows/plugin.yml`: it needs five containers (aweb's stack is four, built from
source), where every other check of the plugin needs one. On a shared host it counts as a WHOLE
run: `uptime` first (wait above 15, run nothing above 20).

```sh
plugin/container/real/mail/run.sh        # about ten minutes the first time (the stack's two images are built)
KEEP=1 plugin/container/real/mail/run.sh # leave the five containers up, to look or to run inside.sh again
```

The artefacts are in `plugin/container/real/mail/out/` (ignored by git): the checks' images
(`mail-real-<width>-list.png`, `-message.png`) and what each setup step printed. No account, no
login, nothing spent: the stack is local, and no agent is launched.

## What it checks (`check.mjs`)

1. The tab **Mail** of the agent's page lists the mail the agent RECEIVED, newest first; the
   message it sent is no row. No mail is read before the tab is pressed.
2. A press shows one message: its subject, its sender's alias first, its lines; the 300 KB body,
   which the messaging layer cut at 16 KiB, says "Shortened."
3. **Nothing is marked read**: `aw mail inbox --count-only` in the agent's home says the same
   before the plugin read anything and after it listed the mail, opened a message and pressed
   Refresh, at both widths.
4. Every `oats` the plugin ran for the mail is
   `operation run messaging:mail --home <the agent's home> --arg limit=50 --json`, and nothing
   else (the plugin's `oatsBin` is a wrapper that keeps each argv and runs the real `oats`).
5. An agent with no messaging layer has no Mail tab.

## What it sets up (`run.sh` on the host, `inside.sh` in the client container)

| Thing | What | Version |
|---|---|---|
| The stack | `compose.yml`: postgres, redis, awid and aweb, built from a checkout of awebai/aweb; no port on the host; each with a CPU and a memory limit; removed at the end, with its volumes | `AWEB_COMMIT`, default 6a460770f9cafc142b20473f11bcf3b49ce81395 |
| The client | the plugin's own test image (`../../Dockerfile`), `--cpus 2 --memory 6g`, no mount, no Docker socket, in awid's network namespace | |
| bb | bb-app from its lock (`../../setup.sh`), sovereign, on loopback | the repository's `bb-version` |
| The kernel, `aw` | `@awebai/oats`, `@awebai/aw`, from npm | `KERNEL_NPM` 0.70.5, `AW_NPM` 1.36.59 (the mail read needs `aw` 1.36.53 or later) |
| The messaging layer | the package `oats.aweb`, with `oats.framework` | `AWEB_PROVIDER` v1.48.0, `FRAMEWORK` v1.26.0 |
| The harness | Claude Code with the `aweb-channel` plugin: a spawn on the harness claude refuses without the harness's package, even with `--no-launch`. Nothing is launched | `CLAUDE_CODE_VERSION` 2.1.332 |
| The team | a namespace of the container's own (`mailreal.test`: `aw id create --skip-dns-verify`), the registry setting (`oats aweb setup --registry`), and a team made by `oats aweb setup --create` | |
| The agents | `mail-reader` and `mail-writer` (two souls with messaging) and `mail-none` (a soul with `messaging: none`), each `oats spawn --no-launch` | |
| The mail | written by `inside.sh`: two messages to `mail-reader` (one of 300 KB) and one from it | |

Every word of mail is made up by the script. Nothing is taken from a real workspace.

## What the stack needs

Two things that awebai/aweb's `docker-compose.e2e.yml` and the `oats-aweb` repository's CI recipe
do not say, and that cost half a day to find (2026-11-25):

- **awid needs `APP_ENV=development` and `AWID_ALLOW_INSECURE_DELIVERY_ORIGIN=1`.** Without them
  `oats aweb setup --create` stops at "publishing the AWID team-server record … failed … http
  422": awid refuses a team's server record on plain http (`server_url_invalid`,
  `awid_service/delivery_origin.py`).
- **The client shares the server's network namespace** (`--network container:<awid>`; aweb has
  `network_mode: service:awid`). A team's server URL may be plain http only on LOOPBACK
  (`awid/team_server_record.py`), and a self-hosted aweb accepts signed requests only for its
  public origin: so aweb must be `http://127.0.0.1:8000` for the client as for itself, and awid
  `http://127.0.0.1:8010`. A service name on a Docker network (`http://aweb:8000`) is refused.

And one of the kernel's: a team must be declared in `oats-workspace.yaml` (`teams:`,
`defaultTeam:`) for a soul to spawn into it; `inside.sh` declares it before it is made.

## The fixtures

The recorded answers the unit tests and the live scenes read (`../../../test/fixtures/mail/`) were
made on this stack by hand on 2026-11-25, with more states than this run sets up (a second team,
an identity moved aside, an older `aw`, an older messaging layer): its README says how each was
made. This run does not write them again.
