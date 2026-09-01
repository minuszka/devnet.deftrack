# Szimulátor mérési pipeline

## Cél

A pipeline ugyanabból a nyers, magassághoz kötött bizonyítékból készít baseline- és fault-ablakot. A számítás tiszta és determinisztikus: azonos bizonyíték, aktív LLMQ-profil, fault-határok és generálási idő mindig byte-azonos riportot és SHA-256 ujjlenyomatot eredményez.

## Ablakok

- A fault kezdő és záró magassága az executor által rögzített, blokkhassel együtt ellenőrzött anchor.
- A baseline közvetlenül a fault előtti blokknál ér véget.
- Hossza az aktív, kódban regisztrált ChainLock-LLMQ három DKG-intervalluma. A hívó ezt nem rövidítheti le.
- A fault első két blokkja warm-up, a fault utáni négy blokk cooldown; egyik sem kerül az összehasonlító mintába.
- Reorg, hiányzó vagy nem egyértelmű boundary block esetén a lezárás fail-closed.

## Snapshotok

- DKG: formation rate, health, leghosszabb profilon belüli hibasorozat, büntetett tagok és profilonkénti bontás.
- ChainLock: coverage, ZMQ/poll/unknown forrás, observed-time p50/p95 és külön chain-timestamp p50/p95. A két időalap sosem kerül közös átlagba.
- PoSe/DSL: eseménytípusok, pontos `listdiff` kontra polling forrás, commitment-konvergencia és missed bitek.
- Staking: chain-time blokkidő, stallok, koncentráció script- és — ahol bizonyítható — hostszinten.
- Data quality: hiányzó/dupla magasság, peer coverage, dupla observation, stale vagy hiányzó host, ZMQ-gap és observed-time latency coverage.

A publikus staking-riport sem scriptet, sem hostazonosítót nem tartalmaz.

## Érvényesség és eredmény

Az `expected` a DryRun változtathatatlan quorum-hatásbecsléséből származik. Az `actual` ugyanazon metrikák baseline/run összevetése. A riport csak akkor lehet sikeres, ha:

1. az aktív LLMQ profil baseline-jában megvan három eldőlt DKG-kör;
2. a baseline ChainLock minimuma teljesül;
3. mindkét ablak data-quality kapuja zöld;
4. a várható és tényleges eredmény kiértékelhető és egyezik.

Hiányos telemetria mellett a protokolleredmény látható marad, de `measurementValid=false` és `success=false`.

## Tárolás és publikus határ

- A lezárt riport append-only `SimulationMeasurementReport` dokumentum.
- Az azonos run + fault anchor más tartalommal konfliktus, nem felülírás.
- A `verify` újra lekéri a bizonyítékot és összeveti mindkét ujjlenyomatot.
- Publikus olvasás: `GET /api/v1/simulations/:runKey/report`.
- A DTO explicit allowlistből épül; nyers evidence, target snapshot, hostRef, unitRef, proTxHash és staking script nem kerülhet a válaszba.
- Mutáló mérési HTTP-route nincs. A `finalize` belső orchestrator-hívás; a 8. napi executor adja majd át a hiteles block anchorokat.
