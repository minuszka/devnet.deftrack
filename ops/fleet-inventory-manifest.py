#!/usr/bin/env python3
"""Runs ON THE VPS. Builds the devnet fleet inventory manifest from the raw
collector output and the explorer's own private operator map, cross-checks it
against what the explorer indexed from the chain, writes it to a private file,
and asks the read-only inventory-preview endpoint for the import diff.

Prints no address. Writes nothing into the registry."""
import json, os, sys, urllib.request

RAW = os.path.expanduser('~/fleet-manifest-raw.txt')
OUT = os.path.expanduser('~/fleet-manifest-devnet.json')
API = 'http://127.0.0.1:4100/api/v1'
KEY = os.environ['ADMIN_API_KEY']
INVENTORY_ID = os.environ.get('INVENTORY_ID', 'devnet-fleet-2026-09-05')


def get(path, admin=False):
    req = urllib.request.Request(API + path)
    if admin:
        req.add_header('x-admin-api-key', KEY)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)['data']


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method='POST')
    req.add_header('x-admin-api-key', KEY)
    req.add_header('content-type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


# ---- raw lines -> hosts
hosts = {}
for line in open(RAW, encoding='utf-8'):
    line = line.rstrip('\n')
    if not line:
        continue
    ip, kind, *rest = line.split('|')
    h = hosts.setdefault(ip, {'ip': ip, 'units': []})
    if kind == 'HOST':
        h['hostname'], h['build'], h['observer'] = rest[0], rest[1], (rest[2] or None)
    elif kind == 'UNIT':
        if rest[1] == 'missing-conf':
            raise SystemExit(f'unit mn{rest[0]} on a host has no conf')
        n, port, ext, role, ptx, active = rest
        h['units'].append({'n': int(n), 'port': int(port), 'ext': ext, 'role': role,
                           'proTxHash': ptx.lower() or None, 'active': active})

# ---- operator map (private admin API): IP -> operatorLabel
ops = get('/admin/operators', admin=True)
label_of = {}
for o in ops['operators']:
    for ip in o['hostIps']:
        label_of[ip] = o['operatorLabel']

# ---- what the explorer indexed from the chain: proTxHash -> hostIp
mns = get('/masternodes?limit=200')
chain = {m['proTxHash'].lower(): m for m in mns['items']}

problems = []
targets = []
for ip, h in sorted(hosts.items(), key=lambda kv: label_of.get(kv[0], kv[0])):
    op = label_of.get(ip)
    if op is None:
        problems.append(f'host {h.get("hostname")} has no operator label in the explorer')
        continue
    host_ref = h['observer'] or op
    labels = ['devnet-fleet', 'dao' if op.startswith('op-') else 'roland-shared']
    if h['observer']:
        labels.append('observer')
    if len(h['build']) != 64:
        problems.append(f'{host_ref}: build hash is not 64 hex')
    for u in sorted(h['units'], key=lambda u: u['n']):
        ext_ip = u['ext'].rsplit(':', 1)[0] if u['ext'] else ip
        if ext_ip != ip:
            problems.append(f'{host_ref} mn{u["n"]}: externalip host differs from the inventory address')
        if u['role'] == 'masternode':
            if not u['proTxHash']:
                problems.append(f'{host_ref} mn{u["n"]}: masternode without proTxHash (daemon down?)')
                continue
            m = chain.get(u['proTxHash'])
            if m is None:
                problems.append(f'{host_ref} mn{u["n"]}: proTxHash unknown to the explorer')
            elif m.get('operatorLabel') != op:
                # The public row pseudonymises the host, so the operator label
                # is the cross-check: one operator per host on this devnet.
                problems.append(f'{host_ref} mn{u["n"]}: explorer attributes this proTx to {m.get("operatorLabel")}, manifest says {op}')
            if u['active'] != 'active':
                problems.append(f'{host_ref} mn{u["n"]}: unit is {u["active"]}')
            target_id = f'{host_ref}-mn{u["n"]}'
            display = f'{host_ref} mn{u["n"]}'
        else:
            target_id = f'{host_ref}-staker'
            display = f'{host_ref} staker (mn{u["n"]})'
        targets.append({
            'targetId': target_id,
            'displayLabel': display,
            'operatorId': op,
            'proTxHash': u['proTxHash'],
            'hostRef': host_ref,
            'chainHostRef': ip,
            'unitRef': f'defcon-devnet-mn@{u["n"]}',
            'p2pPort': u['port'],
            'role': u['role'],
            'network': 'devnet',
            'capabilities': ['service-control'],
            'expectedBuild': h['build'],
            'labels': labels,
            'maintenance': False,
        })

per_host = {}
for t in targets:
    per_host[t['hostRef']] = per_host.get(t['hostRef'], 0) + 1
manifest = {
    'schemaVersion': 1,
    'inventoryId': INVENTORY_ID,
    'network': 'devnet',
    'expectedHostCount': 16,
    'limits': {'maxEnabledTargetsTotal': 160, 'maxEnabledTargetsPerHost': 14},
    'targets': targets,
}

mn_count = sum(1 for t in targets if t['role'] == 'masternode')
st_count = sum(1 for t in targets if t['role'] == 'staker')
covered = {t['proTxHash'] for t in targets if t['proTxHash']}
missing_from_manifest = [p for p in chain if p not in covered]
print(f'hosts={len(per_host)} targets={len(targets)} masternodes={mn_count} stakers={st_count}')
print('per host:', ', '.join(f'{k}={v}' for k, v in sorted(per_host.items())))
print(f'explorer masternodes={len(chain)} covered={len(covered)} not-in-manifest={len(missing_from_manifest)}')
print('builds:', sorted({t['expectedBuild'][:12] for t in targets}))
if problems:
    print('PROBLEMS:')
    for p in problems:
        print('  -', p)
if missing_from_manifest:
    print('explorer proTx not in manifest:', [p[:8] for p in missing_from_manifest])

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=1)
os.chmod(OUT, 0o600)
print('written', OUT, os.path.getsize(OUT), 'bytes')

status, body = post('/admin/simulations/targets/inventory-preview', {'manifest': manifest})
print('preview http', status)
if status == 200:
    d = body['data']
    print('manifest:', json.dumps(d['manifest']))
    p = d['preview']
    print('preview: create=%d update=%d unchanged=%d undeclared=%d enabledMappingChanges=%d' % (
        len(p['createTargetIds']), len(p['updateTargetIds']), len(p['unchangedTargetIds']),
        len(p['undeclaredExistingTargetIds']), len(p['enabledTargetMappingChangeIds'])))
else:
    print(json.dumps(body)[:1500])
sys.exit(1 if problems else 0)
