#!/usr/bin/env bash
# A minimal lease client in the bash-era format, for the interop test: a ticket per waiter in
# gpu.queue/ (name, pid, epoch), dead tickets swept with `kill -0`, the oldest live ticket takes
# gpu.lock/ with mkdir and writes gpu.lock/holder (name, epoch, minutes, pid).
#   legacy-lease.sh <lease dir> <name> <command...>
set -u
shopt -s nullglob
ROOT="$1"; WHO="$2"; shift 2
LOCK="$ROOT/gpu.lock"; QUEUE="$ROOT/gpu.queue"
mkdir -p "$QUEUE"
T="$QUEUE/${EPOCHREALTIME//[!0-9]/}-$$"
printf '%s\n%s\n%s\n' "$WHO" "$$" "$EPOCHSECONDS" > "$QUEUE/.new-$$"
mv -f "$QUEUE/.new-$$" "$T"
trap 'rm -f "$T"' EXIT
while :; do
  head=""
  for t in "$QUEUE"/[0-9]*; do
    [ -e "$t" ] || continue
    F=(); mapfile -t F < "$t" 2>/dev/null || continue
    if [ -n "${F[1]:-}" ] && kill -0 "${F[1]}" 2>/dev/null; then head="$t"; break; fi
    rm -f "$t"
  done
  if [ "$head" = "$T" ] && mkdir "$LOCK" 2>/dev/null; then break; fi
  sleep 0.05
done
rm -f "$T"; trap - EXIT
printf '%s\n%s\n%s\n%s\n' "$WHO" "$EPOCHSECONDS" 5 "$$" > "$LOCK/holder"
"$@"; rc=$?
rm -rf "$LOCK"
exit "$rc"
