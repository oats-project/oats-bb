# The contract-test image: the pinned bb-app and Claude Code, nothing of OATS.
# bb's API is unauthenticated and runs commands (bb docs/multiple-devices.md), so bb runs
# only inside this container, on its loopback; no port is published and nothing of the
# host is mounted but this repository, read-only.
FROM node:22-bookworm
ARG BB_APP_VERSION=0.50.1
ARG CLAUDE_CODE_VERSION=2.1.328
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
RUN npm install -g --no-audit --no-fund "bb-app@${BB_APP_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
WORKDIR /home/node
CMD ["sleep", "infinity"]
