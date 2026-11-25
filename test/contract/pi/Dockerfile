# The contract-test image for pi threads: the pinned bb-app, pi, and what the home's pi
# needs of OATS (the kernel, which @awebai/oats-pi loads, and @awebai/oats-pi itself, in
# the pi configuration bb's server runs with). And Claude Code, for the one test that moves
# a home between the two harnesses; test/contract/Dockerfile is the image for Claude threads.
#
# bb's API is unauthenticated and runs commands (bb docs/multiple-devices.md), so bb runs
# only inside this container, on its loopback; no port is published and nothing of the
# host is mounted but this repository, read-only. The models are mocks on loopback
# (test/contract/mock-openai.mjs, mock-anthropic.mjs): no credential.
#
# Built from test/contract (docker build -f test/contract/pi/Dockerfile test/contract). bb-app,
# pi, the kernel and Claude Code come from a committed lock, locks/pi (locks/README.md):
# `npm ci`, every package at its version with its integrity checked, nothing resolved when
# the image is built. The two packages pi installs by itself below are not in a lock:
# locks/README.md, "What is not locked", says what each can bring.
FROM node:22-bookworm
# The pinned bb-app: the repository's bb-version file, passed by the test. The lock is the
# one that installs it: a lock of another version fails the build here.
ARG BB_APP_VERSION
# The aweb extension for pi: what must NOT be in the pi configuration bb's server runs
# with. It is installed into a second configuration, for the readiness check to refuse.
ARG AWEB_PI_VERSION=0.5.0
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
COPY --chown=node:node locks/install.sh locks/pi/package.json locks/pi/package-lock.json /home/node/tools/
RUN sh /home/node/tools/install.sh \
 && test "$(bb --version)" = "${BB_APP_VERSION:?the build is told the pinned bb-app (--build-arg BB_APP_VERSION)}"
WORKDIR /home/node
# The kernel and its pi bridge, one version (the provider's floor): the bridge at the
# version of the kernel the lock names.
# The pi configuration of this container's bb: @awebai/oats-pi, and not @awebai/pi.
RUN pi install "npm:@awebai/oats-pi@$(node -p 'require("/home/node/tools/package.json").dependencies["@awebai/oats"]')"
# A second one, as a host that also runs tmux pi agents has it: both packages.
RUN mkdir -p /home/node/pi-with-aweb \
 && PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi install "npm:@awebai/oats-pi@$(node -p 'require("/home/node/tools/package.json").dependencies["@awebai/oats"]')" \
 && PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi install "npm:@awebai/pi@${AWEB_PI_VERSION}"
# The mock model, and an extension whose tool opens one of pi's blocking dialogs.
COPY --chown=node:node pi/models.json /home/node/.pi/agent/models.json
COPY --chown=node:node pi/contract-dialog.ts /home/node/.pi/agent/extensions/contract-dialog.ts
CMD ["sleep", "infinity"]
