# Plan — what is owed, and why

Working queue for the devnet. Everything here was either measured or read from
source; where something is *not* proven, this file says so rather than implying
it. Public repository: host labels only, never addresses.

Last updated 2026-09-05.

## 1. Experiment runs, in order

| Run | What it settles | Blocked on |
|---|---|---|
| **E1a** enforcement gate | `-dslenforcementheight` reaches every conf; nothing happens at the height | conf edit + restart on 160 fleet instances, seed, devnet2 |
| **E1b** enforcement outage | The DSL punishing branch, first time on any chain: 5 nodes down, `nMissedEpochs` 1→4 → `fRewardSuspended`, 5 → `nDSLBanHeight`; one online epoch clears all three (#189, #190) | E1a |
| **E2** mass-outage guard | The edge pair: 23/152 = 15.13 % (guard on, nobody punished, counter neither advances nor resets) against 22/152 = 14.47 % (guard off) | E1b |
| **E4b** chaos netem, real fault | A fault large enough for the quorum to notice, on one masternode | **ran 2026-09-05, see §3a** — it measured the tool, not the network; owed again once the fault can isolate a member |
| **InstantSend security** | A conflicting spend offered to a node that never saw the first one. The mempool refuses a double spend anyway, so only this shows InstantSend did the refusing | a partition fault; the wrapper does delay/loss only |

`E1a` is consensus: `IsBanned()` reads `nDSLBanHeight` (`dmnstate.h:454`) and
`fRewardSuspended` changes payee selection, so a node started without the
argument forks. Same mechanism as `dslactivationheight`. Height = tip + 100
rounded up to a multiple of 24 (epoch boundaries are exactly the multiples).

## 1b. Owed on the next fleet roll

- **M-02 comes off the devnet** (defcon-project/defcon#194). `CDevNetParams` no
  longer sets `nStrictBLSSigSizeActivationHeight`, so the rule is unset on every
  network -- the devnet is kept identical to what v23 ships, and M-02 is not in
  v23. **Until a binary carrying this reaches the fleet the change exists only
  in git:** every running daemon still enforces M-02 from height 5250.
  No urgency and no deadline -- unsetting a stricter rule is a relaxation, so
  the chain stays valid, there is no gate height to hit and no reindex. Ride the
  next binary rollout rather than making it an event of its own, and give that
  rollout its Experiments entry as usual.

## 2. In the binary, not proven on-chain

| Change | State |
|---|---|
| #186 `CheckLLMQConfiguration` | Unit tests pass (`llmq_configuration_coherence`, `formation_follows_the_height_not_the_network`). **Not reachable from a running node's configuration**: `-llmqchainlocks` only accepts types the network registers, so `require_registered` cannot be tripped from the command line. The guard is against a chainparams edit — i.e. the v23 Q60 mainnet activation — not against operator error. |
| #189 banned masternode may still answer | Needs a PoSe-banned node; the network is 152/152 enabled. Falls out of E1b. |
| #190 enforcement height | E1a. |
| #191 report target must be registered | Needs a crafted P2P message. Lab only. |
| #192 refused ChainLock leaves no trace | Needs a forged CLSIG. Lab only; unit-covered in `llmq_chainlocks_tests`. |
| #167 staking hardenings | Covered and passing: `a_watch_only_output_is_never_offered_as_a_kernel` in `pos_stake_rules_tests`. The 256-bit `expectedtime` half cannot be falsified at the current network weight — a passing observation today is not evidence. |
| #109 lifted `stakeAgeRange` upper bound | **Time-gated.** Needs an unspent output older than 60 days; the chain began 2026-08-21, so not before roughly **2026-10-20**. Off-chain coverage exists in `pos_kernel_tests`. |

Proven on-chain and closed: #184 (`bls-strict-size-spend-2026-09-04`, with the
negative control), #193 + #164 + #188 (full reindex on the current binary,
8028 blocks, `-assumevalid=0`, zero errors, tip hash equal to the live chain).

Added 2026-09-05, all measured against the deployed `e15e29b136`:

- **#171, proof-of-stake fee burning -- accepting side proven on-chain.**
  Devnet gate 7920. 188 PoS blocks measured across it, 0 RPC errors: every one
  minted exactly the subsidy. Below the gate the rule was never actually
  exercised, because **no block below it carried a fee at all**; above it three
  blocks carry real fees (0.21 DFCN total). Block 8017 hand-checked to the
  satoshi: coinstake input 7,862,109,000,000, outputs 7,912,109,000,000, minted
  50,000,000,000 = the subsidy, with 11,000,000 sat of fees present in the
  block over 13 transactions and left unclaimed. The *rejecting* side -- a
  modified wallet claiming the fees -- cannot be produced on a live chain;
  `pos_coinstake_fee_tests` covers it and passes on this commit.
- **#173, #174, #183 -- verified read-only on the running node.** Eight wallet
  RPC helps carry zero remaining "Dash" mentions. The `defcon` umbrella
  category appears in both the `logging` and `debug` help; it is deliberately
  absent from the `logging` category *list*, exactly like `all` and `none`
  (`LogCategoriesList` skips it), which is easy to misread as a regression.
  The dead knobs were not removed but rewritten to say what they are:
  `-llmqplatform` now reads "the (unused) platform role",
  `-llmqmnhf` "EHF signalling, which no deployment on this chain uses", and
  `-llmqinstantsenddip0024` is hidden behind the accurate `-llmqinstantsend`.

## 3a. E4b, 2026-09-05: what the fault injector actually does

Run `chaos-netem-quorum-2026-09-05`, fired at the llmq_50_60 cycle boundary
8064 with mn01 confirmed in the session at phase 1, `sentContributions: false`,
`receivedContributions: 0` — the exact moment the test was designed for. Four
findings, three of them about the tool rather than the chain.

- **The watchdog works, and was proven under the condition it exists for.** The
  fault cut administrative access to the host: `ping` and a TCP connect to port
  22 both succeeded while every SSH session timed out (exit 124) at 07:44:14,
  07:45:05 and 07:45:56 UTC. Nobody could call `clear`. The host-local systemd
  timer restored the `fq_codel` baseline **13 seconds after expiry** (applied
  07:36:14, TTL 600 s, reachable again 07:46:27), the job record was gone, and
  all nine masternodes were alive at the same height. The pilot demonstrated
  this with a harmless 1 ms fault; this time it mattered.

- **The netem fault is too broad: `1:3` is a default prio band, not a private
  one.** `apply_netem` runs `tc qdisc replace ... root handle 1: prio`, which
  creates the standard three-band prio whose classes are 1:1, 1:2 and 1:3, then
  hangs the netem on `parent 1:3` and points the port filter at `flowid 1:3`.
  Any traffic the kernel priomap already sends to that third band passes through
  the netem **without matching the filter**. At `loss 0` this is invisible — a
  stray packet is delayed one millisecond. At `loss 100` it is destruction, and
  it is what took SSH out while the run record claimed "SSH and RPC are
  untouched". The fix is a band the priomap cannot reach (`prio bands 4` with a
  priomap confined to 0-2, netem on 1:4), and the regression test must run at
  100 % loss, because no test at 0 % can fail.

- **The netem fault is also too narrow to do what it was aimed at.** The filter
  matches `ip dport <port>` on egress, so it drops only what the host
  *initiates* toward that one port number — one peer per host, every machine's
  first instance, plus the seed and devnet2. Replies on established inbound
  connections carry source port 19799 and are untouched, and every peer
  listening on 19800-19808 is unaffected. Measured on mn01: contributions still
  went out and **50 of 50** came back, `llmq_400_60` saw all 152, and
  `PoSePenalty` stayed 0. The visible effect was **19 received complaints**
  against `llmq_50_60`'s threshold of 40 — and 19 sits very close to the 16
  hosts plus seed plus devnet2 that the filter structurally cuts off. So the
  fault produced a real and quantitatively explained signal; "isolate this
  masternode" it is not.

- **A pure packet-loss fault cannot be expressed.** `require_fault_numbers`
  enforces `latency >= 1`, so `netem <target> <job> <expiry> 0 0 100` is refused
  with "latency must be 1..2000 ms". The run had to be fired as 1 ms / 0 / 100 %.
  Harmless here, but every loss experiment silently carries a delay.

Owed: fix the band binding before any further netem run, and re-run E4b once the
fault can actually isolate a member — which needs a filter on the peer set, not
on a port number.

**Closed 2026-09-05 at height 8088**, not at the tip. Left open it had absorbed
147 blocks — the whole of `stake-redistribution`'s recovery window, and it would
have taken the fleet roll's restart of 162 daemons as well. 8088 bounds it at
the full lifecycle of the round the fault was aimed at: the fault began at the
8064 cycle boundary and that round's commitment is mined in [8074, 8082]. The
frozen outcome over those 37 blocks is the clean statement of the negative
result — `llmq_50_60` formed both its rounds at health 1.00 with nobody
punished, on the profile and in the window the fault was timed to disrupt.

`stake-redistribution-2026-09-05` closed the same day at 8172: top-1 producer
share 44 % → **5.06 %** against an expected 10–15 %, 40 distinct producers,
Gini 0.216, ChainLock coverage 1.00, nobody punished.

## 3. Tooling debts found by using the tools

- **The InstantSend probe races the ChainLock.** It polls `getislocks`, and
  `HandleFullyConfirmedBlock` prunes the very record it polls. One of twenty
  transactions was mined four seconds after broadcast and its lock was gone
  before the poll could see it; scored naively that is a false "no lock". The
  probe must treat block inclusion as its own outcome, and should read the
  notification rather than poll.
- **`medianBlockIntervalSec` must not be compared against the target spacing.**
  Block intervals are a Poisson process, so they are exponentially distributed
  and the median is `mean x ln2` = 0.693 of the mean, never the mean itself.
  Measured over 40 blocks on 2026-09-05: mean 161.6 s, median 112 s, min 8 s,
  max 818 s -- and 161.6 x 0.693 = 112.0, an exact fit. The target governs the
  **mean**, so the settled chain is within 8 % of its 150 s target while the
  median makes it look 25 % too fast. `stake-redistribution-2026-09-05` named
  the median in its expected outcome and would have been read as a miss on that
  half. Either publish the mean beside it, or state the 0.693 factor wherever
  the median is compared to a target.
- **`distinctStakers` in the experiment outcome invites a wrong reading.** It
  counts distinct kernel scripts, not concentration: 42 distinct producers while
  one script took 44 % of 250 blocks. A concentration figure (top-1 share, or a
  Gini) belongs beside it, or every fairness measurement will read too kindly.
- **A restored root qdisc comes back with a new handle.** `fq_codel 8001:` where
  it began as `fq_codel 0:`; the kernel assigns it on replacement. A checker
  comparing handles reports a false difference — compare parameters.
- **`defcon-enable-staking` has a latent bug.** Its state check matches
  `"staking": "true"` while the node answers `"staking": true`, so the pattern
  never matches and it calls `setstaking` unconditionally — and `setstaking` is
  a toggle. On a normal restart the wallet switch defaults to off, so the toggle
  turns it on and the bug is invisible. If the switch were ever already on at
  that moment, the same call would turn staking **off**. devnet2 and the fleet
  stakers use this script.

## 4. Current state of the network

- **The seed no longer stakes, durably.** `staking=0` in its conf plus a
  systemd drop-in clearing `ExecStartPost` for that unit only. With staking off
  the subsystem does not initialise at all: `getstakinginfo` and
  `liststakingwallets` both answer `{}` — which is stronger than `false`, and a
  checker looking for `"staking": false` finds nothing and may misread it.
  Revert: delete
  `/etc/systemd/system/defcond-devnet.service.d/no-staking.conf`, restore
  `staking=1`, `daemon-reload`, restart.
- **`stake-redistribution-2026-09-05` is open.** Close it once the LWMA-3
  retarget settles (N = 36, recomputed every block) and measure the top-1
  producer share: 44 % before, expected 10–15 % after.
- **The chaos wrapper is installed on THREE fleet hosts, not one.** Measured
  2026-09-05; the earlier entry here said one and was wrong. The documented
  pilot host is the third (9 masternodes, no staker, no container, `chaosops`
  present, conf written 09-05 07:33, and its root qdisc carries the
  `fq_codel 8001:` handle the pilot's restore left behind). The other two are
  leftovers from install attempts the evening before (confs 09-04 21:10 and
  21:53): **no `chaosops` account**, so the restricted sudo path has no user --
  but the root-owned wrapper and its 15-second recovery timer are enabled and
  active on both, and one of them carries a fleet staker *and* a running
  `defcon-node` container. That is the case `fleet-nodes.txt` exists to
  prevent. Neither has ever run a fault: both sit at an untouched
  `fq_codel 0:` with zero job records.

  **The two leftovers were removed on 2026-09-05, with the user's approval.**
  All 16 hosts were swept first; exactly three carried the package and none
  had an active fault anywhere (zero `tc` filters, zero job records, every
  root qdisc a plain `fq_codel`). Recovery ran before the watchdog was
  disabled on each, and the removal was gated on the host's own hostname
  rather than on an inventory line, so a wrong entry could not have reached a
  machine it was not meant for. After: wrapper gone, timer absent, no
  `chaosops` account, `eth0` still at `fq_codel 0:` with no filters, and 11
  masternode units still active on each. Re-swept afterwards: 16 checked, 1
  with the wrapper. The network was unchanged throughout -- 152/152 enabled,
  ChainLock signing on `llmq_defcon`.

  **The pilot host still carries the pre-fix wrapper and is owed a
  reinstall.** Its root qdisc reads `fq_codel 8002:`, not the `8001:` this
  note said -- the kernel assigns a fresh handle on each replacement, which is
  exactly why a checker must compare parameters and not handles. Reinstalling
  needs the package from #76: `targets.conf` now requires a `host` record and
  the wrapper refuses every command on a machine whose hostname does not match
  it. Full removal anywhere is `ops/chaos/uninstall.sh` plus `userdel
  chaosops`.

  Note for whoever reinstalls: `/root/chaos-install.sh` on the jump host is
  the scratch script from the session that produced the two accidental
  installs. It predates the host binding and should be rewritten against the
  current `ops/chaos/install.sh`, which refuses a mismatched host and a host
  showing production markers.

## 5. v23 / M-02 — DROPPED from v23 (user, 2026-09-05)

**M-02 gets no mainnet or testnet height in v23.** Nothing is reverted: the
merged rule stays gated on devnet at 5250 and regtest 0, and mainnet simply
continues on the pre-M-02 `IsBLSSig` behaviour, which is therefore an accepted
exposure rather than an open finding. The notes below are kept because they are
the evidence behind the decision and would have to be re-derived if a later
release schedules it.

With K-03 (2026-09-04) and M-02 (2026-09-05) both out, the coordinated v23
activation is `nPosKernelV2ActivationHeight` + the Q60 switchover, not four
halves of one decision. The `CMainParams` comment above `posLimit` in
`chainparams.cpp` still names K-03 and M-02 and is now wrong on both.


- **The mainnet premine is already spent.** Verified against a copy of mainnet
  at height 130100 with a control: `gettxout` on the coinbases of blocks 1, 2,
  450, 899 and 900 all answer spent, and `scantxoutset` on the premine script
  returns `0.00000000` while a control script returns a real balance. The
  audit's headline risk — "activating M-02 would freeze the premine and split
  the chain on the first spend" — therefore rested on an assumption that no
  longer holds. `HANDOFF-v23-audit-2026-09-04.md` and the
  `m02-strict-blssig-size-gated` memory still carry the old framing and should
  be corrected.
- **M-02's real benefit is not about BLS outputs.** Below the gate `IsBLSSig`
  returns true for *any* signature of 96 bytes or more, and
  `CheckSignatureEncoding` then returns immediately — skipping DER strictness,
  low-S and hashtype for ordinary outputs too. `CPubKey::Verify` parses with
  `ecdsa_signature_parse_der_lax` and normalises, so a non-canonical signature
  can still verify. That is live on mainnet today — and stays live, since M-02
  is out of v23. The technical case for the rule is unchanged; the release
  decision went the other way.
  *Not measured:* exactly which mutations the lax parser tolerates, i.e. how
  exploitable this is by a third party. That is a bounded, worthwhile test.
- **Open question that decides the rest:** are there any unspent BLS-locked
  outputs on mainnet besides the premine script? `scantxoutset` cannot filter by
  type; `dumptxoutset` plus a parser can, and the parser must itself be proven
  on a known output before its answer is believed.

## 6. Housekeeping

- Refresh the inherited-failing tests listed in `CLAUDE.md`. **Two of the three
  named there now pass**: `subsidy_tests` and `block_reward_reallocation_tests`
  both came back clean on the deployed commit, so that paragraph is stale.
  `validation_chainstate_tests/chainstate_update_tip` still aborts exactly as
  described.
- **The 16 suites outside the CI gate were measured (2026-09-05, on the
  deployed `e15e29b136`) and the gate's exclusion list is exactly right.**
  Full run: 738 test cases, 12 aborted, 744 of 9,003,312 assertions failed.
  Every failing suite is on `build.yml`'s exclusion list and every excluded
  suite fails -- the two sets are equal, so nothing has been silently fixed and
  nothing new has broken. Everything the gate covers is green, including
  `pos_coinstake_fee_tests`, `logging_tests`, `llmq_chainlocks_tests`,
  `pos_stake_rules_tests`, `pos_multiwallet_tests` and `pos_kernel_tests`.
- **v22.1.4 cannot serve as the control for those 16.** Run there for exactly
  that purpose, it aborts 141 of 581 cases and skips 438 more -- the state
  #168/#169 was written to fix. A pre-#169 commit cannot distinguish "this
  suite fails" from "the binary died before the suite ran", so any control for
  the excluded set has to start at `bfd832a71e` (#169) or later. The failures
  themselves look inherited by construction -- `key_io_tests` and
  `rpc_tests/rpc_rawsign` die on Dash-format addresses in fixtures
  (`Invalid DeFCoN address: 7iYoULd4...`), which is the base58-identity pattern
  -- but that is a reading of the messages, not yet a measurement.
- CI builds linux64 only and runs no functional tests, while releases ship
  win64 and macOS.

### Open items the 2026-09-05 audit left in the explorer

- **The pilot host still carries the pre-fix chaos wrapper** and is owed a
  reinstall from the merged package, because `targets.conf` now requires a
  `host` record and the wrapper checks it on every command. Until then the
  pilot holds the old, wrong netem band, so **no real netem fault (E4b) may be
  run**. A VPS operation, and the only one the audit left owed.
- **A real host IP is in this repository's public git history**, at `fb6bb7c`
  and replaced at `a2f86c6`. The decision -- rewrite the history, or accept it
  and firewall -- is the owner's and has not been made. The CI secret gate
  deliberately scans the tree and not the history, so it neither forces that
  decision nor pretends it was made.
- **`defcon-enable-staking` has a latent toggle bug** (see §3): its state check
  matches `"staking": "true"` while the node answers `"staking": true`, so it
  calls `setstaking` unconditionally -- and `setstaking` is a toggle. Invisible
  on a normal restart, because the switch defaults to off; if it were ever
  already on, the same call would turn staking **off**. devnet2 and the fleet
  stakers use this script.
- **The other four writing services have no integration test.** `quorumRound`
  is covered end to end against a real MongoDB, and the repository-level claims
  (unique index, `$setOnInsert`, the write race) are covered for the round and
  ban-event patterns. `sync`, `masternodePoller`, `mnListDiff` and `chainLock`
  still have only unit tests over faked models, which cannot catch a schema
  path Mongoose silently drops.
- **The `action_*` audit events are declared and never written, and the
  `SimulationResumeDirective` is computed and never read.** Both are recorded
  in the simulator docs as unkept promises rather than features; closing either
  is its own piece of work.
