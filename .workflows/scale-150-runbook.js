export const meta = {
  name: 'scale-150-runbook',
  description: 'Investigate the live devnet fleet read-only and produce a verified runbook for scaling 80 -> ~150 masternodes across 8 new VPS',
  phases: [
    { title: 'Investigate', detail: 'six parallel read-only investigators over the live fleet' },
    { title: 'Verify', detail: 'adversarial check of each dimension\u2019s claims' },
    { title: 'Synthesize', detail: 'merge into one executable runbook' },
  ],
}

const CONTEXT = `
CONTEXT — DeFCoN devnet "defcon-q60" fleet, READ-ONLY INVESTIGATION.

Access (all already configured, use Bash):
- \`ssh devnet\` -> the explorer/seed VPS, you are ROOT. Runs: defcond-devnet.service (seed, BDB binary
  /usr/local/bin/defcond, datadir /home/defcon/.defcon) and defcond-devnet2.service (node2, nobdb binary
  /usr/local/bin/defcond-nobdb, datadir /home/defcon/.defcon2). Node RPC:
  \`sudo -n -u defcon /usr/local/bin/defcon-cli -datadir=/home/defcon/.defcon <cmd>\`
  Explorer API on 127.0.0.1:4100 (curl).
- \`ssh devnet-jump\` -> the jump host, ROOT. Fleet inventory: /root/fleet-nodes.txt (8 IPs, one per line).
  Fleet key: /root/.ssh/defcon_nodes. Reach a fleet host FROM the jump:
    ssh devnet-jump "ssh -n -i /root/.ssh/defcon_nodes -o StrictHostKeyChecking=no root@<IP> '<remote cmd>'"
- Fleet hosts: each runs 11 systemd instances defcon-devnet-mn@1..11 (10 masternodes + instance 11 = a
  staker, because a masternode cannot stake). Binaries in /opt/defcon-devnet/bin/, per-instance datadir
  /opt/defcon-devnet/mn<N>/ with defcon.conf.
- The project's hard-won ops lessons live in d:\\www\\devnet .deftrack\\CLAUDE.md — READ IT (Read tool) for
  the "Operational notes earned the hard way" and "Where things run" sections. They record real failures.

CURRENT STATE: 8 fleet hosts x 11 instances = 88 services, plus seed + node2 = 90 daemons. 80 masternodes
enabled. Chain tip ~5553. Fleet binary md5 d1be1264468ab1ee0119110f7b467837 (--without-bdb build).

GOAL BEING PLANNED: the operator will supply 8 NEW VPS with ssh access, to raise the masternode count from
80 to roughly 150 (so ~70 new masternodes, ~9 per new host). Your job is to establish, from EVIDENCE on the
live systems, exactly what a new host must look like and what the operation requires.

RULES:
- READ-ONLY. Never modify a file, never restart a service, never send a transaction, never register anything.
  Only inspect: cat/grep/systemctl cat/systemctl is-active/ls/RPC read calls/curl GETs.
- Ground every claim in evidence you actually observed. Quote the command and the real output.
- If you could not verify something, say so in "gaps" — do NOT guess. A guessed port range or conf line
  would be executed later against 8 production hosts.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'One concrete, actionable fact' },
          evidence: { type: 'string', description: 'The command run and the actual output that proves it' },
        },
        required: ['claim', 'evidence'],
      },
    },
    gaps: { type: 'array', items: { type: 'string' }, description: 'What you could NOT verify and why' },
    risks: { type: 'array', items: { type: 'string' }, description: 'What could go wrong in execution' },
  },
  required: ['dimension', 'facts', 'gaps', 'risks'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    confirmed: { type: 'array', items: { type: 'string' } },
    refuted: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, why: { type: 'string' }, correction: { type: 'string' } },
        required: ['claim', 'why'],
      },
    },
    missed: { type: 'array', items: { type: 'string' }, description: 'Important things the investigator did not check' },
  },
  required: ['dimension', 'confirmed', 'refuted', 'missed'],
}

const DIMENSIONS = [
  {
    key: 'host-layout',
    prompt: `Establish exactly what a fleet HOST looks like, so an identical new one can be built.
Inspect a real fleet host (take the first IP from the jump inventory):
- the full systemd unit: \`systemctl cat defcon-devnet-mn@\` — every line: ExecStart, User, LimitNOFILE,
  Restart, ExecStartPost, WorkingDirectory, environment.
- the on-disk layout under /opt/defcon-devnet: bin/ contents (ls -la, md5sum of defcond and defcon-cli),
  the mn<N> directories, ownership and permissions.
- which OS/release the host runs (cat /etc/os-release), and whether libdb is present (this matters: the
  fleet uses a --without-bdb build).
- \`ldd /opt/defcon-devnet/bin/defcond | grep -c "not found"\` to confirm the binary's runtime deps resolve.
- how many instances are enabled/active: \`systemctl is-active defcon-devnet-mn@{1..11}\`.
- whether there is any provisioning script or README left on the host that built this layout.
- ufw/firewall state (\`ufw status\` or iptables -S | head) — CLAUDE.md warns two of eight hosts filter.
Report the exact reproducible layout a new host needs.`,
  },
  {
    key: 'node-config',
    prompt: `Establish the exact per-instance node CONFIG, so a new instance's defcon.conf can be written correctly.
On a real fleet host, read several instance configs (at least mn1, mn5, mn10 and the staker mn11) and diff
them mentally:
- \`cat /opt/defcon-devnet/mn1/defcon.conf\` etc. Report EVERY key, and which keys differ per instance
  (port, externalip, masternodeblsprivkey, rpcport, ...) versus which are identical everywhere.
- the exact PORT ASSIGNMENT scheme: which P2P port and which RPC port each instance N uses. CLAUDE.md
  mentions ports 19799-19808. Verify against the real configs and against listening sockets
  (\`ss -lntp | grep defcond\` on the host).
- how staking differs on instance 11 (the staker) versus the masternodes 1-10 — which keys are present or
  absent (masternodeblsprivkey, staking, disablewallet), and whether ExecStartPost enables staking.
- confirm dslactivationheight and maxconnections are present and their values.
- REDACT every secret: never output a masternodeblsprivkey, rpcpassword or any key material. Report only
  that the key EXISTS and its config key name.
Report a precise template for a new instance's config with the per-instance variables named.`,
  },
  {
    key: 'funding',
    prompt: `Establish exactly how ~70 new masternode COLLATERALS can be funded from the seed wallet.
On the seed (ssh devnet, RPC as shown in the context):
- \`getbalances\`, and the shape of the UTXO set: \`listunspent 26\` — how many outputs, what denominations
  (bucket them), how many are >= 1000000, what the typical amount is. Use python3 to aggregate; do NOT
  print the whole list.
- the devnet collateral amount for a REGULAR masternode (1,000,000 DFCN per CLAUDE.md) — confirm from the
  chain if you can (e.g. an existing masternode's collateral output value via \`protx list registered 1\`
  then \`gettxout\` on one collateralHash/collateralIndex).
- READ CLAUDE.md carefully for the funding traps and report them precisely: the coinstake-maturity trap
  ("never let the wallet pick its own inputs on the seed node"), why sendmany can return a txid that never
  reaches the mempool, the COINBASE_MATURITY depth rule, the stakeValueRange caveat, and the
  WAIT_FOR_ISLOCK_TIMEOUT 10-minute mining delay that applies to every transaction once masternodes exist.
- work out the arithmetic: to create ~70 outputs of exactly 1,000,000 DFCN, how many transactions are
  needed given the real UTXO denominations, and what the per-transaction output limit implies.
- check whether the seed wallet is currently staking (\`getstakinginfo\`) since that is what creates the
  immature coinstake outputs that poison automatic coin selection.
Report a concrete, safe funding procedure with explicit input selection.`,
  },
  {
    key: 'registration',
    prompt: `Establish exactly how the existing 80 masternodes were REGISTERED, so ~70 more can be registered the same way.
- On the seed, inspect an existing registration on-chain: \`protx list registered 1\` (limit output with
  python3 — print ONE entry pretty-printed, plus the total count). Identify the fields: proTxHash,
  collateralHash/collateralIndex, service (ip:port), ownerAddress, votingAddress, payoutAddress,
  pubKeyOperator, operatorReward, and the state block.
- Determine whether all 80 share one payout address (CLAUDE.md says every masternode here shares one payout
  address) — verify by aggregating payoutAddress across all entries.
- Determine which protx RPC variant is appropriate: run \`defcon-cli help protx\` and report the available
  subcommands and the exact argument list of \`protx register_fund\` and \`protx register\` (use
  \`defcon-cli help "protx register_fund"\`). State precisely which arguments are needed and in what order.
- Establish how the BLS operator keypair is produced: \`defcon-cli help bls\` / \`bls generate\`. Do NOT
  generate or print any key — just report the command and its output field names.
- Look for any leftover registration script or notes on the seed or jump host (find /root /home -maxdepth 3
  -iname "*regist*" -o -iname "*mn*setup*" 2>/dev/null | head) that shows how the original 80 were done.
- Note the ISLock 10-minute mining delay implication for registering ~70 masternodes.
Report a concrete registration procedure, including what must be unique per masternode.`,
  },
  {
    key: 'ops-integration',
    prompt: `Establish what must be UPDATED OUTSIDE the new hosts when the fleet grows from 8 to 16 hosts.
- The jump host inventory: \`cat /root/fleet-nodes.txt\` (count lines, show the format — IPs are not secret
  within this investigation but note that the explorer is public and must use host LABELS, never IPs).
- Read d:\\www\\devnet .deftrack\\ops\\fleet-deploy.sh (Read tool) and report exactly what it expects:
  which env vars, the FLEET_INSTANCES default, what it does per host, and what would happen if a new host
  were added to the inventory but had a different instance count.
- The explorer's operator attribution: how host IP maps to an operator label. Query the explorer admin/API
  read endpoints on the seed (curl 127.0.0.1:4100/api/v1/... — find the operators endpoint) and read
  d:\\www\\devnet .deftrack\\server\\src\\domain\\operatorIndex.ts to establish how a NEW host would be
  attributed and what has to be declared so 70 new masternodes are not all "unattributed".
- Check the explorer's masternode-count-dependent config: read d:\\www\\devnet .deftrack\\server\\src\\config\\llmq.ts
  and report anything that assumes a fixed masternode count or profile size that a jump to 150 would break.
Report the exact list of off-host updates required.`,
  },
  {
    key: 'risk',
    prompt: `Establish the FAILURE MODES of adding ~70 masternodes at once to this live chain, and how to avoid them.
- Read d:\\www\\devnet .deftrack\\CLAUDE.md in full, especially "Operational notes earned the hard way" and
  "Measurement caveats that are easy to get wrong". Extract every lesson that bears on adding many
  masternodes at once — in particular the PoSe ban-wave history, the "do not measure in the first rounds
  after a revive or a restart" rule (46 masternodes revived at height 2404 caused a punishment cascade),
  the dkgBadVotesThreshold history, and the masternode maxconnections requirement.
- On the seed, establish the CURRENT quorum profile parameters actually in force: \`defcon-cli help quorum\`,
  then read the live profiles the chain uses. Specifically get the LLMQ types and sizes in play
  (llmq_50_60, llmq_60_75, llmq_400_60, llmq_defcon) via \`quorum list\` and report how many quorums of each
  type currently exist, and how a jump from 80 to 150 candidates changes selection.
- Establish the DSL implication: the service commitment carries a bitfield sized to the masternode list
  (currently size=80 per the explorer /api/v1/dsl/epochs). Reason precisely about what happens to the DSL
  measurement while ~70 nodes join and have not yet announced liveness.
- Establish the practical constraint: how long ~70 registrations take given the 10-minute ISLock mining
  delay per transaction batch, and whether registrations can be batched.
Report a prioritized risk list with a concrete mitigation for each.`,
  },
]

phase('Investigate')
log(`Investigating ${DIMENSIONS.length} dimensions of the live fleet, read-only`)

const investigated = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${CONTEXT}\n\nYOUR DIMENSION: ${d.key}\n\n${d.prompt}`, {
      label: `investigate:${d.key}`,
      phase: 'Investigate',
      schema: FINDINGS_SCHEMA,
    }),
  (findings, d) => {
    if (!findings) return null
    return agent(
      `${CONTEXT}\n\nYou are ADVERSARIALLY VERIFYING another investigator's report on dimension "${d.key}".\n\n` +
        `Their report:\n${JSON.stringify(findings, null, 2)}\n\n` +
        `Independently re-check the load-bearing claims by running the commands YOURSELF (read-only). ` +
        `A claim that would be executed against 8 production hosts must not rest on one reading. ` +
        `Refute anything wrong, imprecise, or unverifiable, and give the correction. ` +
        `Then list what the investigator MISSED that matters for building 8 new hosts and registering ~70 masternodes. ` +
        `Be skeptical: default to refuting a claim you cannot reproduce.`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
    ).then((verdict) => ({ dimension: d.key, findings, verdict }))
  }
)

const results = investigated.filter(Boolean)
log(`${results.length}/${DIMENSIONS.length} dimensions investigated and verified`)

phase('Synthesize')
const runbook = await agent(
  `${CONTEXT}\n\nSix investigators mapped the live fleet and an adversarial verifier re-checked each. ` +
    `Here is everything, including refutations and corrections:\n\n${JSON.stringify(results, null, 2)}\n\n` +
    `Write the RUNBOOK for scaling this devnet from 80 to ~150 masternodes across 8 new VPS.\n\n` +
    `Requirements:\n` +
    `- Where the verifier refuted or corrected a claim, the CORRECTION wins. Never carry a refuted claim forward.\n` +
    `- Ordered phases with explicit commands, each grounded in what was actually observed. Mark anything still ` +
    `unverified as [UNVERIFIED - confirm before running] rather than presenting it as fact.\n` +
    `- Cover: (1) prepare each new host, (2) fund ~70 collaterals of exactly 1,000,000 DFCN safely, ` +
    `(3) register ~70 masternodes, (4) update the jump inventory and operator attribution, ` +
    `(5) verify the result, (6) what to do if it goes wrong (rollback/triage).\n` +
    `- A dedicated section on TIMING and MEASUREMENT: the ISLock 10-minute rule, how long the whole operation ` +
    `realistically takes, and precisely what happens to the in-flight DSL shadow measurement and the DKG/PoSe ` +
    `readings while the new nodes join — including which readings must be excluded as artefacts.\n` +
    `- A pre-flight CHECKLIST of things to confirm before touching anything.\n` +
    `- Call out every irreversible step.\n` +
    `- Secrets: never include key material; say where a key is generated and that it stays on the host.\n\n` +
    `Be precise and executable. This will be run against 8 production hosts on a live chain.`,
  { label: 'runbook', phase: 'Synthesize' }
)

return { dimensionsCovered: results.map((r) => r.dimension), runbook }
