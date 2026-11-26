# SOURCED FIRST, before anything else runs, by every script of this directory that changes the machine it runs
# on (it renames or installs binaries, writes the user's settings, removes directories, sets bb's limits):
#     . "$(dirname "$0")/guard.sh"
# Such a script is for the checks' CONTAINER alone. Run by mistake on a person's machine it would move that
# machine's `claude` and `oats`, install tools for that user and change that bb. So it refuses, with one line and a
# non-zero exit, before it touches anything, wherever the image's MARK is not: a file that only the image built from
# this directory's Dockerfile carries. (Not "/.dockerenv": every container has that one, a person's too.)
# OATS_BB_CHECKS_MARK_ABSENT=1 makes it refuse where the mark IS (for the test of the refusal, which runs inside the
# image): it can only refuse more, never less.
# The same rule for the .mjs entries: guard.mjs. The list of who is guarded: test/container-guard.test.ts.
if [ ! -f /etc/oats-bb-checks-image ] || [ "${OATS_BB_CHECKS_MARK_ABSENT:-}" = 1 ]; then
  echo "refused: $(basename "$0") runs only inside the container of the oats-bb plugin checks (it changes the machine it runs on); start it with plugin/container/ci.sh, never by hand" >&2
  exit 97
fi
