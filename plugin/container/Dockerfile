# The image the plugin's tests run in. It holds only the operating-system tools: bb, the plugin SDK
# and the plugin's dependencies are installed by container/setup.sh inside a running container, so
# the installs get the container's CPU and memory limits too (container/README.md). bb-app (with
# the build toolchain it would fetch by itself) and pi come from committed locks
# (container/locks/README.md): no version is resolved when a check runs.
# tmux is for the real run's one agent on the tmux backend (container/real/parts/lost.mjs).
FROM node:22
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium procps tmux \
  && rm -rf /var/lib/apt/lists/*
USER node
ENV BB_TELEMETRY=false \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /home/node/plugin
CMD ["sleep", "infinity"]
