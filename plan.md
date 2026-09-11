# Plan — what is owed, and why

Working queue for the devnet. Everything here was either measured or read from
source; where something is *not* proven, this file says so rather than implying
it. Public repository: host labels only, never addresses.

Last updated 2026-09-08.

## 1. Experiment runs, in order

| Run | What it settles | Blocked on |
|---|---|---|
| **E1a** enforcement gate | `-dslenforcementheight` reaches every conf; nothing happens at the height | **CLOSED 2026-09-05 at 8348** (`dsl-enforcement-gate-2026-09-05`): 162/162 daemons answer 8304, 160/160 fleet instances on one chain, nobody suspended or banned, 13/13 rounds at health 1.00, ChainLock 1.00 |
| **E1b** enforcement outage | The DSL punishing branch, first time on any chain: 5 nodes down, `nMissedEpochs` 1→4 → `fRewardSuspended`, 5 → `nDSLBanHeight`; one online epoch clears all three (#189, #190) | **CLOSED 2026-09-06 at 8592** (`dsl-enforcement-outage-2026-09-05`, 8353–8592). Proved on the schedule the rules promise: stop 8376; epochs 350–355 missedCount exactly 5, commits mined at the boundary blocks; `service_suspended` at 8496 (count 4), `service_banned` with `dslBanHeight` 8520 (count 5); restart 8544; epoch 356 (8568) cleared all three fields on all five **without a ProUpServTx** while every one of them also carried a DKG-PoSe ban (8387–8468) — that is #189 on-chain. Nobody else marked. 27/27 rounds formed, worst health 0.93, ChainLock 1.00. Caveat: payee exclusion by DSL alone is not separable, the PoSe bans from 8387 already skip payment. PoSe bans revived by ProUpServTx after the close (the plan's `feeAddress` entries hold no coins; fee paid from a funded wallet address) |
| **E2** mass-outage guard | The edge pair: 23/152 = 15.13 % (guard on, nobody punished, counter neither advances nor resets) against 22/152 = 14.47 % (guard off) | **CLOSED 2026-09-06 at 8856** (`dsl-mass-outage-guard-2026-09-06`, 8613–8856). The guard opened exactly at the declared share: commits 8712/8736/8760 read 21/21/22 missed with counters 1/2/3, 8784 and 8808 read 23 and froze every counter at 3 (no suspension where 4 would have suspended all), 8832 and 8856 read 0 with `service_recovered` on 22 and every counter cleared; nobody outside the 23 touched, 28/28 rounds formed, ChainLock 1.00. Finding: fullnode-4 mn2 was read as present for two epochs after a clean stop (a false negative in detection, mechanism open), so the unguarded 8784 would have suspended 21, not 22. The 23 were DKG-PoSe-banned by the lottery (8699–8795, enabled 129 at close) and revived by ProUpServTx at 8870 from a funded fee address: enabled 152, nothing owed |
| **E4b** chaos netem, real fault | A fault large enough for the quorum to notice, on one masternode | **ran 2026-09-05, see §3a** — it measured the tool, not the network. Three of the four tool findings are closed in the merged package and proven on the pilot host (§4, 2026-09-07); the filter still reaches only the target's inbound connections (§3a, where the measurement owed before a re-run is stated). **Held back while `absent-epoch-rate-post-208-2026-09-07` runs** — its own exclusion clause removes any intervened epoch from the sample — so not before that run closes at 10608 |
| **InstantSend latency + double-spend refusal** | How fast the Q60 quorum locks a payment, and whether a locked coin's second spend is refused | **CLOSED 2026-09-10 at 11106**, three runs, 60 transactions: `instantsend-q60-lock-latency-2026-09-10` (11042–11052), `-lock-relay-` (11056–11062), `-verify-reproduction-` (11104–11106). Lock latency over 54 locked: median ~2 s, p90 ~4 s, max 7 s. The double spend of a locked coin refused with `tx-txlock-conflict` in all three, confirmed in the seed's log. **Finding, predicted lock by lock and handed to the Core audit (a fork-integration defect, not a Dash one):** a non-masternode re-derives an islock's signing quorum from `cycleHash` with **rotation** logic (`instantsend.cpp:862-875, 912-935`: select at `B+23`, retry at `B-1`) while the signer of the non-rotated Q60 type chose by min-hash over the four quorums active at `tip-8` (`quorums.cpp:1330-1384`); a lock signed by a quorum older than one cycle is checked against {B and older} instead of {B and newer} and rejected as `invalid sig in islock` whenever an older quorum outscores B — but only when the ISLOCK outruns its recovered signature (`HasRecoveredSig` shortcut). `ops/islock-selection-reproduce.py` reproduces the signer 55/55, predicts every logged verdict on the reconstruction path (17/17 + 17/17) and every one of the five rejections across the runs **from the transaction's input alone**, out of sample; the raw-prefix serialisation (negative control) reproduces 6/18. Run 1's "relay gap" and run 2's "cycle boundary" readings are both withdrawn in their records. Consequence: the eight fleet stakers are non-masternodes and reject the same way, so such a payment is mined after the 120 s unlocked wait (run 3 tx 10: 250 s). No safety failure in any run. Fix for Core: for a non-rotated type take the quorum at `cycleHash` directly, bounded to the last `poolSize+1` active, and verify against its key. `instantsend` logging left ON at seed and devnet2 (runtime only). **The two cases left unexplained are explained, and by the node's own log (2026-09-10, §3):** both sit in the window in which block 11059's *body* was late — header 13:36:42Z, connected at the seed 13:39:34Z after `Timeout downloading block … from peer=577, disconnecting`. tx 16's lock arrived 12 s after that disconnect, 342 s after broadcast, accepted at both observers; tx 17 has no islock line of any kind at either node and `instantlock_internal` false at 60 confirmations, so no lock ever reached them. Not the verification defect (no `invalid sig` line for either), and not the machine (devnet2, same host, had that block 72 s earlier with no timeout). What is still open is only whether tx 17's lock was never signed or never relayed, which needs `instantsend` logging on a masternode |
| **InstantSend security (partition)** | A conflicting spend offered to a node that never saw the first one. The mempool refuses a double spend anyway, so only this shows InstantSend did the refusing | a partition fault; the wrapper does delay/loss only — still owed |

**CLOSED 2026-09-10 at 10608: `absent-epoch-rate-post-208-2026-09-07`, 60 of 60
epochs committed, zero absent, zero missed bits.** Observation only, boundary
9192 to 10608, asking whether the one block of report-pool margin #207 and #208
bought is enough to stop the network losing one hour in twenty (7 absent in 145
before the roll).

**The verdict is the declared one, and it lands exactly on the line.** Under the
unchanged 4.83% rate, sixty clean epochs in a row occur by luck with probability
**0.0514** — just *over* the one-in-twenty threshold the run set for itself, not
under it. The frozen `expected` reads 0 absent as "the pre-rollout rate is
rejected at about the 5% level", and that is precisely what happened: about,
not past. Twelve further epochs (442–453) have since committed clean, which
would put seventy-two at 0.0284 — supporting evidence, and deliberately not part
of the frozen sample. Anyone quoting this run must quote 0.0514, because the
tempting sentence ("significant at p < 0.05") is false by 0.0014.

**Every declared NOT-EXPECTED control held**, measured over the run's block
window 9282–10608: 159 DKG rounds, all four scheduled profiles, **every one
formed**, median *and* worst health 1.00, not one member punished; 0 bans, 0
revivals, 0 penalty increases; ChainLock coverage 1327/1327; mean block interval
152.85 s against the 150 s target. `llmq_400_85` contributed 2 `impossible`
rounds and no decided one, as its 576-block interval requires.

**What it does not show, restated because the number is tempting:** a quiet
network is the easy case. A missed bit needs five of a target's seven sentinels
to agree, so an hour with nobody down cannot split the signers however late the
reports are. The absent epochs that were ever explained sat in an outage window.
This run says nothing about the layer under one, and E4b is still owed.

**Tooling debt the close exposed: `computeOutcome` measures no DSL epochs at
all.** It computes rounds, events, block samples and ChainLock counts — so the
frozen `outcome` of a run whose entire purpose was an epoch count does not
contain that count. It lives in `notes` as prose, and nowhere else in the
record. The epoch table is still on the chain and re-readable, so nothing is
lost; what is missing is the run record's ability to answer its own question
without a human reading a paragraph. Worth adding before the next DSL run. **Added 2026-09-10** (PR `feat/outcome-dsl-epochs`): the outcome carries `dsl` -- epochs, committed, absent, missedBits and convergenceRate over the window -- the comparison a `dslConvergenceRate` delta, and the caps that this day's two closes hit are raised (`notes` 6000, `intervention.description` 2000). Outcomes frozen before it carry `dsl: null`, this run's own included; the count by status matches what /dsl/summary does, over the window instead of all time.

**A second constraint met at the same moment:** `notes` is capped at 2000
characters and the pre-run declaration context already filled 1947 of them, so
recording the result *overwrote* it. (The cap is 6000 since the PR above.) Preserved here rather than lost:

- **Why 9192 is the floor.** Epoch 381 at boundary 9168 is absent, but it
  contains the rollout's own restarts — an artefact of the intervention, not a
  measurement. Epoch 382 at 9192 is the first clean one.
- **What made the question worth asking.** The same position 17–23 sampler ran
  on 11 hosts before and after #207/#208. Before: report pools held 189–988 of
  1064 at position 18 and agreed only at 21, the moment signing starts, with two
  nodes still short at 20. After: 286–632 at 18 with 11 distinct pool hashes,
  two values at 19, identical by 20 and unchanged through 23. Convergence now
  completes a full block *before* signing rather than at it. `missedreports` was
  0 on every node at every position.
- **Four collector errors, all found and fixed before the run opened, none of
  them in the network.** The watcher was first given 24 hours, reaching only
  ~9833 and 27 epochs; the API was queried with `limit=60`, which would have
  dropped the earliest epochs exactly as the sample reached 60; a `pgrep` check
  matched the checking command's own text and reported a watcher alive that had
  already stopped; and under systemd `HOME` is unset, so the log went to the
  filesystem root for one restart. Verification is now by effect — unit state
  and the log advancing — never by process count. ([[verify-the-verifier]])

**Explorer tartozás (2026-09-06), fele lezárva 2026-09-07-én (#123):** a lab
explorer beragadt egy node-reindex utáni láncmozgás után – „block N follows X
but Y was indexed before it; the chain moved mid-batch” minden ticken, csak az
adatbázis eldobása segített. Ugyanez a devneten is előállt 2026-09-07-én
9188-nál, 14 blokkal a tip mögött, és az ok nem a mélység volt: a `syncOnce` a
rollback *előtt* olvasott kurzor-hasht vitte a következő batchbe, így a
visszagördítés utáni első blokk sosem illeszkedett, és minden tick ugyanazt a
rewindet ismételte. A #123 a rewind pontján újraolvassa a folytatási hasht a
node-tól, és a kurzort a törlés *előtt* írja ki; a regressziós teszt a
production üzenetet szó szerint reprodukálja, negatív kontrollal. **A másik
fele is lezárva 2026-09-07-én:** a `MAX_ROLLBACK_DEPTH` (200) fölötti
eltérésnél a szolgáltatás továbbra is megáll, de a rögzített hiba megmondja,
hová nézzen az operátor. `GET /api/v1/admin/sync/rewind` kettéosztással
(nem blokkonkénti sétával) megnevezi az elágazáspontot – a legmagasabb
magasságot, ahol az index és a node még egyezik –, és kimondja, kié a döntés;
`POST` ugyanoda pontosan ezt a magasságot és hasht kéri, újraszámolja, és
minden mást 409-cel elutasít: más elágazáspontot, futó tick alatti kérést,
200-on belüli vagy nem létező eltérést. Egy másik lánc (a genezis is eltér)
`no-common-history`-ként jelenik meg, rewind nélkül. A megerősített rewind a
`SyncState.operatorRewind` mezőbe kerül (ki, mikor, hová, hány blokk).
Végponttól végpontig bizonyítva valódi Mongón és a valódi admin-őr mögött,
231 blokkos hamis láncon 210 mély reorggal; runbook a CLAUDE.md-ben.

**Core döntés v23 előtt (2026-09-07):** az üres Sentinel-órák. 145-ből 7 óra
jegyzőkönyv nélkül maradt a devneten; mérve: a jelentéskészlet 5–10 perc alatt
egyezik össze, az aláírás rögzített három blokkal a kiküldés után indul, és a
konszenzus a jegyzőkönyvnek egyetlen blokkot ad. A mechanizmus és a három
lehetséges irány a handoff „Devnet-elemzés” szakaszában; a választás nyitva.
A fenti futó megfigyelés ehhez a döntéshez szállít számot, nem dönt helyette.

`E1a` is consensus: `IsBanned()` reads `nDSLBanHeight` (`dmnstate.h:454`) and
`fRewardSuspended` changes payee selection, so a node started without the
argument forks. Same mechanism as `dslactivationheight`. Height = tip + 100
rounded up to a multiple of 24 (epoch boundaries are exactly the multiples).

## 1b. Owed on the next fleet roll

- **M-02 came off the devnet, and had already done so before this entry was
  last read** (defcon-project/defcon#194). `CDevNetParams` no longer sets
  `nStrictBLSSigSizeActivationHeight`; the only assignment left in
  `chainparams.cpp` is `= 0` inside `CRegTestParams`, so the rule is unset on
  devnet, testnet and mainnet alike. This entry claimed until 2026-09-07 that
  "every running daemon still enforces M-02 from height 5250", and that was
  **wrong from 2026-09-05 onward**: #194 (`292337f175`) is an ancestor of
  `3ce1d8b8d6`, the commit the binary installed that day was built from --
  verified with `git merge-base --is-ancestor` and a negative control. The item
  was discharged by a rollout nobody credited with it.

  **The lesson is the entry, not the rule.** An "owed on the next roll" note
  does not clear itself when the roll happens; someone has to check the range
  the roll actually shipped against this list. Do that as part of closing a
  rollout, or this section quietly accumulates work that is already done --
  which is the same failure, in the other direction, as an owed verification
  that lives only in a conversation.

- **#209 rides the next roll that has its own reason. It is not a reason to
  roll.** `37e845beb0` landed upstream shortly after the 2026-09-07 rollout and
  is the only commit the fleet does not have. It is two lines in
  `src/pos/stake.h`: `static const int` becomes `static constexpr int` for
  `SHORTDELAY` and `LARGEDELAY`. **The values are unchanged** (2500 and 10000)
  and nothing else in the tree is touched.

  What it actually fixes is a **build configuration**, not the network. The two
  constants are used in twelve places, all
  `std::chrono::milliseconds{CStakeWallet::SHORTDELAY}`; libstdc++'s duration
  constructor takes `const Rep2&`, so each of those *odr-uses* the member, and a
  `static const int` with no out-of-line definition (there is none) then needs
  one. An optimised build folds the constant and never emits the reference, which
  is why the binary running on 162 daemons is correct; a debug or sanitizer build
  fails to link. `constexpr` static members are implicitly inline since C++17, so
  the definition exists and the link succeeds. Hence the branch name,
  `fix/f107-debug-sanitizer`.

  Three reasons not to re-roll for it, in order of weight. It changes no value
  and no runtime behaviour, so the deployed binaries already behave identically.
  It is staking code, and 152 of the 160 fleet instances never execute it --
  `init.cpp` soft-sets `disablewallet=1` wherever `masternodeblsprivkey` is
  present, so a masternode has no wallet and no `CStakeWallet`; only the 8
  stakers and the seed would even reach it. And `ops/fleet-deploy.sh` restarts
  every instance on a host, so the price is 160 restarts, every DKG connection
  dropped at once, and a disturbed hour that reads like a ban wave --
  [[devnet-binary-build-path]] records this exact trade for a staking change.

  If a sanitizer build is wanted before the next roll, it needs the source tree,
  not the fleet.

  **Proven 2026-09-07, in the source tree, both halves.** An ASan+UBSan
  `-O0 -g3` build at the #209 tip (`37e845beb0`,
  `~/DEFCON-verify-f107-37e845beb047`) links: `defcond` and `test_defcon` both
  exist, every source older than the binaries. Negative control in the sibling
  sanitizer tree (`~/DEFCON-indrev-san-3d03b3f492`, same fix as a local
  commit): the pre-fix `stake.h` put back, nine translation units rebuilt, and
  the link of `test_defcon` fails with **16 undefined references** to
  `CStakeWallet::SHORTDELAY` and `LARGEDELAY` (`pos/minter.cpp:215`, `:260`,
  ...; `make` exit 2). File restored, nine objects rebuilt, link succeeds, tree
  clean. So the fix does exactly what its description says, and only a
  non-optimised build ever sees the difference -- the fleet's `-O2` binaries
  were never affected. The unit suite under the sanitizer build is recorded
  below in §6, and what it found is §2b.

- **#209 is no longer the only commit the fleet does not have — as of
  2026-09-08 there are thirteen, and three of them are a reason to roll.** The
  paragraph above was written when `37e845beb0` stood alone; #210–#221 have
  merged since. Triaged by file list, not by commit title:

  | PR | Ships to a running daemon? | Verdict |
  |---|---|---|
  | #211, #213, #214 | no — `test/functional/` only | irrelevant to a roll |
  | #215 | no — `src/test/` + `Makefile.test.include` | irrelevant to a roll |
  | #219 | no — `.github/workflows/build.yml` | irrelevant to a roll |
  | #212 | `src/chainparams.cpp` +34, but **verified regtest-only** | irrelevant to a roll |
  | #210 | `src/qt/` only | no daemon behaviour |
  | #209 | `src/pos/stake.h`, +2/−2, values unchanged | rides, never leads |
  | #216 | `src/streams.h` +14, UB guard on an empty Span | rides |
  | #221 | `src/rpc/misc.cpp` +18/−1 | rides |
  | **#220** | **`src/net_processing.cpp` −1** | **a reason to roll** |
  | **#218** | **`src/validation.cpp` +5/−1** | **a reason to roll** |
  | **#217** | **`src/validation.cpp` +10/−1** | **a reason to roll** |

  #212's "test-only" claim was checked rather than taken: every addition sits
  inside `CRegTestParams` — the constructor call, the method, and the
  `FromArgs` reader — and the new `-minstaticcollateral` is `DEBUG_ONLY`. No
  other network's constructor calls it, so mainnet, testnet and devnet are
  byte-identical without the argument.

  **#217 (F-2026-119) is a use-after-free, and it is one of the four v23
  release-gate findings.** `ConnectBlock` inserted `pindex` into
  `m_blockman.m_dirty_blockindex` on every proof-of-stake block, including
  when `fJustCheck` is set — and under `fJustCheck` the caller owns `pindex`:
  `TestBlockValidity` passes the address of a `CBlockIndex` living in its own
  stack frame, and that frame is gone by the time `FlushStateToDisk`
  serialises the set. The fix is one `if (!fJustCheck)`; the writes below it
  still happen either way, because `CheckProofOfStake` and the modifier need
  them. Reachable through `getblocktemplate` in proposal mode, the
  `generateblock` RPC, **and validation of a valid, not-yet-indexed PoS
  block** — the last of which is ordinary operation, not an RPC an operator
  has to invoke. The regression suite segfaults 5 of 5 times on the unfixed
  `-O2` build and passes 3 of 3 with the fix.

  **#218 (F-2026-125) costs a whole block.** `MaybeUpdateMempoolForReorg`
  re-checked maturity for `coin.IsCoinBase()` only, so a coinstake spend that
  a rollback had made immature again stayed in the mempool: the producer could
  include it, sign the block, and then have its own node reject it. The check
  now reads `(coin.IsCoinBase() || coin.IsCoinStake())`. Triggered by
  `invalidateblock` or an automatic ChainLock-conflict rollback.

  **#220 (F-2026-130) is the third reason to roll, and it is one deleted
  line.** Reading a plain `headers` message, `ProcessMessage` consumed **two**
  CompactSize values per header — the tx count, and a second one commented
  "needed for vchBlockSig" — where every writer emits one. The stream is
  therefore misaligned after the first header and the rest of the message is
  unreadable. It was measured against the node's own output: the node answers
  `getheaders` with 81 bytes per header, and feeding that exact byte sequence
  back could not be processed; across five test nodes' logs, **12 classic
  `headers` messages arrived and all 12 were dropped**. The mutation control is
  the part worth copying — restoring the line fails the new test immediately
  with `Block not found`, and deleting it again produces a **bit-for-bit
  identical binary**, so nothing else moved between the two measurements.

  This devnet did not notice because its nodes speak `HEADERS2` to each other.
  Any peer that sends a classic `headers` message — an older node, another
  implementation, a light client — silently fails header sync against us. Not
  consensus, and **not a compatibility break in either direction**: the fix
  corrects the *reader* while writers are untouched, so a mixed fleet is safe.

  **#221 (F-2026-129) rides.** `getaddressbalance` counted a freshly staked
  coinstake as spendable while the node still refused to spend it
  (`bad-txns-premature-spend-of-coinbase`); it now lands in `balance_immature`
  until `COINBASE_MATURITY`. The fix reads position 1 above `lastPowBlock` as
  the coinstake and leaves *spends* in the spendable column, which is right on
  both counts. No consensus, no reindex — and **the explorer does not call it**
  (checked across `server/`, `client/`, `shared/` and `ops/`), so nothing this
  repository publishes changes.

  **None of them changes block validity, so none needs an activation height.**
  Source-side fingerprint over the reject-reason literals — the pattern
  `"(bad-|pos-|pow-|dsl|posechallenge|poseresponse|posereport)…"` across
  `src/*.cpp` and `src/*.h` — gives **181 strings, md5
  `9740ca2cf39a9e5fed084797eef35512`, identical on `c739d9f504` and
  `v22.1.x`**, and a `diff` of the two sets prints nothing. Negative control
  passed: the narrower `bad-` pattern gives 165 strings and md5
  `086ce7176939f3b8f786852430e6dc91`, so the probe is reading something rather
  than silently matching nothing. This is a **proxy for, not a replacement
  of,** the binary-side check — `strings` on the built artefacts, same tool
  and same host, still has to run before anything is installed
  ([[devnet-binary-build-path]]).

- **The roll is blocked until height 10608, and not by a technical
  dependency.** `absent-epoch-rate-post-208-2026-09-07` runs from boundary
  9192 to 10608, and its frozen `expected` excludes any epoch containing a
  deliberate intervention. A roll restarts 162 daemons: the 2026-09-07 roll at
  9147 produced eight `penalty_up` events, one PoSe ban (9165, revived 9234)
  and one absent Sentinel epoch (381) — exactly the contamination that clause
  names. **Build and fingerprint the artefacts now**, in the worktrees, so that
  nothing but `systemctl` is left when the run closes on the evening of
  2026-09-09. Take `ops/defcon-enable-staking` (§6) with it; that installation
  is owed on a host touch and there is no reason to spend a second one.

- **The artefacts are built and fingerprinted; only `systemctl` is left
  (2026-09-08).** Both deployable binaries were built at the branch tip
  `1887b036c9` in their own worktrees and staged in `~/roll-2026-09-08` on the
  workstation's WSL (never committed). **Rebuilt at `55174597ed` when #220 and
  #221 landed** — the 1887b036c9 artefacts are gone, so nothing stale can be
  shipped by reaching for the wrong file.

  | artefact | bytes | md5 |
  |---|---|---|
  | `DEFCON-seed/src/defcond` | 396,489,512 | `b0e4033e3c39fb0a5f5cd19099f6841b` |
  | `DEFCON-fleet/src/defcond` | 393,065,144 | `6696eff7b96bc040affd1e212a573eea` |

  The rebuild recompiled **3 of 679** objects, and the three were hand-checked
  rather than accepted: `libbitcoin_server_a-misc.o` (#221),
  `libbitcoin_server_a-net_processing.o` (#220) and
  `libbitcoin_util_a-clientversion.o`, which any commit change rebuilds. Two
  changed `.cpp` files plus the build-info object is exactly right, and it is
  **not** the mixed-ABI signature: that alarm is few objects after a *header*
  change, and neither commit touches a header.

  **The first build was proven to have happened, not assumed.** Seed: 157 `CXX` lines,
  5 `CXXLD`, **157 of 679** objects newer than a timestamp taken before `make`
  started, and the binary newer than every object. Fleet: 155 `CXX`, 5 `CXXLD`,
  **155 of 677**. The two-object difference is the BDB-only translation units.
  157 is the right order of magnitude for a `streams.h` change in a
  `--disable-tests --with-gui=no` tree, and a *small* number here would have
  been the mixed-ABI alarm, not a gift.

  **Both baselines were preserved before `make` overwrote them, and both match
  what is deployed**: seed `a1ad976f18016c5a67672adacdb8f4f5`, fleet
  `406828f76173a5a23f3dd6db740afc76` — the values `docs/devnet-rollouts.md`
  records for the 2026-09-07 roll. That is what makes the comparison below a
  real before/after and not two unrelated builds.

  **Consensus fingerprint, binary side, same tool and same host, all four
  artefacts at once:** `strings … | grep -aE
  '^(bad-|pos-|pow-|dsl|posechallenge|poseresponse|posereport)' | sort -u |
  md5sum` gives **178 strings, `559683c468564314759dfe943705e359`** on the old
  seed, the new seed, the old fleet and the new fleet alike, and `diff` of the
  old and new sets prints nothing for either artefact. That is the same
  four-way match, to the same value, as the 2026-09-07 roll. Negative control
  passed: the narrower `^bad-` pattern gives 165 strings and
  `e2cb189210bb49c76e035a7ea3f2c2f0`, so the probe is reading the binary rather
  than silently matching nothing. Together with the source-side check above,
  **the eleven commits move no consensus rule.**

  **What is deliberately NOT done yet**, and must run at roll time rather than
  now: `ldd` on a **real fleet host** (the build host answers 0 missing
  libraries, which is exactly the check that passed before a binary linked
  against the build host's `libminiupnpc` was installed and would not start);
  the `defcon-cli` comparison against the deployed copies; and the install
  itself. `ops/fleet-deploy.sh` does the first; the roll waits on 10608.

- **The roll must be given the inventory explicitly, and that is now verified
  (2026-09-08).** `ops/fleet-deploy.sh` defaults to `/root/fleet-nodes.txt`,
  which is **11 hosts**; the five that log in as their own unprivileged users
  carry 45 of the 152 masternodes and are only in `/root/fleet-nodes-all.txt`.
  Re-checked on the jump host today: that file holds **16 entries** — eleven
  bare addresses (root) and five `user@address` — and `/root/mn-hosts.txt`
  agrees at 16. So the roll runs as
  `FLEET_INVENTORY=/root/fleet-nodes-all.txt ops/fleet-deploy.sh …`, and a run
  without it would leave 45 masternodes on the old binary while reporting
  success over the eleven it did reach ([[devnet-fleet-access]]).

- **Rebuilt at `25c3966adc` on 2026-09-10, because #222 and #223 landed after
  the staged artefacts.** The 2026-09-08 build at `55174597ed` is superseded and
  its binaries are gone, overwritten in place, so nothing stale can ship by
  reaching for the wrong file. Both worktrees were clean at build time: HEAD
  `25c3966adcc3aeb5e92937afe31a7c17261010a5`, `git diff` sha256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — the hash
  of the empty string, which is what "clean" looks like when it is stated as a
  number ([[claims-carry-diff-and-binary-hash]]).

  | artefact | bytes | md5 |
  |---|---|---|
  | `DEFCON-seed/src/defcond` | 397,418,576 | `69afd7fb340b5845b8a3c3015207712e` |
  | `DEFCON-fleet/src/defcond` | 393,998,352 | `c07037160d46fc152dfb4417f4e78a90` |

  Both: `make` exit 0, **86 `CXX`, 4 `CXXLD`**, 4 m 16 s for the pair at `-j16`.

  **The incremental build was proven exact, not plausible.** #222 changes
  `validation.h`, and CLAUDE.md's mixed-ABI alarm is "surprisingly few `CXX`
  lines after a header change" — but "86 feels about right" is not a
  measurement. The `.deps/*.Po` files record each object's real dependency set,
  so the question has an exact answer: **81 objects depend on `src/validation.h`,
  and all 81 were rebuilt, 0 stale**, on both trees. 82 objects in total are
  newer than the build-start marker — the 81 plus `clientversion.o`, which any
  commit change rebuilds — and each binary is newer than every object.

  Two traps met on the way, both of which would have produced a clean wrong
  answer. The first probe grepped the `.Po` files for `src/validation.h` and
  matched **nothing**, reporting "0 objects, 0 stale" as though that were a pass:
  dependency paths there are relative to the *object's* directory, so the file
  appears as `validation.h` or `../validation.h` — and must not be confused with
  the different file `src/consensus/validation.h`. The **negative control is what
  caught it**: the same check run against `streams.h`, a header this build did
  not touch, must report stale objects, and it does — 153 dependents on the fleet
  tree of which **72 are stale**, 155 and 74 on the seed. A dependency probe that
  cannot report staleness is not evidence of its absence
  ([[verify-the-verifier]]).

- **#223's two tests were run against the new fleet binary, and against the
  commit before #222 as a control (2026-09-10).** On
  `c07037160d46fc152dfb4417f4e78a90` both pass: `feature_evodb_reconcile.py` in
  20 s, `feature_evodb_reconcile_below_dip3.py` in 12 s, runner exit 0.

  **The control is what makes that mean something.** Re-run with
  `BITCOIND=` pointing at a clean build of `55174597ed` — the commit immediately
  before #222, `ba6c6b70b22af8c36d134f3be08c4c98`, whose `nm -C` contains
  `ReconcileEvoDBToTip` **zero** times against **two** in the new binary — both
  tests **fail**, and they fail with precisely the symptom #222 exists to
  remove: `dashd exited with status 1 during initialization. : Error upgrading
  Evo database.` Runner exit 1. So the tests measure the fix rather than merely
  passing, and the fix removes the documented failure rather than merely
  compiling.

  One process trap on the way, and it is the everyday one: the first attempt ran
  `test/functional/test_runner.py` directly, which is not executable in this
  tree. The shell reported `Permission denied`, the wrapper's last command
  succeeded, and the job **exited 0 with no test having run**. Invoke it as
  `python3 test/functional/test_runner.py`, and read the runner's own
  pass/fail table rather than the wrapper's exit code.

- **Consensus fingerprint: unchanged, and this time that proves less than
  usual.** `strings … | grep -E '^(bad-|pos-|pow-|dsl|posechallenge|poseresponse|
  posereport)' | sort -u | md5sum` gives **178 strings,
  `559683c468564314759dfe943705e359`** on the new seed, the new fleet, and — read
  on the jump host with its own `strings` — the binary that is actually deployed
  (`/root/fleet-bin-prev/defcond`, `406828f76173a5a23f3dd6db740afc76`). Negative
  control `^bad-`: 165 strings, `e2cb189210bb49c76e035a7ea3f2c2f0`, on all of
  them.

  **Say what it means, and stop there.** #222's `validation.cpp` half only adds a
  new trigger to `fDoFullFlush` (`fManyBlocksSinceFlush`), which changes *when
  data reaches disk*, not what is valid; its `node/chainstate.cpp` half is 249
  lines of new **startup** code. The fingerprint reads consensus error strings, so
  an unchanged value here is evidence that no validity rule moved and is **not**
  evidence that runtime behaviour is unchanged — the startup path deliberately
  changed. Quoting this fingerprint as "the roll changes nothing" would be false
  for exactly the commit the roll exists to ship.

- **No new library dependency**, checked host-independently with
  `objdump -p | grep NEEDED` rather than `ldd` (which answers about the host it
  runs on): the new fleet binary, the new seed binary, the deployed fleet binary
  on the jump host and the deployed seed binary on the VPS all list the **same
  ten** entries. This is a pre-check, not a replacement for `ldd` on a real fleet
  host at roll time — that check exists because a build host reports 0 missing
  libraries for a binary the targets cannot run.

- **Baselines preserved before staging, without destroying the older one.**
  `/root/fleet-bin-prev` on the jump host now holds the binary being replaced
  (`406828f76173a5a23f3dd6db740afc76`), and the 2026-09-05 copy it previously
  held (`c0db9a2fe14f2e5b8ec90878306e613c`) was moved to
  `/root/fleet-bin-archive-20260905` rather than overwritten.

- **`jq` is present on all 16 fleet hosts and on the VPS**, checked before
  installing `ops/defcon-enable-staking` — the fixed hook parses
  `getstakinginfo` with `jq` and fails closed without it, and a fail-closed
  `ExecStartPost` **without** the leading dash would stop the daemon. Its suite
  passes 15/15 on the VPS, negative control included (the original script toggles
  a wallet that is already staking). The repo copy and the VPS copy are
  byte-identical, `e53ea9660ac7d2a7cc1f5a3b5f411e65`; what runs on the seed today
  is the 2026-08-21 `45d2df089c879c7dd3a64a818563f8c8`, so the install is a real
  change and not a no-op.

- **(Superseded 2026-09-10 by the rebuild recorded above.) The branch tip did not move, and the artefacts still match it
  (2026-09-08, evening).** `git fetch upstream v22.1.x` is a no-op: the tip is
  still `55174597ed` (#221), and both build worktrees sit on it, so **no
  rebuild is owed**. The staged binaries are byte-for-byte the ones this
  section records — seed `b0e4033e3c39fb0a5f5cd19099f6841b`, fleet
  `6696eff7b96bc040affd1e212a573eea`, both timestamped after the tip commit.

  The consensus fingerprint was re-measured **on the jump host, against the
  binary that is actually deployed** (`/root/fleet-bin-new/defcond`,
  `406828f76173a5a23f3dd6db740afc76`) rather than quoted from this file: 178
  strings, `559683c468564314759dfe943705e359`, with the `^bad-` negative
  control at 165 / `e2cb189210bb49c76e035a7ea3f2c2f0`. Identical to what the
  new artefacts give on the build host. Two hosts, two tools' worth of
  independence, same answer.

  One trap worth recording, because it cost a wrong answer first: the
  `grep -a` form used on hosts without `strings` **cannot carry the `^`
  anchor**. Anchored to the binary's accidental newlines rather than to string
  starts, it matched nothing and returned the md5 of the empty set —
  `d41d8cd98f00b204e9800998ecf8427e` — for every artefact, which reads as a
  clean four-way match. The jump host has `strings`; use it there, and on a
  host that lacks it the pattern must lose the anchor and be re-validated
  against a host that has one ([[verify-the-verifier]]).

- **The 13 commits classified for the Experiments entry (2026-09-08).** Only
  **six** change the deployed binaries' behaviour: #209 (`pos/stake.h`, inline
  constexpr staking delays), #216 (`streams.h`, no null `Span` to
  `fread`/`fwrite`), #217 and #218 (`validation.cpp` — dirty index only on
  connect; coinstake maturity re-checked after a rollback), #220
  (`net_processing.cpp`, plain `headers` message) and #221 (`rpc/misc.cpp`,
  `getaddressbalance` coinstake maturity). #210 is Qt, which neither deployed
  build compiles. #211, #213, #214, #215 are tests only. #219 is CI only.
  #212 touches `chainparams.cpp` but **inside `CRegTestParams` alone**, behind
  a `-minstaticcollateral` argument that is unset everywhere — regtest is
  byte-identical without it. **No commit in the range adds or moves an
  activation height**, which is why the fingerprint is unchanged and why the
  Experiments record has no gate to name.

- **Observation status at the time of writing: 35 of 60 epochs, all clean.**
  Epochs 382–416 are every one `committed`, `missedCount` 0, no absent record.
  Tip 10021, so 10608 is ~587 blocks — the evening of 2026-09-09 at the
  measured mean interval.

- **Rolled 2026-09-10 at `25c3966adc`: 162 of 162 daemons, one chain; the run
  closed at 10983 (12:23 CEST) with its outcome frozen.** Order as declared in `fleet-rollout-222-2026-09-10` (opened
  at 10915, before any restart): devnet2 09:47 CEST, seed 09:48, then the 16
  fleet hosts 09:5x–10:25 through `FLEET_INVENTORY=/root/fleet-nodes-all.txt
  ops/fleet-deploy.sh` — 160 instances, "hosts with a problem: 0".
  `fleet-chain-check2.sh` afterwards: **hosts=16 instances=160 same-chain=160
  forked=0 unreachable=0**, every instance at 10929 with md5 `c0703716`; seed
  and devnet2 at 10930 with one hash; `NRestarts=0` on both VPS units.

  **#222's startup path ran on every daemon and did nothing, correctly.** On the
  seed and devnet2 the shutdown flushed the evodb ("write evodb cache to disk
  completed"), and startup logged all four `MigrateDBIfNeeded` steps as
  "migration already done. skipping." — no reconciliation, no "Error upgrading
  Evo database". One deviation from the frozen `expected`, worth a line:
  `ReconcileEvoDBToTip` **logs nothing when it has nothing to do**. The
  expectation said it would "say so"; it is silent. Not a fault, but a healthy
  start and a start on which the reconciler was never compiled in look the same
  in the journal, and the only proof it is there is `nm` (2 symbols).

  **Noise, final (run closed at 10983, 12:23 CEST, 2 h 15 min after the last
  restart):** 3 `penalty_up`, 3 masternodes punished, **0 bans**, 0 revivals;
  8 decided rounds in the window, **7 formed, 1 failed** (`llmq_defcon` at
  10920 -- forensics below), formation rate 0.875, median health 1.00, worst
  0.94 (the 47/50); ChainLock 69/69; mean block interval 148.9 s. Sentinel
  epochs in the window: **454 committed, 455 absent, 456 committed**, 0 missed
  bits -- and the `dsl` field is in the frozen outcome, because #143 was
  merged and deployed twenty minutes before the close. The three penalties
  stood at 49 at close and reach 0 around 11032. Against 2026-09-07 (8
  `penalty_up`, 1 ban, 1 absent epoch, 0 failed rounds): fewer penalties, no
  ban, the same one absent epoch, and one failed Q60 round more -- the last
  two are one event seen by two layers, and both are the restarts.

  **Why the Q60 round at 10920 failed, and the rule that follows (forensics,
  2026-09-10).** The explorer's member selection reproduces the node's own
  member list **order-exact** for two formed quorums at the same two heights
  (`llmq_50_60` at 10920 and `llmq_defcon` at 10896), so the failed round's
  sixty expected members are trusted. Mapping them by service address to the
  16 inventory hosts and to each host's `ActiveEnterTimestamp`, then to the
  DKG stage that time fell in (stage arithmetic from
  `dkgsessionhandler.cpp:160-161`, block times converted to CEST; base 10920
  at 09:57:30, Contribute 09:58:42-10:04:34, Commit 10:08:48-10:12:08):

  | the member's host restarted ... | Q60 (60) | 50_60 (50) |
  |---|---|---|
  | before the base block (09:51-09:57:17) | 22 | 17 |
  | during Initialized | 3 | 2 |
  | during Contribute | 20 | 15 |
  | during Complain | 4 | 2 |
  | during Justify | 11 | 14 |

  The mechanism is in `dkgsessionhandler.cpp:756-786`: the session handler
  waits for the **Initialized** stage and only then calls `InitNewQuorum`, so a
  daemon that starts after that stage waits for the *next* cycle and never
  joins the one in progress. Thirty-eight of the sixty Q60 members were on
  hosts restarted at or after Initialized; at most 22-25 were in the session
  at Commit, under `minSize` 44, so no final commitment was possible. The
  `llmq_50_60` round at the same base formed at 47/50 because its `minSize` is
  **3** and a member restarted during Contribute had already *sent* its
  contribution before going down -- valid in the commitment, absent from the
  finish. The three it excluded, and the three carrying a penalty, are all on
  host #6, restarted at 09:57:17: **thirteen seconds before the base block**,
  so the daemon missed the 10920 tip, never became a session member and never
  contributed. A roll punishes the node that is down *around the base block*,
  not the one that restarts mid-session.

  **The rule for the next roll:** a 16-host, ~17-minute rolling restart fails
  any Q60 cycle whose base block falls inside it, because fewer than 44 members
  are then on hosts restarted *before* the base. Start the roll right after a
  cycle's Commit stage (base + 8..10 blocks) so it finishes before the next
  base, ~35-40 minutes later; no round fails and nobody is penalised. The
  2026-09-07 roll had 0 failed rounds and 8 penalties + 1 ban for the same
  reason in the other direction: it landed in a different stage. The 10944
  cycle, the first with every host up, formed at 60/60 with nobody punished,
  which is what settles the cause as the restarts. Inputs and the script are in
  the session scratchpad (`forensics/forensics.mjs`); the reproduction needs
  only `protx diff 1 <base>`, `getblockhash <base>` and `quorum info` for the
  controls.

  **Sentinel epoch 455 (boundary 10944) is absent, and that is the roll's most
  useful by-product.** Block 10944 carries a CbTx and the coinstake and no
  type-10 commitment; the explorer judged the epoch absent at 11:01:58. The
  epoch spans 10920-10944, and blocks 10917-10928 are the ones during which
  all 160 fleet daemons restarted -- so from the Sentinel's point of view this
  epoch *contained an outage*, the case the absent-epoch run declared it could
  not speak to ("a quiet network is the easy case ... the absent epochs that
  were explained sat in an outage window, where 35 missed reports per hour had
  to reach 60 signers inside three blocks"). The one block of margin that
  #207/#208 bought held for sixty quiet epochs and did not hold for the first
  epoch with a fleet-wide restart in it. The signing-window remedy the plan
  names (a wall-clock margin, more than one block for the record, or a retry
  when a signature does not finish) now has an outage-shaped data point,
  produced by an intervention that was not aimed at it.

  Two things this does NOT establish, stated so nobody quotes it further than
  it goes. First, the mechanism is inferred, not observed: **the DSL layer
  writes no log line at all** -- zero `LogPrint` calls in the five
  `src/evo/pose_service*.cpp` files, and the node's forty logging categories
  have none for it -- so no daemon on the network recorded why 455 has no
  record, and the same is true of every earlier absent epoch. That is an
  observability gap worth an audit item beside the staking-status one: at
  minimum, a category and a line at the commit decision (pool size, whether
  the threshold was reached, and why not). Second, the missing Q60 quorum from
  the 10920 cycle is not the cause: the commitment's signing quorum is chosen
  by `SelectQuorumForSigningAt` among the quorums *active at the epoch base
  minus `SIGN_HEIGHT_OFFSET`* (`pose_service.cpp:123-128`), all four of which
  existed, so a quorum was available to sign; what did not happen is a
  threshold signature over an agreed pool.

  Epoch 454 (boundary 10920, spanning 10896-10920) committed with 0 missed
  bits because the restarts began at block 10917, three blocks before its
  boundary and after its reports had gone out.

  **`ops/deploy.sh` reported this very deploy as failed while it had
  succeeded.** Its readiness check asked the API once, immediately after
  `systemctl restart`, got "Couldn't connect", and under `set -e` exited 1
  before the served-bundle check -- on a deploy whose publish and restart
  were complete and whose API answered `ok` thirty seconds later. Fixed in the
  same PR as this record: the check now polls for up to 60 s and prints how
  long the API took. A deploy script whose last word can be wrong in the
  reassuring direction is bad; one wrong in the alarming direction trains the
  operator to ignore it, which is worse.

  **Hook wiring applied without a restart**, as approved: on the 8 stakers
  `/opt/defcon-devnet/bin/defcon-enable-staking` is now
  `e53ea9660ac7d2a7cc1f5a3b5f411e65` (old copy kept as `.bak-…`), and
  `defcon-devnet-mn@11.service.d/staking.conf` carries
  `Environment=DEFCON_ENABLE_STAKING_TRIES=12` plus `ExecStartPost=-…`,
  `daemon-reload` done; the 8 masternode-only hosts have no staking drop-in and
  were skipped by the guard. First attempt applied to **nobody**: the loop used
  `ssh -n … bash -s < script`, and `-n` points stdin at `/dev/null`, so `bash
  -s` ran an empty script and printed nothing — the earlier lesson ("use `-n`
  in loops") is right only when stdin is not the payload. Nothing changed on
  that pass; the guard confirmed the original shape on the second.

- **Every failed DKG round since the first masternode existed sits inside a
  declared intervention (2026-09-10, read the moment the rounds-to-runs join
  went live, #146).** 31 failed rounds are on record. Eleven are `llmq_400_60`
  at heights 648-1368 on 2026-08-24, before the first masternode registered
  (1419) and before the first run was declared (`baseline-80mn-stock`, 1458):
  with zero masternodes against `minSize` 4 they could never have formed, and
  they are recorded as `failed` only because the `impossible` status did not
  exist yet when they were written. **The other twenty — six `llmq_defcon`,
  five `llmq_50_60`, two `llmq_60_75`, seven `llmq_400_60` — are all covered:**
  the Q60 activation (4), the v22.1.5 final rollout (4), the DSL shadow
  activation (3), the kernel-v2 and consensus-audit rollouts (3 + 2), and one
  each for six more rolls including today's. Not one failed round outside a
  rollout window, in any profile, in the network's whole life with
  masternodes. That is the strongest single statement this explorer has
  produced about the devnet, and it was invisible until the two records were
  joined — the overview was reading each of those twenty as "inspect quorum
  connectivity".

  **DONE 2026-09-10.** `ops/backfill-impossible-rounds.cjs` run on the VPS:
  eleven rows flipped `failed` → `impossible` (all `llmq_400_60`, heights
  648–1368, `available=0 < minSize=4`), 11 of 11 modified, dry-run afterwards
  reports 0 remaining and 20 failed rounds on record. The first still-failed
  round left standing is `llmq_50_60` @2616, `consecutiveFailures` 0. The
  all-time failure count no longer carries rounds that had no members to fail.

- **v23 mainnet preparation started (2026-09-10).** The plan is a page —
  "v23 mainnet átállás" in the artifact gallery — with phases, gates and a
  block-height axis; the sentence it exists for: H is the deadline, H−120 the
  real one, and there is no brake after it, so every proof is owed *before* H
  is pinned. What today established, from source at `25c3966adc`:
  - **two** activation heights, `nChainLocksV2ActivationHeight` and
    `nInstantSendV2ActivationHeight`, each paired with its type and IS ≥ CL
    enforced (`chainparams.cpp:1667-1681`); mainnet has neither, nor
    `LLMQ_DEFCON` in its `AddLLMQ` list;
  - `WAIT_FOR_ISLOCK_TIMEOUT` is an ungated `static constexpr 2*60`
    (`chainlocks.h:51`) that ChainLock signers also read
    (`chainlocks.cpp:357`): a mixed v22/v23 window can delay ChainLocks before
    H, with mainnet `llmq_400_60` at threshold 3;
  - no test exercises the resolver flip, and regtest cannot host one:
    `-testactivationheight` has `chainlocksv2` and no `instantsendv2`
    (`chainparams.cpp:1213-1214`). Both sent to the Core audit with the DSL
    logging gap and the silent `ReconcileEvoDBToTip`;
  - baseline on the deployed tree: `feature_llmq_q60_regtest.py` passes (the
    120-block formation lead pinned); `feature_llmq_q60_dkg.py`, which is not in
    the runner's list, passes run directly — a real 60-member DKG from 65
    daemons, 60/60 valid, health 1.00, 3.5 min;
  - mainnet from its public explorer: **217 masternodes**, tip 133285, and
    every measured peer on `/DeFCoN:22.1.4/` (54 of 55) — adoption starts at
    zero, and the explorer's own node is under the H−120 deadline too.
  - **Phase-1 pre-rehearsal on the deployed tree, 2026-09-10 (`25c3966adc`,
    fleet build `c07037160d46fc152dfb4417f4e78a90`), against the pristine
    v22.1.4 mainnet datadir** (`~/mainnet-2214-backup-2214`, height 129777,
    evodb `b_b4`/`dmn_S3`; the `d:\x\Defcon` copy the 2026-09-04 note names is
    gone, and this copy's tip is 129777, not 130100). Three derivations, one
    tip, `831cc9352ac13eb8bc6cb27436e2e1819d2fd5fc8766b9c424dec3af66082e32`:
    **A**, in-place migration — 234 migrate lines, `b_b4`→`b_b6`,
    `dmn_S3`→`dmn_S5`, 0 errors, up in 4 s; **B**, full reindex with
    `-assumevalid=0 -txindex=1` — same tip in 214 s, 220 masternodes / 138
    enabled from blocks alone, 0 validation problems; **C**, reindex killed -9
    at 65021 and restarted with no flag — up at the flushed tip 61709 in 2 s,
    every migration gate "already done", the import continued to 129777 within
    a minute, 224 snapshot pairs verified. C is #222 on real mainnet data, and
    it passed by the *other* half of the fix: nine evodb flushes during the
    import kept the evodb level with the coins, so `ReconcileEvoDBToTip` had
    nothing to replay and wrote nothing. The reconciliation half acts only on a
    datadir an older binary left lagging.

    One correction owed to the audit note: `ReconcileEvoDBToTip` is not silent
    on every idle start — Test A logged `evodb carries the older marker b_b4 and
    no b_b6: this database is not migrated, not stranded; leaving it to the
    migration gates`. It is silent on a migrated database already at the tip,
    which is every healthy restart, and that is the case the note meant.

    Harness lesson, so the next run does not lose twenty minutes to it: a
    daemon started inside `PID=$(start …)` holds the command substitution's
    stdout open, so the substitution never returns while the daemon runs;
    redirect the daemon's stdout and stderr before backgrounding it. And the
    node shrinks a `debug.log` over 10 MB at startup, so a line count taken
    before a restart cannot be used to `tail` the lines after it.
  - **Phase 2 delivered here:** the software census (`/masternodes/versions`,
    off the seed's peer table, 151/152 coverage) — the instrument the phase-3
    go/no-go reads. Owed: the same on the production explorer, the countdown
    page, and the phase-1 rehearsals once an RC exists (migration on the
    mainnet datadir copy, the proto-floor exclusion, the lab switchover).

    **The production half is specified, not started
    (`docs/v23-production-explorer-port.md`, 2026-09-10).** Read out of
    `d:\www\DeFCoN_Explorer` with a negative control on every search and
    nothing modified there, because CLAUDE.md makes the reference projects
    read-only: that explorer already stores a per-node version
    (`NodeInventory.walletVersion`, a scanner with four sources), but it
    attributes it **by host IP** -- `verified_proregtx_hash` occurs zero times
    in the repository -- so every masternode behind one address is counted as
    whatever the first peer row said. And the constraint that shapes the whole
    thing: its node answered **55 connections against 217 masternodes** today,
    so a peer-table reading there is a sample of at most a quarter of the
    network, never the census the devnet's fleet-dials-the-seed topology
    gives us. Three owner decisions are named at the end of that file, and the
    work cannot start without the first.

- The 2026-09-07 rollout (`c739d9f504`, 12 commits) reached all 162 daemons;
  see `docs/devnet-rollouts.md`.

## 2b. What the first sanitizer run found (2026-09-07)

The ASan+UBSan `-O0` build at the #209 tip ran all 156 suites, one process
each, with the tree's own suppression files. **Zero AddressSanitizer reports**
-- no use-after-free, no overflow, no bad free anywhere in the suite. Every
suite that fails at `-O2` fails here too, so nothing is hidden by
optimisation; eight suites fail *only* here, and none of them for a Boost
assertion. What those eight are:

- **Seven leak reports, and they are one leak, not seven.** `coinjoin_tests`,
  `coinselector_tests`, `pos_multiwallet_tests`, `pos_stake_rules_tests`,
  `psbt_wallet_tests`, `wallet_tests`, `walletdb_tests` -- every suite that
  opens a wallet -- end with LeakSanitizer, and every stack roots in
  `__os_malloc`, Berkeley DB's own allocator. The amount scales with wallets
  opened, not with test logic: 554 bytes in 8 allocations for one wallet,
  2493 in 36 for the heaviest suite. Nothing suppresses them because
  `test/sanitizer_suppressions/lsan` carries exactly one line,
  `leak:libQt5Widgets`, and BDB is **statically** linked here (`ldd` shows no
  `libdb`; `__os_malloc` is a `T` symbol inside `test_defcon`), so even
  upstream's usual `leak:libdb` form would not match -- it would have to be by
  function name. **Owed decision, and it is a Core one:** suppress
  `__os_malloc` with a comment saying why, or close the environment properly in
  the wallet test teardown. Not a node-runtime concern -- these are
  allocations still live at process exit, in a test binary -- but until it is
  decided, a sanitizer run cannot be read as clean at a glance, which is the
  whole point of running one.

  **Why there is no upstream line to inherit, checked rather than assumed
  (2026-09-08):** `test/sanitizer_suppressions/lsan` has never carried a BDB
  entry in any commit of its history, the Bitcoin Core merges included.
  Upstream needs none because its sanitizer builds do not link Berkeley DB;
  this tree links it, because the seed keeps a legacy wallet. So the gap is
  our configuration's own, not a dropped inherited line.

  **Settled 2026-09-08 by measurement: run the sanitizer suite
  `--without-bdb`.** That is the configuration 160 of the 162 daemons already
  run, and it removes the leaks without suppressing anything. Built at the
  current tip `fb88a893da` (`~/DEFCON-nobdb-san`, same options as the BDB
  sanitizer tree but `--without-bdb --with-sqlite=yes`; 5 min at `-O0`) and
  run over all 157 suites:

  | | with BDB (`37e845beb0`) | without BDB (`fb88a893da`) |
  |---|---|---|
  | AddressSanitizer | 0 | 0 |
  | UndefinedBehaviourSanitizer | 1 | **0** (#216 fixed it) |
  | LeakSanitizer | **7 suites** | **0** |
  | failing suites | 24 of 156 | 17 of 157 |

  All seven leaks are gone, and **nothing broke to buy that**: the set of
  suites failing without BDB but not with it is empty. Six of the seven now
  exit 0 clean; `wallet_tests` still fails, for its own inherited reason and
  with `leak=0`. What remains failing is exactly `build.yml`'s 16-name
  exclusion list plus `dsl_service_pose_tests`, which is a budget problem, not
  a defect -- it is compute-bound at 98 % CPU (6453 s of CPU in 6603 s
  elapsed) and hit the 7200 s cap; give it its own budget or run it at `-O2`.

  The coverage is not bought by skipping: `CreateMockWalletDatabase()`
  switches to SQLite under `#ifdef USE_BDB / #elif USE_SQLITE`
  (`wallet/walletdb.cpp:1233`), so the suites run the same cases either way --
  `wallet_tests` 17 and 17, `coinselector_tests` 4 and 4,
  `pos_multiwallet_tests` 6 and 6.

  **What it costs, stated rather than glossed:** `db_tests` is not compiled
  without BDB -- it tests the Berkeley DB wrapper itself -- so that path stays
  unmeasured under sanitizers. It matters for exactly one daemon of 162, the
  seed, which is the only one with a legacy wallet. Suppressing `__os_malloc`
  or rewriting the wallet teardown are both still available if that ever
  matters; neither is needed for a clean baseline now.
- ~~**One UBSan report, real and one line to fix.**~~ **CLOSED 2026-09-08,
  defcon-project/defcon#216** (`fb88a893da`, squashed onto `v22.1.x`).
  `net_tests`:
  `streams.h:599` `null pointer passed as argument 1, which is declared to
  never be null`, from `CaptureMessageToFile` (`net.cpp:5201`). The last
  statement is `f.write(AsBytes(data))`, and on an empty message `data.data()`
  is null while `size()` is 0, so `fwrite(nullptr, 1, 0, file)` -- undefined by
  the standard even though every implementation copies nothing. Inherited from
  Bitcoin Core verbatim, reachable only through `-capturemessages`, which is a
  debug switch no node here runs.

  Fixed by guarding the empty case in `CAutoFile::read` and `write`, which
  changes no behaviour: per the C standard a zero-length `fread`/`fwrite`
  returns 0 and leaves the buffer and stream state untouched, exactly what
  the early return does. `read` had the same latent shape and was guarded
  with it. A named `streams_tests` case now gives UBSan a direct site, so
  the only trigger is no longer a captured VERACK deep inside `net_tests`.
  Measured before and after in one worktree: `net_tests` from exit 1 with
  one report to exit 0 with none over 19 cases, `streams_tests` 9 cases to
  10, the neighbours unchanged. Consensus-neutral by the fingerprint rule --
  179 strings, md5 `aa83d8f81eebff6a50013bb95e044a16` with and without, and
  a narrower control pattern gives a different value.

  **The same defect is in Dash**, unfixed and unsuppressed:
  `dashpay/develop:src/streams.h:559` carries the identical unguarded
  `fwrite`, their 95-line ubsan suppression file has no `nonnull` entry
  (though it does suppress `shift-base:streams.h`, so they curate it and do
  run UBSan), and their `net_tests` still sets `-capturemessages`. Recorded
  for the owner's own list of inherited Dash defects; no PR is opened there
  from here.
- **One timeout, and it is the build, not the code.** `dsl_service_pose_tests`
  ran 190 s at `-O2` and was killed at 3959 s here, in its third case -- a
  Monte-Carlo sweep over population, concentration and sentinel counts. Twenty
  times slower under `-O0` plus sanitizers is ordinary; read it as "this suite
  needs its own budget in a sanitizer run", never as a hang.

## 2. In the binary, not proven on-chain

| Change | State |
|---|---|
| #186 `CheckLLMQConfiguration` | Unit tests pass (`llmq_configuration_coherence`, `formation_follows_the_height_not_the_network`). **Not reachable from a running node's configuration**: `-llmqchainlocks` only accepts types the network registers, so `require_registered` cannot be tripped from the command line. The guard is against a chainparams edit — i.e. the v23 Q60 mainnet activation — not against operator error. |
| #189 banned masternode may still answer | **Proven on-chain by E1b (2026-09-06).** All five outage nodes were DKG-PoSe-banned during the outage (8387–8468) and still announced after their restart: `respondedcount` 152 with 5 PoSe-banned, and epoch 356 cleared their DSL fields with no ProUpServTx. The shadow-run deadlock is gone. |
| #190 enforcement height | Proven by E1a (closed 2026-09-05): the height reached all 162 daemons and crossing it changed nothing. The punishing side is E1b. |
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

**Where the four stand on 2026-09-07, against the merged package**
(`ops/chaos/defcon-chaos`, reinstalled and proven on the pilot host, §4):

- Band binding: **closed.** `prio bands 4` with every TOS class mapped to band
  1, netem on 1:4, nothing reachable without the filter; read live on the host.
- Too broad: **closed** by the same change.
- Pure loss: **closed.** `require_fault_numbers` now accepts latency 0 and
  leaves `delay` off the netem command entirely.
- Too narrow: **changed shape, still open.** The filter now matches the
  target's listening port as the *source* port, so it impairs what leaves that
  daemon's listening socket — replies on the connections peers opened to it —
  and no longer touches other daemons on the host dialling the same remote
  port. Connections the target itself initiated leave from an ephemeral port
  and pass untouched; the wrapper's own comment says covering those needs a
  per-process classifier (cgroup v2 plus an nftables mark) proven on a real
  host first.

So before E4b runs again, measure on the target how many of its quorum links
are inbound (`getpeerinfo`, `inbound` against the masternode-connection flag):
the filter reaches exactly those. If that is a minority, the re-run would
measure the tool a second time. And it waits for the running observation
regardless (§1).

**Measured 2026-09-10** on three masternodes of one fleet host, read-only:
134, 134 and 137 quorum links (`masternode`-flagged peers), of which 73, 79 and
80 are inbound -- **54-59 %**. A majority, so an inbound-only fault reaches most
of a target's links but not all: a re-run either writes its hypothesis for a
~57 % impairment of the member, or the wrapper gains an egress half first. The
observation run that held E4b back closed at 10608; nothing else blocks it.

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

- ~~**The InstantSend probe races the ChainLock.**~~ It polled `getislocks`,
  and `HandleFullyConfirmedBlock` prunes the very record it polled: one of
  twenty transactions was mined four seconds after broadcast, its lock was
  gone before the poll could see it, and scored naively that was a false "no
  lock". **Closed 2026-09-07 with `ops/instantsend-probe.py`**, in the
  repository this time. It reads `getrawtransaction`'s `instantlock`, which
  stays true through the ChainLock prune that empties `getislocks`; treats
  block inclusion as an outcome of its own (`locked`, `mined-with-lock`,
  `mined-unlocked`, `timeout`, `rejected`); states its resolution -- the poll
  interval -- beside every latency; and counts RPC errors instead of scoring
  them. It spends only to the seed wallet's own addresses, from distinct
  mature non-collateral outputs it selects itself, and refuses to run with
  the InstantSend spork off. The pure parts are unit-tested in `ops/tests/`.
  What it still cannot do is read the notification: the seed publishes no
  InstantSend-lock ZMQ topic (`getzmqnotifications` on 2026-09-07: hashblock,
  hashchainlock, hashtx, sequence) and the VPS has no pyzmq, so that half
  needs a conf change and a seed restart -- not during the running
  observation, and a separate decision. Not yet run against the chain either:
  see §1 for why the wait is about signing traffic landing in a window that
  measures signing, not about the run's declared exclusions, which do not
  name the probe.

  **Run against the chain 2026-09-10, and it exposed a bug in itself.** The
  probe scored a mined transaction `mined-with-lock` on `getrawtransaction`'s
  `instantlock`, which is islock OR chainlock -- so a transaction first seen
  in an already-ChainLocked block was called locked on the ChainLock's word,
  not the islock's, after 734 polls that all read unlocked (run 1, tx 17).
  Fixed the same day: a mined transaction is scored by `instantlock_internal`
  (the islock alone), the ChainLocked-but-no-live-lock case is its own outcome
  `mined-lock-unknown`, and the summary carries the effective poll cadence
  (`elapsed/observations`, ~169 ms against a nominal 100 ms, because each RPC
  call takes ~90 ms). The fix rode into run 2 and its 12 → 14 unit tests. The
  broader lesson is the recurring one (`verify-the-verifier`): the tool's own
  clean number, `mined-with-lock`, asserted more than the node had said.
- **A missing lock can be a missing block, and nothing measured that until
  now.** Chasing the two InstantSend cases the runs left open (§1) ended
  somewhere else entirely: block 11059's body was late — header time
  13:36:42Z, connected at the seed 13:39:34Z, with the seed's own log naming
  the cause, `Timeout downloading block ac62712c… from peer=577,
  disconnecting`, at 13:39:18Z. tx 16's lock arrived 12 s after that
  disconnect and was accepted; tx 17 has no islock line at either observer in
  either direction. The window, not the quorum, is what those two have in
  common.

  **It is not rare, and it is not one node's fault.** `ops/block-arrival-lag.py`
  (new, read-only: parse `UpdateTip` and `Timeout downloading block` out of a
  debug.log, ask the node for each block's header time, report the
  distribution and name the peers) was run over the identical window
  10540–11125, the rollout excluded, on five daemons:

  | node | blocks > 120 s late | p99 | max | timeout lines |
  |---|---|---|---|---|
  | seed (the explorer's RPC, ~169 peers) | 20 (3.6 %) | 297 s | 448 s | 16 |
  | devnet2 (same host, 28 peers) | 6 (1.1 %) | 125 s | 176 s | 2 |
  | fleet host 1, mn1 | 8 (1.4 %) | 167 s | 302 s | 16 |
  | fleet host 2, mn1 | 13 (2.3 %) | 294 s | 374 s | 54 |
  | fleet host 4, mn1 | 4 (0.7 %) | 82 s | 358 s | 28 |

  Median 2 s and p90 6–9 s everywhere, so the ordinary case is healthy and the
  tail is the whole story. The seed is the worst of the five but not a
  different animal, and the two daemons on one machine differ by a factor of
  three — so this follows the peer set, not the host. Block 11059 read 16 s,
  17 s, 96 s, 126 s and 278 s across five fleet hosts while 11060 reached every
  one of them within 5 s; 10986 and 11010 were 0–5 s at four fleet hosts and
  447/448 s at the seed. Eleven of the seed's twenty late blocks name a peer
  that was asked for the body and did not send it, twice two peers in a row.

  **What it costs this project.** Every wall-clock latency measured at the seed
  — InstantSend locks, ChainLock first sight, the ZMQ block notification the
  explorer stores as evidence — inherits this tail, and the node reports
  nothing amiss while it lasts. Before attributing a delay to a quorum, run the
  tool over the window. Unit-tested against a fixture read from the chain with
  two negative controls: an unknown log format must report *nothing parsed*
  rather than nothing late, and header times shifted so nothing is late must
  keep the same block count. Proven able to fail (last-tip-wins mutation: 4
  failures, byte-identical restore).

  **And it contaminates a number this site already published.** With both
  series live, the overlap was read off the deployed API over the same 500
  blocks: three of the four largest ChainLock latencies sit immediately before
  a block that arrived minutes late -- 11058 (lock 207 s, next block 173 s
  late), 11130 (127 s, 308 s) and 11106 (124 s, 152 s) -- while 11034 (165 s)
  and 11082 (110 s) have prompt neighbours and are something else. The
  mechanism is one event seen twice: the block arrives, the feed stalls, and
  the CLSIG for that block and the next block both land when it resumes, so
  `chainLockLatencyMs` charges our own gap to the quorum. The ChainLocks page
  now says so in the panel; what it does not do is subtract it, because two of
  the five show the effect is not the whole story.

  **The explorer publishes it since 2026-09-10, so the caveat is no longer
  only in this file.** `GET /api/v1/block-arrival` reports the distribution
  over a window from `Block.firstSeenAt` — the ZMQ sighting the collector has
  stored all along and nothing ever read for this — and the ChainLocks page
  carries it under the lock latencies it qualifies. Two rules are in the domain
  module and in its tests rather than in a comment: a block the watcher never
  saw arrive is `unmeasured`, never a zero, and every share is over `measured`;
  a negative lag is kept, because it says the two clocks disagree rather than
  that a block arrived early. The integration test proves the wiring a unit
  test cannot — dropping `firstSeenAt` from the route's projection makes every
  block look unmeasured while the report stays well-formed, and that mutation
  fails two cases.

  Open, and worth a decision rather than a guess: whether the seed's share is
  its peer count, its RPC load, or the announcing peers it happens to pick. The
  tool makes any of those measurable on a second window.

  **One structural fact is in already (2026-09-10, `getpeerinfo`).** The seed
  holds **169 peers, 161 of them inbound** against 8 outbound; devnet2, three
  times better on every lag percentile, holds **28, every one outbound** (16 of
  them masternode connections). So the daemon that waits to be dialled is the
  one that waits for blocks, and the one that chooses its peers does not. That
  is consistent with the mechanism the log names -- the body is requested from
  whoever announced it, and the seed's announcers are the whole fleet,
  including nodes that are themselves behind -- but it is a correlation of two
  daemons, not a cause. Settling it needs either a controlled change (more
  outbound slots on the seed) or a window in which the two are compared with
  the RPC load moved, and neither is worth a restart on its own.
- **`medianBlockIntervalSec` must not be compared against the target spacing.**
  Block intervals are a Poisson process, so they are exponentially distributed
  and the median is `mean x ln2` = 0.693 of the mean, never the mean itself.
  Measured over 40 blocks on 2026-09-05: mean 161.6 s, median 112 s, min 8 s,
  max 818 s -- and 161.6 x 0.693 = 112.0, an exact fit. The target governs the
  **mean**, so the settled chain is within 8 % of its 150 s target while the
  median makes it look 25 % too fast. `stake-redistribution-2026-09-05` named
  the median in its expected outcome and would have been read as a miss on that
  half. Either publish the mean beside it, or state the 0.693 factor wherever
  the median is compared to a target. **Closed 2026-09-07:** the outcome now
  carries `meanBlockIntervalSec` beside the median (a running run recomputes
  it; a run frozen earlier shows "not recorded", never zero), the experiment
  page shows both, and the baseline comparison prints the 0.693 relation under
  the table. `stakingHealth` had computed the mean all along; the outcome
  dropped it.
- **`distinctStakers` in the experiment outcome invites a wrong reading.** It
  counts distinct kernel scripts, not concentration: 42 distinct producers while
  one script took 44 % of 250 blocks. A concentration figure (top-1 share, or a
  Gini) belongs beside it, or every fairness measurement will read too kindly.
  **Closed 2026-09-07:** the page shows top staker share, HHI and Gini beside
  the count, and the baseline comparison carries their deltas -- the model had
  stored all three since 2026-09-05 while the shared type and the client never
  read them.
- ~~**devnet2 stakes, and nothing attributes its blocks.**~~ **CLOSED
  2026-09-08, deployed and measured.** Before: `hhi null`, `distinctHosts 8`,
  `unattributedBlocks 21`. After, on the same 500-block window:
  **`hhi 0.1179`, `distinctHosts 9`, `unattributedBlocks 0`**, with `seed` at
  21 blocks (4.2 %). The index was hand-checked against the published shares
  rather than taken from the service that computes it -- the nine squares sum
  to 0.11792 against a reported 0.11791999999999998, and the shares sum to
  1.0. For nine producers a perfectly even split would be 0.1111, so the
  machine-level distribution is close to even; that is the sentence the null
  had been withholding. The seed self-report went from 9 payout scripts to 10
  on the first tick after the restart, with no "peer daemon did not answer"
  line. Deployment was the `.env` block plus `ops/deploy.sh`; **no node was
  restarted**, which the running observation required. Re-measured that day at
  tip 9985: the single unattributed payee is
  `21037fe73c65a732…`, **22 blocks in a 500-block window**, and it is devnet2's
  one pay-to-pubkey payout script — confirmed by reading its wallet directly
  (112 outputs, all inside `stakeValueRange`, exactly one already-staked key).

  **The consequence was larger than the 4 %.** `byHost.hhi` is deliberately
  withheld while *any* producer is unmapped — "a concentration index computed
  over part of the producers is not a measurement of concentration, and it
  would read low precisely when the missing producer is the big one"
  (`domain/stakingHealth.ts`). So one undeclared key held the devnet's
  headline decentralisation figure at `null`, and had done for as long as
  devnet2 had been staking. `topHostShare` and `distinctHosts` were still
  published beside it, which is what made the gap easy to miss.

  **This entry was wrong about the mechanism, and the wrong version cost a
  detour.** It said "the VPS observer reports the seed's scripts under `seed`
  and knows nothing of the second daemon". There is no observer process on the
  VPS at all — `ops/devnet-observer.py` is deployed there but no unit runs it,
  and `ps` finds nothing. The seed's sightings come from the explorer itself:
  `SeedStatusService` polls the seed's own RPC every ten minutes and writes
  both the `HostStatus` row and the append-only `StakeScriptObservation`
  sightings. Checking `systemctl` first and believing the absence would have
  been the wrong conclusion; the data said `seed` was reporting up to the
  current height, which is what sent the search to the right place.

  **The fix reads the peer's wallet from the same service**, behind an optional
  `config.peerRpc` (off unless a port *and* credentials are given, so a
  deployment without a second daemon is byte-identical in behaviour). Its
  scripts are folded into the **`seed` host row**, not a label of their own:
  `byHost` groups production by machine, and two daemons on one box are one
  machine — a separate entry would split the seed host in two and understate
  exactly the concentration the index exists to show. A configured peer that
  does not answer leaves `stakeScripts` unwritten rather than publishing a list
  short by a producer, which is the rule this service already applied to the
  seed's own fields; the append-only sightings are *not* gated that way, since
  each one records a script a host really did hold and a missing one is a gap
  rather than a wrong answer.

  Six cases in `seedStatus.peer.test.ts` pin all of it, including two negative
  controls: a deployment with no peer must never construct the client, and a
  port without credentials must stay off. The suite was proven able to fail —
  disabling the union alone turns the union case red.
- **A restored root qdisc comes back with a new handle.** `fq_codel 8001:` where
  it began as `fq_codel 0:`; the kernel assigns it on replacement. A checker
  comparing handles reports a false difference — compare parameters.
- **`defcon-enable-staking` had a latent toggle bug; the fix is in the repo
  and not yet installed.** Its state check matched `"staking": "true"` while
  the node answers `"staking": true` (a JSON boolean nested under the wallet
  id), so the pattern never matched and it called `setstaking` unconditionally
  — and `setstaking` is a toggle. On a normal restart the wallet switch
  defaults to off, so the toggle turned it on and the bug was invisible; a
  switch already on would have been turned **off**. Fixed 2026-09-06 as
  `ops/defcon-enable-staking` (jq-parsed state, no call when already on, one
  toggle when off, re-read and verify, fail closed with a non-zero exit on
  anything unparseable) with `ops/tests/defcon-enable-staking.sh` — 15 cases
  against a fake `defcon-cli`, including a negative control that runs the
  original script and requires it to show the bug. **Owed: installation.** Two
  copies are live, identical except for the `defcon-cli` path (the new script
  derives it from its own directory, so one file serves both):
  `/usr/local/bin/defcon-enable-staking` on the VPS (`defcond-devnet.service`,
  `defcond-devnet2.service`; the seed unit clears the hook) and
  `/opt/defcon-devnet/bin/defcon-enable-staking` on the 8 fullnodes
  (`defcon-devnet-mn@11.service.d/staking.conf`). Because the exit status is
  now meaningful, each unit line must become `ExecStartPost=-…` (leading
  dash) at install time, or a staking check that cannot be verified — a
  reindex still in warmup, say — would make systemd stop the daemon. No
  restart is needed to install: the hook only runs at the next start.

  **The leading dash is necessary and NOT sufficient, measured 2026-09-10 —
  this entry previously said the dash was the whole install requirement, and
  that would have restart-looped the seed.** The hook waits for RPC and for a
  staking wallet with a retry budget of `DEFCON_ENABLE_STAKING_TRIES` x
  `DEFCON_ENABLE_STAKING_SLEEP` = **60 x 5 s = 300 s**, and every unit that
  carries it has `TimeoutStartUSec=1min 30s` — the seed, devnet2 and
  `defcon-devnet-mn@11` alike. A dash makes systemd ignore the hook's **exit
  status**; it does not make systemd stop **waiting** for it. So a hook that
  runs past 90 s fails the start, and `Restart=on-failure` loops the daemon.

  The seed reaches that state every time, not occasionally: its conf carries
  `staking=0`, so `getstakinginfo` answers `{}`, no staking wallet is ever
  listed, and the hook necessarily spends the whole budget before failing.
  Measured directly — the repo copy run against `/home/defcon/.defcon` was still
  running at 120 s (`timeout` returned 124) — while the same copy against
  `/home/defcon/.defcon2` answered in seconds with `wallet 0: staking already
  on, nothing to do`, exit 0. One more property worth knowing: the script takes
  `defcon-cli` **from its own directory**, so running it out of the repo fails
  with `defcon-cli is not executable` (exit 2) and proves nothing about the
  installed case.

  **What was installed instead (2026-09-10, seed host):** the hook binary
  `e53ea9660ac7d2a7cc1f5a3b5f411e65` at `/usr/local/bin/defcon-enable-staking`;
  `defcond-devnet.service` has its `ExecStartPost` **removed entirely**, with a
  comment saying why, because a node that does not stake has no use for a hook
  whose only possible outcomes there are "wait" and "fail"; and
  `defcond-devnet2.service` carries
  `Environment=DEFCON_ENABLE_STAKING_TRIES=12` (60 s worst case, under the 90 s
  limit) together with `ExecStartPost=-…`. Unit files backed up as
  `.bak-YYYYMMDD-HHMM` first. No restart was needed: the hook runs at the next
  start, which the rollout provides.

  **Three different versions of this script are live in the estate**, which is
  its own finding: `45d2df089c879c7dd3a64a818563f8c8` was on the seed
  (2026-08-21, the toggle bug), `0f3aad3a5af7958fe9b42893c9b27d3d` is on the
  fleet at `/opt/defcon-devnet/bin/defcon-enable-staking`, and
  `e53ea9660ac7d2a7cc1f5a3b5f411e65` is the tested repo copy. `md5sum`, not the
  path, says what a host is actually running.

  **The repo side is fixed (2026-09-10, `fix/enable-staking-budget`); the
  wiring migration is the part still owed.** `ops/defcon-enable-staking` now
  ships `TRIES` 12 (12 x 5 s = 60 s, inside the 90 s default
  `TimeoutStartSec` with 30 s of headroom), announces its budget in the journal
  before the first attempt, and at exhaustion names the two causes the operator
  can actually act on -- `staking=0` in the conf, which the node cannot report
  and on which the hook must not be installed, or RPC still in warmup. Its
  INSTALL NOTE says the dash is necessary and not sufficient, with the
  arithmetic, and points at the wiring that removes the coupling. The suite is
  18 cases: the three new ones check the exhaustion message, the announced
  budget, and that the defaults read **from the script text** multiply to at
  most 60 -- with a self-check that the assertion rejects the old 60 x 5.

  `ops/systemd/defcon-enable-staking@.service` is the structural fix -- a
  `Type=oneshot` unit ordered `After=` the daemon with its own 330 s timeout
  and the full 300 s budget, so the daemon's start can never fail because of
  the hook -- and it is **shipped but not deployed**. The 8 stakers and devnet2
  run the interim `ExecStartPost=-` + `DEFCON_ENABLE_STAKING_TRIES=12` form,
  which is safe. Migrating is one host touch per staker (install, `enable
  defcon-enable-staking@11`, drop the `ExecStartPost=` line, `daemon-reload`),
  takes effect at the next start, and is owed at the next planned restart
  rather than as its own. The node-side gap -- no RPC distinguishes "staking
  off" from "wallet list not built" -- went to the Core audit as its own item;
  once a status RPC exists the hook gains a proven early exit instead of a
  guess.


## 4. Current state of the network

- **Every daemon runs `f569316413` (#229 + #230) since 2026-09-11, rolled with
  block production deliberately frozen.** 162 of 162: 16 fleet hosts with 160
  instances, plus seed and devnet2. Fleet and devnet2 md5
  `d067c3dd6ba9a29eb86797db75816a47`, seed `07ac431840c27840d040d90e430018b0`;
  `fleet-chain-check2.sh` afterwards **hosts=16 instances=160 same-chain=160
  forked=0 unreachable=0**, one tip hash on all sixteen. Run
  `fleet-rollout-229-230-2026-09-11`, declared before any restart.

  **What is new on the network.** #229 carries the v23 activation bundle (eight
  gates and two V2 profiles behind one height, dormant: `CheckV23ActivationBundle`
  returns early off main and testnet, and there is not one `CDevNetParams` hunk
  in the diff), the ChainLock pause for `[H-lead, H)` (devnet window
  `[3120, 3240)` -- long past, inert, and `VerifyChainLock` untouched so history
  stays verifiable), and **the protocol floor**: `PROTOCOL_VERSION` 70241 to
  70242 with `Q60_SWITCHOVER_PROTO_VERSION` required from `H-lead`, which on this
  devnet is height **3120** and therefore already in force. #230 re-mines the
  testnet genesis and writes `CTestNetParams` only.

  **Consensus-neutral for the devnet, and measured rather than read:** the
  `bad-/pos-/pow-/dsl` fingerprint is `559683c468564314759dfe943705e359`
  (178 strings) on the old fleet binary, the old seed binary and both new ones --
  a four-way match -- with the `^bad-` negative control differing at
  `e2cb189210bb49c76e035a7ea3f2c2f0` (165), so the probe discriminates. `nm`
  finds both new symbols in the artefacts, and on a throwaway regtest datadir the
  new binary answers `protocolversion` **70242** against the old one's 70241 --
  while both answer subversion `/DeFCoN:22.1.5/`. **The version string cannot
  distinguish these two builds at all; md5 and the protocol number are the only
  evidence of the update.**

  **The floor makes a partial roll impossible, and the topology made that
  sharper than the plan assumed.** The fleet dials the seed, so while the seed
  still advertised 70241 every updated fleet daemon sat at **0 peers** -- twelve
  hosts of isolated daemons, not an island -- and no production could have
  happened there regardless, since `mn_sync.IsSynced()` never completes without
  peers and `pos/minter.cpp:164` waits on it. The floor was also visible from
  the other side: the seed's connection count fell **169 to 64** as hosts were
  updated, and climbed back to 161 once it took 70242 itself, every peer at the
  new version and **zero below the floor** across all sixteen hosts.

  **Production was frozen for the roll, and that is what bought the clean
  result.** All nine producers were stopped once the 11544 cycle's commitments
  were mined: the eight fleet stakers by stopping *and masking*
  `defcon-devnet-mn@11` (masking, because `ops/fleet-deploy.sh` restarts every
  instance it finds and a merely stopped staker would have come back up mid-roll),
  and devnet2 by stopping it. The tip then held at **11558 for seven readings
  over six minutes, on both sides of the split**. Order: the sixteen fleet hosts
  first, then seed and devnet2 **last** -- the reverse of the 2026-09-10 roll --
  so the explorer's own RPC source tracked the real chain to the end instead of
  an island.

  **The whole cost to the chain was one gap of 1664 seconds**, which the
  explorer measures for itself as `longestGapSec` over the 500-block window;
  the mean interval across that window is 156.5 s against the 150 s target, with
  the median at 110 s and 0.693 x mean = 108.4 -- the exponential fit this file
  documents, undisturbed. So the trade is exactly quotable: **28 minutes of no
  blocks instead of three penalties, a failed Q60 round and a lost hour.** Said
  honestly, it did not buy everything: the absent Sentinel epoch came anyway.

  **Result: 0 failed DKG rounds, 0 `penalty_up`, 0 bans, 0 revivals from the
  roll** -- not one masternode event at or above height 11550. Against
  2026-09-10 (3 penalties, one failed Q60 round, one absent epoch) and
  2026-09-07 (8 penalties, one ban). The reason the freeze works is worth stating
  plainly: **a fork needs two producing sides, and a DKG round needs a cycle base
  block.** With nothing produced anywhere, neither exists, so the roll cannot
  cost a round or a penalty however long it takes.

  **After the thaw, measured in order.** All eight stakers staking with a live
  minter thread; the first post-roll Q60 cycle (base 11568) formed at **60 of
  60, health 1.00, nobody punished**, with `llmq_50_60` 50 of 50 and
  `llmq_60_75` 60 of 60 at the same base, all three at health 1.00 with nobody
  punished -- where the 2026-09-10 roll's Q60 round at its own base failed
  outright;
  ChainLock **9 of 9 post-roll blocks locked by `llmq_defcon`**, median 2 s, and
  the 500-block window still coverage 1.00 with zero gaps; InstantSend **8 of 8
  locked**, median 1190 ms (faster than the 2026-09-10 baseline's ~2 s) with the
  double spend of a locked coin refused as `tx-txlock-conflict` and no
  `invalid sig in islock` in the set; the proof-of-stake rules clean over the
  post-roll blocks -- zero non-zero nonces, zero non-increasing block times,
  every coinstake minting exactly the subsidy with the block's fees left burned
  -- with a negative control (subsidy off by one satoshi) flagging all eight, so
  the zero is a pass and not a vacuum. **#164, the connect-time stake modifier,
  is NOT checkable from RPC** and is reported as such rather than as a pass; only
  a reindex reaching the same tip hash shows it, which is how the 7560 gate was
  proven.

  **Sentinel epoch 481 (boundary 11568) is absent, and it was predicted before
  the evidence existed.** The run's `expected` had argued "no absent epoch" from
  the roll crossing no epoch *boundary*, which is true and insufficient; the
  refinement was written onto the run while the tip was frozen at 11558 with
  epoch 480 the latest judged, so it cannot be read as fitting the result. The
  freeze protects the DKG, which is height-driven; it does not protect a report
  pool, which is time-and-memory driven.

  **And the absence is sharper than "the pool was lost".** Sampled across all
  sixteen hosts at positions 22-23 of that epoch, every one answered
  `respondedcount` **152**, `missedreports` **0**, and a **single identical
  poolhash** (`56944c5d3f98…`) -- the pool had fully reconverged -- and the
  commitment still did not appear. That points at the signing window rather than
  at pool convergence, which is exactly the open v23 decision.

  **DSL logging is now on at runtime on 27 daemons**, which this roll made
  possible for the first time: #228 gave the Sentinel layer its first log lines
  and shipped in this binary. Until now not one absent epoch on this network
  could be explained from a log, because the layer wrote nothing at all. The
  stakers are included, because the decisive line for an absent epoch (F-2026-140,
  "block built without the commitment") is emitted by the *producer*, which is a
  staker and not a masternode. Runtime only, so it does **not** survive a
  restart -- which is also how this roll silently switched off the `instantsend`
  logging the 2026-09-10 runs had left on, now restored on seed and devnet2.

  **Three of my own tools gave clean, wrong answers during this roll, and all
  three were caught by looking at the raw evidence** ([[verify-the-verifier]]).
  The key-extraction pipeline returned nothing because `$SSH` carried `-n`, which
  points stdin at `/dev/null`, so `sudo -n bash -s` ran an empty script -- the
  exact trap this file already records from 2026-09-10, repeated. The staker
  check called all eight minter threads dead by comparing `thread start` against
  `thread exit` counts, when the node shrinks a `debug.log` over 10 MB at startup
  and drops the first `start`; the reliable test is whether the **last** minter
  line is a start, and it was on all eight. And the protocol check reported
  **4930 peers below the floor on a fully rolled fleet**, because a peer entry
  carries more than one line that looks like a version field and a text scrape
  counted three per peer; `jq` on `.version` answers zero. A checker that cannot
  be wrong in a way you would notice is not a checker.

  **Still owed, and this roll did not discharge them:** the
  `ops/systemd/defcon-enable-staking@.service` migration, which §3 says is due at
  the next planned restart -- this was one, and it was not done; and the firewall
  unification, which §6 says rides the roll after 10608.

- **Two masternodes were banned at 11411 on 2026-09-11, outside any declared
  run, and the two layers disagreed about whether they were there.** The first
  measured instance of the coincident-mining-window ban this file's notes
  predict, and it cost nothing to observe because it happened on its own.

  Block **11411** (`3538d09a…`, 04:42:42 UTC, 4 transactions) mined **both**
  commitments of the 11400 cycle: `llmq_defcon` at 57/60 and `llmq_50_60` at
  46/50, the same `quorumHash` `e3d74760…` and the **same `minedBlockHash`** --
  which is the direct evidence that these two profiles share a mining window,
  rather than an inference from the window arithmetic.

  **And it is routine, not a coincidence:** the very next cycle measured for
  this, base 11568, mined `llmq_defcon` and `llmq_50_60` into one block again
  (`44a25f2c…`) -- harmlessly, because that round excluded nobody. So the
  shared block is structural, and what made 11411 expensive was not the
  coincidence but a host being excluded by both profiles at once.

  **Every one of the seven exclusions was on `roland-node-6`, and every member
  it had was excluded:** 3 of its 3 selected Q60 members and 4 of its 4 selected
  `llmq_50_60` members, against **103 of 103 member slots valid** across the
  other fifteen hosts. Five distinct masternodes, because two sat in both
  quorums -- and those two took 100 twice in one block: `PoSePunish` clamps with
  `std::min` to the 152 ceiling, the threshold at 152 registered is 152, so they
  were banned on the spot. The other three decayed exactly as the rule says (40
  at tip 11471, 0 by 11525; the ban does not decay). No cascade: the 11424 and
  11448 rounds formed at health 1.00 with nobody punished.

  **The Sentinel layer recorded the same hour as clean.** Epochs 474 (boundary
  11400) and 475 (11424) are both `committed` with **0 missed bits**, so the
  quorum agreed those nodes were announcing while the DKG treated them as
  absent. Three of the host's masternodes were also *paid* at 11470-11476, so
  the machine serves. That is the two-layer comparison this project exists to
  make, produced without an intervention: `interventions` on the round is `[]`.

  **What this does NOT settle, and it needs the host's own log.** Whether the
  DKG excluded them through the absence branch (`dkgsession.cpp:458`, "did not
  send any contribution", judged per observer with no threshold) or through the
  bad-vote threshold (`:676`) cannot be read from the explorer -- and the two
  are different diagnoses, mesh churn against a host whose DKG traffic did not
  flow. The fleet runs `debug=llmq-dkg`, so the answer is in that host's
  debug.log around 11400 and nowhere else. Until it is read, "partial
  connectivity" is a reading, not a measurement.

  **Mainnet reading:** `llmq_50_60` is devnet-only, so as the v23 mainnet would
  count this hour it punished **3** and banned **nobody**; the two bans exist
  only because a devnet-only profile shares a block with a mainnet one.

  **Revived 2026-09-11 at 11623 and 11624, and the ban was indeed stale:** both
  daemons were `active`, at the tip, `MASTERNODE_SYNC_FINISHED`, `NRestarts=0`,
  differing from their five healthy neighbours on the same host only in holding
  **90 peers against 151-159** -- which is itself the ban's doing, since a
  PoSe-banned masternode is not dialled for quorum connections. Two ProUpServTx
  broadcast together were mined one block apart, the second waiting out
  `WAIT_FOR_ISLOCK_TIMEOUT` while the chain sat on 11623 for five minutes;
  `enabled` is 152 of 152 and both `revived` events are on record.

  **Still owed:** read that host's DKG log around 11400 for the branch -- the
  absence route (`dkgsession.cpp:458`) or the bad-vote threshold (`:676`) --
  because the explorer cannot tell them apart and they are different diagnoses.

- **(Stale as of 2026-09-10; see §1b for the 25c3966adc roll and the
  229/230 roll below it.)** **Every daemon runs `c739d9f504` (#208) since 2026-09-07, height 9147.**
  162 of 162: 16 fleet hosts with 160 instances, plus seed and devnet2. Fleet
  and devnet2 md5 `406828f76173a5a23f3dd6db740afc76`, seed
  `a1ad976f18016c5a67672adacdb8f4f5`. 160/160 on one chain, 0 forked, 0
  unreachable; 152/152 enabled; ChainLock at the tip on `llmq_defcon`; no ban
  or penalty event from the roll. The consensus-string fingerprint is
  bit-identical to the binaries replaced, so nothing about block validity
  moved. Full record in `docs/devnet-rollouts.md` and the Experiments run
  `fleet-rollout-208-2026-09-07`.

  **What is now on the network that was not before:** #207 (an announcement
  arriving before its epoch base block is held rather than dropped) and #208
  (Sentinel messages relay over masternode connections too). Both are ungated
  and act from the first epoch after install. Neither is claimed to fix the
  absent Sentinel epochs -- that cause was measured separately and is the open
  v23 decision recorded above.

  **What the restart cost, measured rather than assumed.** The DKG round whose
  base block was 9144 ran straight through the rollout window, and it is the
  only one disturbed. `llmq_defcon` -- the ChainLock profile -- formed at health
  **1.00 with nobody punished**. `llmq_50_60` formed at **0.96 with 2 of 50
  punished**, both on `roland-node-8`, the host that carries 14 instances and so
  dropped the most DKG connections at once; two `penalty_up` events at 9155,
  each `None -> 100`. That is a mild disturbance by this network's history: the
  2404 revive punished 42 of 50 in the equivalent window.

  **One masternode was banned, and the run's own prediction said none would
  be.** `9c94c198…` on `roland-node-8` took 100 at 9155 from `llmq_50_60`, then
  100 again at 9165 from `llmq_400_60` -- ten blocks apart, saturating at the
  152 ceiling. Expectation 7 of the run reasoned from a single profile's
  24-block interval and concluded two exclusions could not fall close enough
  together. That was wrong for a reason this file's own notes already record:
  what bans is two exclusions from **different interleaved profiles**, and their
  gap has nothing to do with either profile's interval. Enabled fell to 151.

  **No cascade.** The 9168 rounds formed at 1.00 with nobody punished, so the
  mesh re-formed inside one interval; the five nodes left at 100 decay from
  there at one point per block. A ban does not decay, so that node needed a
  ProUpServTx, and reviving it was deferred until the wave had passed rather
  than done into it. Confirmed quiet first: `enabled` held at 151 from 9169 to
  9215 with no further event.

  **Revived at 9234; the network is back to 152/152.** A stale ban, not an
  outage -- the daemon was up, at the tip and holding 99 peers the whole time,
  which is the check that decides whether a ProUpServTx is the right answer.
  `/root/revive-expansion.py` on the seed did it, fed the one operator key it
  needed. On chain afterwards: `PoSeBanHeight -1`, `PoSePenalty 0`, and the
  explorer recorded the `revived` event at 9234.

  **How the key was handled, because this is the part worth repeating.** The
  operator secret lives only in that instance's own conf on a shared host.
  `/root/extract-keys.sh` runs there through `sudo -n bash -s` and prints
  `port secret` lines to stdout and nothing else; the jump host filters to the
  single port that needed reviving, so no other instance's key left that
  machine; the line was piped straight into a mode-600 file on the seed, which
  the revive script deletes when it is done. It was never printed, never
  written to disk anywhere in between, and the deletion was verified
  afterwards. Check the count and the secret's length rather than echoing it --
  one line, 64 characters is enough to know the extraction worked.

  **A logging limit worth knowing before the next measurement.** The fleet runs
  `debug=llmq-dkg` only, so #207's held-announcement trace line never reaches a
  fleet debug.log. Evidence for #207 and #208 on this network has to come from
  `dslstatus` (`respondedcount`, `epochreports`, `missedreports`, `poolhash`)
  sampled across hosts at epoch positions 17-23, and from the explorer's
  `/api/v1/dsl/epochs`. Turning the category on is a conf change and a restart,
  so it rides a roll rather than being done for one measurement.

- **The simulator cannot act on the devnet, by construction, so nothing of it
  belongs on a VPS yet.** `EXECUTOR_LAB_NETWORK` in
  `services/simulationControl.service.ts` is the constant `'regtest'`, and the
  comment beside it says it is a design constant rather than a setting: a live
  run whose target snapshot carries real fleet host identities is exactly what
  the guard exists to prevent. The only implementation of
  `SimulationLiveExecutor` is `DockerLiveExecutor`, which drives lab
  containers, and it is built only when `SIMULATION_LAB_EXECUTOR_ENABLED` is
  set. So the 160 imported devnet targets are for planning, preview and
  dry-run; all 160 are `enabled: false` and all carry `service-control` only.
  Installing a wrapper on a fleet host today would connect to nothing. What the
  live devnet path would need first is a devnet executor and a transport to
  reach a host, and neither exists.

  **Decided 2026-09-07 (the user, option B): it stays that way.** No devnet
  executor, no transport, the 160 targets disabled for good. The devnet
  remains script-driven -- the E1b/E2 pattern, hand-run and recorded in
  Experiments -- and the simulator is the lab instrument for proving Core
  changes, closed as a chapter. Roadmap day 16 and day 22's devnet half are
  closed by documentation as covered by those runs; day 17's missing half
  (P2P-port-only isolation) stays a chaos-wrapper task, which E4b needs
  anyway. Reason: the fleet is temporary and eight of its hosts carry
  mainnet; a web button that stops daemons on production machines is not
  worth what it would buy. Re-openable for a DAO-voted permanent fleet that
  shares no machine with production.

- **The seed no longer stakes, durably.** `staking=0` in its conf plus a
  systemd drop-in clearing `ExecStartPost` for that unit only. With staking off
  the subsystem does not initialise at all: `getstakinginfo` and
  `liststakingwallets` both answer `{}` — which is stronger than `false`, and a
  checker looking for `"staking": false` finds nothing and may misread it.
  Revert: delete
  `/etc/systemd/system/defcond-devnet.service.d/no-staking.conf`, restore
  `staking=1`, `daemon-reload`, restart.
- **`stake-redistribution-2026-09-05` is closed** (8015 to 8172, same day);
  an earlier version of this entry still called it open after §3 had already
  recorded the result. Read §3 for the numbers.
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

  **The pilot host was reinstalled on 2026-09-07 and the debt is closed.** It
  now runs the merged 18,181-byte wrapper, host-bound: `verify` answers
  `version=1 host=<this machine> targets=1 max_ttl_seconds=600`, where the old
  one reported no host field at all. The old `targets.conf` predated the
  binding and had
  no `host` record, which is why `install.sh` needed `uninstall.sh
  --purge-config` first -- it refuses to overwrite an existing configuration.
  `chaosops` and its sudoers entry were kept; the account is not recreated by
  the installer.

  Order matters and the package enforces it: `uninstall.sh` runs `recover-all`
  first and refuses to remove anything if that fails, so a host can never be
  left holding a live fault with the only tool that could undo it deleted.

  **The band fix is proven on the host, not just shipped to it.** With the
  smallest fault the wrapper accepts (1 ms, no jitter, no loss, 45 s) the live
  structure read: `prio 1: root ... bands 4 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0
  0 0 0`, `netem 40: parent 1:4 delay 1ms`, and a filter at `*flowid 1:4`
  matching `4d570000/ffff0000` -- 0x4d57 is 19799, the declared port. Nothing
  on band 3, which is the pre-fix defect. After `clear`: root qdisc back to
  `fq_codel`, zero filters, zero job records, all 9 masternode units active,
  mn1 at the tip with 150 peers, network 152/152.

  The handle went from `fq_codel 8002:` to `8003:` across that cycle, which is
  the same reminder as before: **compare parameters, never handles.**

  **E4b is therefore unblocked.** It is an experiment and needs its own
  Experiments record; the reinstall above is maintenance and is not that run.

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
  longer holds. `HANDOFF-v23-audit-2026-09-04.md` carries a dated correction
  block at its head since 2026-09-07 (its body is left as the record of what
  was believed on 2026-09-04), and the `m02-strict-blssig-size-gated` memory
  was rewritten the same day.
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

- **Every devnet figure now says what mainnet would make of it (2026-09-10).**
  The devnet forms four punishing profiles and the v23 mainnet will form two
  (`llmq_defcon`, `llmq_400_60`); `llmq_50_60` and `llmq_60_75` are admitted
  on testnet and devnet only (`llmq/options.cpp:188-191`) and v23 leaves that
  as it is. So every "this roll punished N" from here was pessimistic for
  mainnet by an unknown amount -- for the #222 roll by all three. The registry
  carries `formsOnV23Mainnet` with a one-line reason per profile; round rows
  and per-profile outcome rows are tagged `devnet-only` on read (registry data,
  never snapshotted); every experiment outcome carries `mainnetRelevant` --
  the same window with the devnet-only profiles held out (rounds, formation,
  health, streak, DKG-invalid members) -- frozen at close and recomputed from
  the rounds on read for the runs closed before it existed; the baseline
  comparison gains the two mainnet-counted deltas; `GET
  /api/v1/quorum-rounds/profiles` serves the registry. Ban and penalty
  *events* stay network-wide and unsplit, by design: a ban earned by two
  `llmq_50_60` exclusions cannot be attributed away afterwards. Decided the
  same day: the two profiles stay switched on here (see CLAUDE.md, measurement
  caveats). Owed: quote both counts in every roll's closing notes from now on.

- **The simulator's 16-host fleet manifest exists and is waiting for the
  import decision** (2026-09-05 evening, `docs/SIMULATOR_HANDOFF.md` top
  addendum). 160 targets (152 masternodes, 8 fleet stakers), schema-valid,
  fingerprint `41a4c2b0…`, read-only preview: 160 create, 0 update, 0
  undeclared. Built by `ops/fleet-inventory-collect.sh` (jump host, read-only)
  and `ops/fleet-inventory-manifest.py` (VPS, private operator map), verified
  with a negative control. It lives at `/root/fleet-manifest-devnet.json` on
  the VPS and is never committed. **Imported the same evening with the user's
  go:** 160 `PUT /admin/simulations/targets/:id` (paced -- the admin router
  allows 30 a minute), all `enabled: false`; the preview then answered 160
  unchanged, fingerprint identical. Enabling is a later, safety-admin act.

  **What the import did not fix, by rule:** the forming-quorum view still
  answers `no unambiguous target mapping`, now for a `roland-node-8` member.
  The resolver drops every target whose host has no `HostStatus`
  (`MISSING_HOST_OBSERVATION`, `targetResolver.ts`), and only the 8 DAO hosts
  run an observer -- their 88 targets resolve (fresh, at tip, build hash the
  full 64 hex equal to `expectedBuild`), the 72 on the 8 shared `roland-node-*`
  hosts do not. A 60-member quorum drawn from 152 almost always contains one of
  those 72, so resolution stays closed until either an observer runs on the
  shared hosts (a decision -- they carry production services) or a policy
  admits declared-but-unobserved targets, which the fail-closed design
  deliberately does not. **Moot since 2026-09-07 (option B, §4):** the
  targets stay disabled for good, so the gap needs no observer on the shared
  hosts. The manifest stays useful as the fleet's declared inventory for
  preview and dry-run.
- ~~Refresh the inherited-failing tests listed in `CLAUDE.md`.~~ **Done**:
  `CLAUDE.md` now records `subsidy_tests` and `block_reward_reallocation_tests`
  as passing (measured 2026-09-05 on the deployed commit) and keeps the rest
  with the date they were last measured. ~~**What that leaves owed:** the names
  still on the list were verified on 2026-09-02 and not since.~~ **Discharged
  2026-09-07/08.** The list was re-measured on the deployed `c739d9f504`
  (`~/DEFCON-tests`, -O2, one process per suite): 156 suites, 764 cases,
  exactly 16 failing, and that set equals `build.yml`'s exclusion list name for
  name. `WatchOnlyPubKeys` came off the list by that run; `CLAUDE.md` carries
  the current set with its date. The `--without-bdb` sanitizer run at
  `fb88a893da` agrees (§2b): 17 of 157, the same 16 plus `dsl_service_pose_tests`
  on its timeout.
- **The 16 suites outside the CI gate were measured (2026-09-05, on the
  deployed `e15e29b136`) and the gate's exclusion list is exactly right.**
  Full run: 738 test cases, 12 aborted, 744 of 9,003,312 assertions failed.
  Every failing suite is on `build.yml`'s exclusion list and every excluded
  suite fails -- the two sets are equal, so nothing has been silently fixed and
  nothing new has broken. Everything the gate covers is green, including
  `pos_coinstake_fee_tests`, `logging_tests`, `llmq_chainlocks_tests`,
  `pos_stake_rules_tests`, `pos_multiwallet_tests` and `pos_kernel_tests`.
- **First sanitizer run of the whole suite, 2026-09-07** (`-O0 -g3`,
  ASan+UBSan, at the #209 tip): 156 suites, 24 failing -- the 16 the `-O2` gate
  already excludes, plus seven BDB leak reports, one UBSan report and one
  timeout. Zero AddressSanitizer findings. Detail and the owed decisions are
  in §2b. Cost: about 105 minutes wall clock for the run.
- **Re-measured 2026-09-07 on the deployed `c739d9f504`** (`~/DEFCON-tests`,
  -O2, binary brought up to HEAD first -- it had been two source files behind
  -- and one process per suite): 156 suites, 764 cases entered, exactly 16
  suites failing, and the set equals `build.yml`'s exclusion list name for
  name. One case moved inside a suite: `wallet_tests/WatchOnlyPubKeys` now
  passes, so CLAUDE.md's named list is five wallet cases, not six.
  `validation_chainstate_tests/chainstate_update_tip` fails on the critical
  check `CreateAndActivateUTXOSnapshot`; `rpc_getblockstats.py` on the
  subsidy fixture, as before. First attempt measured a stale binary because a
  top-level `make src/test/test_defcon` "had nothing to do" (CLAUDE.md,
  operational notes); the run was thrown away and repeated with `make -C src`.
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

- ~~**The pilot host still carries the pre-fix chaos wrapper**~~ **Done
  2026-09-07.** Reinstalled from the merged package, host-bound, and the netem
  band binding proven on the host with a 1 ms fault and a clean recovery. See
  §4 for the evidence. **E4b is no longer blocked by tooling** -- it needs its
  own Experiments record, which the reinstall deliberately is not.
- ~~**A real host IP is in this repository's public git history.**~~ **DECIDED
  2026-09-08 (the owner's): do not rewrite. Harden instead.**

  **What settled it is that the address is already on the chain.** It is one of
  the sixteen masternode service addresses, and the deterministic masternode
  list publishes those by protocol -- a masternode must be reachable, so its
  address is in the list permanently and anyone with a devnet node reads all
  sixteen with one `protx list registered true`. Checked rather than assumed:
  the two routable addresses the history scan found were tested for membership
  in the on-chain service set, and the real one is in it while the placeholder
  is not. Rewriting would delete one copy of something the chain republishes to
  every peer that connects, for as long as the chain exists.

  Three supporting facts, none of them decisive on its own. The address left
  the tree at `a2f86c6` after eleven days. A rewrite would not un-publish it on
  GitHub either -- rewritten commits stay fetchable by SHA until Support purges
  them, and forks, clones and archives may hold it. And the cost is real: the
  address is in **150 commits**, and rewriting the earliest changes every
  descendant -- **431 of the repository's 444** -- breaking the VPS deploy
  clone, every PR association, and every SHA this file and `CLAUDE.md` cite.

  **What the leak did prove is that the gate was looking for the wrong shape.**
  It runs gitleaks' default ruleset, which finds *credentials*; a host address
  is not one, so the gate that exists would not have caught this and would not
  catch the next. `.gitleaks.toml` now carries a `routable-host-address` rule
  that fails closed on anything outside loopback, the private and CGNAT ranges,
  link-local, multicast, reserved, and the RFC 5737 / RFC 2544 documentation
  blocks. Verified against the version CI pins (8.30.1, not the 8.21.2 first
  tried -- the older binary does not honour the `[[allowlists]]` form and
  reported fourteen findings that were all configuration, not content): the
  tree is clean, a planted address from a real routable block **is** caught,
  and an RFC 5737
  address passes. Both controls matter; a rule that flagged everything would
  pass the first alone.

  **And it caught its own documentation, which is how the sequencing lesson was
  learned.** The three checks were run, passed, and *then* this entry was
  written -- with two routable literals in it, quoted as examples. CI failed on
  exactly those two lines. The gate was right and the verification was stale:
  proving a scanner clean before the last edit proves nothing about what is
  pushed. Re-run it against `git archive HEAD`, which is the tree CI actually
  sees, rather than a working copy that still has to be committed.

  Two things fixed alongside it. The last routable placeholder in the tree --
  an APNIC-allocated address of the `1.2.x.x` shape, in a fixture and a doc
  comment -- is now an RFC 5737 one. And `lab-compose.yml` / `.lab-state/` are excluded by
  path: they are gitignored and CI never sees them, but they carry generated
  regtest credentials, so a developer who had run the lab watched
  `npm run verify:secrets` fail on seven findings that were neither real nor
  committed. A gate that cries wolf locally is a gate people stop running.

  **What is still owed is the part that actually reduces exposure.** The
  addresses are public by protocol; which *ports answer* on them is not. Two of
  the eight fullnodes run `ufw` with `-P INPUT DROP` and the other six have no
  filtering at all (§4, `CLAUDE.md`). That is a fleet touch -- a wrong rule
  drops quorum connections and disturbs the DKG mesh -- so it rides the roll
  after 10608 rather than being done piecemeal now.

  Repeatable: the history scan walks every blob in `git rev-list --all`,
  keeps addresses outside the documentation and private ranges, and prints
  masked. It found exactly two, and one of them was the placeholder.
- **`defcon-enable-staking`: fixed in the repo, installation owed** (see §3).
  The toggle bug is closed by `ops/defcon-enable-staking` and its test suite;
  the VPS (two units) and the 8 fullnode stakers still run the old copy until
  it is installed with the unit line changed to `ExecStartPost=-…`.
- ~~**The other four writing services have no integration test.**~~ **Done
  2026-09-07.** `sync`, `masternodePoller`, `mnListDiff` and `chainLock` now
  each write through the real models into a real MongoDB and read every
  field the views depend on back (`server/src/integration/*.integration.test.ts`),
  including the reorg rollback's deletes, the walker's replay and the
  watcher's two pipeline backfills. Each suite was proven able to fail:
  renaming one schema path per model (`missedProTxHashes`, `dslBanHeight`,
  `operatorLabel`, `chainLockLlmqName`) made its suite fail and nothing else.
  The first run found a real defect: the ZMQ derivation woke itself in a
  tight loop whenever an observation's block was not indexed yet -- the
  normal order of events -- and the test worker ran out of heap. Fixed in the
  same change with a unit regression that hangs on the old code.
- ~~**The `action_*` audit events are declared and never written, and the
  `SimulationResumeDirective` is computed and never read.**~~ **Closed
  2026-09-07 by removal** (the user's call: take them out and document that
  they do not exist). The four event types, the `action` stream value and the
  `actionAfter` slot are gone from the audit model -- nothing had ever written
  them, and every stored event is a run event -- and the directive is gone from
  the reconcile result, which nothing had ever read. The `SimulationAction`
  projection stays: it is real and used. What the docs now say, as a decision:
  actions have no append-only trace, and a run interrupted without expiring
  waits for a person. Wiring either in later is its own piece of work.
