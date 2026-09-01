# Devnet Simulator – fenyegetési modell

Állapot: 1. napi biztonsági alap. A modell a későbbi kód-review és pilot kötelező ellenőrzőlistája.

## Védendő értékek

- A devnet node-ok rendelkezésre állása és hálózati konfigurációja.
- Jump-host SSH-kulcs, fleet inventory és target-regiszter.
- Admin sessionök, worker-token és observer ingest-token.
- A futások auditnaplója, mérési tartománya és eredményének hitelessége.
- A mainnet teljes elkülönítése a szimulátortól.
- Wallet-, operator- és collateral kulcsok; ezekhez a szimulátornak nincs szüksége hozzáférésre.

## Szereplők

- Publikus, anonim explorer-látogató.
- Jogosult admin, aki szcenáriót állít össze és indít.
- Orchestrator worker a privát jump hoston.
- Node-oldali privilegizált wrapper/watchdog.
- Read-only observer agent.
- Külső támadó vagy megszerzett publikus felhasználói session.
- Hibázó vagy kompromittált admin/worker.

## Bizalmi határok

1. Böngésző ↔ explorer/admin API.
2. Explorer szerver ↔ MongoDB.
3. Explorer API ↔ jump-host worker, kizárólag outbound pollinggal.
4. Jump host ↔ fleet node SSH.
5. Nem privilegizált worker ↔ root wrapper.
6. Node observer ↔ ingest API.

Az egyes határok tokenjei és jogosultságai nem cserélhetők fel. Az observer kompromittálása például nem adhat vezérlési képességet.

## Fenyegetések és kötelező védelem

| Fenyegetés | Lehetséges hatás | Kötelező védelem |
| --- | --- | --- |
| Publikus control endpoint | bárki leállíthat node-okat | külön public/control router; minden módosítás hitelesített; deny-by-default |
| Böngészős API-key kiszivárgása | tartós adminhozzáférés | HttpOnly/Secure/SameSite session; rövid TTL; kulcs nem kerül frontend bundle-be |
| CSRF | bejelentkezett admin nevében futás indul | CSRF token, Origin/Referer ellenőrzés, SameSite cookie |
| Tetszőleges shell/injection | teljes fleet takeover | nincs command string; zárt action union; fix wrapper-alparancsok; argumentum-allowlist |
| SSH-kulcs az explorer szerveren | publikus app kompromittálása fleet-hozzáférést ad | kulcs csak jump hoston; worker kifelé pollol |
| Mainnet confused-deputy | valaki devnetnek címkéz mainnet node-ot | build-, config-, RPC chain- és port-guard az API-ban, workerben és wrapperben |
| Request replay/dupla claim | fault kétszer települ vagy cleanup versenyez | action ID, idempotency key, egyedi index, lease és wrapper state file |
| Worker összeomlás fault közben | node tartósan hibás állapotban marad | minden fault TTL-es; node-local watchdog; bootkori cleanup; recovery scan |
| API/Mongo kiesés | worker nem kap cleanup parancsot | node-local TTL nem függ az API-tól; worker reconnect után reconcile-ol |
| Worker-token lopás | támadó actiont claimel/hamis eredményt küld | minimális scope, rövid rotálható secret/mTLS később, IP/network restriction, audit |
| Target mapping drift | rossz unit/node módosul | immutable target snapshot, wrapper allowlist, build/network/proTx preflight |
| Két párhuzamos live run | egymást felülíró hálózati szabályok | globális adatbázis-lock/lease, run-scope state, unique active lock |
| Hamis sikeres recovery | rejtett qdisc/firewall marad | wrapper state + OS-state ellenőrzés + observer/daemon ellenőrzés |
| Logban secret/privát infra | későbbi oldalirányú támadás | strukturált redakció; stderr sanitization; külön public/private hiba |
| Túl nagy target/duration | teljes devnet kiesés | scenario maximumok; kockázati osztály; target cap; piros jóváhagyás |
| Admin tévedés | túl erős szcenárió | terv-előnézet, becsült blast radius, kétlépcsős approve/start, dry-run |
| Observer token privilegizálása | telemetry agentből control | külön token audience és külön route; observer továbbra is read-only |
| Mérési eredmény manipulálása | hibás következtetés | immutable scenario snapshot, append-only audit, observer coverage/data quality kijelzés |
| SSH host key megkerülése | MITM a fleet kapcsolatban | rögzített `known_hosts`; productionben nincs `StrictHostKeyChecking=no` |
| Tűzfalszabály ütközés | idegen szabály törlése | saját chain/table/run tag; csak saját szabályokhoz nyúlhat a wrapper |
| Netem ütközés | meglévő qdisc sérül | preflight csak clean állapotból; saját handle; pontos state capture; fail closed |

## Jogosultsági modell

### Publikus felhasználó

- Listázhatja és megtekintheti a redaktált futásokat és eredményeket.
- Nem láthat infrastruktúra-metaadatot és nem kezdeményezhet állapotváltozást.

### Admin

- Draftot készíthet és előnézheti a determinisztikus tervet.
- Kockázati szintjének megfelelő runt jóváhagyhat, indíthat és abortálhat.
- Nem küldhet shellt, hostnevet, unitnevet vagy nyers tűzfalszabályt.

### Orchestrator

- Claim/renew/result műveleteket végezhet a kiosztott actionökön.
- Nem hozhat létre, nem approve-olhat és nem törölhet runt.
- Nem írhat explorer-mérési adatot observer-tokenként.

### Node wrapper

- Csak a lokális allowlistben szereplő devnet unitot és P2P interfész/port profilt kezelheti.
- Nem módosíthat walletet, kulcsot, binárist, configot vagy más szolgáltatást.
- Minden módosítás run/action azonosítóhoz és TTL-hez kötött.

## Safety interlockok

Ezek közül bármelyik hibája leállítja az indítást:

1. Az API konfigurált networkje nem `devnet`/`regtest`.
2. A worker RPC alapján nem a várt chain/devnet néven fut.
3. A wrapper lokális konfigurációja vagy portja nem egyezik az allowlisttel.
4. A target build vagy wrapper verzió nincs az engedélyezett listán.
5. Nincs friss observer-adat vagy a target nincs szinkronban.
6. Már fut élő kísérlet.
7. A preflight maradt fault state-et talál.
8. A recovery TTL nagyobb a scenario maximumánál.

A mainnet hard-disable háromszoros: a típusszerződésben nincs mainnet, a worker chain-ellenőrzést végez, a node-wrapper pedig csak explicit devnet profilból indul.

## Recovery követelmények

- A fault telepítése és a TTL/watchdog felélesítése egy műveleti egység; TTL nélkül nincs apply.
- A watchdog a workertől, MongoDB-től és explorertől függetlenül takarít.
- Reboot után induláskor megvizsgálja és lejárat szerint eltávolítja a simulator state-et.
- A cleanup többször biztonságosan meghívható.
- A recovery nem töröl globálisan minden firewall/qdisc állapotot, csak a saját run/action scope-ját.
- Ha a szolgáltatás a futás előtt nem futott, recovery nem indítja el automatikusan; az eredeti állapotot állítja vissza.
- Sikertelen recovery emberi beavatkozást és publikus `failed` státuszt eredményez, nem hamis `completed` állapotot.

## Auditálás

Minden módosító eseményhez tárolandó:

- időpont és chain height, ha elérhető;
- run/action/scenario ID és scenario-verzió;
- actor és auth-módszer, secret nélkül;
- előző és új állapot;
- paraméterek redaktált formája;
- target snapshot hash;
- claim/lease/attempt adatok;
- wrapper verzió és strukturált result code;
- recovery bizonyíték és data-quality.

Az auditbejegyzéseket normál API-val nem lehet szerkeszteni vagy törölni.

## Pilot előtti kötelező támadási tesztek

- Ismeretlen/extra JSON mező, túlcsorduló szám és rossz enum elutasítása.
- Shell metakarakter, útvonalbejárás és newline semmilyen mezőn nem jut el parancsként.
- Worker-token nem használható admin/observer route-on és fordítva.
- Lejárt/replayelt admin kérés nem indít második runt.
- Worker kill, jump-host hálózati kiesés és Mongo-kiesés után a node TTL-re visszaáll.
- Abort az injection minden pontján recoverybe vezet.
- Két párhuzamos start közül pontosan egy nyer.
- Hamis network/port/unit/build esetén minden réteg fail closed.
- Public API snapshotban nincs host/IP/unit/token/private error.
- Wrapper kizárólag saját tűzfalszabályát és qdisc handle-jét takarítja.

## Elfogadott maradék kockázat az első pilotban

- A jump host magas értékű vezérlési pont; ezért egyetlen pilot targettel indulunk.
- Az SSH-alapú executor átmeneti megoldás lehet. Később mTLS-es node-agent csökkentheti a root SSH függést, de csak külön audit után.
- A devnet mérési lefedettsége lehet hiányos; ezt data-quality jelöléssel láthatóvá kell tenni, nem szabad elrejteni.

## Kifejezetten tiltott rövidítések

- SSH-kulcs feltöltése az explorer szerverre vagy MongoDB-be.
- `exec(commandFromRequest)` jellegű implementáció.
- `sudo ALL` a worker számára.
- `StrictHostKeyChecking=no` a pilot/fleet végleges megoldásában.
- TTL nélküli netem/firewall/service-stop.
- Mainnet-engedélyezés környezeti változóval.
- Observer agent újrafelhasználása privilegizált vezérlésre.
- Sikertelen recovery mellett kézi `completed` státusz.
