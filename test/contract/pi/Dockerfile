# The contract-test image for pi threads: the pinned bb-app, pi, and what the home's pi
# needs of OATS (the kernel, which @awebai/oats-pi loads, and @awebai/oats-pi itself, in
# the pi configuration bb's server runs with). And Claude Code, for the one test that moves
# a home between the two harnesses; test/contract/Dockerfile is the image for Claude threads.
#
# bb's API is unauthenticated and runs commands (bb docs/multiple-devices.md), so bb runs
# only inside this container, on its loopback; no port is published and nothing of the
# host is mounted but this repository, read-only. The models are mocks on loopback
# (test/contract/mock-openai.mjs, mock-anthropic.mjs): no credential.
FROM node:22-bookworm
# The pinned bb-app: the repository's bb-version file, passed by the test.
ARG BB_APP_VERSION
ARG PI_VERSION=1.5.2
ARG CLAUDE_CODE_VERSION=2.1.328
# The kernel and its pi bridge, one version: the provider's floor.
ARG OATS_VERSION=0.70.5
# The aweb extension for pi: what must NOT be in the pi configuration bb's server runs
# with. It is installed into a second configuration, for the readiness check to refuse.
ARG AWEB_PI_VERSION=0.5.0
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
RUN npm install -g --no-audit --no-fund "bb-app@${BB_APP_VERSION}" "@earendil-works/pi-coding-agent@${PI_VERSION}" "@awebai/oats@${OATS_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
WORKDIR /home/node
# The pi configuration of this container's bb: @awebai/oats-pi, and not @awebai/pi.
RUN pi install "npm:@awebai/oats-pi@${OATS_VERSION}"
# A second one, as a host that also runs tmux pi agents has it: both packages.
RUN mkdir -p /home/node/pi-with-aweb \
 && PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi install "npm:@awebai/oats-pi@${OATS_VERSION}" \
 && PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi install "npm:@awebai/pi@${AWEB_PI_VERSION}"
# The mock model, and an extension whose tool opens one of pi's blocking dialogs.
COPY --chown=node:node models.json /home/node/.pi/agent/models.json
COPY --chown=node:node contract-dialog.ts /home/node/.pi/agent/extensions/contract-dialog.ts
CMD ["sleep", "infinity"]
