#!/bin/sh
# Runs ON THE SEED. Reads "port secret" lines on stdin, writes them to a
# mode-600 file, runs the revive, and removes the file whatever happens.
#
# It exists so the operator's command needs no quoting at all:
#
#     ssh devnet-jump /root/getkeys-banned.sh | ssh devnet /root/revive-now.sh
#
# which behaves the same in PowerShell and in a POSIX shell.
#
# Carriage returns are stripped with the octal escape rather than a backslash-r:
# an earlier version of this file was written through a heredoc that ate one
# backslash level, so "tr -d CR" became "tr -d NEWLINE" -- which joined every
# key onto one line and then failed the shape check. \015 cannot be mangled the
# same way.
#
# The keys are never echoed: only how many lines arrived, how many fields each
# has, the secret lengths, and the file's mode.
set -u
KF=/root/expansion-keys.txt
umask 077
tr -d '\015' > "$KF"
trap 'rm -f "$KF"' EXIT INT TERM

n=$(grep -c . "$KF" 2>/dev/null); n=${n:-0}
if [ "$n" = "0" ]; then
  echo "nothing arrived on stdin -- the pipe delivered no keys, so nothing was attempted"
  exit 1
fi

fields=$(awk '{print NF}' "$KF" | sort -u | tr '\n' ' ')
lens=$(awk 'NF==2 {printf "%s ", length($2)}' "$KF")
printf 'keys received: %s   fields per line: %s  secret lengths: %s  mode: %s\n' \
  "$n" "$fields" "$lens" "$(stat -c %a "$KF")"

case "$fields" in
  "2 ") ;;
  *) echo "unexpected shape: every line must be exactly two fields"; exit 1 ;;
esac

# An operator secret is 64 hex characters. Reporting the length is not the same
# as checking it: a test with a 4-character stand-in reached the RPC and was
# refused there, which is one layer later than it should have been.
bad=$(awk 'length($2) != 64 || $2 !~ /^[0-9a-fA-F]+$/ {n++} END {print n+0}' "$KF")
if [ "$bad" != "0" ]; then
  echo "$bad line(s) do not carry a 64-character hex secret -- nothing attempted"
  exit 1
fi

exec /root/revive-expansion.py
