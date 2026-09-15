#!/bin/bash
# C6a end-height check, run on the VPS (stdin), read-only. Before 13535 it is
# the control (both retired types still listed and mining); from 13536 on it is
# the measurement for the run's expectations and the closing conditions.
#   llmqType: 1 llmq_50_60, 2 llmq_400_60, 3 llmq_400_85, 4 llmq_100_67, 5 llmq_60_75, 7 llmq_defcon
S=13488
C="sudo -n -u defcon /usr/local/bin/defcon-cli -datadir=/home/defcon/.defcon -conf=/home/defcon/.defcon/defcon.conf"
C2="sudo -n -u defcon /usr/local/bin/defcon-cli -datadir=/home/defcon/.defcon2 -conf=/home/defcon/.defcon2/defcon.conf"
tip=$($C getblockcount)
echo "UTC $(date -u '+%F %T')  tip $tip (end height $S, tip - S = $((tip - S)))  devnet2 tip $($C2 getblockcount)  same hash: $([ "$($C getblockhash $tip)" = "$($C2 getblockhash $tip 2>/dev/null)" ] && echo yes || echo no)"
echo "quorum list types at tip: $($C quorum list | grep -oE '"llmq_[a-z0-9_]+"' | tr -d '"' | tr '\n' ' ')"
echo "best chainlock: $($C getbestchainlock | grep -oE '"height": [0-9]+|"llmqType": "[a-z0-9_]+"' | tr '\n' ' ')"

# Commitments (type 6) by llmqType and quorum height, from S-96 to the tip.
from=$((S - 96)); [ $tip -lt $S ] && from=$((tip - 96)); [ $from -lt 1 ] && from=1
$C getblockhash $from > /dev/null || exit 1
tmp=$(mktemp -d)
for h in $(seq $from $tip); do
  $C getblock "$($C getblockhash $h)" 2 > "$tmp/$h.json" 2>/dev/null
done
python3 - "$tmp" "$from" "$tip" "$S" <<'PY'
import json, os, sys
d, lo, hi, S = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
names = {1: 'llmq_50_60', 2: 'llmq_400_60', 3: 'llmq_400_85', 4: 'llmq_100_67', 5: 'llmq_60_75', 7: 'llmq_defcon'}
rows = []
blocks = {}
for h in range(lo, hi + 1):
    try:
        blocks[h] = json.load(open(os.path.join(d, f'{h}.json')))
    except Exception:
        print(f'  block {h}: unreadable')
hash2height = {b['hash']: h for h, b in blocks.items()}
for h, b in sorted(blocks.items()):
    for tx in b.get('tx', []):
        if tx.get('type') != 6: continue
        c = (tx.get('qcTx') or {}).get('commitment') or {}
        t = c.get('llmqType')
        base = hash2height.get(c.get('quorumHash'), 'base<' + str(lo))
        null = (c.get('signersCount', 0) == 0 and c.get('validMembersCount', 0) == 0)
        rows.append((h, names.get(t, t), base, 'null' if null else f"valid {c.get('validMembersCount')}"))
retired = [r for r in rows if r[1] in ('llmq_50_60', 'llmq_60_75')]
print(f'commitments in blocks {lo}..{hi}: {len(rows)} total')
for r in rows:
    if (r[1] in ('llmq_50_60', 'llmq_60_75') and r[3] != 'null') or (r[0] >= S - 30 and r[3] != 'null'):
        print(f'  block {r[0]}: {r[1]} base {r[2]} {r[3]}')
nulls = {}
for r in rows:
    if r[3] == 'null': nulls.setdefault(r[1], []).append(r[0])
for k, v in nulls.items():
    print(f'  null commitments {k}: {len(v)} in blocks {min(v)}..{max(v)}')
after = [r for r in retired if r[0] >= S]
print(f'RETIRED-TYPE commitments in blocks >= {S}: {len(after)}' + ('' if after else ' (expected 0)'))
PY
rm -rf "$tmp"

# PoSe and Sentinel
$C protx list registered true | python3 -c "
import json,sys
l=json.load(sys.stdin)
pen=[x for x in l if x['state'].get('PoSePenalty',0)>0]; ban=[x for x in l if x['state'].get('PoSeBanHeight',-1) not in (-1,None)]
print(f'PoSe: registered {len(l)} penalty>0 {len(pen)} banned {len(ban)}')"
curl -s 'http://localhost:4100/api/v1/dsl/epochs?limit=4' | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data',{}); items=d.get('items',d if isinstance(d,list) else [])
for e in items[:4]: print('  epoch', e.get('epoch'), 'boundary', e.get('boundaryHeight', e.get('height')), 'status', e.get('status'), 'missed', e.get('missedCount'))" 2>/dev/null
# Explorer: rounds of the retired types at or above the end
curl -s "http://localhost:4100/api/v1/quorum-rounds?llmqName=llmq_50_60&limit=5" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data',{}); items=d.get('items',[])
print('explorer llmq_50_60 latest rounds:', [(i.get('expectedHeight'), i.get('status')) for i in items[:5]])" 2>/dev/null
curl -s "http://localhost:4100/api/v1/quorum-rounds?llmqName=llmq_60_75&limit=5" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data',{}); items=d.get('items',[])
print('explorer llmq_60_75 latest rounds:', [(i.get('expectedHeight'), i.get('status')) for i in items[:5]])" 2>/dev/null
curl -s http://localhost:4100/api/v1/health | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('health', d['status'], d['failing'], 'behind', d['behind'], d['rounds'])"
