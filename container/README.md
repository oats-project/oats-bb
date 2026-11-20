# A bb server in an OATS team container

[bb](https://github.com/get-bb/bb) (npm `bb-app`, MIT) is a server that runs coding agents
as threads and shows them in a web, desktop and phone app. This directory holds what an
operator needs to run one bb server inside an
[OATS team container](https://github.com/oats-project/oats/blob/main/docs/container.md):

| File | What it is |
|---|---|
| `Dockerfile`, `package.json`, `package-lock.json` | The team image for bb: an OATS team image plus `bb-app`, at the version in the repository's [`bb-version`](../bb-version) file. |
| `agent-child.json` | The declaration: it tells the team image's supervisor how to run bb as its optional child. The image carries it at `/etc/agent-child.json`. |
| `compose.agent.child.yaml` | The Compose fragment that switches the child on: `AGENT_CHILD: "bb"`. |
| `relay.mjs` | The operator's route to bb, over SSH. It runs on the operator's machine, never in an image. |

It is opt-in. A team container that does not use this image and this fragment holds no bb
and runs exactly as before. Use it when agents are spawned with the bb session provider
(`oats spawn --backend bb`, [the provider's README](../README.md)); without that, bb
starts, listens and holds no thread of OATS's.

Not to be confused with `plugin/container/`, which holds the plugin's CI checks.

## Building and selecting the image

Two things, together:

1. **The image.** Build it on a team image you have built and accepted from
   `container/agent` of the OATS repository, **at a commit whose supervisor runs an
   optional child**: the one this repository's
   [container workflow](../.github/workflows/container.yml) pins as `OATS_COMMIT`, which
   is the commit this image is accepted on, or a later one whose `docs/container.md` has
   the section "An optional child". An older team image does not know `AGENT_CHILD`: it
   ignores the fragment, and no bb starts. `AGENT_IMAGE` has no default:

   ```sh
   docker build --platform linux/amd64 \
     --build-arg AGENT_IMAGE=oats-agent:reviewed \
     -t oats-agent-bb:reviewed container
   ```

   It adds only `bb-app`, installed from the committed `package.json` and
   `package-lock.json` with `npm ci --ignore-scripts`: no lifecycle script, no rebuild, no
   OS package. bb's native modules are the prebuilt ones in its locked packages. The image
   keeps the team image's entrypoint, user, `HOME` and environment, and bb runs the Claude
   Code the team image already holds; this image adds no second one. It is about 280 MB
   larger than the team image.

   Select it with `AGENT_IMAGE` in the team's Compose variables.

2. **The fragment.** Append `-f <this checkout>/container/compose.agent.child.yaml` to the
   Compose commands of the team container. It sets `AGENT_CHILD: "bb"` and nothing else.
   Export `AGENT_CHILD=bb` with the other variables when you run the team image's
   acceptance.

The image holds the declaration and the deployment holds the switch. With the fragment on
a team image that has no declaration, the container refuses to start. With this image and
no fragment, no bb starts.

**Changing bb's version.** `bb-version` is the one pin of this repository; a test fails
unless this directory's dependency and lock, the provider's default `version` and the
plugin's build agree with it. So one change moves them all:

- `bb-version`;
- the dependency in `container/package.json`, and the lock in `container/`, regenerated
  with npm 11 or later (`npm install --package-lock-only --ignore-scripts`; npm 10 drops
  the `libc` field of platform packages, and `npm ci` then also installs their musl
  builds);
- the provider's default `version` (`oats-package/`), with its contract test;
- the plugin's `bb-app` dev dependency (`plugin/package.json`), and its `engines.bb`
  range if the new version falls outside it.

Review the two files of this directory and build a new image.

## What runs

After the wake broker is ready and before sshd and `oats host run`, the supervisor starts
`bb-app --no-in-app-updates --server-bind-host 127.0.0.1`, with two additions to its own
environment:

- `BB_TELEMETRY=false`: telemetry is off.
- `CLAUDE_CODE_OAUTH_TOKEN`, read from `/etc/agent-login/claude-token` when that file
  exists, so bb's Claude threads use the team's inference token. The file holds the token
  on one line; a line break or a space inside it refuses the start. bb reads its
  environment once, when it starts: after replacing the token, restart the container.

bb keeps its data in its default directory, `/state/home/.bb`, on the team's state volume.
It needs no getbb.app account. At start it looks up two DNS names, `getbb.app` and
`registry.npmjs.org`. The team's egress boundary refuses both and bb works without them:
neither needs an egress entry. A thread's model calls go through the egress boundary as an
agent's do.

Push notifications need a service outside the container. Keep them off:

```sh
ssh team-agent bb plugin disable push-notifications
```

How the supervisor treats its optional child (the start order, what counts as ready, the
restart after an exit, the stop order and its time budget, and what acceptance checks) is
the team image's, and is described once, in the section "An optional child" of
`docs/container.md` in the OATS repository. Read it at the commit your team image is built
from: a revision without that section has no optional child. For bb the declared values
are: ready when `http://127.0.0.1:38887/status` says `connected: true`, and 8 seconds to
stop before it is killed. A thread's process ends with its bb; the thread itself is kept, the next bb lists
it idle, and a message to it starts a new turn.

## The deployment's settings

The provider's settings go in the `oats-local.yaml` of the deployment inside the
container: `trust: container`, and `version` equal to `bb-version` (its default). They are
described in the provider's README: [Settings](../README.md#settings) and
[A team image: two pins](../README.md#a-team-image-two-pins).

**Spawn bb agents with `--yolo`** in a team container. That is bb's `full` mode: the
container is the boundary, as it is for the other agents there. bb's sandboxed modes need
bubblewrap, which the image does not carry, so without `--yolo` every command of the agent
waits for a person in bb.

## Trust

bb's API has no login. It listens on the container's loopback only: on ports 38886 (the
server) and 38887 (its host daemon), and on one more loopback port that bb picks at each
start. The service publishes no port. Inside the container:

- Any agent can read and drive every bb thread: read it, send it a message, start one,
  stop one.
- Any agent can read bb's database under `/state/home/.bb`. It holds every conversation of
  every thread. It is on `/state`, so it outlives the container and is in any copy of the
  volume, and OATS never trims it.
- The token in bb's environment is the one every agent can already read.
- The threads of one bb share writable thread storage: any agent, one in a sandboxed bb
  thread included, can write every other thread's storage under `/state/home/.bb`.
- bb's sandboxed permission modes (`auto`, `accept-edits`) are not a security boundary.
  They limit accidents, not a determined agent. Treat an agent in such a mode as able to
  do what any agent in the container can.

One bb serves one container. Never share one across teams, and never point two containers
at one `/state`.

## Reaching it

bb listens only inside the container, and sshd's forwarding stays off. The operator
reaches bb over the SSH route they already have to the team container, with the relay. It
needs only Node and `ssh` on the operator's machine:

```sh
node container/relay.mjs --ssh team-agent --listen 48886
```

It listens on `127.0.0.1:48886` and nowhere else; it refuses any other address. Each
connection becomes one SSH command channel to the container, whose command pipes to bb on
`127.0.0.1:38886` there. The relay keeps up to nine channels on one SSH connection of its
own and opens a separate connection for each one beyond that. If the shared connection
ends, the relay starts it again; meanwhile new connections work, each on a connection of
its own. TERM or Ctrl+C closes the listener and every channel. Use one local port per
team.

- **Desktop app, on the same machine.** Server menu, Add Server,
  `http://127.0.0.1:48886`. Add one server per team and name it. Nothing is set in bb.
- **Phone, or another machine.** Serve the relay's port under HTTPS on your own tailnet,
  one port per team (Tailscale Serve:
  `tailscale serve --bg --https=443 http://127.0.0.1:48886`). bb refuses a name it was not
  told about, so set it once, over the SSH route:

  ```sh
  ssh team-agent bb-app config set BB_APP_URL 'https://<name>[:port]'
  ```

  Then add one Direct profile per team in the app, with that URL.

**Whoever reaches the relay's port, or that name, runs commands in that team's
container**: bb starts agents and terminals for anyone who can talk to it. The relay's
port has no login, so every local user of the machine it runs on can reach it. Run the
relay only on a machine whose only user is the operator. The tailnet's access rules for
that name are part of the team's boundary too. Never use Tailscale Funnel or any public
address for it, and never make the relay listen wider.

## Limits

bb counts toward the container's limits. Add to `AGENT_MEMORY` and `AGENT_PIDS` about
650 MB and 180 pids for bb itself, and about 200 MB and 30 pids for each live thread.

## What was run

Each pull request here builds a team image from one pinned commit of the OATS repository,
builds this image on it, starts it under that commit's Compose files with this fragment,
and runs that commit's acceptance with `AGENT_CHILD=bb`
([the workflow](../.github/workflows/container.yml)). It uses no token and no model.

Run by hand on amd64, on an earlier commit of the same OATS change (`e1b23202`): both
builds; the start (broker, then bb
ready in about 3 seconds, then sshd and host run); `bb --version` equal to the pin; the
ordered stop (host run first, then sshd, the broker and bb, each exiting 0); and that
acceptance, which checks the declaration file, bb's two declared ports, that nothing but
sshd listens beyond loopback, and the declared version.

Run before the move, on the image and relay as they were in the OATS repository (the relay
is unchanged): a bb restart after `kill` and after `kill -9`, each followed by a new turn
in a thread made before it, on a mock model; and the relay with the real `ssh`, the bb web
page and API through it.

**NOT RUN:** arm64; Tailscale Serve; the desktop and phone apps; push notifications.
