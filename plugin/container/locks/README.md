# Locks: the tools the checks install, each as one exact tree

A tool the container checks install from npm at run time has a directory here:

- `package.json` names ONE package at an exact version;
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
| `bb-app` | `bb-app` | every stage (`../setup.sh`) | `bb-version` at the repository's root, and `plugin/package.json` |
| `pi` | `@earendil-works/pi-coding-agent` | the pi run (`../real/pi/setup.sh`) | `PI_VERSION` and `PI_INTEGRITY` there |

In bb-app's lock the packages under `node_modules/npm/node_modules/` have no integrity of their
own: npm ships its dependencies inside its own tarball (`inBundle`), which has one.

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
- **The plugin's dependencies**: `npm ci`, from `plugin/package-lock.json`, as before.
- **The image** (`../Dockerfile`): `node:22` and three packages of the distribution, at the
  image's build. Not npm, and not pinned here.

## When a pin moves

One command writes a tool's lock again, from its `package.json`:

```sh
plugin/container/relock.sh <tool>
```

For a moved pin, change the version in `locks/<tool>/package.json` first; to renew a lock at the
same version, just run it. Commit both files with the pin that moved (for pi: `PI_VERSION` and
`PI_INTEGRITY` in `../real/pi/setup.sh`; the lock's line for pi's own tarball holds the integrity
to put there. For bb-app: `bb-version` and `plugin/package.json`). It runs npm in a container of the tests'
image, with no mount, and installs nothing (`npm install --package-lock-only`). A unit test
(`../../test/container-locks.test.ts`) holds each lock against the pin it serves: a pin moved
without its lock, or a lock without its pin, fails there.

A lock is renewed only on purpose: it is also what keeps a run of today the same as a run of
last week.
