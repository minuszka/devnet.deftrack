# Devnet Simulator – scenario registry és DryRun

Állapot: 4. napi implementáció

## Biztonsági határ

A `generateDryRunPlan()` tiszta, szinkron tervgenerátor. Nincs adatbázis-, RPC-, SSH-, Docker-, hálózati vagy órafüggősége. Bemenetet validál, célpontot választ és egy leíró actiontervet ad vissza; actiont nem ment el és hibát nem alkalmaz.

A DryRun kizárólag `regtest` és `devnet` hálózatot fogad el. `mainnet` nem része a típustérnek és runtime validációval is elutasításra kerül.

Az action payloadok zárt, kód által előállított uniont alkotnak:

- `service-stop` és időkorlátos fault lease;
- `service-start`;
- `netem-apply`, kizárólag a `devnet-p2p` interfész-hivatkozással;
- `partition-apply`, kizárólag regisztrált target ID-kkel és a devnet P2P port-hivatkozással;
- `fault-clear`, kizárólag a run hatókörében.

Payloadban nincs parancssor, script, fájlútvonal, hostname, `hostRef` vagy `unitRef`. Ezeket majd a privát target registry és a fix worker wrapper oldja fel.

## Scenario-k

| ID | Cél | Fő korlát |
|---|---|---|
| `mn-stop` | Egy vagy N masternode leállítása és visszaindítása | legfeljebb 20 target, 5–900 s |
| `host-outage` | Egy regisztrált host minden allowlistelt service-e | legfeljebb 20 target, opcionális elvárt MN-szám |
| `quorum-member-outage` | Aktuális quorumtagok kiesése DKG vagy ChainLock fázisban | pontos quorum snapshot kötelező |
| `staker-stop` | Egy vagy több staker kiesése | legfeljebb 5 staker |
| `restart-flapping` | Ismételt stop/start ciklus | legfeljebb 10 target és 5 ciklus |
| `network-degradation` | Latency, jitter és packet loss | 2000 ms latency, 1000 ms jitter, 30% loss |
| `node-isolation` | MN-ek P2P izolációja a többi regisztrált targettől | legfeljebb 5 izolált target |
| `clear-recover` | Ismert simulator fault törlése | legfeljebb 20 target |

Minden Zod objektum `strict()`: ismeretlen scenario, mező vagy payload-paraméter hibát ad. Az explicit `targetIds` lista egyedi, és elemszámának egyeznie kell a `count` mezővel.

## Presetek

- `dkg-minus-16`: Q60 esetén pontosan 44 tag marad, a DKG küszöb széle;
- `dkg-minus-17`: 43 tag marad, a DKG küszöb alatt;
- `chainlock-minus-19`: pontosan 41 tag marad, a ChainLock küszöb széle;
- `chainlock-minus-20`: 40 tag marad, a ChainLock küszöb alatt;
- `host-10-masternodes`: az anchor target hostján pontosan 10 MN szükséges, eltérésnél fail closed;
- `one-staker-outage` és `multi-staker-outage`.

A preset csak paraméter-shortcut. Ugyanazon a zárt sémán megy át, mint a kézi kérés, ezért nem kerülheti meg a limiteket.

## Reprodukálhatóság

A nem explicit célpontválasztás SHA-256 rangsorolást használ a `seed + scenario namespace + targetId` alapján. Nem használ globális véletlenszám-generátort, és független a MongoDB-ből érkező lista sorrendjétől.

Az action ID a run key, sequence, kind és target ID stabil lenyomata. A payload és a teljes terv canonical SHA-256 fingerprintet kap. Azonos snapshot, scenario és seed azonos tervet eredményez.

## Hatásbecslés

A preview megadja az érintett targetek, MN-ek, stakerek, hostok és aktuális quorumtagok számát. Ismert Q60 quorum snapshot esetén kiszámítja a megmaradó tagokat, valamint a 44-es DKG- és 41-es ChainLock-küszöbhöz mért margót.

Ez determinisztikus küszöbszámítás, nem valószínűségi szimuláció. A Core-native szimulátor eredményeit nem másolja és nem számolja újra: scenario-család és artifact hivatkozást ad a `defcon-chainlock-pose-scalability-testplan` repóhoz. Ha nincs megfelelő modell – például staker kiesésnél –, ezt `not-modeled` állapottal jelzi.

## Még nem része ennek a fázisnak

- MongoDB-be történő DryRun mentés;
- target discovery vagy élő quorum lekérdezés;
- preflight és frissességvizsgálat;
- admin API/UI;
- action worker és claim;
- VPS wrapper, `systemctl`, `tc` vagy firewall végrehajtás;
- bármilyen valódi fault injection.
