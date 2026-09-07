# Devnet rollouts

A record of what has been deployed to the `defcon-q60` devnet, kept in the
explorer's repository because the rollouts are interventions in the very
network this explorer measures. One entry per completed rollout, written when
the rollout completes; the live measurement record, with each run's hypothesis
declared before its outcome is known, is the [Experiments
page](https://devnet.deftrack.xyz/experiments).

Two facts frame every entry here. The devnet exists to measure DKG and
ChainLock behaviour, so a rollout is an intervention to be recorded, not just
an upgrade. And a version string does not identify a build — different binaries
report the same version — so entries record md5sums.

## Sentinel relay fixes and the Dash audit wave — the whole network, no gate

*Rolled out 2026-09-07, completed at height 9147. Explorer record:
[`fleet-rollout-208-2026-09-07`](https://devnet.deftrack.xyz/experiments/fleet-rollout-208-2026-09-07).*

Every daemon on the devnet runs a binary built from defcon-project/defcon
commit `c739d9f504fe4a2b390a9cdceb907f927535b328` (v22.1.5): 16 fleet hosts
carrying 160 instances (152 masternodes and 8 stakers), plus the seed and
devnet2 — **162 daemons, no exceptions**.

| artefact | md5 |
|---|---|
| fleet / devnet2 non-BDB (`--without-bdb`) | `406828f76173a5a23f3dd6db740afc76` |
| seed BDB | `a1ad976f18016c5a67672adacdb8f4f5` |
| `defcon-cli` (both) | `91a238ea58105541a5e2364be1ba5e7f` fleet, `815f2091fec9f66e0e126fad51a8c967` seed — both byte-identical to the ones they replaced |

It replaces `c0db9a2fe14f2e5b8ec90878306e613c` on the fleet and devnet2 and
`93d4868fc7311cf60d4d2570300d8560` on the seed, both built from `3ce1d8b8d6`
and installed 2026-09-05.

**No consensus gate is introduced or moved by any of the twelve commits**, and
the consensus-string fingerprint is bit-identical across old and new on both
artefacts — 178 strings, md5 `559683c468564314759dfe943705e359`, identical
sets, with a negative control on a narrower pattern giving a different value.
Mixed versions during the roll were therefore safe by measurement rather than
by assumption.

### What the binary carries beyond `3ce1d8b8d6`

All references are pull requests on
[defcon-project/defcon](https://github.com/defcon-project/defcon):

- [#197](https://github.com/defcon-project/defcon/pull/197) — build/qt: Qt
  5.15.19 in depends, minimum Qt 5.15, Qt-6-removed APIs dropped. GUI only, so
  inert in a `--with-gui=no` build
- [#198](https://github.com/defcon-project/defcon/pull/198),
  [#199](https://github.com/defcon-project/defcon/pull/199),
  [#200](https://github.com/defcon-project/defcon/pull/200) — DSL fault
  injection behind the `-enablefaultinjection` hard gate: refused at startup on
  mainnet and testnet, allowed on devnet and regtest, process-local,
  height-expiring, nothing serialised. The faults act on announce, reports,
  signing and miner inclusion, and `dslstatus` gains `poolhash`, `candidate`
  and `faults` so shadow tests can read whether signers hold the same pool
- [#201](https://github.com/defcon-project/defcon/pull/201) — RPC:
  `masternode payments` stops before genesis instead of aborting the daemon
- [#202](https://github.com/defcon-project/defcon/pull/202) — RPC:
  `faultinject` parses its numbers from strings, the form `defcon-cli` sends
- [#203](https://github.com/defcon-project/defcon/pull/203) — governance
  (audit F-019): govsync Bloom hash-function limits bounded and rejected with
  score 100 before request classification
- [#204](https://github.com/defcon-project/defcon/pull/204) — RPC (audit
  F-028): legacy masternode operator payloads choose their signing scheme by
  V19 activation, matching verification. Dormant, since V19 is unset on every
  network, but it would have blocked `service update` and `revoke` for
  legacy-registered masternodes the moment V19 activated
- [#205](https://github.com/defcon-project/defcon/pull/205) — LLMQ (audit
  F-016): malformed but within-cap `QSIGSHARE`, `QSIGSESANN`, `QSIGSHARESINV`
  and `QGETSIGSHARES` vectors are scored 100 and disconnected
- [#206](https://github.com/defcon-project/defcon/pull/206) — LLMQ (audit
  F-008, F-007): the `AlreadyHave` fallback for a best ChainLock is restored
  after the bounded seen cache misses
- [#207](https://github.com/defcon-project/defcon/pull/207) — **DSL**: an
  announcement arriving before its epoch base block is held for one block and
  validated when that block connects, instead of being dropped with no
  retransmission ever following. Ungated; acts from the first epoch after
  install
- [#208](https://github.com/defcon-project/defcon/pull/208) — **DSL**: Sentinel
  messages relay over masternode connections as well as ordinary ones, since
  they are quorum traffic. Block-relay-only connections stay excluded. Ungated

### The gates this rollout passed before it shipped

Every one of these can fail, and each was checked against evidence rather than
assumed:

- **Build freshness** — zero sources and zero objects newer than the binary
- **Mixed-ABI canary** — all 677 fleet objects and all 679 seed objects newer
  than the regenerated `configure`, each set produced inside a single build
  window after a `make clean`, so no incremental build crossed a reconfigure.
  This is the check that a reconfigure once defeated silently
- **Tree identity** — the fleet binary was built from the cherry-pick
  `9aa903f696`, whose tree is identical to merged upstream `c739d9f504`,
  verified with a negative control against `dc79b9cd1d`
- **Artefact kind** — the fleet build carries the `Compiled without bdb
  support` marker and the seed build does not, each probe controlled against
  the other binary
- **`ldd` on real targets** — clean on a Debian fleet host, on all five Ubuntu
  24.04 hosts, and on the VPS, before anything was installed anywhere
- **Consensus fingerprint** — bit-identical, with a negative control

### Result

160 of 160 fleet instances on one chain at height 9147, zero forked, zero
unreachable, every host reporting the shipped md5; seed and devnet2 at the same
height and the same block hash; ChainLock at the tip on `llmq_defcon`. All nine
block-propagation observers kept reporting across their hosts' restarts.

**devnet2 was included deliberately.** It runs `/usr/local/bin/defcond-nobdb`,
a different path from the seed's `defcond`, and every earlier roll had left it
behind on whatever build it happened to hold.

Run closed at 9194. Frozen outcome over the 49-block window: 6 rounds formed
and none failed, formation rate 1.00, median health 1.00 and worst 0.96,
ChainLock coverage 1.00, 28 distinct stakers, median block interval 96 s —
**and one ban, 8 penalty increases, 7 masternodes punished.**

### What the restart cost, and the prediction that was wrong

The DKG round with base block 9144 is the only one that spans the rollout.
`llmq_defcon`, the ChainLock profile, formed at health 1.00 with nobody
punished. `llmq_50_60` formed at 0.96 with 2 punished and `llmq_400_60` at 0.96
with 6, all of them on `roland-node-5`, `-6` and `-8` — the hosts carrying 7 to
14 instances each, which drop the most DKG connections at once.

**One masternode was banned, and the run had predicted that none would be.**
It took 100 at 9155 from `llmq_50_60`, then 100 again at 9165 from
`llmq_400_60`: ten blocks apart, saturating at the 152 ceiling. The declared
expectation reasoned from a single profile's 24-block interval and concluded
that two exclusions could not fall close enough together. That was wrong for a
reason `CLAUDE.md` already records — what bans is two exclusions from
*different* interleaved profiles, and their gap has nothing to do with either
one's interval. Enabled fell to 151.

No cascade followed. The 9168 rounds formed at 1.00 with nobody punished, so
the mesh had re-formed within one interval, and the five nodes left at 100
decay from there at one point per block.

### The two Sentinel fixes, measured

The report pool was sampled on 11 hosts at every block from epoch position 17
to 23, the same measurement taken before the rollout:

| position | before the rollout | after |
|---|---|---|
| 18 | 189-988 of 1064 | 286-632, 11 distinct pool hashes |
| 19 | 430-1064 | two distinct values |
| 20 | two nodes still at 722 and 822 | **all identical**, unchanged through 23 |
| 21 (signing starts) | first height where all agreed | already agreed |

So convergence now completes a full block before signing begins rather than at
the moment it begins. `missedreports` was 0 on every node at every position: no
phantom MISSED reports in a quiet epoch, which is what #207 was expected to
remove.

Epoch 381 carries no commitment, but it contains the rollout restarts and is an
artefact of the intervention rather than a measurement. Epoch 382, the first
clean one, carries its commitment — a type-10 transaction in block 9192.

**This does not close the absent-epoch question.** The single-block publication
window and the fixed three-block signing offset are untouched by this rollout,
and the decision recorded in `plan.md` stands.

## DSL shadow re-roll — reorg/signing hardening, activation brought forward to 5472

*Rolled out 2026-08-30, completed at height 4939. Explorer record: the same
[`dsl-shadow-activation`](https://devnet.deftrack.xyz/experiments/dsl-shadow-activation)
run (its notes carry this re-roll — the shadow phase is one experiment across
its builds).*

The sixth build of the DSL shadow phase, carrying a third external review's
fixes and bringing both height-gated events forward so the network reaches them
sooner. Every daemon — 8 fullnode hosts with 11 services each, plus both seed
daemons — runs a binary built from defcon-project/defcon commit
`371b75dcf620c6ebbfd6deb806b91bc79c65a7b9` (v22.1.5), with
`dslactivationheight=5472` configured everywhere.

| artefact | md5 |
|---|---|
| fleet / devnet2 (`--without-bdb`) | `d1be1264468ab1ee0119110f7b467837` |
| seed BDB | `c0353593d0d0e46fb8dd8b79b34ec6ba` |

### What the binary carries beyond the shadow build

[#149](https://github.com/defcon-project/defcon/pull/149) — two things, one
shadow-only and one a compiled-in gate move:

- **DSL (shadow-only, no consensus change)**: a reorg that rewinds the tip back
  across an epoch boundary now drops the stale epoch state — a new `Rewound`
  path in the per-epoch manager — instead of misreading it as ordinary forward
  progress and letting responses from the abandoned chain survive; and both
  reorg cases now mark the epoch a warm-up, so a rebase past the report cutoff
  can no longer judge a freshly-cleared observation set and report honest nodes
  missed. Separately, a masternode outside the selected signing quorum no longer
  rebuilds and retries the commitment on every block of the signing window — an
  `IsValidMember` pre-check retires the epoch for a non-member. All of it
  corrects shadow-mode measurement under an epoch-boundary-crossing reorg, which
  ChainLock makes rare; none of it touches consensus or reward payment.
- The same binary compiles the **strict-BLS-size (M-02)** gate forward, from
  6000 to 5250.

### The activation

Two devnet gates move forward in one coordinated roll — reached sooner, doing
exactly what they did before:

- **M-02** strict-BLS-size gate: `nStrictBLSSigSizeActivationHeight` 6000 → 5250,
  compiled into the binary, so every daemon carries it before the height.
- **DSL shadow**: `dslactivationheight` 6240 → 5472 (per-node config,
  epoch-aligned at 228 × 24), so the first service commitment is now possible at
  5496 rather than 6264. Enforcement stays unreachable — this is still shadow,
  and the convergence question it exists to measure is unchanged.

The build recipe is the established one — the fleet artefact is
`--without-bdb --without-miniupnpc --without-natpmp --with-gui=no`, the seed
keeps its BDB build — and `ldd` was checked on a real fleet host before install.
The roll completed with the whole devnet on one chain (matching tip hash at
height 4939, ChainLocked under `llmq_defcon`), every running process verified
against the shipped md5; rollback binaries are kept as `.bak-20260830-2304`.

## DSL shadow — the Sentinel Layer observes from height 6240

*Rolled out 2026-08-30, completed at height 4750. Explorer record:
[`dsl-shadow-activation`](https://devnet.deftrack.xyz/experiments/dsl-shadow-activation).*

Every daemon on the devnet — 8 fullnode hosts with 11 services each, plus both
seed daemons — runs a binary built from defcon-project/defcon commit
`4134f7ee220a96dadf59a3b771a9b512fb9385cb` (v22.1.5), with
`dslactivationheight=6240` configured everywhere before the restart.

| artefact | md5 |
|---|---|
| fleet / devnet2 (`--without-bdb`) | `c51785ebb84e93b6dbf0092d2061e214` |
| seed BDB | `72b753408692e72e4ac1b6c4991de9a9` |

(This is the fifth build of the rollout. The earlier ones, in order:
`16e1bab8…`/`f68618a2…` at `eaecf7e473` performed the database migration;
`e469b206…`/`7511171d…` at `ed33138d78` added the RPC payload
([#143](https://github.com/defcon-project/defcon/pull/143)); a fix for the
`defcon-tx` link ([#144](https://github.com/defcon-project/defcon/pull/144))
followed; and this one carries the two external reviews' fixes below.)

### What the binary carries beyond phase 5

The DeFCon Sentinel Layer (DSL): a service-liveness layer that bans a dead
masternode in hours instead of the DKG-PoSe median of ~N/720 days, without
touching the Q60 profile or the existing DKG-PoSe. Designed against the
chainlock-pose simulator's measurements (ban window 5 consecutive missed
epochs, 7 sentinels with 5 agreeing, 15% mass-outage guard). All references
are pull requests on
[defcon-project/defcon](https://github.com/defcon-project/defcon):

- [#129](https://github.com/defcon-project/defcon/pull/129) — **consensus
  (gated)**: the service-commitment special transaction (type 10), verified
  only by its quorum threshold signature — the ChainLock trust model
- [#130](https://github.com/defcon-project/defcon/pull/130) — **consensus
  (gated)**: the masternode service-state fields and the evodb migration that
  carries them
- [#131](https://github.com/defcon-project/defcon/pull/131) — **consensus
  (gated)**: applying a commitment's bitfield to masternode state, behind a
  separate enforcement gate that stays unreachable
- [#132](https://github.com/defcon-project/defcon/pull/132) — the sentinel
  assignment (grind-safe, epoch-rotated) and BLS-signed service reports
- [#133](https://github.com/defcon-project/defcon/pull/133) — aggregating
  signed reports into the epoch's bitfield (five of seven must agree)
- [#134](https://github.com/defcon-project/defcon/pull/134) — a spam-resistant
  relay store for the reports
- [#135](https://github.com/defcon-project/defcon/pull/135) — the probe's
  inverse assignment and the liveness response
- [#136](https://github.com/defcon-project/defcon/pull/136) — the per-epoch
  probe state machine
- [#137](https://github.com/defcon-project/defcon/pull/137),
  [#138](https://github.com/defcon-project/defcon/pull/138) — the wire
  vocabulary, with liveness as a self-announced flood
- [#139](https://github.com/defcon-project/defcon/pull/139) — the probe on the
  wire end to end, with the `dslstatus` RPC and chain-verified ingest
- [#140](https://github.com/defcon-project/defcon/pull/140) — binding the
  commitment to the epoch it observed
- [#141](https://github.com/defcon-project/defcon/pull/141) — quorum signing
  and mining of the commitment, attached only on an exact hash match
- [#142](https://github.com/defcon-project/defcon/pull/142) — evodb: every
  migration gate recognises a newer database (see below)
- [#143](https://github.com/defcon-project/defcon/pull/143) — rpc: the
  commitment payload in transaction JSON, with its missed bits named by
  canonical index — the surface this explorer's DSL view indexes
- [#144](https://github.com/defcon-project/defcon/pull/144) — evo: inline the
  commitment ToJson so the full release (`defcon-tx`) links
- [#145](https://github.com/defcon-project/defcon/pull/145) — evo: robust to
  startup, restart, reorg and bad input (first-review follow-ups)
- [#146](https://github.com/defcon-project/defcon/pull/146) — evo: bind the
  probe's signatures to the epoch base, validate ingest against the epoch-base
  list, and close two dormant enforcement gaps (second-review follow-ups)

### The activation

*(Superseded 2026-08-30 by the re-roll above: brought forward to 5472, and the
strict-BLS gate to 5250, so the network reaches both sooner.)*

`dslactivationheight = 6240` on devnet, epoch-aligned (260 × 24) and placed
after the strict-BLS gate at 6000 so the two events stay in separate
measurement windows. From 6240 the network probes itself once per 24-block
epoch in **shadow mode**: announcements flood, sentinels report, the ChainLock
quorum threshold-signs the epoch's bitfield, and the commitment is mined at
the next boundary — the first one possible at 6264. Shadow records
`missedServiceEpochs` per masternode and never suspends or bans: the
enforcement height stays unreachable until the shadow data supports it. The
open question the shadow phase exists to measure is pool convergence, and the
fraction of epoch boundaries carrying a commitment is that measurement — a
missing commitment is the datum, not a failure.

### The rollout that had to happen twice

The first deploy stopped every fleet daemon on a latent flaw in the inherited
evodb migration pattern: each migration gate short-circuited on one fixed
marker key — the newest constant — while a healthy database only ever carries
the marker of the binary it last ran, so after the constant bump every older
gate read a good database as a broken half-migration and refused to start.
The right instinct against the wrong evidence, never hit before only because
earlier bumps had coincided with freshly created databases. The fleet was
rolled back within the hour — the seed stayed up and staking throughout, and
the chain never stopped — and the fix landed as
[#142](https://github.com/defcon-project/defcon/pull/142) with a regression
test that replays the exact database state that refused to start. On the
second deploy the migration ran clean in one step and `evodb verify` on a
fleet host answered 7 snapshots verified, 0 errors. DKG and health readings in
the rollback window are restart artefacts and are excluded from measurement,
per the standing rule.

## Phase 5 — consensus/crypto audit hardening

*Rolled out 2026-08-29, completed at height 4304. Explorer record:
[`phase5-consensus-audit-rollout`](https://devnet.deftrack.xyz/experiments/phase5-consensus-audit-rollout).*

Every daemon on the devnet — 8 fullnode hosts with 11 services each, plus both
seed daemons — runs a binary built from defcon-project/defcon commit
`948f881b8d7e4ee8cd75de2d27ce1c2087dff383` (v22.1.5).

| artefact | md5 |
|---|---|
| fleet / seed non-BDB (`--without-bdb`) | `04c1a60764c6031f1685b8982d12216b` |
| seed BDB | `217a85670522bdf137d8b1e84d34cdb5` |

### What the binary carries beyond phase 4

The fixes come from a consensus/crypto review. All references are pull requests
on [defcon-project/defcon](https://github.com/defcon-project/defcon):

- [#114](https://github.com/defcon-project/defcon/pull/114) — test: cover the
  PoS kernel v2 activation boundary from both sides (regtest-only)
- [#115](https://github.com/defcon-project/defcon/pull/115) — wallet: match the
  wallet's staking eligibility to the kernel's depth rule (wallet-only)
- [#116](https://github.com/defcon-project/defcon/pull/116) — crypto: a BLS
  verify can no longer throw off the script-check threads (a crash became a
  clean `false`; unconditional)
- [#117](https://github.com/defcon-project/defcon/pull/117) — **consensus
  (gated)**: a strict BLS signature-size check, gated on an activation height
- [#118](https://github.com/defcon-project/defcon/pull/118) — crypto: an
  invalid `CPubKey` can no longer report itself valid (unconditional)
- [#119](https://github.com/defcon-project/defcon/pull/119) — consensus: derive
  the premature-collateral rule from the deterministic masternode list
  (unconditional, history-compatible)
- [#120](https://github.com/defcon-project/defcon/pull/120) — consensus:
  require a header's proof of work by height, not by its nNonce (unconditional,
  history-compatible)
- [#121](https://github.com/defcon-project/defcon/pull/121) — pubkey:
  `ValidSize` checks the secp256k1 header byte, not only the length
  (classification/policy only, ungated)

([#122](https://github.com/defcon-project/defcon/pull/122), the React + Tauri
modern wallet, is in the same upstream range but changes no node behaviour.)

### The activation

Only one fix here is gated. #117 sets `nStrictBLSSigSizeActivationHeight = 6000`
on devnet: below it nothing changes; from it a BLS signature must be exactly 96
bytes to be treated as BLS, so an over-long signature that currently slips past
the strict-encoding checks is held to them. The gate resolves from block height
alone, one-way, the same shape as the kernel-v2 and Q60 switchovers; mainnet and
testnet keep it unset. It ships now so the whole fleet already carries it before
the gate is ever brought forward — the input it rejects does not occur in
organic traffic, so the rule is dormant until then, and its rejection path is
covered off-chain by the fix's regression test.

The rest take effect the moment the binary runs and are history-compatible:
#119 and #120 re-derive existing consensus rules from the deterministic
masternode list and by-height proof of work rather than changing any verdict, so
reconsidering old blocks yields no difference. After the rolling restart the
whole devnet — 88 fleet services and both seed daemons — was confirmed on one
chain (matching hashes at a settled height, the tip ChainLocked), with every
running process checked against the shipped binary.

Deferred: the GetBlockProof half of the header proof-of-work fix (the chainwork
weighting) rewrites every node's accumulated work, so it is a coordinated,
height-gated change scheduled with the other mainnet activations, not part of
this binary.

## Phase 4 — PoS kernel v2, activated at height 4000

*Rolled out 2026-08-28/29, completed at height 3867. Explorer record:
[`phase4-kernel-v2-rollout`](https://devnet.deftrack.xyz/experiments/phase4-kernel-v2-rollout).*

Every daemon on the devnet — 8 fullnode hosts with 11 services each, plus both
seed daemons — runs a binary built from defcon-project/defcon commit
`9be589117ea6ad9d9957b20df22aeb46a0784fe9` (v22.1.5).

| artefact | md5 |
|---|---|
| fleet / seed non-BDB (`--without-bdb`) | `c36acecaab36c26e9650845abc1bb6fc` |
| seed BDB | `9409535d73fe7312276e3a9bc754c3e6` |

### What the binary carries beyond phase 3

All references are pull requests on
[defcon-project/defcon](https://github.com/defcon-project/defcon):

- [#100](https://github.com/defcon-project/defcon/pull/100),
  [#101](https://github.com/defcon-project/defcon/pull/101) — GUI:
  theme-native arrows, Nebula selector polish, multisig header fix, and the
  image distribution fix
- [#102](https://github.com/defcon-project/defcon/pull/102) — backports:
  wallet, allocator and ProTx-RPC smalls (dash#7346, dash#7383, dash#7342)
- [#103](https://github.com/defcon-project/defcon/pull/103) — RPC: predict
  upcoming DKG participation in `quorum dkginfo`
- [#104](https://github.com/defcon-project/defcon/pull/104) — PoS: set the
  validation state on stake rejection; lock the block index in the staking
  thread
- [#106](https://github.com/defcon-project/defcon/pull/106) — RPC: stop the
  address-index RPCs dereferencing a BLS address
- [#107](https://github.com/defcon-project/defcon/pull/107) — wallet: stop
  `dumpwallet` describing an incomplete backup as complete
- [#108](https://github.com/defcon-project/defcon/pull/108) — wallet: name BLS
  scripts in the import path instead of misreporting them
- [#109](https://github.com/defcon-project/defcon/pull/109) — **consensus
  (gated)**: correct the kernel's weighted target and stake-age rules
- [#110](https://github.com/defcon-project/defcon/pull/110) — wallet: stop
  staking losing coins silently (the split guard, and `getstakinginfo`
  reporting why coins are excluded)
- [#111](https://github.com/defcon-project/defcon/pull/111) — consensus: bring
  the devnet activation of #109 forward to 4000

([#99](https://github.com/defcon-project/defcon/pull/99), the anti-DoS
headers-sync groundwork, was already running on the fleet as part of the
phase-3 binary.)

### The activation

`nPosKernelV2ActivationHeight = 4000` on devnet. Below it nothing changes; from
it, the weighted target is computed by dividing the kernel hash by the stake
weight instead of a multiplication that silently truncates to 256 bits, and the
upper bound of `stakeAgeRange` stops applying. The gate resolves from the block
height alone, one-way, in the same shape as the Q60 ChainLock switchover:
blocks made under the original rules stay valid under them forever. Mainnet and
testnet keep the original rules — their activation height is unset.

The height was merged as 5000 in #109 and brought forward to 4000 by #111 once
the fleet was confirmed rolled. It is compiled into chainparams, so the change
required a full re-roll. Every devnet daemon was confirmed on the new binary
before the gate; the rollout completed at height 3867, 133 blocks ahead of it.
