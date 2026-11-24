# Locks: the tools the checks install, each as one exact tree

A tool the container checks install from npm at run time has a directory here:

- `package.json` names the tool's package at an exact version (its `tool`: the package whose
  commands go on the PATH), and beside it only what the tool would fetch from npm BY ITSELF when it
  runs, at the versions the tool asks for;
- `package-lock.json` is the lock npm wrote for it: every package of its tree, with its version,
  where it comes from and its integrity.

`../locked-install.sh <tool>` installs it in the container with `npm ci`: exactly what the lock
names, each package's integrity checked, **nothing resolved at run time**. The tree goes to
`~/tools/<tool>` and the package's own commands are linked onto the PATH. An install is tried
three times, five minutes each: for the network, which is all that is left to fail.

Why: `npm install -g <package>` resolves the package's dependencies when it runs. On 24 Nov 2026
the pi check failed on main because one package under pi had been published two minutes before
and the registry did not serve it yet (a 404, three times). A version published upstream must not
be able to change or fail a run of ours.

| tool | package | used by | its pin |
|---|---|---|---|
| `bb-app` | `bb-app`, and bb's build toolchain (below) | every stage (`../setup.sh`) | `bb-version` at the repository's root, and `plugin/package.json`; the toolchain's four versions are bb-app's own |
| `pi` | `@earendil-works/pi-coding-agent` | the pi run (`../real/pi/setup.sh`) | `PI_VERSION` and `PI_INTEGRITY` there |

In bb-app's lock the packages under `node_modules/npm/node_modules/` have no integrity of their
own: npm ships its dependencies inside its own tarball (`inBundle`), which has one.

## bb's build toolchain

bb builds a plugin with four packages at versions of its own (`esbuild`, `@tailwindcss/node`,
`@tailwindcss/oxide`, `tailwindcss`: `PLUGIN_TOOLCHAIN_PINS` in bb-app's server). Where they do not
resolve, at exactly those versions, from bb-app's own module path, bb **installs them itself**,
with its bundled npm and no lock, into `<its data directory>/plugins/toolchain-<versions>`: the
four are exact, what is under `@tailwindcss/node` is by range and resolved that minute. That is an
`npm install` at run time in every stage, made by the tool and not by a script of ours:

- `bb plugin install .` and the install from git (the live, real and pi stages), by the installed
  bb-app: its lock names the four beside bb-app, so they are in its tree;
- `npx bb plugin build` (the unit stage), by the plugin's own bb-app (a dev dependency of
  `plugin/package.json`): the four are dev dependencies of the plugin too, in
  `plugin/package-lock.json`. Dev dependencies only: a deployment's install of the plugin takes
  `dependencies` alone (bb's install from git omits dev; the live check G1 holds that its tree
  has none of the four).

bb falls back to the fetch **silently**. Two things catch a bb whose four versions moved without
the locks: the unit test reads the four from bb-app's own server and holds both places against
them; and `../no-toolchain-fetch.sh`, run after every build and install of the plugin and at the
end of the real and pi runs, fails a run in which a `toolchain-*` directory appeared.

## What a lock costs

The checks run the tree **of the day the lock was written**, not the tree a person gets from npm
today with `npm install -g bb-app@<version>`. A break upstream, in a package under bb-app or pi, is
no longer seen by a check: it is seen when the lock is written again. So a lock is renewed not
only when its pin moves:

- **at every move of the pin** (the unit test fails until it is);
- **before each release of this repository**, as a step of the release's preparation: write both
  locks again, run the checks on the result, and commit what changed. A release is then tested on
  the tree a person installing that day gets.

## What is not locked, and why

- **The OATS kernel** (`../real/setup.sh`): its registry tarball is fetched once and checked
  against `KERNEL_INTEGRITY`, and it has two dependencies, both at an exact version and with none
  of their own (`yaml`, `croner`): nothing under it can move. It stays a global install: its
  install path is in what the real run records (the `injects/` paths of the kernel, in the
  fixtures), and a lock's tree lives elsewhere.
- **The OATS bridge for pi** (`../real/pi/setup.sh`): pi installs that one package, checked against
  its tarball file by file; it brings nothing with it.
- **Claude Code** (`../real/setup.sh`, `../live.sh`): no dependencies; its optional ones are its
  own platform binaries, at its own exact version.
- **The plugin's dependencies**: `npm ci`, from `plugin/package-lock.json`, as before. bb's own
  install of the plugin from git (the live check G1) runs `npm install --omit=dev` in its clone,
  which holds that same lock: it resolves nothing.
- **The image** (`../Dockerfile`): `node:22` and three packages of the distribution, at the
  image's build. Not npm, and not pinned here.

## Known, and not closed

**pi fetches two tools by itself, from github.com, at their latest release.** pi 1.5.2 downloads
`fd` and `ripgrep` when its interactive mode starts, or when its `grep` or `find` tool runs, and
neither is on the PATH (the image has neither). The checks drive pi through bb, without its
interactive mode, and their mock model calls neither tool: so no check resolves them today. A
check that did would take whatever was released that minute. It is not npm, and a lock does not
reach it: the fix is the two packages in the image, a change of its own.

## When a pin moves

One command writes a tool's lock again, from its `package.json`:

```sh
plugin/container/relock.sh <tool>      # bb-app, pi
```

For a moved pin, change the version in `locks/<tool>/package.json` first; to renew a lock at the
same version, just run it. Commit both files with the pin that moved:

- **pi**: `PI_VERSION` and `PI_INTEGRITY` in `../real/pi/setup.sh` (the lock's line for pi's own
  tarball holds the integrity to put there);
- **bb-app**: `bb-version` and `plugin/package.json`'s `bb-app` (`../../../container/README.md`,
  "Changing bb's version"); `plugin/package.json` changed, so the plugin's own lock is written
  again too: `plugin/container/relock.sh plugin`. If the new bb-app asks for other versions of its build toolchain (the
  unit test says so, with the versions), put them in `locks/bb-app/package.json` AND in
  `plugin/package.json`'s dev dependencies, then run `plugin/container/relock.sh bb-app` and
  `plugin/container/relock.sh plugin`. The second writes the plugin's own lock
  (`plugin/package-lock.json`) with the lock that is there sent in beside `package.json`: npm keeps
  every version it holds and adds only the new ones, so what a deployment installs does not move.

The lock is written by npm 11, whatever npm the image has (npm 10 drops the `libc` field of
platform packages, and `npm ci` then also installs their musl builds). It runs npm in a container of the tests'
image, with no mount, and installs nothing (`npm install --package-lock-only`). A unit test
(`../../test/container-locks.test.ts`) holds each lock against the pin it serves: a pin moved
without its lock, or a lock without its pin, fails there.

A lock is renewed only on purpose: it is also what keeps a run of today the same as a run of
last week.
