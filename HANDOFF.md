# HANDOFF — devnet session, 2026-09-05

**Repo** this one (`devnet .deftrack`), branch `main`. **Node** `e15e29b136`
(#193) on the whole network. The previous handoff, on the DeFCoN Core v23
pre-release audit, is preserved unchanged as
[`HANDOFF-v23-audit-2026-09-04.md`](HANDOFF-v23-audit-2026-09-04.md).

Open work is tracked in [`plan.md`](plan.md); this file is the narrative of what
happened and what to do next. Where the two overlap, `plan.md` is the list to
work from.

---

## 1. The task

The newest binary had just been rolled out. Two questions: what is actually in
it, and which experiments are worth running against it. That turned into six
Experiment runs, one operational change to block production, and the first real
installation of the fault-injection tooling.

---

## 2. What is deployed, verified rather than assumed

| | |
|---|---|
| Node commit | `e15e29b136` (#193) |
| Seed binary | `/usr/local/bin/defcond` md5 **f0a2d5ce** (BDB build) |
| Fleet + devnet2 | `/usr/local/bin/defcond-nobdb` md5 **356f2b25** |
| Uniformity | 16 hosts, 160 instances, one chain, 0 forked, 0 unreachable; plus seed and devnet2 = **162** |
| Masternodes | 152 total / 152 enabled throughout the session |

Compared by `md5sum`, never by version string — all three report `v22.1.5`.

---

## 3. Completed

### 3.1 Five Experiment runs closed

- **`sentinel-hardening-rollout-2026-09-04`** (7745 → 8004). 31 rounds formed,
  0 failed, median *and* worst health 1.00 on all four profiles, 0 PoSe
  penalties, ChainLock coverage 1.00, block spacing on target. Ten consecutive
  Sentinel epochs (323–332) committed after the change against a 93.5–96.6 %
  baseline; the single absent epoch, 322, is the one whose signing window
  contained the restart itself.
- **`bls-strict-size-spend-2026-09-04`** (7756 → 8004). #184 proven on-chain: a
  BLS-locked output created and spent with the strict rule active, mined in
  block **7760**, scriptSig one `OP_PUSHDATA1` push of **97 bytes**. Negative
  control: the previous binary reindexes to 7759 and refuses 7760
  (`ConnectBlock: CheckQueue failed`), and offered the same transaction answers
  `non-mandatory-script-verify-flag (Non-canonical DER signature)`.
- **`instantsend-lock-latency-2026-09-05`** (8015 → 8017). 20 transactions:
  median **1.143 s**, p90 2.020 s, min 0.768 s, one outlier at 18.157 s. The
  conflicting spend was refused with **`tx-txlock-conflict`**, not an ordinary
  mempool conflict — the null result written into the hypothesis did not occur.
- **`chaos-wrapper-pilot-2026-09-05`** (8022 → 8022). Installed on one fleet
  host; every refusal path fired with its exact message; a marker job retired
  16 s after expiry and a 1 ms netem fault 5 s after expiry, both with nobody
  calling `clear`; `eth0` restored to `fq_codel` on its own.
- **`stake-redistribution-2026-09-05`** — **still open**, see §5.

### 3.2 An owed verification that had been skipped

The rollout run's `expected` demanded a full reindex on the new binary reaching
the network's tip hash, and the run was closed this morning without it. Done
afterwards on binary `356f2b25`: **8028 blocks** rebuilt from raw block files
with `-assumevalid=0` in **45 s**, **zero validation errors**, tip hash equal to
the live chain's (`a1118849…469a1e`). That single result closes #193 (every
historical DSL commitment re-derived its attesting quorum — a mismatch is
`bad-dsl-quorum-hash` and would have stopped the reindex), #164 (the
connect-time stake modifier is deterministic, which RPC cannot show) and #188.
The evidence was appended to the closed run's notes.

### 3.3 Unit coverage confirmed on the deployed commit

- `llmq_chainlocks_tests` — no errors. Includes `llmq_configuration_coherence`
  and `formation_follows_the_height_not_the_network` (#186).
- `pos_stake_rules_tests`, `pos_multiwallet_tests` — no errors. Includes
  `a_watch_only_output_is_never_offered_as_a_kernel` (#167).

### 3.4 Findings worth more than the runs that produced them

- **The premine key is identical on all four networks** (`chainparams.cpp` 224,
  416, 587, 924). The devnet premine is locked to the main network's own
  premine key, so the originally planned "spend a premine output" test would
  have required a production secret. It was rebuilt on a freshly generated BLS
  key instead.
- **The mainnet premine is already spent.** Verified with a control against a
  copy of mainnet at 130100: `gettxout` on the coinbases of blocks 1, 2, 450,
  899, 900 all answer spent; `scantxoutset` on the premine script returns
  `0.00000000` while a control script returns 2,990,000. The v23 audit's
  headline risk therefore rested on an assumption that no longer holds — and
  M-02's real benefit is a different one (see `plan.md` §5).
- **One kernel script won 44 % of 250 blocks**, top five 57 %, and it is the
  seed's wallet, holding 58.6 % of network stake weight — while the experiment
  outcome reported `distinctStakers: 42`.

---

## 4. Decisions taken

- **The seed's staking is off, durably** (user chose this over letting it come
  back at E1a's restart). `staking=0` in the seed conf plus a systemd drop-in
  clearing `ExecStartPost` for `defcond-devnet` only. Verified by restarting:
  service active, `ExecStartPost` empty, 175 peers, tip advancing.
- **M-02 / v23 is postponed** by the user; everything found about it is in
  `plan.md` §5 so it is not lost.
- **The chaos pilot host was chosen by the inventory's own rule**, not by
  preference: `fleet-nodes.txt` exists precisely "so a routine rollout does not
  reach the hosts that also carry production services". Among those 11, three
  carry no fleet staker — which matters while block production rests on the
  staker hosts — and one of those three runs no containers.
- **The chaos pilot applied no real fault.** A marker job and a 1 ms delay were
  enough to prove the recovery timer; stopping a masternode belongs to the
  outage run, not to a tooling pilot.

---

## 5. What remains

Work from [`plan.md`](plan.md). The immediate items:

1. **Close `stake-redistribution-2026-09-05`** once the LWMA-3 retarget settles
   (N = 36, recomputed every block; expect two to three hours from 07:41 UTC).
   The number the run exists for is the top-1 producer share: **44 % before**,
   expected 10–15 % after. Difficulty had already fallen 519 M → 428 M and six
   blocks after the switch came from five distinct producers, none of them the
   seed.
2. **E1a**, the DSL enforcement gate. Then **E1b** (the punishing branch, first
   time on any chain) and **E2** (the mass-outage guard edge pair).
3. **E4b** and the real InstantSend security test — the latter needs a partition
   fault the wrapper does not implement yet.

---

## 6. Exact next steps

### 6.1 Closing the staking run

```bash
# top-1 producer share over the last 250 blocks; run on the seed
# (the same sampling used before the switch, so the two are comparable)
# then close at the current tip and write the notes.
```
Compare against the recorded baseline in that run's `notes`: 41 distinct kernel
scripts, top-1 110/250 = 44.0 %, top-5 57.2 %.

### 6.2 E1a, the enforcement gate

- Pick **H = tip + 100 rounded up to a multiple of 24** (epoch boundaries are
  exactly the multiples of 24; epoch 323 began at 7752).
- Add `dslenforcementheight=H` to the **`[devnet]` section** of every conf: 160
  fleet instances, the seed, devnet2. Then restart all of them.
- **This is consensus.** `IsBanned()` reads `nDSLBanHeight` (`dmnstate.h:454`)
  and `fRewardSuspended` changes payee selection, so a node started without the
  argument forks — the same mechanism as `dslactivationheight`, which has
  already stranded a node once on this project.
- The node refuses an enforcement height below the activation height, so the
  configuration cannot be half-applied in that direction.
- The seed's restart no longer re-enables its staking; that interaction was
  removed in §4.

### 6.3 Reverting anything from this session

```bash
# seed staking back on
rm /etc/systemd/system/defcond-devnet.service.d/no-staking.conf
sed -i 's/^staking=0$/staking=1/' /home/defcon/.defcon/defcon.conf
systemctl daemon-reload && systemctl restart defcond-devnet

# chaos wrapper off the pilot host
bash /root/chaos/uninstall.sh && userdel chaosops
```

---

## 7. Working notes for whoever continues

- **Remote configuration writes and service restarts are blocked in this
  session's permission mode.** The seed staking change had to be handed to the
  user as a script to run from their own PowerShell. Read-only SSH, the
  Experiments admin API and throwaway-datadir work all pass. Expect the same for
  E1a's fleet-wide conf edit and restart — plan it as a script the user runs, or
  get a Bash permission rule added first.
- **Every measurement in this session that looked like a failure was checked
  before being reported, and two of them were the tool's fault, not the
  network's**: the InstantSend probe raced the ChainLock that prunes the record
  it polls, and the first negative-control reindex died on a startup flag
  (`Cannot set -bind together with -listen=0`) rather than on validation. Keep
  doing that; `plan.md` §3 lists the tooling debts it exposed.
- **Experiment field limits are 2000 characters** for `hypothesis`, `expected`
  and `notes`, and 1000 for `intervention.description`. Write to the limit
  before posting; the API refuses rather than truncating.
- The admin API key lives in `/opt/devnet-deftrack/app/.env` on the explorer
  host as `ADMIN_API_KEY`; read it there and post from the host so it never
  crosses the wire.
- Scratch scripts from this session are in the session scratchpad
  (`isprobe.py`, `reindex-current.sh`, `chaos-install.sh`,
  `chaos-exercise.sh`, `seed-staking-off.sh`); the shapes are worth keeping.
