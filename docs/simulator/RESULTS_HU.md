# Scenario-katalógus, eredményértelmezés és mainnet-biztonsági bizonyíték

A 22. nap dokumentációs csomagjának második fele; az üzemeltetési részt az
[OPERATIONS_HU.md](OPERATIONS_HU.md) tartalmazza. A katalógus a
`scenarioRegistry.ts` mai állapota; a számok onnan valók, nem fejből.

## 1. Scenario-katalógus

Közös korlátok (`SCENARIO_LIMITS`): legfeljebb 20 célpont, a kiesés hossza
legfeljebb `MAX_OUTAGE_BLOCKS = 6` blokk (devneten 900 s, a 15 s-os laboron
90 s), legfeljebb 5 staker, 5 izolált node, 5 flapping-ciklus, 2000 ms
latencia, 1000 ms jitter, 30% csomagvesztés.

| Scenario | Kockázat | Mit csinál | Paraméterek |
|---|---|---|---|
| `mn-stop` | medium | Egy vagy több masternode leáll, majd újraindul | `count`, `durationSeconds`, `targetIds?` |
| `host-outage` | high | Egy regisztrált host minden engedélyezett szolgáltatása leáll; a seed sosem | `anchorTargetId`, `durationSeconds`, `expectedMasternodes?` (elutasít, ha a host masternode-száma közben változott) |
| `quorum-member-outage` | high | A *jelenlegi* quorum tagjai állnak le DKG- vagy ChainLock-aktivitás köré időzítve | `count`, `phase` (`dkg` \| `chainlock`), `durationSeconds` |
| `staker-stop` | medium | Stakerek leállnak és újraindulnak | `count` (≤ 5), `durationSeconds` |
| `restart-flapping` | high | Ismételt le-fel kapcsolgatás | `role`, `count` (≤ 10), `cycles` (≤ 5), `downSeconds` 5–60, `upSeconds` 5–120 |
| `network-degradation` | high | Latencia, jitter, veszteség csak a P2P-interfészen, egy qdiscként | `role`, `count` (≤ 10), `durationSeconds`, `latencyMs`, `jitterMs`, `lossPercent`, `correlationPercent` |
| `node-isolation` | high | A kiválasztott node-ok elvágva a többi regisztrált célponttól (tc `prio` + peerenkénti `u32` szűrő, egress-oldali) | `count` (≤ 5), `durationSeconds` |
| `clear-recover` | low | Ismert szimulátor-faultállapot törlése a megadott célpontokon | `targetIds` |
| `dsl-fault` | medium | Sentinel Layer fault a node teszthorgán át: visszatartott/késleltetett válasz vagy jelentés, kihagyott commitment | `faultKind`, `count`, `epochs` 1–3, `param?` (a `*-delay` fajtáknak, blokkban), `targetIds?` |

A `dsl-fault` fajtái és a várt láncbeli hatásuk, ahogy a dry-run
deklarálja (`impact.dsl`):

| `faultKind` | Mit tesz a node | Amit a commitmentnek mutatnia kell |
|---|---|---|
| `response-drop` | nem válaszol az epoch bejelentésére | a célpont bitje, senki másé |
| `response-delay` | `param` blokkot késik a válasszal | a célpont bitje, ha `param ≥ 18` (cutoff-pozíció); különben tiszta |
| `report-drop` / `report-delay` | a saját jelentéseit másokról ejti/késlelteti | tiszta commitment: egy node nézete változik, a pool verdiktje nem |
| `commitment-skip` | bányászként kihagyja a commitmentet | nem jósolható: más bányász commitolhat; a jelentés `not-evaluable` |

Presetek (`SCENARIO_PRESETS`): `dkg-minus-16`, `dkg-minus-17`,
`chainlock-minus-19`, `chainlock-minus-20` (quorumtag-kiesés a Q60
küszöbök két oldalán, 180 s), `host-10-masternodes`, `one-staker-outage`,
`multi-staker-outage`, `dsl-response-drop-1`, `dsl-report-drop-1`,
`dsl-commitment-skip-1`. A preset csak paraméterkészlet: a célpontok a
seedből és a scenario-névtérből választódnak, ugyanaz a seed ugyanazt a
listát adja, és a terv ujjlenyomata (`planFingerprint`) a rekordban marad.

## 2. Az eredmény olvasása

A jelentés (`SimulationMeasurementReport`, publikus DTO-n át redaktálva)
négy részből áll. Az olvasás sorrendje ugyanez.

### 2.1 Ablakok

`windows.baseline` a fault előtti szakasz (legalább 72 blokk, 3 DKG-kör,
80% ChainLock-lefedettség, 0,9 medián health, 0 PoSe-revive – ez a
`baselineGate`); `warmupExcluded` a fault első két blokkja;
`observation` onnan a `recoveredTip`-ig; `cooldownExcluded` négy blokk
utána. Ami az ablakokon kívül van, nincs a jelentésben – egy hosszabb
hatás másik mérés.

### 2.2 Pillanatképek és delta

`baseline` és `observation` ugyanazt a szerkezetet hordozza:

- **dkg** – körök `formed / failed / pending / impossible`, `formationRate`,
  medián és legrosszabb `healthRatio`, `membersPunished`, profilonként. A két
  számot mindig együtt kell olvasni: egy 1.00 formálódási arány 0,24 medián
  health mellett büntető hálózatot jelent, nem egészségeset.
- **chainLock** – lefedettség (`lockedBlocks / eligibleBlocks`), forrás
  (`zmq` / `poll`), két latencia: `observedTimeLatency` (helyi
  blokk-érkezéstől helyi lock-érkezésig, ms) és `chainTimestampLatency`
  (blokk-időbélyegtől, s). Az első a műszer, a második a lánc.
- **pose** – események: `banned`, `revived`, `penalty_up/down`, és a
  Sentinelé: `service_missed`, `service_recovered`, `service_suspended`,
  `service_banned`; `distinctSubjectsAffected`.
- **dsl** – epochok, `committed / absent`, `convergenceRate`,
  `totalMissedBits`, `maximumMissedRatio`, és `guardedEpochs`: azok a
  commitolt epochok, ahol a nevezett arány elérte a 15%-os mass-outage
  küszöböt. Ezekben a lánc nevezett, de nem büntetett; a bitjeik a hálózat
  időjárása, nem a fault aláírása.
- **staking** – lánc-idő alapú intervallumok, stallok, staker-koncentráció.
- **dataQuality** – hiányzó/dupla magasságok, peer-megfigyelés lefedettség,
  observed-time ChainLock-latencia lefedettség (küszöb 80%), ZMQ-rések.
  A `reasons` lista mondja meg, miért nem elégséges.

`delta` az `observation − baseline` különbség a fő mutatókra; a `null`
azt jelenti, hogy valamelyik oldalon nem volt minta, nem azt, hogy nulla a
változás.

### 2.3 Elvárás kontra valóság

`expectedVsActual` három sort hordoz, mindegyik `expected / actual /
matched / reason`:

- **dkg** és **chainLock** – az elvárás a dry-run margójából jön: a
  túlélő quorumtagok a profil küszöbe fölött → `available`, alatta →
  `degraded`; `unknown`, ha a tagság a dry-run idején nem volt ismert. A
  valóság `degraded`, ha a formálódási arány, illetve a lefedettség 0,8 alá
  vagy az alapvonal −0,1 alá esett.
- **dsl** – csak a `dsl-fault` tervekhez deklarált; a megfigyelési ablak
  nem-guardolt epochjai fölött nézi, hogy a commitmentek pontosan a várt
  célpontokat nevezték-e és senki mást. `degraded` itt azt jelenti, hogy „a
  lánc nevezett valakit”, ami egy válasz-faultnál a helyes eredmény. Nem
  értékelhető, ha nincs nem-guardolt epoch, ha a nevezettek feloldatlanok,
  vagy ha a fajta nem jósolható (`commitment-skip`).
- **overall** – `matched`, ha minden *deklarált* sor egyezett; a
  `dsl` sor csak akkor számít bele, ha a terv Sentinel-elvárást deklarált,
  így egy hálózati fault jelentését nem teszi értékelhetetlenné egy kérdés,
  amit nem tett fel.

### 2.4 Verdikt

`verdict.measurementValid` akkor igaz, ha az alapvonal-kapu és mindkét
ablak `dataQuality.sufficient` teljesül; `verdict.success` ezen felül
`overall === 'matched'`. A `reasons` lista minden okot kimond. Egy
érvénytelen mérés nem kudarc: azt jelenti, hogy a műszer nem látott eleget,
és a futamot meg kell ismételni vagy a rést dokumentálni – nem azt, hogy a
hálózat rosszul viselkedett.

Tipikus olvasatok:

| Ami a jelentésben áll | Mit jelent |
|---|---|
| `dkg` matched `available`, `chainLock` matched `available` | a fault a küszöb fölött hagyta a quorumot, és a lánc úgy is viselkedett |
| `dkg` expected `degraded`, actual `available` | a dry-run alábecsülte a hálózatot: a margó negatív volt, mégis formálódott – a mismatched itt *jó hír*, de mismatch |
| `dsl` matched, `dkg`/`chainLock` `unknown` | a Sentinel az elvárás szerint viselkedett, de a quorum-margó ismeretlen volt; `overall` not-evaluable, a Sentinel-eredmény önmagában érvényes |
| `guardedEpochs > 0` | a Sentinel szelepe nyitva volt; az adott epochok bitjeit ne tulajdonítsd a faultnak |
| `service_missed` az elvárt célponton, `service_recovered` egy epochhal később | a Sentinel egy-epochos válasz-faultjának teljes pályája |
| `dataQuality.reasons` ChainLock-latencia lefedettség | műszer-hiány, nem hálózati; a fedetlen minták a lock-before-first-sight versenyből vagy a watcher indulása előtti lockokból jönnek |

A jelentés két ujjlenyomatot hordoz: `evidenceFingerprint` a bemenő
bizonyíték, `reportFingerprint` a kimenet fölött. Ugyanaz a bizonyíték
ugyanazt a jelentést adja bármikor, bármilyen sorrendben olvasva; ez a
tulajdonság tesztelt, és ez teszi a jelentést újraszámolhatóvá, ha a
képlet később változik.

## 3. Mainnet-biztonsági bizonyíték

A szimulátor sosem érhet mainnetet. Ez nem szabály, hanem több egymástól
független retesz, amelyek mindegyike külön elég:

1. **Hálózat-retesz a control service-ben.** Élő futam csak `regtest`
   hálózatra hozható létre; a `create` elutasítja a `live && network !==
   'regtest'` kérést, és az `abort`/`recover` ág minden perzisztált átmenet
   *előtt* ellenőrzi a végrehajtó hálózatát (`assertExecutorNetwork`). Egy
   devnet-futam a laborvégrehajtón azonnal és auditáltan bukik.
2. **Konténer-retesz a labor végrehajtójában.** A `DockerLiveExecutor`
   csak a saját Compose-projektjének konténereit érinti
   (`allowedContainerProject`); üres érték esetén semmit. Egy máshol
   futó konténer neve célpontként nem elég: a projekt-címke is kell.
3. **A flotta-wrapper zárt szótára.** A `defcon-chaos` csak logikai
   azonosítókat fogad, a unit/interfész/port hármast root tulajdonú
   konfigból olvassa, a `tc`-t csak ismert alap-qdisc fölött futtatja, és
   minden művelet előtt helyreállítási rekordot ír, amelyet egy systemd-timer
   a hívó nélkül is lejárat. A sudoers csak ezt az egy programot delegálja.
4. **Nincs hitelesítő az explorer VPS-en.** Az explorer nem kap SSH-kulcsot
   a flottához; a szállítás a jump host külön komponense, privát
   inventoryval. A repository publikus, és nem hordoz címet, kulcsot vagy
   inventoryt.
5. **Szerep- és kockázati kapu.** `high` kockázatú scenariót csak
   `safety-admin` indíthat; a live lockot csak ő engedheti el kézzel;
   minden mutáló kérés idempotencia-kulcsot kér, és minden átmenet
   szereplővel auditált.
6. **Fail-closed végrehajtás.** Ami nem alkalmazható teljesen, az nem indul
   el (`UnsupportedLiveFaultError`, `NODE_BUILD_MISMATCH`, preflight
   `409`); a fault lease és a wrapper TTL egymástól függetlenül zárja a
   futamot, ha az orchestrator eltűnik.
7. **A Core-oldali teszthorog csak teszthálózaton él.** A Sentinel
   fault-injection (`-enablefaultinjection`) mainneten és testneten
   induláskor elutasítva, a `faultinject` RPC csak cookie-hitelesítéssel,
   és a mainnet-bináris konszenzus-sztring ujjlenyomata a horog nélkül és
   vele azonos (178 sztring, 21. nap).

Ami ebből *nem* következik: a devnet-flotta pilotja (13–14. nap) új
bizalmi határt nyit, és a fenti 3–4. pont ott bizonyítandó újra, egy hoston,
read-only lépésekkel, mielőtt bármi leáll.
