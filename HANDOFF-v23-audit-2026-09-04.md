# HANDOFF — DeFCoN Core v23 pre-release audit

**Written** 2026-09-04. **Repo** `defcon-project/defcon`, branch `v22.1.x`,
tip at handoff **`27f6e7b10a`** (#192). Working tree `~/DEFCON` in WSL Ubuntu.

Written in English to match the repo, commit messages and PR text.

---

## 1. The task

Audit the node before the v23 release, which will carry the first coordinated
mainnet consensus activation this chain has had. Mainnet runs **v22.1.4**
(every peer reports `/DeFCoN:22.1.4/`, protocol 70239); the release will be cut
from the `v22.1.x` tip. The audit had to answer two questions:

1. Is there anything in the code that makes v23 unsafe to release?
2. Does v23 validate the entire existing mainnet history exactly as v22.1.4
   does — i.e. did any change since that tag alter validity without an
   activation height to separate the two?

Both are now answered. The bug-hunting phase is closed.

---

## 2. Completed

### 2.1 Five blockers found and fixed (all merged)

| PR | What it was |
|---|---|
| **#184** | **M-02 would have frozen every BLS output, and the premine is one.** A script carries a signature with its hash type appended, so a BLS signature reaches the encoding check at **97** bytes; the strict rule compared against 96. With the gate active every genuine BLS spend failed as `SCRIPT_ERR_SIG_DER`. `consensus.premineAddress` is a 48-byte key under `OP_CHECKSIG` — a `BLSPUBKEY` output — on all four networks, and mainnet paid its first 900 blocks into it. Activating the gate would have made those outputs unspendable and split the chain on the first spend. |
| **#185** | **The evodb verifier was innocent; two tests were stale.** `evodb_diff_round_trip` planted corruption under `dmn_D3` while `DB_LIST_DIFF` has been `dmn_D5` since the DSL migration — it corrupted nothing, the verifier rightly said clean, and the test then reported it for missing damage that did not exist. `verify_db_legacy` spent a collateral one block after registering it, which `minStaticCollateral` (8064) correctly refuses. Suite is back in the CI gate; it runs in 8 s and was never the "long mining loop" its exclusion claimed. |
| **#186** | **Q60 formation was hard-wired devnet-only.** `IsQuorumTypeEnabledInternal` returned false for `LLMQ_DEFCON` on every non-devnet network *before* reading the activation height, so a mainnet height would have formed no quorum and forked nobody — and at the height the resolver would have flipped to a profile with no quorums, stopping ChainLocks silently. Formation is now keyed on the height alone. Added `CheckLLMQConfiguration`, which refuses to start on a role naming an unregistered profile, on either half of a switchover without the other, or on an InstantSend switchover below the ChainLock one. |
| **#188** | **The proof-of-stake nonce rule is no longer optional.** #120 rightly made the header proof-of-work requirement follow height, but above `lastPowBlock` that removed the check entirely — so a header with a non-zero nonce entered the index, which reads a nonce the same way, stored it as proof-of-work, and `LoadBlockIndexGuts` then failed the whole index load on the next restart. **One unsolicited header would stop a node from starting.** The gate that closes it was unset on mainnet, so the release would have shipped that open. Gate removed; the rule now follows `lastPowBlock` everywhere. |
| **#192** | **A refused ChainLock must leave no trace.** `ProcessNewChainLock` wrote `bestChainLock` *before* checking that the named block sits at the claimed height, so a refused signature stayed as the node's best lock — suppressing every later lock at that height and relaxing the superblock check in `ConnectBlock`, which reads that height. Also, a CLSIG we could not verify because we lack the quorum was punished like a forgery and remembered as seen. Both inherited from Dash and still present in their v23 rewrite; no upstream patch exists. |

Also merged the same day by another session: **#189, #190, #191** (Sentinel
Layer). All classified; none touches mainnet — DSL activation and enforcement
heights remain unreachable there.

### 2.2 Classification of every consensus-path change since v22.1.4

Done by net diff per validity-deciding file, not commit by commit. Result:
**exactly one ungated change had a real consequence** (#120, fixed by #188), and
**one is ungated but confined to paths that were already broken** (#119, settled
by the reindex below). Everything else is gated, unreachable on mainnet, or not
consensus.

Facts worth keeping, because the safety often rests on something non-obvious:

- **#124 retiring the Evo masternode type cannot invalidate history**, because
  Evo was never registrable on mainnet: it required `BASIC_BLS_VERSION`, which
  requires V19, and `V19Height` is unreachable on mainnet and testnet.
- **`simplifiedmns.h` could have broken every block and does not.** The entry is
  hashed into `cbTx.merkleRootMNList`, which consensus checks. Its changed
  fields are written only inside `if (obj.nVersion == BASIC_BLS_VERSION)` —
  again unreachable without V19 — so mainnet serialization is byte-identical.
- **`GetMNPayee`'s multi-slot branch went from never-executed to always-executed
  on mainnet.** The outcome is unchanged only because no registrable type has a
  payment weight above 1. **Compute has 5.** This is not dead code; it is code
  waiting for a gate.
- `llmq_50_60` / `llmq_60_75` bad-votes thresholds changed ungated (3 → 40/48)
  but both profiles are testnet/devnet-only and the sole reader is the DKG
  session. No mainnet-enabled profile changed shape.
- `serialize.h`: no block or transaction field gained a bound. `LIMITED_VECTOR`
  is applied only to spork signatures, bloom filters, one P2P vector and the
  dormant Compute descriptor.

### 2.3 Both mainnet validation tests passed

Run against `b70a7e292e` with a throwaway build in `~/DEFCON-v23test`.

- **Migration** (what every operator will do): v23 started on a genuine v22.1.4
  datadir with no reindex, loaded in 5 s, migrated `dmn_S3`/`dmn_D3` →
  `dmn_S5`/`dmn_D5` with the marker moving `b_b4` → `b_b6`, and reached the same
  tip.
- **Full reindex** (`-reindex -assumevalid=0 -connect=0 -txindex=1`): rebuilt
  130 100 blocks from raw block files in **190 s**, verifying every signature.
  **Zero validation problems.** Same tip hash. The masternode list derived from
  blocks alone came out **220 total / 138 enabled**, the enabled count matching
  the live explorer that day.

Two independent derivations agree. This settles #119, #120's stricter half,
#188's rule across all ~129k proof-of-stake blocks, and the CbTx merkle roots.

---

## 3. Decisions taken

- **Q60 goes to mainnet in v23** (user, 2026-09-04). This makes v23 a mandatory,
  coordinated upgrade.
- **K-03 (the `GetBlockProof` chainwork weighting) stays out of v23**, recorded
  as accepted risk. Skipping leaves v23 *strictly better* than what mainnet runs
  today; doing it would require re-deriving `nMinimumChainWork` in the same
  commit, and getting that wrong freezes every restarted node in permanent IBD.
  Compensating controls: ChainLocks, the checkpoint at 103536, the fork-recovery
  anchor from 113117.
- **The nonce rule was ungated rather than scheduled**, because leaving it
  optional is what was dangerous and no block on any network violates it.
- **Registration and activation height for Q60 must land in one commit.** #186's
  startup check now makes separating them impossible by accident.
- **DSL enforcement is testable but not advisable anywhere.** The commitment
  still carries only a `missed` bitfield, so "no evidence" heals; the unmetered
  `POSECHALLENGE` is still open.

---

## 4. What remains

### 4.1 Blocked on the user — the Q60 mainnet activation height

This is the only real consensus event in v23.

- Pick **H as a multiple of 24**.
- **Non-upgraded nodes fall off at H − 110**, not at H: quorum formation opens
  at H − 120 and commitments of a type they do not know are rejected as
  `bad-qc-commitment-type`. They strand on an invalid tip and need a reindex
  after upgrading. **H − 120 is the upgrade deadline to communicate.**
- Q60 needs **44 valid masternodes of 60** to form, with no fallback. Mainnet had
  138 enabled / 220 total, so there is roughly 3× headroom — but 79 were
  PoSe-banned. Watch mainnet quorum health for a few weeks before fixing H.
- Then one commit: `AddLLMQ(LLMQ_DEFCON)` on mainnet (and testnet),
  `llmqTypeChainLocksV2`, `nChainLocksV2ActivationHeight`,
  `llmqTypeDIP0024InstantSendV2`, `nInstantSendV2ActivationHeight`
  (≥ the ChainLock height), and `WAIT_FOR_ISLOCK_TIMEOUT` 600 → 120.

### 4.2 Release hygiene — can be done now, the tree is free

- **`_CLIENT_VERSION_IS_RELEASE` → false until tagging.** This bit us in
  practice: a datadir could not be attributed to a build because every
  development build reports `v22.1.5`. Only the evodb keys revealed the truth.
- **`chainTxData`** is still Dash's, so a fully synced mainnet node reports
  `verificationprogress: 0.0043`. Recompute with `getchaintxstats`.
- `nMinimumChainWork`, `defaultAssumeValid`, checkpoints — refresh **at tagging**
  from the then-current chain, not before.
- Release notes: `doc/release-notes.md` is still Dash's v22.1.2. Nothing exists
  for v22.1.3/4/5 or v23.
- **Issue #15** — the published Linux tarball for release `6ea2f52` still
  contains zero-filled `defcond`, `defcon-wallet` and `defcon-qt`. No process
  change followed. Add an artifact smoke test (`file` + `ldd` + `-version` on a
  target host) and record the md5 in the release notes.
- Note for release notes: #183 moved the **mainnet Tor listen port 9996 → 8189**.

### 4.3 Must be repeated on the release candidate

Both validation tests bind only the commit they ran against. Re-run them on the
tagged binary. Adding the Q60 activation at a height above the tip should not
change either result, since the gate is never reached.

---

## 5. Exact next steps

```bash
# 1. Rebuild the test binary at the release candidate (throwaway tree,
#    never touches ~/DEFCON)
cd ~/DEFCON-v23test && git fetch --depth 1 origin v22.1.x && git reset --hard FETCH_HEAD
make -C src -j10 defcond defcon-cli

# 2. Fresh copies of the pristine datadir — migration is one-way, so never
#    run against d:/x/Defcon itself
rm -rf ~/mn-test && mkdir -p ~/mn-test/migrate ~/mn-test/reindex/blocks
cp -r /mnt/d/x/Defcon/{blocks,chainstate,evodb,indexes,llmq,sporks.dat,mncache.dat,governance.dat} ~/mn-test/migrate/
cp /mnt/d/x/Defcon/blocks/blk*.dat /mnt/d/x/Defcon/blocks/rev*.dat ~/mn-test/reindex/blocks/

# 3. Migration test — must reach the same tip and move dmn_S3/D3 -> dmn_S5/D5
~/DEFCON-v23test/src/defcond -datadir=$HOME/mn-test/migrate \
    -connect=0 -listen=0 -disablewallet -txindex=1 -daemon=0 -printtoconsole=1

# 4. Reindex test — -assumevalid=0 matters, without it script checks below the
#    fork anchor are skipped, which is exactly the BLS path M-02 changed
~/DEFCON-v23test/src/defcond -datadir=$HOME/mn-test/reindex \
    -reindex -assumevalid=0 -connect=0 -listen=0 -disablewallet -txindex=1 \
    -daemon=0 -printtoconsole=1
```

Watch for `ERROR: ConnectBlock`, `txn-spends-premature-collateral`,
`bad-pos-nonce`, a proof-of-work failure below height 999, or any CbTx merkle
mismatch. Success is reaching the datadir's own tip hash.

Ready-made scripts from this session are in the session scratchpad
(`migrate.sh`, `reindex.sh`, `cigate.sh`); the shape is worth keeping.

---

## 6. Artefacts and where things are

| What | Where | Note |
|---|---|---|
| Pristine **v22.1.4** mainnet datadir | `d:\x\Defcon\` | height 130100, tip `d48a0fc4…1223d1`, evodb `dmn_S3`/`dmn_D3`, marker `b_b4`, clean shutdown. **Never run a test against it directly** — migration is one-way. Contains a small `teszt` wallet; copies exclude it. |
| The **v22.1.4 binary** that produced it | user's machine | More valuable than the datadir: with it a fresh master copy can be regenerated at any height. Keep it. |
| Throwaway v23 build tree | `~/DEFCON-v23test` | Independent shallow clone, `--without-bdb --with-gui=no --disable-tests --disable-bench`. Never touches `~/DEFCON`. |
| Stash and branch backups | `~/stash-backup-20260904/` | Three stash patches plus the commit list of the deleted `release/v22.1.5`. All verified to hold nothing unique; deletable once nobody misses them. |

---

## 7. Open risks

- **The largest risk is not in v23 — it is live on mainnet now.** The ChainLock
  quorum is `llmq_400_60` at **size 400 / minSize 4 / threshold 3**, and the
  quorum is capped by the masternode count, so with 138 enabled masternodes
  **any three of them can produce a ChainLock**. Nothing merged fixes this; the
  Q60 activation does. It also set the severity of #192.
- **Two gates must stay unset**, or code that is currently inert goes live:
  `nComputeNodeActivationHeight` (makes `GetMNPayee`'s multi-slot branch
  meaningful) and `nDSLActivationHeight` / `nDSLEnforcementHeight` (opens the
  type-10 path, whose empty-vin exemption in `tx_check.cpp` is genuinely
  ungated).
- **The audit covered changes since v22.1.4.** Code that predates the tag was
  not re-audited, and **16 unit suites remain excluded from CI**, including
  `transaction_tests`, `validation_chainstate_tests`, `miner_tests` and
  `denialofservice_tests`. An audit finding nothing more does not prove there is
  nothing more.
- CI builds **linux64 only** and runs **no functional tests**, while releases
  ship win64 and macOS.
- `spork@{1}` in the deleted stashes carried 12 files the reverse-apply check
  called unlanded; that check is unreliable after months of drift, and the patch
  is saved. Worth a proper look if anything seems missing.

---

## 8. Working notes for whoever continues

- **Verify the verifier.** Three times in this project a tool gave a clean wrong
  answer. Twice today the thing that looked broken was innocent: the evodb
  verifier (#185) and the ChainLock race branch the user asked about. Hand-check
  one instance and run a negative control before believing any measurement.
- **Every fix here shipped with a negative control** — the change reverted, the
  new test required to fail, and only it. Keep that.
- A restriction rule needs **both halves proven**: that it rejects what it must
  reject, and that it accepts what it must accept. M-02 had only the first, and
  that is exactly how it nearly froze the premine.
- The WSL sibling trees `~/DEFCON-seed`, `~/DEFCON-fleet`, `~/DEFCON-qt` are
  **git worktrees sharing `~/DEFCON/.git`** — checking out in them writes to the
  shared git directory. They now sit at the current tip, which means a rebuild
  there would produce a binary different from what the devnet fleet runs.
  **The devnet has deliberately not been updated.**
- `wsl -d Ubuntu -- bash -c '...'` expands `$VAR` and `$(...)` on the Windows
  side. Write a script file and run it instead.
