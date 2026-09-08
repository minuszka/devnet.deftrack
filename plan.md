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
| **InstantSend security** | A conflicting spend offered to a node that never saw the first one. The mempool refuses a double spend anyway, so only this shows InstantSend did the refusing | a partition fault; the wrapper does delay/loss only |

**Running (2026-09-07): `absent-epoch-rate-post-208-2026-09-07`**, observation
only, from boundary 9192 to 10608 — 60 Sentinel epochs, about 57 hours, closing
around the evening of 2026-09-09 at the measured 152 s block interval. It asks
whether the one block of report-pool margin that #207 and #208 bought is enough
to stop the network losing one hour in twenty (7 absent epochs in 145 before the
roll). Intermediate readings at 9648, 9888 and 10128, none of them conclusive by
the run's own arithmetic.

**What the run actually forbids, and what this file added on top.** The frozen
`expected` excludes "any epoch containing a deliberate intervention" and names
E4b, because that one applies a real network fault to a quorum member: no roll,
no restart, no revive, no fault. This file also said "no InstantSend probe",
which the record does not — a correction made 2026-09-08 rather than left to be
read as the run's rule. **The probe is still held back, for a mechanism reason
worth stating:** it sends twenty transactions that each open an InstantSend
signing session on the same masternodes whose *signing convergence* this run
measures, and the effect being looked for is about five per cent. Adding
signing traffic to the window that measures signing is how a true number
becomes unreadable. It costs 36 hours to wait, and nothing needs the probe
sooner.

The collector is a transient systemd unit on the VPS (`epoch-watch`) and does
not survive a reboot; the epoch table itself comes from the chain and can be
re-read.

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
  2026-09-08 there are eleven, and two of them are a reason to roll.** The
  paragraph above was written when `37e845beb0` stood alone; #210–#219 have
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

  **Neither changes block validity, so neither needs an activation height.**
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
  workstation's WSL (never committed).

  | artefact | bytes | md5 |
  |---|---|---|
  | `DEFCON-seed/src/defcond` | 396,488,688 | `c2ebc951790bc95f631585b70b85cca3` |
  | `DEFCON-seed/src/defcon-cli` | 20,510,344 | `2e29c5ab5eea95a3205c4bfb0a898dc4` |
  | `DEFCON-fleet/src/defcond` | 393,064,336 | `aefb020cd36e6ee168719e1cc74177a8` |
  | `DEFCON-fleet/src/defcon-cli` | 20,510,344 | `3e85cac8d906f3cb49b35e2812d5121b` |

  **The build is proven to have happened, not assumed.** Seed: 157 `CXX` lines,
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

## 4. Current state of the network

- **Every daemon runs `c739d9f504` (#208) since 2026-09-07, height 9147.**
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
