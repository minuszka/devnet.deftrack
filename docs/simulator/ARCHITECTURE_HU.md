# Devnet Simulator – architektúra

Állapot: **1. napi tervezési alap, 2026-09-05-én a megvalósult kódhoz igazítva.**
A terv egy jump-hoston futó orchestrator workert és SSH-n keresztül vezérelt
node-wrappert rajzolt; **egyik sem létezik**. Ami létezik, azt az alábbi
„Mi épült meg valójában" szakasz írja le, és a rajzon is az szerepel. A többi
rész terv maradt, és ott is annak van jelölve.

Ág: `feat/devnet-chaos-orchestrator`
Hatókör: automatikus kísérlet-orchesztrátor → Live Devnet Chaos → DSL fault injection

## Cél

A rendszer előre meghatározott, időkorlátos és automatikusan visszaálló hibajelenségeket indítson a DeFCoN devneten, majd a már meglévő explorer-adatokból reprodukálható mérési eredményt készítsen. Nem általános VPS-adminisztrációs felület és nem távoli shell.

Az első kiadás fő biztonsági szabálya:

> Az admin csak típusos, allowlistelt szcenáriót indíthat. Sem a böngésző, sem az explorer szervere nem küldhet tetszőleges shell-parancsot a node-oknak.

## Mi marad külön

- Az `ExperimentRun` a mérés deklarációja és eredménye marad: magasságtartomány, profil, résztvevők, baseline és számított outcome.
- Az új `SimulationRun` az élő futtatás állapotát tárolja: preflight, ütemezés, végrehajtás, recovery és cooldown.
- Az új `SimulationAction` append-only végrehajtási napló. Egy action pontosan egy allowlistelt műveletet jelent.
- A `HostStatus` observer read-only telemetria marad. Nem kap SSH-kulcsot, vezérlő tokent vagy rendszer-módosítási jogot.
- A privát target-regiszter tartalmazza a host-, systemd-unit- és port-hozzárendelést. Ezt a publikus API soha nem adja vissza.

Az elkülönítés oka: a mérési eredmény utólag stabil és auditálható, miközben az orchesztráció szükségképpen sok átmeneti állapottal, retryjal és lease-szel dolgozik.

## Komponensek és bizalmi határok

```text
Publikus internet
  └─ Explorer UI ── read-only ──> Public Results API

Privát admin-hozzáférés
  └─ Admin UI ── session + CSRF ──> Control API
                                      │
                                      ▼
                                    MongoDB
                              SimulationRun/Action
                                      ▲
                                      │ ugyanabban a processzben
                                      │
  DockerLiveExecutor ──────────────────┘
        │
        └─ fájl-sorba írt parancs ──> node-lokális wrapper a labor konténerében
                         │
                         ├─ netem az adott konténer saját interfészén
                         └─ a wrapper saját TTL-watchdogja állít vissza

Node-ok ── read-only státusz ──> Observer ingest API ──> HostStatus
```

### Public Results API

- Bejelentkezés nélkül olvasható futáslista, státusz, idősor és aggregált eredmény.
- Nem mutat belső IP-t, SSH-nevet, systemd-unitot, tokent vagy nyers végrehajtási hibát.
- Nem tartalmaz start/stop/retry/control végpontot.

### Control API

- A meglévő `/api/v1/admin` útvonalak szerveroldali API-key védelme a CLI ajtaja,
  és ezen az ajtón a middleware **elutasít minden `Origin` és `Cookie` fejlécet** —
  ez az, ami a kulcsot böngészőből használhatatlanná teszi.
- A böngészős admin panel megépült: rövid életű session cookie plusz CSRF-token
  minden módosító kérésen (`middleware/adminSession.ts`). Nem „későbbi" többé.
- Csak regisztrált `scenarioId` + validált paraméterek fogadhatók el.
- A Control API nem rendelkezik fleet SSH-kulccsal, és nem futtat parancsot közvetlenül.

### Mi épült meg valójában (2026-09-05)

**Két executor van, és egyik sem SSH-t használ.**

- `dryRunExecutor` — tervez és nem hajt végre semmit. Ez adja az
  action-listát, a hatásbecslést és a küszöb-margókat.
- `dockerLiveExecutor` — az egyetlen élő executor, és a **Docker-labort** hajtja
  (`allowedContainerProject` kapuval). A parancsokat egy fájl-alapú sorba írja,
  amit a konténerben futó wrapper vesz ki; a fault valódi visszaállítója a
  wrapper saját TTL-watchdogja, az executor recovery-je csak megerősítés.
- **Az élő executor ma netem-only.** A `service-stop` és a partíciós faultok
  fail-closed módon el vannak halasztva: a terv fordítása előre eldobja őket,
  nem félúton.

A jump-hoston futó orchestrator worker, a worker token és az SSH-n hívott
node-wrapper **terv maradt**. Ami ebből létezik, az az `ops/chaos` csomag: egy
allowlistelt root parancs és egy SSH forced-command wrapper, telepítve egyetlen
pilot hosztra — de a szimulátor nem hívja, kézzel vagy szkriptből használjuk.
A kettő összekötése önálló munka, saját jóváhagyással.

### Node-oldali wrapper (a labor konténerében; a devnet-pilot csomag külön)

- Nem fogad shell-fragmentet, csővezetéket, átirányítást vagy szabad fájlútvonalat.
- Ellenőrzi a hálózatot, a unitot, az interfészt, a célportot, a célhalmaz méretét és a maximális időtartamot.
- Minden hibát lejárati idővel telepít; lejáratkor a worker nélkül is visszaállít.
- A cleanup idempotens, és eltávolítja a runhoz tartozó qdisc/tűzfalszabály/state fájlokat.
- Mainneten hard-fail: sem konfigurációval, sem API-kéréssel nem kapcsolható át.

## Állapotgép

```text
draft
  └─> preflight
        ├─> rejected
        └─> scheduled
              └─> baseline
                    └─> armed
                          └─> fault_active
                                └─> observing
                                      └─> recovery
                                            └─> cooldown
                                                  └─> completed

bármely aktív állapot ──> aborting ──> recovery ──> aborted | failed
```

Alapszabályok:

- Egy időben legfeljebb egy élő, node-okat módosító futás lehet. Modell- és dry-run teszt futhat mellette.
- Minden állapotváltás optimista `revision` ellenőrzéssel történik.
- A worker claim lease időkorlátos. Lejárt lease újra claimelhető, de ugyanaz az action idempotens marad.
- A `recovery` állapot kötelező akkor is, ha a fault aktiválása részben vagy teljesen hibázott.
- `completed` csak sikeres recovery és cooldown után állítható be.
- A vészleállítás nem egyszerű `cancel`: először visszaállít, majd `aborted` lesz.

## Végrehajtási sorrend

1. A Control API immutable target snapshotot készít a regiszterből.
2. A preflight ellenőrzi a hálózatot, chain heightot, node buildet, observer frissességet, quorum-/szinkronállapotot és a worker elérhetőségét.
3. A baseline szakasz létrehozza vagy összeköti az `ExperimentRun` rekordot.
4. A rendszer determinisztikus action-listát készít; ugyanazon seed és snapshot ugyanazt a listát adja.
5. A worker sorban claimeli és végrehajtja az actionöket.
6. Az observer és az explorer meglévő mérései rögzítik a hatást.
7. Recovery után a rendszer külön ellenőrzi, hogy nincs maradt qdisc/tűzfalszabály és minden elvárt unit fut.
8. Cooldown végén lezárja az `ExperimentRun`-t, majd kiszámítja az outcome-ot és a baseline-összehasonlítást.

## Target-regiszter

A jelenlegi `DevnetOperator` rekord jó megjelenítési név/proTx kapcsolat, de nem vezérlési inventory. A vezérléshez külön, privát regiszter kell:

- stabil `targetId`;
- operator- és proTx-kapcsolat;
- privát `hostRef`, nem feltétlenül maga az IP;
- systemd unit és P2P/RPC szerep;
- szerepkör: MN, staker, seed, observer-only;
- engedélyezett action-capabilityk;
- hálózati azonosító és build policy;
- `enabled`/maintenance állapot.

A futás kezdetén snapshot készül, így egy futó kísérlet céljai nem változnak meg attól, hogy közben átírják a regisztert.

## Újrahasználati térkép

| Meglévő elem | Új szerep | Döntés |
| --- | --- | --- |
| `ExperimentRun` + outcome service | baseline, mérési ablak, eredmény | változatlan mérési rétegként újrahasználni |
| `DevnetOperator` | proTx és emberi címke | target-regiszterhez hivatkozás, nem vezérlési forrás |
| `HostStatus` observer | preflight és recovery bizonyíték | read-only marad |
| `/api/v1/admin` API-key middleware | kezdeti gép–gép védelem | böngészős adminhoz session/CSRF réteg kell |
| `ops/fleet-deploy.sh` inventory-minta | jump host, hostlista, unit-séma | a topológia újrahasználható, a tetszőleges root shell nem |
| `docker/generate-compose.py` | lokális többnode-os laborkörnyezet | Day 6–8 Docker executor alapja |
| `docker/netem.sh` | latency/jitter/loss prototípus | logikája portolható, biztonságos wrapperként újraírni |
| `regtest/scenarios.json` | scenario-paraméterek és tesztmátrix | registry-be emelni, sémával validálni |
| Core-native `CalculateQuorum` modell | várható quorum/PoSe eredmény | dry-run és oracle jellegű előellenőrzés |

## Első implementálható szcenáriók (terv) és ami megvalósult

A terv öt `snake_case` szcenáriót nevezett meg. A registryben **nyolc** van,
más nevekkel; a leképezés és az eltérések a `CONTRACTS_HU.md`-ben állnak. Ami
itt fontos, az egy pontatlanság, amit a terv szövege hordozott:

> „késleltetés és jitter **kizárólag a devnet P2P portra**"

Ez **a devnet chaos-wrapper tulajdonsága**, nem a laboré. Az `ops/chaos`
wrapper valóban egy `u32` szűrővel a célpont saját *forrás*portjára szűkíti a
netemet, elérhetetlen `prio` sávban — épp azért, mert egy megosztott NIC-en a
szomszédos szolgáltatásokat, köztük az operátor SSH-ját, nem szabad megzavarni;
ez egyszer már megtörtént. A **laborban** viszont a netem a konténer **saját
interfészére** kerül, portszűrő nélkül: egy konténer egy node, tehát nincs
szomszéd, akit védeni kellene, és egy interfészen egyébként is egyetlen qdisc
lehet.

Aki tehát a labor viselkedéséből következtet arra, mit tesz egy devnet-fault,
két különböző konstrukciót olvas össze.

Az MVP-ben minden szcenárióhoz rögzíteni kell a maximális target-számot,
időtartamot, kockázati osztályt, recovery-módot és szükséges preflight
checkeket.

## Telepítési lépések és jogosultság

- 1–12. nap: kizárólag lokális implementáció, mock/Docker/regtest. Nincs VPS-hozzáférési igény.
- 13. nap: egyetlen pilot node, külön felhasználói jóváhagyással; wrapper és watchdog telepítés.
- Fleet rollout csak sikeres pilot, recovery-teszt és külön jóváhagyás után.
- A fejlesztéshez nem kell wallet seed, privát kulcs, masternode operator key vagy RPC wallet-hozzáférés.
- A későbbi pilothoz jump-host SSH és egy korlátozott devnet target szükséges, de az explorer környezetébe ezek a kulcsok nem kerülnek.

## Nem cél az első kiadásban

- Mainnet vagy testnet hibainjektálás.
- Tetszőleges parancs, scriptfeltöltés vagy fájlkezelő adminfelület.
- Automatikus ProUpServTx, collateral-, wallet- vagy operator-key művelet.
- PoSe-ban lévő node automatikus revive-ja.
- Kontrollálatlan binárisfrissítés a futás részeként.
- Egyszerre több, egymást átfedő élő kísérlet.

## Elfogadási kapu a kódolás előtt

- A scenario-registry zárt és típusos.
- A publikus és privát DTO-k külön vannak definiálva.
- Az explorer nem birtokol SSH-kulcsot.
- Minden módosító actionnek van TTL-je és idempotens cleanupja.
- A hálózati guard buildben és futásidőben is devnet/regtest értékre korlátoz.
- Az `ExperimentRun` mérési szemantikája nem változik az orchesztrátor kedvéért.
