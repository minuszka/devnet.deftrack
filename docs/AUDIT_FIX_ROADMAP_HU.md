# Audit-javítási ütemterv – napi bontás

Forrás: [`AUDIT_2026-09-05_HU.md`](AUDIT_2026-09-05_HU.md) (Fable 5.1 készítette,
2026-09-05, hat területen, a kiemelt találatok forrásban visszaellenőrizve).
Ez a fájl azt mondja meg, **mikor mit** javítunk; az audit azt, **mi a baj**.

A sorrend nem súlyosság szerinti, hanem **kockázat és függés** szerinti: előre
kerül minden, ami vagy elpusztíthatja a mérési rekordot, vagy hozzáérhet egy
production hoszthoz. Amit ezek nem blokkolnak, az később jön.

## Állapot

| Nap | Tárgy | Állapot |
|---|---|---|
| 1 | A rekord védelme: fail-closed rollback, ítélet sosem hibából | **KÉSZ** (2026-09-05) |
| 2 | Chaos-biztonság: netem-sáv, szűrő, host-kötés | **KÓD KÉSZ**; takarítás **KÉSZ**; pilot-újratelepítés a merge után |
| 3 | Publikus felület: IP-redakció, admin-auth, boríték | **KÉSZ** (2026-09-05), két tétel átsorolva |
| 4 | Szimulátor: a csendes no-op osztály lezárása | **RÉSZBEN KÉSZ** (2026-09-05); a parancs-visszaigazolás hátra |
| 5 | Szimulátor: tervezett vég és live-lock | nyitva |
| 6 | Mérés: anchor, ablak, küszöbök, next-quorum | nyitva |
| 7 | Gyűjtő: egy igazságforrás (commitment-alapú kör-rekord) | nyitva |
| 8 | Kliens: a fő üzenet helyreállítása | nyitva |
| 9 | CI és szerszám-hitelesítés (negatív kontrollok) | nyitva |
| 10 | Dokumentáció-drift és runbook | nyitva |

**Következő pontos feladat:** a 4. nap maradéka — parancsonkénti wrapper-
visszaigazolás, hogy a `succeeded` alkalmazást jelentsen. Utána 5. nap.

**A 2. nap első VPS-lépése kész** (2026-09-05, jóváhagyással): a két maradvány
install eltávolítva. Mind a 16 hoszt felmérve előtte, pontosan három hordozta a
csomagot, aktív fault sehol. Utána: 16-ból 1, a pilot. A hálózat végig
változatlan (152/152 engedélyezve, ChainLock a `llmq_defcon`-on). Részletek a
`plan.md` §4-ben.

**Hátra van a pilot host újratelepítése**, mert a `targets.conf` immár
`host <rövid-hostnév>` rekordot követel, és a wrapper minden parancsnál
ellenőrzi. Ez a #76 mergelése után történik, hogy a hoszton az legyen, ami a
`main`-en van. Amíg nincs meg, a pilot a régi, hibás netem-sávot hordozza,
tehát **valódi netem-fault (E4b) nem futtatható**.

---

## Kötelező szabályok minden napra

- Minden nap végén: `npm run typecheck`, `npm test`, `npm run build`. A kapukat
  **exit-kóddal** kell ellenőrizni, nem a kimenet utolsó sorával.
- Minden javításhoz **negatív kontroll**: egy teszt, amelyik a javítás nélkül
  bukik. Az audit szerint eddig a hamis eredmények többségét maga a szerszám
  adta, nem a hálózat.
- VPS-művelet, szolgáltatás-újraindítás és konfigurációs írás **csak külön
  jóváhagyással**. A 2. nap 1. pontja és a 9. nap netns-tesztje az egyetlen két
  hely, ahol ez felmerül.
- Commit-üzenet a repó saját konvenciója szerint: a tulajdonos az egyetlen
  szerző, `Co-Authored-By` trailer nélkül.
- Ami elkészül, azt ebben a fájlban **KÉSZ**-re állítjuk, és a `plan.md`-ben is
  lezárjuk, ha ott is szerepelt. Egy csak beszélgetésben létező elvégzett munka
  elveszik.

---

## 1. nap – a rekord védelme

Az egyetlen nap, amelyik után a rendszer *veszíteni* nem tud. Amíg ez nincs kész,
egy seed-reindex vagy egy node-restart törölheti az egész indexet.

Feladatok:

- `sync.service.ts` `rollbackIfReorged`: a meg nem válaszolt `getblockhash`
  (`null`) soha ne számítson hash-eltérésnek; a node lemaradása (tip a mi
  magasságunk alatt) ne számítson reorgnak; a visszagörgető ciklus csak valódi
  hash-eltérésre lépjen; mélységi plafon, fölötte a tick megáll és emberre vár.
- `quorumRound.service.ts`: `available === null` esetén a kör **ne kapjon
  ítéletet** (ugyanaz a kezelés, mint az `unseeable`), ne írjon `failed`-et.
- `seedStatus.service.ts`: a sikertelen RPC ne legyen `peers: 0` /
  `verifiedMasternodes: 0` / `stakeScripts: []`.
- `masternodePoller.service.ts`: üres `protx list` ne gyártson minden
  masternode-ra `removed` eseményt (IBD/warmup-kapu).
- Tesztek mindegyikhez, negatív kontrollal.

Elfogadási kapu: a node reindexe, restartja vagy egy RPC-timeout **nem** töröl
egyetlen indexelt sort sem, és egyetlen `masternode count` hiba sem ír `failed`
ítéletet. A tesztek a javítás visszavonásával bukjanak.

## 2. nap – chaos-biztonság

Ez a nap zárja azt a két hibát, amelyik ma **production forgalomhoz érhet**.
Amíg nincs kész, valódi netem-fault (E4b) nem futtatható.

Feladatok:

1. A `plan.md` §4-ben megnevezett **két maradvány install eltávolítása**
   (`ops/chaos/uninstall.sh`, majd `userdel chaosops`). VPS-művelet, jóváhagyás
   kell. A `uninstall.sh` sorrendhibáját (timer tiltása a `recover-all` előtt)
   előbb javítsuk, hogy a takarítás ne hagyjon élő faultot watchdog nélkül.
2. A netem-konstrukció javítása **egy definícióból, mindkét helyen**
   (`ops/chaos/defcon-chaos` és `server/src/simulator/netemLease.ts`):
   elérhetetlen sáv (`prio bands 4 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`,
   netem az `1:4`-en), hogy szűrő nélkül semmi ne essen bele — ma az
   interaktív SSH (`af21`) és minden TOS-bulk production forgalom beleesik.
3. A szűrő célzásának javítása: `dport` helyett a cél daemon azonosítása
   cgroup/unit alapján (`tc filter ... cgroup` a `system.slice/<unit>`-ra, vagy
   nftables `meta cgroupv2` → mark → `fw`), plusz `sport`.
4. **Host-jogosultsági kapu**: `host <label>` rekord a `targets.conf`-ban,
   `install.sh --host <label>` egyezés kötelező; production-marker
   (`defcond*` unit, `defcon-node` konténer) esetén elutasítás explicit
   override nélkül; `verify` írja ki a host-labelt.
5. `latency 0..2000` (ma `>= 1`, ezért tiszta loss-fault nem fejezhető ki).

Elfogadási kapu: 100 %-os loss egy network namespace-ben **nem** öli meg az
SSH-t, és a `tests/run.sh` a `prio` sort pontosan állítja. Az installer
elutasítja a production-jelölt hostot. (A netns-teszt a 9. napon kerül CI-be.)

### Amit a 2. nap ténylegesen elvégzett (2026-09-05)

- **Elérhetetlen sáv mindkét helyen.** `defcon-chaos` és `netemLease.ts` immár
  `prio bands 4 priomap 0 0 …` gyökeret épít, és a netem az `1:4`-en ül, ahova
  szűrő nélkül semmi nem kerül. A laborban ez azt is javítja, hogy a partíció
  csendben szélesebb volt a deklaráltnál.
- **A szűrő a helyi porthoz köt.** `match ip dport` helyett `match ip sport`, így
  csak a célzott daemon saját figyelő socketjéből kimenő csomagok érintettek.
  *Ismert korlát, szándékosan dokumentálva a kódban:* az általa kezdeményezett
  kapcsolatok ephemeral forrásportról indulnak, azokat ez nem fogja. A teljes
  per-folyamat izoláláshoz cgroup v2 + nftables mark kell, amit **valódi hoston
  kell bizonyítani**, mielőtt szállítjuk. Ez a 2. nap egyetlen nyitott
  kódtétele.
- **Gép-kötés.** A `targets.conf` kötelezően megnevezi a hostot
  (`host <rövid-hostnév>`), a wrapper minden parancsnál egyezést követel, és a
  `verify` kiírja. Ez az, ami a két véletlen telepítést megelőzte volna.
- **Production-kapu az installerben**: aktív `defcon-devnet-mn@11.service`
  (fleet staker) vagy futó `defcon-node` konténer esetén elutasít,
  `--allow-production` nélkül.
- **`latency 0..2000`**, és `delay` csak ha nagyobb nullánál, tehát tiszta
  packet-loss fault kifejezhető.
- **Gyökér-sorra horgonyzott baseline-ellenőrzés**, `mq` gyökér már nem megy át.
- **`uninstall.sh` sorrend**: előbb `recover-all`, utána a timer tiltása, és egy
  sikertelen recovery megállítja az eltávolítást. Mellékesen javult egy
  `set -e` csapda is (`[ -x ... ] && ...` megszakította volna a scriptet).
- Új tesztek a `tests/run.sh`-ban mindegyikre, negatív kontrollal ellenőrizve:
  a sáv-javítás visszavonásakor a suite a pontos állításon bukik.

## 3. nap – publikus felület

Feladatok:

- Host-címek redakciója a **DTO-határon**: `service`, `hostIp`,
  `serviceBefore/After`, `byHost[].hostIp`, `punishmentsInBlock.hosts`, fairness
  `hosts[].host` → `operatorLabel` / kulcsolt `hostLabel`. Nyers mezők csak
  `requireAdminAuth` mögött. Érintett: hat route, `shared/src/index.ts`, öt
  kliensoldal.
- Szerializációs teszt: minden publikus DTO-ra „nincs pontozott négyes”.
- `admin.v1.routes.ts` → `requireAdminAuth` (ma csak API-kulcs; a böngészős
  session nem is éri el az operátor- és kísérlet-kezelést).
- Express **error-middleware** a `{ success, data }` borítékkal; ma a hibás
  JSON, a >256 kB body és a `next(error)` HTML-t ad, fejlesztői módban stackkel.
- `npm audit fix` + `app.set('query parser', 'simple')`.
- `offset` plafon minden lapozott route-on; `Cache-Control: public` csak 2xx-re.
- Döntés a git-történetben maradt valós host-IP-ről: history-rewrite +
  force-push, **vagy** „kiszivárgottnak tekintjük és tűzfalazzuk”. A döntést a
  `plan.md` rögzítse.
- Explicit `ADMIN_ALLOW_HEADER_IDENTITY` kapcsoló a `NODE_ENV` helyett, és
  nginx-oldali fejléc-törlés. (Élesben ma zárva — ellenőrizve —, de a határ ne
  egy környezeti változó hiánya legyen.)

Elfogadási kapu: a publikus API egyetlen válaszában sincs host-cím, és ezt teszt
állítja; minden hibaválasz a boríték szerinti.

### Amit a 3. nap ténylegesen elvégzett (2026-09-05)

- **Host-redakció a DTO-határon.** Új `domain/hostRedaction.ts`: a cím kulcsolt
  HMAC-ből stabil, nem visszafejthető `host-<10 hex>` címkévé válik, a `service`
  megtartja a portot. Kulcsolt, mert egy IPv4-cím puszta hashe nem redakció:
  a teljes tér négymilliárd érték. Alkalmazva öt route-on: masternodes (lista,
  események, ban-hullámok), quorum-round részlet, blokk `paidMasternode`,
  commitment `punishmentsInBlock.hosts`, fairness (bemeneten, így minden
  származtatott host-szám is címke).
- **A kulcs magától jön létre és megmarad** (`ServerSecret` modell,
  `hostLabel.service.ts`), ezért nincs új kötelező környezeti változó és nincs
  telepítési lépés. Két folyamat versenyét a unique index dönti el, a vesztes a
  győztes értékét olvassa vissza, tehát a címkék mindenhol azonosak.
  Inicializálatlan állapotban nincs kulcs, és kulcs nélkül a függvény **nem ad
  címkét** — a hiányzó mező a rossz eset, nem a kiadott cím.
- **Visszafordítható egy helyen**: `PUBLIC_HOST_ADDRESSES=1` esetén a nyers cím
  megy ki, hogy a döntés szándékosan és egy helyen legyen megfordítható.
- **A `hostIp` szűrő eltávolítva a publikus listáról.** Nyers címre szűrni egy
  publikus route-on orákulum: kérdezz rá egy címre, és a sorok megléte a válasz.
  A kliens sosem küldte. Címke szerinti szűrés a 7. napra vár, mert ahhoz a
  címkét a sor mellé kell tárolni.
- **DTO-átnevezés**: `hostIp` → `hostLabel` a `shared/`-ben és a három
  kliensoldalon (`byHost[].hostLabel` is).
- **Boríték-hibakezelő middleware**: hibás JSON, túl nagy body és minden
  `next(error)` a `{ success, error }` alakot kapja; 4xx megnevezi az okot, 5xx
  nem, mert az üzenet belső részleteket hordozhat.
- **`query parser: 'simple'`**, tehát a `qs` egyetlen kódúton sincs rajta.
- **`admin.v1.routes.ts` → `requireAdminAuth`**, így az operátor- és
  kísérlet-kezelés a böngészős session számára is elérhető, és a kulcsútvonal
  megkapja a kettős-credential és Origin elutasítást.
- **`offset` plafon** (`MAX_OFFSET = 100 000`) mind a hét lapozott route-on.
- Új tesztek `hostRedaction.test.ts`-ben, negatív kontrollal ellenőrizve.

**Átsorolva, indoklással:**

- **`npm audit fix` nem alkalmazható, és nem is szükséges.** A három mérsékelt
  találat mind a `qs`-ből jön; a javított 6.16.0 létezik, de a `body-parser`
  `~6.15.1`-re rögzíti, ezért az `overrides` a deklarált tartományt sértené.
  Kipróbáltam és visszavontam. Ebben a szerverben a `qs` **egyetlen kódúton
  sincs rajta**: nincs `express.urlencoded`, és a query parser már `simple`.
  A tétel a 9. napra megy át mint CI-beli, informatív `npm audit` lépés.
- **A git-történetben maradt IP döntése** a felhasználóé, nem kódmunka; a 10.
  nap `plan.md`-tételei közt marad.
- **Teljes route-szintű DTO-szerializációs teszt** (minden publikus válasz
  átvizsgálása) a 9. napra megy, mert `mongodb-memory-server` + supertest kell
  hozzá. A `containsHostAddress` guard már készen áll neki.

## 4. nap – a csendes no-op osztály lezárása

A szimulátor legveszélyesebb tulajdonsága ma: a futam „fault_active”-ot hisz,
miközben a hoston semmi nem történt.

Feladatok:

- `expiresAtMs <= nowMs` **elutasítása** a `parseWrapperCommand`-ban és a strict
  `labFaultsForPlan`-ban (ma az `assertLeaseInstant` csak a plafont nézi).
- Peer-lista validálása az **executorban, enqueue előtt**: IPv4, egyediség,
  ≤ 32; a százalék-formátum ellenőrzése (`1e-7%` ma a wrappernél bukik).
- **Parancsonkénti kimeneti fájl** (`applied` / `noop` / `rejected` + jobId),
  amire a `dispatchScheduledAction` és az `activateFault` vár. Ettől kezdve a
  `succeeded` alkalmazást jelent.
- `simulationDispatcher.service.ts`: a `settle` eredményét ne dobjuk el, a
  `settle → false` (elvesztett lease) kapjon naplósort; lease-megújítás a
  `dispatch` körül vagy a lease ≥ legrosszabb docker-timeout.
- Parancsfájl neve `actionId`-ból, hogy a queue deduplikáljon.
- `isBenignFailure` szűkítése (`Operation not permitted` ma „már tiszta”-ként
  megy el, és az élő qdisc kiesik a nyilvántartásból).

Elfogadási kapu: egy olyan parancs, amit a wrapper nem alkalmazott, **nem
rögzíthető** alkalmazottként; a hozzá tartozó teszt a javítás nélkül bukik.

### Amit a 4. nap eddig elvégzett (2026-09-05)

- **A lejárt lease már parse-hiba.** `assertLeaseInstant` eddig csak a plafont
  nézte, a padlót nem: egy lejárt lease átment, a tervező „elutasította" azzal,
  hogy nem adott akciót, a runner mégis jobId-t adott vissza, és a ciklus
  nyugtázta és `dispatched`-ként számolta. A futam `fault_active`-ot hitt, holott
  semmi nem történt. Ehhez elég a sorban állás: egy `docker stop -t 30` előtte.
- **A `planApply` és a `planServiceStop` most dob, nem üres tervet ad.** Az üres
  akciólista így egyetlen dolgot jelent: nincs mit tenni. Eddig ugyanazt jelezte
  a visszautasítás és az idempotens eset, és a hívó nem tudta megkülönböztetni.
- **A ciklus injektálható órát kapott.** A parse eddig faliórával döntött,
  miközben a tervező injektált órát használ; élesben egyeznek, de így nem
  csúszhatnak szét, és a viselkedés tesztelhető.
- **A végrehajtó a wrapper saját szabályával validál, enqueue előtt.** Egy közös
  `assertFaultArgs` exportált a `netemLease`-ből, két hívóval. Eddig egy olyan
  terv, amit a wrapper garantáltan elutasított, végigment az armon és az
  aktiváláson: a parancs kiíródott, a wrapper dobott, a sor ötször újrapróbálta
  és karanténba tette, a futam meg aktív faultot hitt. Két konkrét eset: az
  `1e-7%` alakú veszteség és a konténernevet tartalmazó peer-lista.
- **A dispatcher elvesztett lease-e már nyomot hagy.** A `settle` eredménye eddig
  a földre esett, tehát egy dupla dispatch teljesen nyomtalan volt.
- Négy negatív kontroll, mind ellenőrizve: a javítások visszavonásakor pontosan
  ezek buknak. Két teszt átírva, amelyek eddig a hibás viselkedést rögzítették
  (a lejárt lease „nem parse-hiba", és a konténernevet peer-ként használó
  partíció).

**Hátra a 4. napból:** parancsonkénti kimeneti fájl a wrappertől
(`applied`/`noop`/`rejected` + jobId), amire a `dispatchScheduledAction` és az
`activateFault` vár. Ez az egyetlen, ami a `succeeded`-et *bizonyítottan*
alkalmazássá teszi; a mostani javítások az odáig vezető csendes utakat zárták le.
Ezzel megy együtt a lease-megújítás a `dispatch` körül és az `actionId`-alapú
parancsfájlnév.

## 5. nap – tervezett vég és live-lock

Feladatok:

- Az ütemezett `fault-clear` vagy ugyanazzal a jobId-sémával dispatch-elhető
  legyen, vagy legyen „planned end” akció, ami `abortRequested: false`-szal hívja
  a `begin_recovery`-t. Ma a netem-fault a tervezett végén **nem szűnik meg**.
- `recoveredTip` a wrapper visszaigazolásakor íródjon, ne az emberi `recover`
  pillanatában — ma a mérési ablak hossza az operátor reakcióidejétől függ.
- Lock-release **fencing**: csak `(runKey, requestKey/revision)` egyezéskor
  engedjen el; egy vesztes dupla `start` ne szabadítsa fel a nyertes lockját.
- `assertExecutorNetwork` és executor-elérhetőség **minden perzisztált átmenet
  előtt** az `abort`/`recover` ágon; a `create` utasítsa el a
  `live && network !== 'regtest'` kombinációt.
- Release csak `allClear` esetén (ma sikertelen recovery után is elenged,
  miközben `faultMayBeActive: true`).
- `GET /admin/simulations/lock` + safety-admin `release`, hogy a bennragadt
  slot látható és oldható legyen.
- Finalize-jelöltség `measurement.reportId` alapján + részleges index (ma 50
  riportolt futam után az újak sosem kerülnek sorra).

Elfogadási kapu: egy netem-futam magától tisztul a tervezett végén, és egyetlen
futam sem tudja véglegesen elfoglalni a live slotot.

## 6. nap – mérés: anchor, ablak, küszöbök

Feladatok:

- A DKG-anchor kapu és a mérési ablak egyeztetése: körválasztás a contribution-
  ablak `[faultStart, faultEnd]` átfedése alapján, **vagy** a kapu
  `cycleStart − warmup`-ot javasoljon. Ma minden horgonyzott futam
  `not-evaluable`.
- A Q60-küszöbök (44/41, 0,8/−0,1) az aktív `LlmqProfile`-ból jöjjenek, ne
  legyenek beégetve — a laborban (3/2/2) ma minden riport `degraded`.
- `quorum-member-outage` `phase:'dkg'`: elutasítás, amíg a **formálódó** kvórum
  tagsága nem számolható. Ez a handoff „next quorum” hézaga; a `CalculateQuorum`
  determinisztikus a MN-listából és a ciklus-kezdő blokk hash-éből, tehát
  reimplementálható (a node tesztvektoraival hitelesítve).
- `chain-synced` preflight: `blocks === headers && !IBD && blocks − captured ≤ N`
  a magasság-egyenlőség helyett (ma validate és arm egy blokkon belül kell
  lezáruljon).
- Kvórum-feloldás csak azoknak a scenarióknak, amelyeknek kell (ma minden draft
  megköveteli az aktuális kvórum összes tagjának regisztrációját, `mn-stop`-ra
  is, így részleges regiszterrel semmi nem draftolható).
- Blast-radius: `seed` kizárása a `host-outage`-ból és a
  `network-degradation`-ből; `maxStakers` alkalmazása a flappingre; a
  `node-isolation` peer-listájának plafonja.

Elfogadási kapu: egy horgonyzott futam **értékelhető** elsődleges profilt ad, és
a laborban a küszöbök a labor profiljából jönnek.

## 7. nap – gyűjtő: egy igazságforrás

Feladatok:

- `QuorumRound` egyeztetése a `QuorumCommitment`-ből: formálódott ⇐ commitment
  `validMembersCount > 0`, sikertelen ⇐ null-commitment sor. Az `absenceIsEvidence`
  keresztellenőrzéssé szelídül, a kör-magasság és a `minedHeight` pontos lesz,
  és az egész lánc visszamenőleg feldolgozható.
- `QuorumCommitment.quorumHeight` javítása (ma a bányászati magasság).
- `minedHeight` visszatöltése `detailsComplete` után is, különben a reorg-reset
  pont az elhagyott blokkban bányászott köröket hagyja ki.
- Egy eseményíró típusonként, **forrás-névterezett** kulcsokkal; a poll-forrású
  lánc-események is töröljenek reorgnál. (Ma a `penalty_up` és a
  `service_changed` kétszer íródik, tehát minden lezárt kísérlet
  `penaltyIncreases` száma akár 2×.)
- Walker-tartósság: kurzor magasságonként, vagy `seeded = false` bármely
  throw-ra; `reset()` generáció-számlálóval az in-flight walk ellen.
- `effectiveSize` a kör **alapmagasságán** (ma a mostani MN-számmal számol, ezért
  ban-hullám alatt és után is téves).
- Batch közbeni reorg észlelése (`previousblockhash` láncellenőrzés).
- ZMQ-felügyelet: újracsatlakozás backoffal, valódi `connected`, és a
  ChainLock-watcher essen vissza a 10 s-os pollra, amíg a ZMQ áll.
- Poll- és ZMQ-latencia szétválasztása a `/chainlocks` route-on is.

Elfogadási kapu: egy egy hetes explorer-kiesés után a kör-rekord hiánytalanul
újraépíthető a láncból, és ezt teszt mutatja.

## 8. nap – kliens: a fő üzenet

Feladatok:

- **Profil-szkópú áttekintő**: alapból a tip ChainLock-profilja, profilváltóval;
  `llmqName` átadása a `healthTimeline`-nak; `minSize` abból a profilból. Ma öt
  interleaved ütemezés egy sorozatban — pont amit a CLAUDE.md tilt.
- **Háromállapotú kör-szemantika**: `formed · clean`, `formed · punished N`
  (borostyán, N félkövér), `did not form · nobody punished` (semleges, szöveggel).
  Ma az incidens zöld és a nem-esemény piros.
- Formation rate és health **soha külön**: a shell-telemetria és a `/rounds`,
  `/pose` oldalak javítása.
- Kör-részlet oldal a már kiszolgált `/quorum-rounds/:id`-re (tagok `valid`
  flaggel, operátoronként csoportosítva, mined block, churn, profil-paraméterek).
- Beavatkozás-jelvények a sorokon: kísérlet-ablak és revive utáni N kör.
- `PollController` (interval, `visibilitychange`, sequence-guard,
  AbortController) + közös `.err/.note/.pager/.badge` stílusok: kilenc oldal
  ~300 sor duplikációja és az összes fetch-verseny egyszerre javul.
- A kilenc kézzel másolt API-típus a `shared/`-be.
- Akadálymentesség: `--ink-3` kontraszt, `aria-pressed` a szegmenseken,
  fókuszálható chart-pontok, `<caption>`/`scope`.
- Első kliensteszt-készlet: `classifyNetwork` döntési tábla, `format.ts`,
  `router.ts`, health-chart render, DTO-kontraktus.

Elfogadási kapu: a nyitóoldal soha nem kever profilt, és egy sikertelen kör
szövegesen azt mondja, hogy senkit nem büntetett.

## 9. nap – CI és szerszám-hitelesítés

Feladatok:

- Shellcheck **minden** `ops/*.sh`-ra (a `fleet-deploy.sh` ma két SC2087-tel
  bukna), `python3 -m py_compile` az observerre, `node --check` az `ops/*.mjs`-re
  (ezek a `server/dist`-ből importálnak: egy átnevezés ma csendben töri őket).
- **gitleaks** a publikus repóra; akciók SHA-ra rögzítve; `concurrency` csoport;
  Docker-build; `systemd-analyze verify` a unitokra.
- **Negatív kontrollok**: netns-es 100 %-os loss teszt (a mai chaos-teszt 0 %-os
  loss-szal fut, tehát nem tud bukni); rollback-teszt `null` RPC-vel;
  DTO-teszt beültetett IP-vel.
- Integrációs tesztek `mongodb-memory-server` + fake-RPC felett az öt
  írószolgáltatásra (`sync`, `quorumRound`, `masternodePoller`, `mnListDiff`,
  `chainLock`) és a Mongo-repository-kra — ma ezekre **nulla** teszt van.
- A rossz viselkedést rögzítő tesztek javítása: `liveExecutorPlan.test.ts:518`
  (`args: ['mn02']`), `netemWrapperMain.test.ts:196`, `simulationMeasurement.test.ts:114`
  (11 blokkos fault registry-max 6 mellett), `dryRunExecutor.test.ts:230`.

Elfogadási kapu: minden mérő- és ellenőrző útvonalhoz tartozik teszt, ami a
javítás visszavonásával bukik.

## 10. nap – dokumentáció-drift és runbook

Feladatok:

- `CONTRACTS_HU.md`: a tényleges nyolc scenario, `low/medium/high`, a valódi
  payload-unió.
- `ARCHITECTURE_HU.md`: az egyetlen executor a Docker-labor; jump-host worker,
  SSH-wrapper és „csak P2P-port” nem létezik.
- `CONTROL_API_HU.md`: van action worker; a session-ajtó fogad cookie-t;
  `X-Simulation-Client` vagy legyen ellenőrizve, vagy kerüljön ki.
- `PERSISTENCE_HU.md` / `THREAT_MODEL_HU.md`: az `action_*` audit-események és a
  `SimulationResumeDirective` ma nem íródnak/nem fogyasztódnak — vagy kössük be,
  vagy vegyük ki az ígéretet.
- `CLAUDE.md`: a „withCachePolicy profilok + in-flight dedup” nem létezik; a két
  már zöld inherited-failing teszt bekezdése elavult.
- `plan.md`: a chaos-host takarítás, az IP-döntés, a `defcon-enable-staking`
  toggle-hiba és a `backfill-commitment-names.cjs` hiányzó `llmq_defcon`-ja
  kerüljön be nyitott tételként.

Elfogadási kapu: a dokumentáció a megvalósított rendszert írja le, és a
következő auditor nem egy 1. napi vázlathoz méri a kódot.
