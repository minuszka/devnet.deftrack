# DeFCoN devnet hibaszimulátor – napi megvalósítási ütemterv

## Cél és sorrend

A fejlesztés sorrendje kötelezően:

1. automatikus kísérleti orchestrator (korábbi 4. pont);
2. Live Devnet Chaos (korábbi 2. pont);
3. DSL fault injection (korábbi 3. pont).

A már elkészült matematikai/Core-native szimulátort nem kell újraimplementálni:

`D:\www\defcon-chainlock-pose-scalability-testplan`

A fő explorer projekt:

`D:\www\devnet .deftrack`

Az ütemterv egy fejlesztő/AI folyamatos munkájával, review-zható napi commitokkal számol. A VPS-es napok csak külön felhasználói jóváhagyással kezdhetők meg.

## Kötelező biztonsági határ

- Mainneten minden hibainjektálás hard-disabled.
- A publikus explorer csak eredményeket mutathat; vezérlés kizárólag privát adminfelületről történhet.
- A publikus explorer VPS nem tárolhat fleet SSH-kulcsot.
- Nem lehet tetszőleges shell parancsot küldeni.
- Minden fault időkorlátos lease-t és hostoldali automatikus recoveryt kap.
- Wallet seedet, collateral-, owner- vagy BLS privát kulcsot nem tárolunk az explorerben.
- Éles VPS-en telepítés, szolgáltatásleállítás, hálózati szabály vagy új binary csak külön jóváhagyással történhet.

## 1. nap – audit és szerződések rögzítése

Feladatok:

- A két repository aktuális állapotának, ágainak és tesztparancsainak rögzítése.
- A meglévő `ExperimentRun`, admin route-ok, operator/host mapping és observer adatút felmérése.
- A meglévő Docker/netem/regtest elemek újrafelhasználási térképének elkészítése.
- Scenario-, target-, action- és run-adatszerződés megtervezése.
- Különválasztani a publikus read-only és a privát control API-t.

Napi eredmény:

- architektúra-dokumentum;
- végleges TypeScript interfészek terve;
- fenyegetési modell;
- nincs VPS-hozzáférés és nincs runtime-változtatás.

Elfogadási kapu: minden scenario csak allowlistelt, típusos paramétert fogadhat.

## 2. nap – persistent run state machine

Állapotok:

`draft -> preflight -> baseline -> armed -> fault_active -> observing -> recovery -> cooldown -> completed/failed`

Feladatok:

- Tiszta domain state machine implementálása.
- Érvényes és tiltott állapotátmenetek.
- Idempotens job/action azonosítók.
- Egyszerre egy aktív live experiment lock.
- Process restart utáni folytatás.
- Timeout és automatikus recovery állapot.

Tesztek:

- minden érvényes átmenet;
- tiltott átmenetek;
- dupla start;
- restart közbeni `fault_active`;
- timeout/recovery;
- abort több állapotból.

Elfogadási kapu: a state machine 100%-ban tesztelhető hálózat és VPS nélkül.

## 3. nap – adatmodellek és auditnapló

Feladatok:

- A meglévő `ExperimentRun` kompatibilis bővítése vagy külön `SimulationRun` modell létrehozása.
- `ScenarioDefinition`, `TargetSnapshot`, `ActionLog`, `PreflightResult`, `RecoveryResult`, `DataQualitySnapshot` sémák.
- Append-only action log.
- Optimistic locking/verziószám a versenyhelyzetek ellen.
- Retention és indexek megtervezése.

Elfogadási kapu: egy teljes dry-run minden állapota újraszámolható az auditadatokból.

## 4. nap – scenario registry és DryRun executor

Első scenario-k:

- egy MN stop/restart;
- N véletlen MN;
- teljes host kiesése;
- kiválasztott quorumtagok;
- staker stop;
- restart/flapping;
- latency/jitter/loss;
- izoláció;
- clear/recover.

Presetek:

- DKG -16 és -17 tag;
- ChainLock -19 és -20 tag;
- egy teljes 10 MN-es host;
- egy és több staker kiesése.

Feladatok:

- Erős Zod validáció.
- Korlátok: maximum célpont, időtartam, latency és packet loss.
- Dry-run hatásbecslés és célpontlista.
- A Core-native szimulátor eredményeire mutató, de azokat nem újraszámoló adapter.

Elfogadási kapu: a dry-run semmilyen külső állapotot nem módosíthat.

## 5. nap – preflight, baseline és célpontfeloldás

Preflight ellenőrzések:

- devnet név/genesis/chain identity;
- tip és szinkronállapot;
- explorer index lag;
- node binary hash egyezés;
- observer/data-quality;
- aktív MN-ek és hostok;
- másik aktív experiment hiánya;
- recovery mechanizmus elérhetősége.

Feladatok:

- Explicit `proTxHash -> host -> systemd unit -> P2P port` target registry.
- Random, host-, operator- és quorumtag-alapú feloldás.
- Baseline időablak és minimális minta követelménye.
- Warm-up/cooldown kizárási szabályok.

Elfogadási kapu: hiányos vagy bizonytalan target mapping esetén a futás nem élesíthető.

## 6. nap – admin control API és CLI

Feladatok:

- Privát API: create, validate, dry-run, arm, start, abort, recover, status, history.
- Idempotency key minden módosító kéréshez.
- CLI kliens fejlesztői használatra.
- Audit identity átadása.
- Read-only publikus runs/results endpoint különválasztása.

Biztonság:

- A jelenlegi admin API key csak szerver-szerver/CLI célra használható.
- Böngészőbe admin API key nem kerülhet.
- Rate limit és CSRF-képes szerződés előkészítése.

Elfogadási kapu: a teljes dry-run életciklus CLI-ből végigfut.

## 7. nap – mérési és összehasonlító pipeline

Feladatok:

- Baseline és run ablak automatikus kijelölése magasság alapján.
- DKG formation/health, ChainLock, PoSe, DSL, staking és data-quality snapshotok.
- A mérési pontossági javítások figyelembevétele: chain-time kontra observed-time, coverage, stale hostok.
- Várható kontra tényleges eredmény.
- A futás ne minősüljön sikeres mérésnek elégtelen telemetry mellett.

Elfogadási kapu: egy teljes szintetikus experiment jelentése determinisztikusan újraszámolható.

## 8. nap – Docker executor és fault lease

Feladatok:

- A meglévő Compose generator és `docker/netem.sh` becsomagolása típusos executorba.
- Container stop/start/restart.
- Latency, jitter, loss és clear.
- Minden fault job ID-val és lejárattal rendelkezzen.
- Ismételt apply/clear legyen idempotens.
- Crash után maradt faultok felismerése és takarítása.

Elfogadási kapu: az orchestrator leállítása után is automatikusan helyreáll a teszthálózat.

## 9. nap – Docker/regtest scenario-k

Futtatandó scenario-k:

- baseline;
- egy node restart;
- 5/10 node restart storm;
- latency és packet loss;
- 50/50 és 60/40 partition;
- staggered reconnect;
- DKG/ChainLock küszöbhatárok, amennyiben a laborméret támogatja.

Feladatok:

- Élő action log és metrikák.
- Abort minden scenario közben.
- Recovery és cooldown ellenőrzése.
- Ismételhetőségi teszt azonos seed/paraméter mellett.

Elfogadási kapu: Gate A – az orchestrator és Docker executor zöld, VPS még nem használható.

## 10. nap – privát adminpanel alapja

Feladatok:

- `/admin` felület, külön a publikus explorertől.
- Szerveroldali session; `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- CSRF-védelem.
- Cloudflare Access/VPN/reverse-proxy identity adapter.
- Dashboard: orchestrator, hostok, build hash, data quality, aktív fault.
- Runs lista és részletes action timeline.

Elfogadási kapu: böngészőbe sem admin kulcs, sem SSH credential nem kerül.

## 11. nap – adminpanel vezérlés és vészhelyreállítás

Feladatok:

- Scenario űrlap.
- Target preview és várható quorumhatás.
- Dry-run eredmény.
- Kétlépcsős megerősítés.
- Aktív fault countdown.
- `Abort & Recover` vészgomb.
- Recovery ellenőrzés és manuális beavatkozást kérő állapot.
- Viewer/operator/approver jogosultsági határ előkészítése.

Elfogadási kapu: Gate B – Docker scenario biztonságosan vezérelhető az adminpanelről.

## 12. nap – VPS wrapper és telepítőcsomag, telepítés nélkül

Elkészítendő:

- root tulajdonú `/usr/local/sbin/defcon-chaos` wrapper;
- `/etc/defcon-chaos/targets.conf` séma;
- szűk sudoers fájl;
- systemd recovery unit/timer;
- install, verify és uninstall szkript;
- SSH executor `BatchMode=yes` móddal;
- semmilyen `eval`, glob vagy tetszőleges unit/port elfogadása.

Hostoldali műveletek:

- stop/start/restart allowlistelt unitra;
- status;
- időkorlátos hálózati fault;
- jobhoz tartozó clear;
- automatikus expiry/recovery.

Elfogadási kapu: shellcheck, unit tesztek és lokális fake-systemd tesztek zöldek. Éles telepítés továbbra sincs.

## 13. nap – egyhostos, read-only VPS pilot

Ehhez külön felhasználói jóváhagyás szükséges.

Szükséges hozzáférés/információ:

- jump host SSH-elérés;
- egy pilot fullnode host;
- deployment user és egyszeri sudo;
- pontos MN/staker unitnevek;
- P2P portok és hálózati interfész;
- kiválasztott teszt-MN;
- maximális fault-idő;
- tesztidőablak.

Feladatok:

- wrapper telepítése csak a pilot hostra;
- target inventory ellenőrzése;
- status/preflight/dry-run;
- recovery timer kézi próbája ártalmatlan marker művelettel;
- ezen a napon még nem állítunk le node-ot.

Elfogadási kapu: Gate C – read-only ellenőrzés és recovery infrastructure zöld.

## 14. nap – egyhostos live pilot

Minden scenario előtt külön jóváhagyás szükséges.

Sorrend:

1. egy MN rövid stop/start;
2. orchestrator kapcsolat megszakítása aktív lease alatt;
3. hostoldali automatikus recovery igazolása;
4. egy staker rövid stop/start;
5. recovery után sync, peer, staking és PoSe állapot ellenőrzése.

Nem automatizálandó ezen a ponton:

- ProUpServTx/revive;
- wallet vagy BLS kulcs használata;
- hostszintű hálózati fault.

Elfogadási kapu: Gate D – egy node biztonságosan visszaáll emberi beavatkozás nélkül.

## 15. nap – fleet inventory és quorumtag-célzás

Feladatok:

- A 8 host teljes explicit inventoryja.
- Unit/port/proTxHash megfeleltetés ellenőrzése.
- Aktuális és következő quorumtagok feloldása.
- Random és quorumtag target selection bizonyítása.
- Célpontsnapshot befagyasztása arm-kor, hogy indulásig ne változzon észrevétlenül.
- Hostonkénti és összesített maximális célszám.

Elfogadási kapu: ugyanazt a quorumot minden megfigyelő ugyanazzal a taglistával oldja fel.

## 16. nap – biztonságos fleet scenario-k

Külön jóváhagyással:

- egy MN;
- 3 véletlen MN;
- egy teljes 10 MN-es host;
- 1/3/8 staker;
- flapping egy node-on;
- recovery és cooldown.

Minden futás után:

- service állapot;
- chain height;
- peer/MNAUTH;
- PoSe;
- DKG/ChainLock;
- observer/data-quality;
- manuális revive szükségessége.

Elfogadási kapu: Gate E – a generikus Live Devnet Chaos használható.

## 17. nap – hálózati fault pilot

Először Dockerben, majd egy jóváhagyott pilot porton:

- 100/500 ms latency;
- jitter;
- 1/5% loss;
- csak P2P-portra korlátozott izoláció;
- clear és expiry;
- controller crash közbeni automatikus helyreállítás.

Teljes interfészre vonatkozó `tc` szabály csak külön, explicit engedéllyel használható.

Elfogadási kapu: a host SSH/control útvonala nem zárható ki a faulttal.

## 18. nap – DSL fault-injection terv és Core tesztkeret

Core branch javaslat:

`test/devnet-dsl-fault-injection`

Feladatok:

- Fault state és expiry magasság szerinti modellje.
- `-enablefaultinjection=1` hard gate.
- Mainnet startup-rejection teszt.
- Regtest/devnet engedélyezési teszt.
- Helyi cookie-auth admin RPC terve: set/list/clear.
- Fault state ne kerüljön konszenzusadatba vagy persistent chainstate-be.

Elfogadási kapu: mainneten sem configból, sem RPC-ből nem aktiválható.

## 19. nap – DSL response/report faultok

Implementálás és teszt:

- response drop;
- report drop;
- response/report delay;
- idő- vagy magasságalapú automatikus expiry;
- cutoff előtti és utáni restart;
- clear/recovery;
- shadow mérőszámok exportja.

Elfogadási kapu: normál módban byte- és viselkedésszinten változatlan DSL útvonal.

## 20. nap – DSL commitment és konvergencia scenario-k

Implementálás és teszt:

- quorumtag kiesés;
- eltérő helyi report-pool;
- commitment kihagyása tesztmódban;
- 1/2/3 missed epoch;
- missed utáni recovery;
- false ONLINE/MISSED mérés;
- pool hash egyezés hostonként;
- signing és miner-reprodukció elkülönítése.

Elfogadási kapu: minden fault explicit scenario ID-val jelenik meg a telemetryben és auditban.

## 21. nap – DSL Docker/regtest end-to-end

Feladatok:

- Új Core binary csak laborban.
- Orchestrator DSL executor.
- DKG-fázisra/magasságra időzítés.
- Baseline, fault, recovery, cooldown.
- Teljes automatikus jelentés.
- Restart után fault state és recovery ellenőrzése.

Elfogadási kapu: Gate F – DSL faultok zöldek izolált laborban.

## 22. nap – devnet DSL pilot és dokumentáció

Csak külön jóváhagyással:

- binary reproducible build és hash;
- egy pilot host;
- fault injection alapból kikapcsolva;
- read-only RPC/gate ellenőrzés;
- egy alacsony kockázatú response/report fault;
- automatikus expiry/recovery;
- csak ezután mérlegelhető fleet rollout.

Dokumentáció:

- admin használat;
- install/uninstall;
- recovery runbook;
- vészleállítás;
- scenario katalógus;
- mainnet safety proof;
- ismert korlátok;
- eredményértelmezési útmutató.

## Napi átadási protokoll modellváltáshoz

Minden munkanap végén kötelező frissíteni:

`docs/SIMULATOR_HANDOFF.md`

Tartalma:

```text
Aktuális nap/fázis:
Branch és HEAD:
Elkészült:
Módosított fájlok:
Futtatott tesztek és eredményük:
Nyitott hibák:
Következő pontos feladat:
Külső állapot/VPS-művelet történt-e:
Aktív fault vagy recovery timer:
Felhasználói jóváhagyás szükséges-e:
```

További szabályok:

- Naponta legalább egy review-zható commit.
- A handoff tartalmazza a pontos tesztparancsokat, de semmilyen secretet.
- Új modell első lépése: roadmap, handoff, `git status`, utolsó commit és aktív jobok ellenőrzése.
- Új modell nem ismétli meg a kész napokat, hanem a handoff `Következő pontos feladat` sorától folytatja.
- Félbehagyott live fault esetén minden fejlesztés előtt recovery és hostállapot-ellenőrzés történik.
- VPS-hozzáférés vagy külső állapot hiánya nem jogosít fel feltételezésre vagy veszélyes kerülőútra.

## Kötelező tesztkapuk minden nap végén

Az érintett rétegtől függően:

```bash
npm run typecheck
npm test
npm run build
```

Core-változtatás esetén ezen felül célzott C++ unit/functional tesztek. Docker/VPS scenario esetén automatikus recovery-ellenőrzés és `status` riport kötelező.

## Első folytatási pont

Az implementáció az 1. nappal indul. Az első 12 nap biztonságosan elvégezhető éles VPS-módosítás nélkül. A 13. nap előtt meg kell állni, átadni a pilot telepítési tervet, és külön jóváhagyást kérni.
