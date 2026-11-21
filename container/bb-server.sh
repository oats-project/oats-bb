#!/bin/sh
# bb's server in an OATS team container: gives bb's pi its own configuration, then runs
# bb-app with the arguments given. The supervisor's declared child (agent-child.json).
#
# A bb pi thread's mail is delivered by the host wake broker, so nothing in bb's pi may
# hold the agent's mail stream, and the home's skills load only through @awebai/oats-pi
# (the provider's README, "pi"). So bb's server runs pi with a configuration of its own
# (PI_CODING_AGENT_DIR, set in the declaration): the image's settings.json, which lists
# @awebai/oats-pi and nothing else, and the image's copy of that package.
#
# pi writes into its configuration directory (its trust file's lock, its own state), and
# the image's file system is read-only: the directory is on the state volume, and the two
# things that decide what pi loads are links into the image, put back at every start. So
# whatever an agent did to them, a restart of the container restores the image's.
set -eu
dir=${PI_CODING_AGENT_DIR:?bb-server: PI_CODING_AGENT_DIR is not set (the declaration sets it)}
mkdir -p "$dir"
for name in settings.json npm; do
  rm -rf "${dir:?}/$name"
  ln -s "/opt/bb/pi/$name" "$dir/$name"
done
exec /usr/local/bin/bb-app "$@"
