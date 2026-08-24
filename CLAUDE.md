# CLAUDE.md

Working notes for this repository. Everything here was verified against source,
not assumed — the "Verified facts" section carries file:line references so it
can be re-checked when the node is upgraded.

## What this project is

An explorer for a DeFCoN **devnet**, whose primary job is to record every DKG
round — including the ones that **did not happen** — and attribute member
failures to operators. It observes; it never touches consensus.

## Commands

```bash
npm install            # workspaces: shared, server, client
npm run typecheck      # all three workspaces
npm run build          # shared -> server -> client
npm run dev            # server :4100 + client :5190 (Vite proxies /api)
npm test               # server unit tests (vitest)
```

## Reference projects (read-only — copy from, never edit)

| Path | What | Use for |
|---|---|---|
| `~/DEFCON` (WSL Ubuntu), branch `v22.1.x` | DeFCoN Core, the build target | RPC semantics, LLMQ params |
| `d:\www\DeFCoN_Explorer\` | production explorer (deftrack.xyz) | Mongoose models, pollers, v1 route conventions, ops scripts |
| `d:\www\SCAN\` | Lit 3 explorer front-end | design system and component architecture |

The node source of truth is the **WSL** checkout, not `d:\www\DEFCON\` — the
latter sits on an unrelated branch with a deleted working tree.

## Devnet identity

| | |
|---|---|
| Network name | `defcon-q60` (identical `-devnet=` on every node, or nodes will not see each other) |
| Domain | `devnet.deftrack.xyz` |
| Database | `deftrack_devnet` |
| systemd unit | `deftrack-devnet.service` |
| Node role | plain full node + devnet seed node — **not** a masternode |

## Local development environment

MongoDB runs as a **userspace install inside WSL Ubuntu 24.04** (same OS as the
target VPS), not via Docker and not via apt — `sudo` needs a password here and
system state is better left untouched.

```
~/opt/mongodb        MongoDB 8.0.29 (tarball)
~/opt/mongosh        mongosh 2.10.0
~/devnet-mongo/      dbpath, logs, start.sh, .creds (chmod 600, never leaves the machine)
```

```bash
wsl -d Ubuntu -- ~/devnet-mongo/start.sh          # start (auth enabled, 127.0.0.1:27017)
wsl -d Ubuntu -- ~/devnet-mongo/start.sh stop     # stop
```

WSL2 forwards the port, so Windows reaches it at `127.0.0.1:27017`. Two users
exist on `deftrack_devnet`, both verified against their boundaries:

| User | Role | Used by |
|---|---|---|
| `devnet_app` | `readWrite` on `deftrack_devnet` | the server (`.env`) |
| `devnet_ro` | `read` on `deftrack_devnet` | the MongoDB MCP server |

MongoDB **8.0** rather than the 7.x the plan names: 7.x is no longer among the
supported releases. 8.0 is the long-term branch; 8.2/8.3 are rapid releases.

## MCP servers

Configured at **local** scope (`~/.claude.json`), so no connection string ever
reaches this public repository.

| Server | Purpose |
|---|---|
| `context7` | version-specific library docs (Mongoose, Express, zod, Lit) |
| `mongodb` | schema inspection — **read-only**, `deftrack_devnet` only, local instance |
| `playwright` | browser automation; used from Phase 3 to verify views render |

The MongoDB MCP takes its connection string from `MDB_MCP_CONNECTION_STRING`
plus `MDB_MCP_READ_ONLY=true`; the `--connectionString` flag is deprecated and
would print the password in `claude mcp list` output.

## Where things run

| | |
|---|---|
| Explorer + seed node | the devnet VPS; `deftrack-devnet.service`, `/opt/devnet-deftrack/app` |
| Second devnet node | same host, `defcond-devnet2`, exists so the seed has a peer |
| 80 masternodes | 8 DeFCoN fullnodes, 10 each, ports 19799-19808, `defcon-devnet-mn@N` |
| Node binaries | `/usr/local/bin/defcond` (seed, BDB wallet) and a `--without-bdb` build for the fleet |

Reach the fleet through the jump host; the per-node key lives there, not
locally. `ssh devnet` reaches the explorer VPS directly.

## Operational notes earned the hard way

- **`sendmany` returning a txid is not proof of anything.** One funding
  transaction never reached the mempool and only `sendrawtransaction` revealed
  why: `bad-txns-premature-spend-of-coinbase`. The seed node stakes
  continuously, so immature coinstake outputs are always present for coin
  selection to pick. After any send, check the mempool.

- **A masternode refuses to start below `maxconnections=125`.** The node
  enforces it; `LimitNOFILE=4096` in the unit keeps ten instances per host
  clear of the default cap.

- **The per-wallet staking switch does not survive a restart.** `staking=1`
  only enables the subsystem; `setstaking <id>` must run afterwards, which
  `ExecStartPost=/usr/local/bin/defcon-enable-staking` does.

- **A solo node never leaves `MASTERNODE_SYNC_BLOCKCHAIN`,** and
  `pos/minter.cpp:164` refuses to stake until `mn_sync.IsSynced()`. With one
  peer it completes on its own; without one the chain stops after a restart.

- **The fleet binary is a separate artefact and drifts.** After the
  mainnet-parity change the 80 masternodes still ran the pre-parity build:
  identical `-version` string, different consensus, so they synced headers to
  999 -- exactly `lastPowBlock` -- and downloaded no blocks at all. It looked
  like a network fault. Compare `md5sum`, not the version string, and ship the
  binary with any consensus change.

- **Once masternodes exist, every transaction waits 10 minutes to be mined.**
  `BlockAssembler::TestPackageTransactions` drops any package whose transaction
  is not InstantSend-locked unless `CChainLocksHandler::IsTxSafeForMining`
  agrees, and that is simply `txAge >= WAIT_FOR_ISLOCK_TIMEOUT`
  (`llmq/chainlocks.h:45`, 600 s). With no InstantSend quorum yet, no lock can
  ever arrive, so the full ten minutes is always paid. A transaction sitting in
  the mempool with an enormous fee is therefore normal, not stuck -- raising the
  fee changes nothing, and `prioritisetransaction` only appeared to help because
  the timeout expired at the same moment.

- **A masternode can never also stake.** `init.cpp:997` soft-sets
  `disablewallet=1` whenever `masternodeblsprivkey` is present, and overriding
  it with an explicit `disablewallet=0` makes the node refuse to start at all:
  "You can not start a masternode with wallet enabled". Distributing block
  production therefore needs a separate daemon per host -- instance 11 of the
  same systemd template, with a wallet and no BLS key.

- **`createwallet` defaults to a legacy wallet the fleet build cannot create.**
  The `--without-bdb` binary answers "Compiled without bdb support (required for
  legacy wallets)"; pass `descriptors=true` (and `load_on_startup=true`).

- **Never let the wallet pick its own inputs on the seed node.** It stakes
  continuously, so its balance is full of coinstake outputs below
  `COINBASE_MATURITY` (25, and spending needs depth 26), and automatic selection
  keeps choosing them: `sendmany` returns a txid and the transaction never
  reaches the mempool. Select inputs explicitly from `listunspent <minconf>`,
  and exclude anything equal to the collateral amount.

- **`abandontransaction` on a broad filter destroys wallet accounting, not
  coins.** Abandoning 16 transactions at once dropped the reported balance from
  1.09 billion to 380 million; `rescanblockchain 0` rebuilt it exactly. The
  chain is the record -- the wallet is a cache of it.

- **Check the firewall on every host, not one.** Two of the eight fullnodes run
  `ufw` with `-P INPUT DROP`; the other six have no filtering. Generalising
  from the first host cost 20 unreachable masternodes and a PoSe ban wave that
  looked like real data.

- **Debian 13 has no `libdb5.3++`,** so a wallet build linked against Berkeley
  DB will not run there. The fleet uses a `--without-bdb` build with SQLite
  descriptor wallets, which does stake. The seed node keeps its BDB wallet and
  must not be given the other binary.

## Measurement caveats that are easy to get wrong

- **ChainLock coverage starts at the first lock ever seen,** not at the start
  of the chain. Before masternodes existed a lock is impossible, not missing;
  counting that era reported 88% where the truth was 99%.

- **ChainLock latency is an observation.** The node says whether a block is
  locked, never when the CLSIG arrived, so resolution equals the poll interval
  and blocks locked before the watcher started carry `null`, not a number.

- **`lastPaidHeight` answers only for each node's most recent payment.** Which
  masternode a block paid comes from `masternode payments <blockhash>`, stored
  at index time; every masternode here shares one payout address.

- **Operator attribution is by host IP** with an explicit proTxHash override.
  It is declared through the admin API, never inferred, and never committed:
  the host addresses are not public and this repository is.

## Verified facts about the node (DeFCoN Core v22.1.4, `v22.1.x` @ `7227180053`)

### The chain is proof-of-work to height 1000, then proof-of-stake

`GetBlockSubsidyHelper` pays 11,000,000 DFCN per PoW block and 500 after
`lastPowBlock` (1000 on devnet). Heights 1-900 are forced to `premineAddress`;
901-1000 reach the miner, which funded this devnet with ~1.1 billion DFCN.
`validation.cpp:2132` enforces the boundary in both directions (`pos-early` /
`pow-late`), so a fresh devnet cannot skip the PoW phase.

Block spacing is not comparable across the boundary, and after 1000 the chain
only advances while something stakes.

### Four bugs kept a devnet from ever starting

All fixed upstream: `defcon-project/defcon` #53, #54, #55.

Stale genesis constants; a genesis block that failed `CheckProofOfWork`
because Dash's nonce was mined for Dash's coinbase (re-mined, `nNonce = 0`,
hash `61f3bbd0…`); a `vSporkAddresses` entry in Dash's `y` format while devnet
uses prefix 55 (`P`), which still needs `-sporkaddr`; and the devnet genesis
block's `OP_RETURN` output colliding with the premine rule.

`getblock <hash> 2` also aborted on every PoS block with
`MoneyRange(fee)` -- a coinstake mints its reward, so inputs - outputs is
negative. Fixed in #55; that one affected mainnet too.

### The devnet ChainLock quorum was `LLMQ_DEVNET`, now `LLMQ_400_60`

`src/chainparams.cpp:634` originally set `llmqTypeChainLocks = LLMQ_DEVNET`;
upstream #54 changed devnet to the mainnet profile (`LLMQ_400_60`,
1,000,000 DFCN collateral, mainnet staking ranges).
Its parameters (`src/llmq/params.h:270-288`):

```
size 12 / minSize 7 / threshold 6 / dkgBadVotesThreshold 7
useRotation = false
dkgInterval = 24 blocks  ->  one DKG round per hour at 2.5 min blocks
```

Consequence: the devnet baseline is **not** the mainnet baseline. Profile
parameters therefore live in explorer config keyed by `llmqName` and are
snapshotted onto each round document — never hardcoded, never inferred.

### A round that does not form has no `quorumHash`

If the DKG fails, no commitment is mined, so `quorum listextended` simply does
not list the round. There is no hash to key an upsert on — yet these rows are
the entire point of the project.

So the collector reconstructs the **expected schedule** and matches observations
against it. The formula is taken from the node itself
(`src/rpc/quorums.cpp:320`):

```
quorumHeight = tipHeight - (tipHeight % dkgInterval) + quorumIndex
```

Idempotency key is synthetic:

```
roundKey = `${llmqType}:${expectedHeight}:${quorumIndex}`
```

`quorumHash` becomes an optional field, populated only when the round formed.
Upserts use a `unique` index on `roundKey` plus `$setOnInsert` for immutable
fields — the same pattern as the production ban-event collector
(`masternodePoller.service.ts:72-116`, `eventKey`), which was audited and
produces zero duplicates across restarts. Do not deviate.

### `previousConsecutiveDKGFailures` will not be in the output

`src/rpc/quorums.cpp:192` gates it behind `quorum->params.useRotation`.
`LLMQ_DEVNET` (and Q60) are **not** rotated, so the field is absent. Derive
consecutive failures from the reconstructed schedule instead.

### `-llmqdevnetparams` cannot express Q60

`src/chainparams.cpp:732-740`:

```cpp
params->size = size;
params->minSize = threshold;          // not independently settable
params->threshold = threshold;
params->dkgBadVotesThreshold = threshold;
```

`60:41` yields `60/41/41/41`; the intended `minSize = 44` is unreachable. Same
limitation as the regtest `-llmqtestparams` override. The first test round
therefore runs the **stock** `LLMQ_DEVNET` profile as a baseline.

### `quorum dkgstatus` is nearly empty on a non-masternode

The useful parts (`quorumConnections`, session phases) are guarded by
`node.mn_activeman`. Our node is not a masternode, so live DKG phase telemetry
is out of scope — observation is post-hoc, which is sufficient for the three
questions the project must answer.

### Which RPC returns what

| RPC | Returns |
|---|---|
| `quorum list [count]` | quorum hashes per LLMQ type |
| `quorum listextended [count]` | adds `numValidMembers`, `healthRatio`, `minedBlockHash`, `quorumIndex` |
| `quorum info <llmqType> <quorumHash> [includeSkShare]` | `height`, `type`, `quorumHash`, `quorumIndex`, `minedBlock`, `members[]` (`proTxHash`, `service`, `pubKeyOperator`, `valid`), `quorumPublicKey` |

`quorum info` does **not** return `numValidMembers` or `healthRatio`; those come
from `listextended`.

### Devnet masternode collateral is 1,000,000 DFCN — since the parity change

`src/chainparams.cpp:575` — `regularMnCollateral = 1000000 * COIN`, identical to
mainnet (`:232`). It was `1000 * COIN` before #56 made devnet match mainnet
consensus in full; funding 80 masternodes therefore costs **80,000,000 DFCN**,
not 80,000. Re-check this line before any funding run: the old figure is the
kind of number that silently under-funds every collateral in the batch.

## Event-time observation (ZMQ) and block-exact history (`protx listdiff`)

Both are additions to, not replacements of, the pollers. The pollers reconcile.

- **ZMQ is enabled on the seed node only, bound to `127.0.0.1:28332`** with
  `hashblock`, `hashchainlock`, `hashtx`, `sequence`. The PUB socket has no
  authentication of any kind. `sequence` is not optional: the socket drops
  silently at the high-water mark, and the per-topic sequence numbers are what
  make a lost message detectable instead of merely suspected. Gaps are stored
  as data (`ObservationGap`), never swallowed.

- **The hash frames arrive in RPC display order — do not reverse them.**
  Reversing (the usual internal-vs-display convention) was tried first and
  produced hashes that matched no indexed block. Verified against blocks
  1382-1385 on the live devnet.

- **Notifications are stored raw and immutable** (`NodeObservation`), and the
  fields the views read are derived in a separate step. When the byte order
  turned out to be wrong, the 23 stored rows were corrected by re-deriving the
  hash from `payloadHex` — the reason to keep raw evidence at all.

- **`protx listdiff <baseHeight> <targetHeight>` takes heights, not hashes**
  (`src/rpc/evo.cpp:1604`), and reports only changed fields, with their *new*
  values. That is enough to name a transition without holding previous state:
  `PoSeBanHeight` with a height means the ban just landed, `-1` means revival.

- **PoSe penalty decay is not an event.** It falls by one per block, so every
  penalised node appears in every single diff; logging that would bury one ban
  wave under thousands of rows. Only an increase — a missed duty — is recorded.
  The walker seeds its penalty baseline from one diff against the start of the
  chain, or a restart reads each node's first change as an increase and invents
  a missed duty.

- **ChainLock event times cannot be validated with no masternodes registered.**
  No quorum, no CLSIG, so `hashchainlock` never fires. What is verified so far
  is block first-sight; the lock path waits on the fleet.

- **`quorum dkgsimerror` is NOT gated to regtest** (`src/rpc/quorums.cpp:749`) —
  only the help text warns. It sets a global error rate on the node it is called
  on and does not reset itself, so a forgotten call keeps that masternode
  misbehaving into later rounds. Use it only from a script that sets, runs and
  resets, and never expose it through the explorer API.

## Derived values to store

- `punishedCount = size - numValidMembers`
- `maxPossibleBan = size - minSize` — the structural ceiling on how many
  masternodes one round can punish. Displaying it is what makes a profile
  change legible.

## Behaviour the UI must make obvious

A failed DKG mines no commitment, and the node's punishment loop is guarded by a
non-null commitment check — so **nobody is PoSe-punished**. Failed rounds are
shown explicitly as `formed: false, punishedCount: 0`. Distinguishing "quorum
paused" from "quorum punished the network" is the whole purpose of this tool.

## Conventions

- **API envelope:** `{ success, data }`; paged endpoints always return the true
  `total` alongside the page. The production `/events` endpoint truncates at its
  limit with no indication — do not repeat that.
- **Validation:** zod on every route input; bounded `limit` / `hours`.
- **Caching:** `withCachePolicy` profiles + in-flight dedup, ported from the
  production server.
- **Commits:** no `Co-Authored-By` trailer — commits show the repository owner
  as the sole author.
- **Retention:** all TTLs >= 90 days, or disabled. The production noise TTL was
  shorter than the ban window, which made a real mainnet fork impossible to
  correlate afterwards.

## Hard constraints

- Never commit `.env`, RPC credentials, API keys, BLS keys, or non-public host
  addresses. **This repository is public** — a leaked secret must be rotated,
  not just deleted in a later commit.
- Never connect to the production deftrack MongoDB, and never reuse production
  RPC credentials or ingest tokens.
- Do not modify the reference projects.
- No market/price integrations, no migration hot-wallet tracking, no DNS-seeder
  feed — meaningless on a test chain.

## Deploying

Use `ops/deploy.sh` on the VPS. **Building is not deploying:** `npm run build`
writes the client to `client/dist`, but nginx serves `/var/www/devnet.deftrack`.
A deploy that stops after the build leaves the site on whatever bundle was last
copied there by hand -- which happened for two days, during which every client
change appeared to have silently failed to take effect. The script rsyncs and
re-checks which bundle the webroot actually serves.

## Gotchas

- `.env` with CRLF breaks `set -a; . ./.env` on Linux (`$'\r': command not
  found`). `.gitattributes` forces LF; keep it that way.
- The workspace folder name contains a space (`devnet .deftrack`) — quote paths.
- The planning-docs folder is named with 19 exclamation marks. In `.gitignore`
  the leading `!` must be escaped (`\!!!...`) or git reads it as a negation.
