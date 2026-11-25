# The contract-test image: the pinned bb-app and Claude Code, nothing of OATS.
# bb's API is unauthenticated and runs commands (bb docs/multiple-devices.md), so bb runs
# only inside this container, on its loopback; no port is published and nothing of the
# host is mounted but this repository, read-only.
#
# Built from test/contract (docker build -f test/contract/Dockerfile test/contract). Its
# tools come from a committed lock, locks/claude (locks/README.md): `npm ci`, every package
# at its version with its integrity checked, nothing resolved when the image is built.
FROM node:22-bookworm
# The pinned bb-app: the repository's bb-version file, passed by the test. The lock is the
# one that installs it: a lock of another version fails the build here.
ARG BB_APP_VERSION
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
COPY --chown=node:node locks/install.sh locks/claude/package.json locks/claude/package-lock.json /home/node/tools/
RUN sh /home/node/tools/install.sh \
 && test "$(bb --version)" = "${BB_APP_VERSION:?the build is told the pinned bb-app (--build-arg BB_APP_VERSION)}"
WORKDIR /home/node
CMD ["sleep", "infinity"]
