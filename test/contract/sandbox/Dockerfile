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
#
# Built from test/contract (docker build -f test/contract/sandbox/Dockerfile test/contract).
# Its npm tools are the first image's, from the same committed lock, locks/claude
# (locks/README.md): `npm ci`, nothing resolved when the image is built. (The three packages
# of the distribution are taken at the build, as the image itself is: not npm, not pinned.)
FROM node:22-bookworm
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends bubblewrap socat ripgrep git >/dev/null \
 && rm -rf /var/lib/apt/lists/*
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
