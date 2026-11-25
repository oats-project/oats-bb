# Locks: what the contract images install from npm, each as one exact tree

The three contract images (`../Dockerfile`, `../sandbox/Dockerfile`, `../pi/Dockerfile`) install
their npm tools from a lock here, the same shape the plugin's checks use
(`plugin/container/locks/README.md`, which says why at length):

- `<image>/package.json` names each package at an exact version, its `tools` (the packages
  whose commands go on the PATH), and beside them only what a tool would fetch from npm BY
  ITSELF when it runs: bb's build toolchain (below);
- `<image>/package-lock.json` is the lock npm wrote for it: every package of its tree, with its
  version, where it comes from and its integrity.

`install.sh`, copied into the image with the lock, installs it with `npm ci`: exactly what the
lock names, each package's integrity checked, **nothing resolved when an image is built**. The
tree is in `~/tools` and the tools' own commands are linked onto the PATH. An install is tried
three times, five minutes each: for the network, which is all that is left to fail.

Why: `npm install -g <package>` resolves the package's dependencies when it runs, so every build
of an image took whatever was published that minute, and a hiccup of the registry under one of
them failed the contract job (the plugin's pi check failed that way on 24 Nov 2026).

| lock | packages | images | its pins |
|---|---|---|---|
| `claude` | `bb-app` and bb's build toolchain, `@anthropic-ai/claude-code` | `../Dockerfile`, `../sandbox/Dockerfile` | `bb-version` at the repository's root; the toolchain's four versions are bb-app's own |
| `pi` | `bb-app` and bb's build toolchain, `@earendil-works/pi-coding-agent`, `@awebai/oats`, `@anthropic-ai/claude-code` | `../pi/Dockerfile` | the same; the kernel is the provider's floor (`compatibility.oats` in the capability's `oats.json`) |

The images are built from `test/contract` (`docker build -f <Dockerfile> test/contract`;
`../.dockerignore` sends a build the locks and the pi image's two files only). A build is told
the pinned bb-app (`--build-arg BB_APP_VERSION`, from `bb-version`) and fails where the lock
installed another. `test/unit/contract-locks.test.mjs` holds each lock against its pins and its
package.json, and the three Dockerfiles against `npm install`.

## bb's build toolchain

bb builds a plugin with four packages at versions of its own (`esbuild`, `@tailwindcss/node`,
`@tailwindcss/oxide`, `tailwindcss`). Where they do not resolve, at exactly those versions, from
bb-app's own module path, bb installs them itself, with its bundled npm and no lock, into
`<its data directory>/plugins/toolchain-<versions>`, and says nothing: an `npm install` as a test
runs (`plugin/container/locks/README.md`, "bb's build toolchain", has it at length). The title
contract test installs a plugin (`../title-service`), and bb fetched the toolchain for it, a server
with nothing to bundle, on an image without the four (seen at bb-app 0.50.1).

So each lock names the four beside bb-app, at the versions the plugin's lock holds
(`plugin/container/locks/bb-app/package.json`, which the plugin's unit test holds against bb-app's
own pins): the unit test here holds the two equal. `../title.test.mjs` fails a run in which a
`toolchain-*` directory appeared.

## What a lock costs

The contract tests run the tree **of the day the lock was written**, not the tree a person gets
from npm today. A break upstream, in a package under bb-app or pi, is seen when the lock is
written again, not by a run. So a lock is renewed at every move of a pin (the unit test fails
until it is) and before each release of this repository, with the plugin's.

## When a pin moves

```sh
test/contract/relock.sh <lock>      # claude, pi
```

Change the version in `locks/<lock>/package.json` first (bb-app, its toolchain and Claude Code in
both: the unit test holds them equal, and the toolchain equal to the plugin's lock); to renew a lock at the same versions, just run it. Commit both files with
the pin that moved. The lock is written by npm 11 in a container with no mount, and installs
nothing (`npm install --package-lock-only --ignore-scripts`).

## What is not locked, and why

- **The OATS bridge for pi** (`../pi/Dockerfile`, `pi install npm:@awebai/oats-pi@<the kernel's
  version>`): pi installs that one package at an exact version, into its own configuration, as a
  deployment does; it brings nothing with it.
- **The aweb extension for pi** (`../pi/Dockerfile`, `pi install npm:@awebai/pi@<version>`, into the
  second pi configuration, the one readiness must refuse): pi installs it at an exact version, and
  it depends on `@awebai/aw` by a range, which is resolved when the image is built. Known, and
  not closed: what the tests read there is pi's own `settings.json` as `pi install` writes it, so
  the install stays pi's.
- **The kernel under test in the kernel runs** (`../kernel/setup.sh`): packed from a checkout and
  installed globally, with its two exact dependencies. CI does not run them.
- **The images' base** (`node:22-bookworm`) and the sandbox image's three packages of the
  distribution: taken at the build. Not npm, and not pinned here.
