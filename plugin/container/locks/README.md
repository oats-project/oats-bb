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

| tool | package | used by |
|---|---|---|
| `pi` | `@earendil-works/pi-coding-agent` | the pi run (`../real/pi/setup.sh`) |

## When a pin moves

One command writes a tool's lock again, from its `package.json`:

```sh
plugin/container/relock.sh <tool>
```

Change the version in `locks/<tool>/package.json` first, run it, and commit both files with the
pin that moved (for pi: `PI_VERSION` and `PI_INTEGRITY` in `../real/pi/setup.sh`; the lock's line
for pi's own tarball holds the integrity to put there). It runs npm in a container of the tests'
image, with no mount, and installs nothing (`npm install --package-lock-only`). A unit test
(`../../test/container-locks.test.ts`) holds each lock against the pin it serves: a pin moved
without its lock, or a lock without its pin, fails there.

A lock is renewed only on purpose: it is also what keeps a run of today the same as a run of
last week.
