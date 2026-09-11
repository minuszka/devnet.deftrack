#!/bin/bash
set -u
# Does the binary actually advertise 70242? Proven on regtest, never on the devnet.
# Negative control: the binary it replaces must answer 70241 from the same probe.
probe() {
  local name="$1" bin="$2" cli="$3" dd="$HOME/v23-proto-check/$1"
  rm -rf "$dd"; mkdir -p "$dd"
  # No rpcuser/rpcpassword at all: defcond writes a .cookie into the datadir
  # and defcon-cli reads it from the same -datadir, so a local probe needs no
  # credential of its own. That is both safer than inventing one and the only
  # form that does not look like a committed secret to a scanner.
  printf 'regtest=1\nserver=1\nlisten=0\n' > "$dd/defcon.conf"
  "$bin" -datadir="$dd" -daemon >/dev/null 2>"$dd/start.err"
  local ok=0
  for _ in $(seq 1 40); do
    if "$cli" -datadir="$dd" getnetworkinfo >"$dd/ni.json" 2>/dev/null; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = 1 ]; then
    printf '%-22s protocolversion=%s  subversion=%s\n' "$name" \
      "$(grep -m1 '"protocolversion"' "$dd/ni.json" | tr -dc '0-9')" \
      "$(grep -m1 '"subversion"' "$dd/ni.json" | sed 's/.*: *"//; s/",*$//')"
  else
    printf '%-22s RPC NEVER ANSWERED (%s)\n' "$name" "$(head -1 "$dd/start.err")"
  fi
  "$cli" -datadir="$dd" stop >/dev/null 2>&1
  sleep 2
}
PREV="$HOME/devnet-bin-prev-25c3966adc"
probe "NEW-fleet-f5693164" "$HOME/DEFCON-fleet/src/defcond" "$HOME/DEFCON-fleet/src/defcon-cli"
probe "OLD-fleet-25c3966a" "$PREV/defcond-fleet"          "$PREV/defcon-cli-fleet"
