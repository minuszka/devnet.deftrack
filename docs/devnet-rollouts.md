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
