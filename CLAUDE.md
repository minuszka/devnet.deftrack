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
| 152 masternodes | 16 hosts, ports 19799-19808, `defcon-devnet-mn@N`. Eleven are in the rollout inventory and log in as root: the 8 DeFCoN fullnodes with 10 each, and three more with 9. The other five carry 14, 10, 7, 7 and 7, and log in as their own unprivileged users, not root |
| 8 fleet stakers | **instance 11**, and only on the 8 DeFCoN fullnodes -- a masternode cannot stake, so block production needs its own daemon. The remaining hosts carry masternodes only, which is why a wallet-side staking fix gains them nothing and is not worth a restart |
| Node binaries | `/usr/local/bin/defcond` (seed, BDB wallet) and a `--without-bdb` build for the fleet |

Reach the fleet through the jump host; the per-node key lives there, not
locally. `ssh devnet` reaches the explorer VPS directly.

**The masternode count is a consensus input, not a statistic.**
`CalcMaxPoSePenalty` is `max(100, GetAllMNsCount())` and a DKG exclusion costs
66% of it (`deterministicmns.cpp:328-339`), so both the ban threshold and the
penalty scale with the size of the network. At 152 registered nodes the
threshold is 152 and one exclusion is 100, which puts **two exclusions within
48 blocks over the line** -- and four profiles punish on interleaved schedules,
two of them every 24 blocks. A single moment's outage at a height where three
schedules coincide costs 300 and bans outright. This entry read 80 for a while
after the fleet had grown; every ban estimate made against that number was
wrong, because at 110 or fewer the penalty is 66, decays to zero inside the
72-block `llmq_400_60` cycle, and that profile alone never bans at all.

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

- **A stakeable output has to be inside `stakeValueRange`.**
  `chainparams.cpp:572` sets `{ 10000, 12500000 }` DFCN on this devnet since the
  parity change, and `SelectCoinsForStaking` filters `AvailableCoins` by it. An
  output of 50,000,000 is therefore invisible to staking however long it
  matures, and `getstakinginfo` reports `weight: 0` with a full balance and no
  error. The seed only stakes because its coins are 11,000,000 PoW rewards --
  inside the range by accident. Fund a staker in outputs of about 10,000,000,
  and never in one lump.

- **A binary that compiles is not a binary that runs.** A fleet build made in
  WSL linked against the build host's `libminiupnpc` and `libnatpmp`, which the
  targets do not have. It was installed on the seed host before anyone noticed;
  the node it replaced would not start, and `defcond -version` on the target was
  the first thing that said so. Nothing in the build log did -- the compile
  succeeded and the exit code was 0. `ldd <binary> | grep "not found"` on a
  **target** host, before installing anywhere, costs one second and would have
  caught it. `ops/fleet-deploy.sh` now runs that check on a real fleet host and
  refuses to continue without it. Configure the fleet build with
  `--without-bdb --without-miniupnpc --without-natpmp`.

- **`make` exiting 0 is not proof that anything was built.** Three times in one
  day a build reported success while compiling nothing: once `make` had no rule
  for the object name given, once a backgrounded build was killed by a stray
  `&`, once the file simply was not rebuilt. Each time the exit code said 0.
  What actually settles it is the **object or binary timestamp against the build
  start**, and the count of `CXX`/`CXXLD` lines in the log.

- **The devnet's evodb was never corrupt -- the verifier was.** An earlier
  version of this note recorded that the diffs do not reproduce the snapshots
  and that repair could not mend it. Both halves were wrong, and the real
  defect was in the tool: `VerifySnapshotPair` and `RepairSnapshotPair` called
  `ApplyDiff` -- which is `const` and *returns* the advanced list -- without
  assigning the result, so verification compared every interval against its
  unmoved base snapshot. That fails exactly like corruption fails:
  `ApplyDiff: can't find an updated masternode, id=0` on every pair. Fixed in
  #73 with a regression test; with the fix, `evodb verify` on this datadir
  answers 3 pairs verified, 0 errors -- including the 1304 diffs an earlier
  broken repair had rewritten, so even that rewrite was correct in content.
  The `internalId` theory recorded here before was a story invented to explain
  a fault that did not exist.

  Three lessons survive. `-Wunused-result` had flagged both call sites in
  every build log all day, and nobody read the warnings -- the compiler knew.
  "Successfully repaired 1304 diffs, verified 0 snapshots in 0s" is a
  self-contradicting success line, and the marker it wrote then suppressed
  startup verification on every later boot, so no later restart could catch
  it. And a verification tool must be proven able to *pass* on known-good
  data before its failures are believed: ours had never once passed anywhere,
  and that alone should have indicted the tool, not the database.

- **Check the firewall on every host, not one.** Two of the eight fullnodes run
  `ufw` with `-P INPUT DROP`; the other six have no filtering. Generalising
  from the first host cost 20 unreachable masternodes and a PoSe ban wave that
  looked like real data.

- **A descriptor wallet could not stake before v22.1.5, and RPC could not see
  that it had stopped.** `CStakeWallet::CreateCoinStake` called
  `EnsureLegacyScriptPubKeyMan(*wallet)` (`src/pos/stake.cpp`), an **RPC
  helper** that throws `JSONRPCError(RPC_WALLET_ERROR, "This type of wallet does
  not support this command")` whenever the wallet has no legacy ScriptPubKeyMan
  (`src/wallet/rpcwallet.cpp:132`) -- which is every descriptor wallet. A
  `JSONRPCError` is a `UniValue`, not a `std::exception`, so `ThreadStakeMiner`
  reported `Exception: <null>` and the thread exited on the first block it tried
  to stake, each of the eight fleet hosts within 48 seconds of its coins
  maturing.

  **Fixed upstream in #59, and confirmed running.** On v22.1.5 every fleet
  staker's debug.log shows five `threadstakeminer thread start` lines against
  four `thread exit` lines: the four exits are the older binaries, and the fifth
  thread is still alive. Six distinct P2PK kernel keys won blocks 2626-2637, so
  block production is genuinely distributed and no longer the seed alone.

  What survives the fix is the diagnostic lesson: `getstakinginfo` reports
  `staking: true` with a full weight whether or not the minter thread is
  running, because it reads wallet state and not the thread. **A dead minter is
  invisible from RPC.** Count `threadstakeminer thread start` against `thread
  exit` in the log; that is the only place the difference shows.

- **A descriptor wallet books its own coinstake as a `send`, but the balance is
  correct on v22.1.5.** The coinstake pays `vout[1]` to a **pay-to-pubkey**
  script built from the kernel key, and consensus requires that:
  `CheckBlockSignature` (`node/miner.cpp:630`) reads `vtx[1]->vout[1]`, and only
  its `PUBKEY` branch works -- the `PUBKEYHASH` branch builds a `CPubKey` from a
  20-byte hash and always fails `IsValid()`. On the earlier binary a wallet
  tracking only `pkh(...)` scripts did not recognise that output as its own:
  fullnode-4 was observed going 50M to 30M with `send -5,000,250.00` twice per
  win.

  That drain does not reproduce on v22.1.5. Across a window in which five of the
  eight stakers won a block, each of those five gained **exactly +500** -- the
  PoS reward -- and none lost principal; all eight sit just above 50,000,000
  with `immature` at zero. Old `send` rows from before the fix are still in
  `listtransactions` and are history, not a current symptom: read the balance,
  not the row type.

- **Debian 13 has no `libdb5.3++`,** so a wallet build linked against Berkeley
  DB will not run there. The fleet uses a `--without-bdb` build with SQLite
  descriptor wallets, which does stake. The seed node keeps its BDB wallet and
  must not be given the other binary.

- **A node stuck below the tip may be on a marked-conflicting fork, not merely
  behind.** After the v22.1.5 restart two masternodes on one host sat at 2427
  while the network ran at 2624, one of them holding 12 peers -- which rules out
  a connectivity problem. `getchaintips` told the real story: their active tip
  was a 2427 the network had abandoned, and the network's actual 2427 was listed
  `status: conflicting`. Neither node held a ChainLock at all (`getbestchainlock`
  answered "Unable to find any ChainLock"), so the marking did not come from
  one.

  `BLOCK_CONFLICT_CHAINLOCK` is a separate bit from `BLOCK_FAILED_MASK`, and
  `ResetBlockFailureFlags` clears it only when `ignore_chainlocks` is true
  (`validation.cpp:3740-3762`). So plain `reconsiderblock <hash>` does nothing
  here; **`reconsiderblock <hash> true`** is what releases it. Both nodes went
  from 2427 to the tip within 60 seconds, no reindex needed. Pass the network's
  hash for the forked height -- descendants are cleared with it.

- **Stalled block production and a slow block are hard to tell apart, and the
  ISLock timeout makes the difference.** A gap of 454 seconds looked like the
  chain had stopped; it was one block waiting out `WAIT_FOR_ISLOCK_TIMEOUT` for
  a batch of 23 transactions, and it mined all of them at once. Blocks either
  side of it were 56-130 seconds apart. Before concluding the chain has stalled,
  check whether the mempool is non-empty and the node is logging `CreateNewBlock`
  -- and read the node's log timestamps as **UTC**, which is an hour or two off
  the wall clock the surrounding commands print.

- **The PoSe ban waves were a parameter, not a fault: `dkgBadVotesThreshold 3`.**
  `dkgsession.cpp:672` marks a member bad once `badMemberVotes >= threshold`,
  and the inherited devnet profiles set that to **3 votes out of 50/60 (6%)**
  where mainnet Dash uses 80%. Three peers that missed your contribution --
  routine on a mesh where a handful of quorum connections are always in
  flux -- were enough to punish; punishment accrued faster than the 1/block
  decay between hourly rounds; 100 meant ban. The fingerprint that identified
  it: `llmq_400_60` (badVotes 30) at health 1.00 in the same blocks where
  `llmq_50_60`/`llmq_60_75` (badVotes 3) punished 12-16 members. It also
  explains months of `formationRate 1.00` next to low health: `minSize 3`
  forms anything, `badVotes 3` punishes everyone. Fixed mainnet-proportionally
  (40/48); the Q60 profile ships with 48. Do not "fix" a wave by reviving
  into it -- the treadmill refills.

- **A reconfigure can silently kill dependency tracking.** After the
  maintainer-mode configure regeneration, header edits stopped triggering
  dependent rebuilds: `touch` on `consensus/params.h` + `make` recompiled 15
  of 1081 objects. Every incremental build after a header-layout change was
  then a potential **mixed-ABI binary** -- ours crashed with memory access
  violations at 0x12c in every test fixture and failed base58 spork-address
  parsing, symptoms that look nothing like their cause. Detection is one
  line: `find . -name '*.o' ! -newer <touched-header> | wc -l` after a make
  that claimed success. Remedy: `make clean` after any configure
  regeneration, and treat "surprisingly few CXX lines after a header change"
  as an alarm, not a gift.

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

- **Do not measure in the first rounds after a revive or a restart.** Reviving
  46 masternodes at height 2404 returned the network to 80 enabled, and the
  selection immediately drew 50 of them into the next `llmq_50_60` round --
  before their DKG mesh had re-formed. That round closed at health 0.16 with 42
  members punished, the next at 0.32 with 34, and penalties accumulated to the
  ban threshold for 21 nodes. `quorum dkgstatus` showed it plainly at the time:
  `members=50 connected=25`, with `recvContrib` still at the pre-revive count.
  Nothing was wrong with the network; the measurement was taken while it was
  still re-connecting. Wait for the mesh, or record the round as an artefact of
  the intervention.

- **A round forming and a round being healthy are different questions.** In the
  window above `formationRate` was **1.00** -- every round that decided did
  form -- while the median health ratio was 0.24. Reading only the formation
  rate would have reported a healthy network at the exact moment it was
  punishing 55 of its own members. The two numbers must always be shown
  together.

- **Operator attribution is by host IP** with an explicit proTxHash override.
  It is declared through the admin API, never inferred, and never committed:
  the host addresses are not public and this repository is.

- **A rule the chain is too young to reach is not measured by the chain.** The
  PoS kernel v2 change (#109) has two halves and this devnet can observe only
  one of them. The weighted target -- `hash/weight` division instead of a
  multiply that truncated at 256 bits -- acts on every stake attempt from the
  activation height. The lifted `stakeAgeRange` upper bound cannot bind until
  an unspent output is older than that bound: 60 days on devnet
  (`chainparams.cpp:573`), against a chain that began on 2026-08-21. Nothing
  can exercise that half before roughly 2026-10-20.

  Age here is block-time arithmetic -- `inputAge = nTime - nBlockFromTime`
  (`pos/kernel.cpp:225`) -- not wall clock, which is why a unit test or a
  regtest node with `setmocktime` reaches it in seconds while the devnet cannot
  reach it at all. Both directions are already covered off-chain:
  `src/test/pos_kernel_tests.cpp` builds the same fixture against
  `nPosKernelV2ActivationHeight` 0 and `max()`.

  So an experiment closed in this window measured the target change and not the
  age cap, and must say which. Claiming the lift was validated on-chain would
  be the same error as reading `formationRate` without the health ratio: a true
  number answering a question nobody asked.

## Verified facts about the node (`v22.1.x`; the devnet now runs v22.1.5)

The facts below were read from source at v22.1.4 (`7227180053`) and re-checked
against the tree that became v22.1.5. The version bump itself is only
`configure.ac`: it exists because eight backports shipped in one day under an
unchanged version string, and three different binaries reported v22.1.4 at
once. The string still does not identify a build -- compare `md5sum`.

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

### The devnet ChainLock quorum: `LLMQ_400_60`, switching to `llmq_defcon` (Q60) at height 3240

The Q60 profile the whole project was built to test now exists in the node:
`LLMQ_DEFCON` (type 7), **60/44/41**, hourly DKG, `dkgBadVotesThreshold 48`.
Selected by the simulator at
github.com/minuszka/defcon-chainlock-pose-simulator; the decisive property is
`2*threshold > size` -- 82 > 60 -- which makes two disjoint signer sets, and so
a dual ChainLock under partition, impossible by construction.

**That guarantee is about ChainLocks, and it does not extend to commitments.**
`dkgsession.cpp:1108` bails out only once a member already holds two premature
commitments, so **two per member are accepted** -- the code says so itself at
:1156, "We only handle up to 2 commitments per member". `FinalizeCommitments`
groups them by `validMembers` alone (:1220) and needs `minSize` of them per
group (:1232), so one member's two commitments land in two different groups and
set its signer bit in both. Two competing final commitments with different
`validMembers` are therefore not arithmetically impossible on Q60; they require
44 of 60 members to double-sign, which is 73% collusion. That is a strong
economic barrier and a different kind of claim from the ChainLock one. Say Q60
is structurally immune to a **dual ChainLock**; do not say it is structurally
immune to divergent commitments.

The switchover follows the simulator audit's design: a single, one-way,
height-only resolver (`llmq::GetChainLocksLLMQType`) that both signing and
verification use, keyed on the CLSIG's signed height. Below
`nChainLocksV2ActivationHeight` (devnet: **3240**) everything is and remains
`llmq_400_60`; at and above it, `llmq_defcon`. Historical locks stay
verifiable forever -- the CbTx best-CL consensus check and both RPC verifiers
funnel through the same one line in `VerifyChainLock`.

Two rollout constraints, both enforced in code: quorum formation for the new
type is gated to `(signingActiveQuorumCount+1)*dkgInterval` = 120 blocks
before activation (devnet: 3120), so quorums exist when the resolver flips;
and **a commitment of a type old binaries do not know forks them off**, so
every daemon must run the new binary before height 3120. `getbestchainlock`
reports the resolved profile name.

### The pre-Q60 history: `LLMQ_DEVNET`, then `LLMQ_400_60`

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

The reconstruction runs for **every** quorum type this devnet forms --
`llmq_50_60` (interval 24), `llmq_60_75` (48) and `llmq_400_60` (72) -- not
only the ChainLock profile. Tracking one type hid real failures for months of
chain: a 57-block experiment window contained no decided `llmq_400_60` round at
all, while `llmq_50_60` had closed twice inside it and punished 55 members.
Streaks and medians are computed per profile; blending three interleaved
schedules invents streaks no type ever had.

**`quorum listextended` takes a height, not a count,** and returns exactly
`signingActiveQuorumCount` quorums per type
(`ScanQuorums(type, pblockindex, signingActiveQuorumCount)`, `rpc/quorums.cpp`).
So a commitment older than the oldest one it still reports has left the RPC's
reach: absence there means "cannot see", not "did not happen". A profile added
to the collector later starts mid-window, and its oldest scheduled height would
otherwise be written as a failure that never occurred. Such heights are left
out of the record entirely -- `absenceIsEvidence()` in `domain/dkgSchedule.ts`.

**A gated profile has no rounds below its formation gate.** The node refuses
to form a consensus-added type below
`activation - (signingActiveQuorumCount + 1) * dkgInterval` (for `llmq_defcon`:
3120), so a scheduled height under the gate is not a failed round -- no session
ever ran, by rule. The collector once wrote 11 `failed` rows for that era and
inflated `consecutiveFailures` on the first real round (3120, formed at health
1.00, "11 straight failures"). Profiles now carry `formationGateHeight`
(`isSchedulable()` in `domain/dkgSchedule.ts`); heights below it stay out of
the record, exactly like heights beyond the RPC window.

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
limitation as the regtest `-llmqtestparams` override. This is why Q60 shipped
as a first-class profile (`llmq_defcon`) instead of an override.

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

### Every binary rollout gets an Experiments entry that says what changed

Whenever DeFCoN code is changed, built and shipped to the fleet, the run
declared in the explorer's **Experiments** view must describe that change in
full. It is the only place the code and the chain are tied together later: the
git log knows the commits, the hosts know the binary, the chain shows a
behaviour change at some height -- and nothing but the run record says they are
the same event.

Minimum for such a run:

- `intervention.description` -- every code change in the build, one line each,
  with its PR number and the activation height or gate that switches it on.
  "PoS kernel v2" is not a description; "#109: weighted target divides
  hash/weight instead of multiplying, which truncated at 256 bits and could
  rank a larger stake below a smaller one; devnet gate 4000" is.
- `nodeVersion` and `nodeGitSha`, plus the binary `md5sum` in `notes` -- the
  version string does not identify a build, and has already named three
  different binaries at once on this project.
- `intervention.targets` -- what was actually replaced, by **host label**
  (`fullnode-4`), never by IP: the explorer is a public site.
- `hypothesis` and `expected`, written *before* the rollout rather than fitted
  to the result afterwards.

Because that site is public, the disclosure rule that governs PR text governs
this field too: bug class, fix rationale and test coverage -- never
reproduction steps or exact trigger inputs.

## Gotchas

- `.env` with CRLF breaks `set -a; . ./.env` on Linux (`$'\r': command not
  found`). `.gitattributes` forces LF; keep it that way.
- The workspace folder name contains a space (`devnet .deftrack`) — quote paths.
- The planning-docs folder is named with 19 exclamation marks. In `.gitignore`
  the leading `!` must be escaped (`\!!!...`) or git reads it as a negation.
