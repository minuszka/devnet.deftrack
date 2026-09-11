#!/bin/bash
# Runs ON THE VPS. The proof-of-stake rules, checked on the blocks produced
# AFTER the roll, on the new binary.
#
# What is checkable from RPC, and what is not:
#   #162 nonce must be 0 on a PoS block        -> readable (getblock .nonce)
#   #163 coinbase bounded by subsidy + fees    -> readable (coinstake mint)
#   #171 PoS fee burning, devnet gate 7920     -> readable: the coinstake mints
#        exactly the subsidy and leaves the block's fees unclaimed
#   #165 block time strictly after predecessor -> readable
#   #164 stake modifier from the kernel        -> NOT exposed by any RPC. It can
#        only be shown by a reindex reaching the same tip hash, which is why the
#        7560 rollout proved it that way. Reported here as "not checkable", never
#        as a pass.
#
# getblock verbosity 2, not getblockstats: getblockstats aborted on every PoS
# block until #166 and its fee loop reaches the coinstake, whose outputs exceed
# its inputs by the reward.
set -uo pipefail
D=/home/defcon/.defcon
C="sudo -u defcon defcon-cli -datadir=$D"
FROM="${1:?usage: posv2-check.sh <fromHeight> [toHeight]}"
TO="${2:-$($C getblockcount)}"
SUBSIDY=50000000000   # 500 DFCN in satoshi, the PoS reward after lastPowBlock

echo "checking PoS blocks $FROM..$TO"
bad_nonce=0; bad_time=0; bad_mint=0; checked=0; errors=0
prev_time=0
for h in $(seq "$FROM" "$TO"); do
  bh=$($C getblockhash "$h" 2>/dev/null) || { errors=$((errors+1)); continue; }
  j=$($C getblock "$bh" 2 2>/dev/null) || { errors=$((errors+1)); continue; }
  nonce=$(printf '%s' "$j" | jq -r '.nonce')
  t=$(printf '%s' "$j" | jq -r '.time')
  ntx=$(printf '%s' "$j" | jq -r '.tx | length')
  # The coinstake is tx[1]. Its mint is outputs - inputs; inputs are the
  # prevouts, which verbosity 2 does not expand, so the mint is read from the
  # value balance the node reports for the block instead: sum of coinstake
  # outputs minus the staked input value, via gettxout on the prevout.
  out_sum=$(printf '%s' "$j" | jq -r '[.tx[1].vout[].value] | add // 0')
  pin_txid=$(printf '%s' "$j" | jq -r '.tx[1].vin[0].txid // empty')
  pin_n=$(printf '%s' "$j" | jq -r '.tx[1].vin[0].vout // empty')
  in_val=0
  if [ -n "$pin_txid" ]; then
    in_val=$($C getrawtransaction "$pin_txid" 1 2>/dev/null | jq -r --argjson n "${pin_n:-0}" '.vout[$n].value // 0' 2>/dev/null || echo 0)
  fi
  mint=$(awk -v a="$out_sum" -v b="${in_val:-0}" 'BEGIN {printf "%.8f", a - b}')
  want=$(awk -v s="$SUBSIDY" 'BEGIN {printf "%.8f", s/100000000}')
  checked=$((checked+1))
  [ "$nonce" != "0" ] && { bad_nonce=$((bad_nonce+1)); echo "  $h: nonce=$nonce (must be 0)"; }
  if [ "$prev_time" -ne 0 ] && [ "$t" -le "$prev_time" ]; then
    bad_time=$((bad_time+1)); echo "  $h: time $t not after predecessor $prev_time"
  fi
  prev_time=$t
  if [ "$mint" != "$want" ]; then
    bad_mint=$((bad_mint+1)); echo "  $h: coinstake minted $mint, subsidy is $want (txs=$ntx)"
  fi
done
echo "---"
echo "blocks checked:            $checked"
echo "RPC errors:                $errors   (counted, never scored as a pass)"
echo "#162 non-zero nonce:       $bad_nonce   (must be 0)"
echo "#165 time not increasing:  $bad_time   (must be 0)"
echo "#163/#171 mint != subsidy: $bad_mint   (must be 0: fees are burned, not claimed)"
echo "#164 stake modifier:       NOT CHECKABLE from RPC -- needs a reindex to the same tip hash"
