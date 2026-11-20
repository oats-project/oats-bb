# The plugin's test container

bb, its npm packages and this plugin's dependencies are installed and run only in a container:
never `npm install` on the host. One command does everything:

```sh
plugin/container/ci.sh            # image, installs, typecheck, unit tests, build, live tests
plugin/container/ci.sh unit       # typecheck, unit tests and the build
plugin/container/ci.sh live       # the live tests
```

The paths here are from the repository's root; the scripts find the plugin by their own place, so
they run from any directory. CI runs the first line (`.github/workflows/plugin.yml`).

The container gets `--cpus 2 --memory 6g`, no mount, no port, no Docker socket and nothing of the
host's home; the plugin's directory goes in through `tar` and the artefacts come out to
`plugin/container/out/` (ignored by git). bb runs sovereign: no account, `BB_TELEMETRY=false`, bound to loopback.

| File | Runs | Does |
|---|---|---|
| `Dockerfile` | `docker build` | node 22, chromium (the live tests' browser) and procps; no bb and no npm package |
| `ci.sh` | on the host | builds the image, starts the container, copies the plugin's directory in, reads the repository's bb pin, runs the scripts below, copies `out/` back, removes the container |
| `setup.sh` | in the container | `npm install -g bb-app@<the pinned version>`, `npm ci` |
| `unit.sh` | in the container | `tsc --noEmit`, `vitest run`, `bb plugin build` |
| `live.sh` | in the container | starts bb-app, makes a deployment and a bb project in it, installs the fake `oats` and the plugin, and checks L1, L2, L3, A14 (backend), A15, G1 and A15b (below); runs `live-ui.mjs` when the app is in the tree |
| `fake-oats.mjs` | as `oats` | prints the recorded answer of the verb it is asked (`test/fixtures/`) and logs each call; a JSON file beside it sets a verb's output, exit code, delay, or makes it start a child of its own |

The bb version: `ci.sh` reads the one line of `bb-version` at the repository's root when that file
exists and hands it to `setup.sh` as `BB_VERSION`; with no such file, or run by hand in a
container, `setup.sh` takes `devDependencies["bb-app"]` of `package.json`. A pin that differs from
`package.json`'s stops the run: the unit tests and the build would use one bb and the live tests
another.

The live checks of the backend:

- **L1** the installed plugin reads the deployment through the host entry (`bb plugin rpc call oats snapshot`).
- **L2** with the poll off (no RPC for 50 s), one line appended to `<deployment>/.agents/events/` makes the server run `oats status`: the host watch, the `changed` signal, the reread. The proof is the fake's call log.
- **L3** an `oats status` slower than the kernel's 20 s limit is the typed `OATS_TIMEOUT` in the snapshot, about 20 s after the read starts (the check allows the 5 s floor before it): bb's retry of a retryable host call does not cut it short. The check asserts the code and the time; a second `status` in the fake's log is the server's next reread, started after the first ended.
- **A14** (the backend's part) with `oats` removed, the snapshot says what is missing and bb's own lists answer; with `oats` back, the snapshot is back.
- **A15** `bb plugin reload oats` while a fake `oats` sleeps and holds a child of its own: neither process is left.
- **G1** the README's install route: `bb plugin install git:<repository>@<ref> --subdirectory plugin`, from a local repository that holds this tree as `plugin/`. A git install gets the manifest's `dependencies` only, so this fails when something the build needs is left in `devDependencies`.
- **A15b** the same as A15 when bb itself is stopped.

To work in a container for a while:

```sh
KEEP=1 NAME=bb-plugin-dev plugin/container/ci.sh unit
# after an edit: copy the tree in again (from plugin/), then run what you need
tar -c --exclude ./node_modules --exclude ./dist --exclude ./container/out . | docker exec -i -u node bb-plugin-dev tar -x -C /home/node/plugin
docker exec -u node -w /home/node/plugin bb-plugin-dev npx vitest run test/kernel
docker exec -u node -w /home/node/plugin bb-plugin-dev bash container/live.sh
docker rm -f bb-plugin-dev
```

Where the host's Docker DNS forwarder is unreliable, pass a resolver:
`DOCKER_RUN_ARGS="--dns 1.1.1.1" plugin/container/ci.sh`.
