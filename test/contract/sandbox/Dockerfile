# The second contract-test image: the first one (the pinned bb-app and Claude Code) plus
# what Claude Code's sandbox needs to start on Linux (bubblewrap, socat) and ripgrep, so
# bb's sandboxed modes really run sandboxed here. The first image has none of them on
# purpose: it is what the hardened team image looks like.
#
# The container that runs it needs to let bubblewrap make its namespaces:
#   --security-opt seccomp=unconfined --security-opt apparmor=unconfined
#   --security-opt systempaths=unconfined
# (test/contract/sandbox.test.mjs passes them). It has no network of its own beyond
# loopback needs: bb, the mock model endpoint and the provider all run inside it.
FROM node:22-bookworm
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends bubblewrap socat ripgrep git >/dev/null \
 && rm -rf /var/lib/apt/lists/*
# The pinned bb-app: the repository's bb-version file, passed by the test.
ARG BB_APP_VERSION
ARG CLAUDE_CODE_VERSION=2.1.328
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
RUN npm install -g --no-audit --no-fund "bb-app@${BB_APP_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
WORKDIR /home/node
CMD ["sleep", "infinity"]
