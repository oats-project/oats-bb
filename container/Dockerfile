# An OATS team image plus one pinned bb server, declared as the base
# supervisor's optional child. Build it FROM a reviewed team image:
#   docker build --build-arg AGENT_IMAGE=<team image> -t <tag> container
ARG AGENT_IMAGE
FROM ${AGENT_IMAGE}

USER root
WORKDIR /opt/bb
COPY package.json package-lock.json ./
COPY agent-child.json /etc/agent-child.json
COPY pi-settings.json /opt/bb/pi/settings.json
COPY bb-server.sh /usr/local/bin/bb-server
# No lifecycle script runs and nothing is rebuilt: bb's native modules are the
# prebuilds in its locked packages. The npm cache stays out of the image's HOME.
# The version file is the one the declaration names; acceptance compares it
# with what `bb --version` prints in the running container. The supervisor
# refuses a declaration that is not a root-owned regular file, or that group
# or others can write, so its owner and mode are set here, not left to the
# build context.
#
# pi, for bb's pi threads: the locked pi and @awebai/oats-pi, and bb's own pi
# configuration, /opt/bb/pi: a settings.json that lists that package at the
# locked version and nothing else, and the package where pi looks for one it
# installed (npm/node_modules), as a link to the locked copy. Root-owned, and
# nothing in it is writable by the agent; bb-server links them into the
# directory pi runs with.
RUN npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/bb-npm \
    && ln -s /opt/bb/node_modules/.bin/bb /usr/local/bin/bb \
    && ln -s /opt/bb/node_modules/.bin/bb-app /usr/local/bin/bb-app \
    && ln -s /opt/bb/node_modules/.bin/pi /usr/local/bin/pi \
    && test ! -L /etc/agent-child.json && test -f /etc/agent-child.json \
    && chown 0:0 /etc/agent-child.json && chmod 0644 /etc/agent-child.json \
    && test ! -L /usr/local/bin/bb-server && test -f /usr/local/bin/bb-server \
    && chown 0:0 /usr/local/bin/bb-server && chmod 0755 /usr/local/bin/bb-server \
    && test ! -L /opt/bb/pi/settings.json && test -f /opt/bb/pi/settings.json \
    && mkdir -p /opt/bb/pi/npm/node_modules/@awebai \
    && ln -s /opt/bb/node_modules/@awebai/oats-pi /opt/bb/pi/npm/node_modules/@awebai/oats-pi \
    && chown -R 0:0 /opt/bb/pi && chmod 0755 /opt/bb/pi && chmod 0644 /opt/bb/pi/settings.json \
    && test "$(node -p 'require("/opt/bb/pi/settings.json").packages.join()')" = "npm:@awebai/oats-pi@$(node -p 'require("./package.json").dependencies["@awebai/oats-pi"]')" \
    && test "$(node -p 'require("/opt/bb/pi/npm/node_modules/@awebai/oats-pi/package.json").version')" = "$(node -p 'require("./package.json").dependencies["@awebai/oats-pi"]')" \
    && test "$(pi --version)" = "$(node -p 'require("./package.json").dependencies["@earendil-works/pi-coding-agent"]')" \
    && version_file="$(node -p 'require("/etc/agent-child.json").version.file')" \
    && mkdir -p "$(dirname "$version_file")" \
    && node -p 'require("./package.json").dependencies["bb-app"]' > "$version_file" \
    && chmod 0644 "$version_file" \
    && test "$(bb --version)" = "$(cat "$version_file")" \
    && rm -rf /tmp/bb-npm /tmp/node-compile-cache

# The team image's entrypoint, HOME and environment stay as they are.
WORKDIR /state
USER agent
