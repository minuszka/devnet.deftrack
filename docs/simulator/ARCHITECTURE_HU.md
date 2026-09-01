# Devnet Simulator – architektúra

Állapot: 1. napi tervezési alap, implementáció előtt

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
                                      │ outbound poll, szűk worker token
Privát jump host                       │
  └─ Orchestrator worker ──────────────┘
        │
        └─ SSH ──> allowlistelt root wrapper a kiválasztott devnet node-okon
                         │
                         ├─ időkorlátos netem/tűzfal/restart művelet
                         └─ független watchdog és automatikus cleanup

Node-ok ── read-only státusz ──> Observer ingest API ──> HostStatus
```

### Public Results API

- Bejelentkezés nélkül olvasható futáslista, státusz, idősor és aggregált eredmény.
- Nem mutat belső IP-t, SSH-nevet, systemd-unitot, tokent vagy nyers végrehajtási hibát.
- Nem tartalmaz start/stop/retry/control végpontot.

### Control API

- A meglévő `/api/v1/admin` útvonalak szerveroldali API-key védelme jó alap CLI-hoz, de böngészős adminhoz önmagában nem elég.
- A későbbi admin panel rövid életű sessiont, CSRF-védelmet, rate limitet és auditált szerepkört kap.
- Csak regisztrált `scenarioId` + validált paraméterek fogadhatók el.
- A Control API nem rendelkezik fleet SSH-kulccsal, és nem futtat parancsot közvetlenül.

### Orchestrator worker

- A jump hoston fut, mert ott van a privát fleet inventory és a node-okhoz szükséges hozzáférés.
- Kifelé kezdeményez kapcsolatot: claimeli a várakozó actionöket, heartbeatet küld és riportálja az eredményt.
- Szűk jogosultságú worker tokent használ, amely nem admin- és nem observer-token.
- Egy actiont `actionId` alapján idempotensen hajt végre.
- A node-on kizárólag az allowlistelt wrapper fix alparancsait hívja strukturált argumentumokkal.

### Node-oldali wrapper

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

## Első implementálható szcenáriók

1. `service_restart`: allowlistelt daemon unit kontrollált leállítása és visszaindítása.
2. `network_latency`: időkorlátos késleltetés és jitter kizárólag a devnet P2P portra.
3. `packet_loss`: korlátozott csomagvesztés a devnet P2P forgalmon.
4. `provider_partition`: előre számított A/B target-csoport közti P2P kapcsolat ideiglenes blokkolása.
5. `dsl_signing_fault`: későbbi DSL test hook, build- és devnet-guarddal; nem általános bináriscserével.

Az MVP-ben minden szcenárióhoz rögzíteni kell a maximális target-számot, időtartamot, kockázati osztályt, recovery-módot és szükséges preflight checkeket.

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
