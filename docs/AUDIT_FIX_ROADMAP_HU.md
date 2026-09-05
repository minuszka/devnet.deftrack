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
| 4 | Szimulátor: a csendes no-op osztály lezárása | **KÉSZ** (2026-09-05); laborban még nem bizonyított |
| 5 | Szimulátor: tervezett vég és live-lock | **KÉSZ, egy tétel átsorolva** (2026-09-05) |
| 6 | Mérés: anchor, ablak, küszöbök, next-quorum | **KÉSZ, egy tétel átsorolva** (2026-09-05) |
| 7 | Gyűjtő: egy igazságforrás (commitment-alapú kör-rekord) | **KÉSZ, egy tétel átsorolva** (2026-09-05) |
| 8 | Kliens: a fő üzenet helyreállítása | **KÉSZ** (2026-09-05) |
| 9 | CI és szerszám-hitelesítés (negatív kontrollok) | **KÉSZ, egy tétel átsorolva** (2026-09-05) |
| 10 | Dokumentáció-drift és runbook | nyitva |

**Következő pontos feladat:** a 10. nap — dokumentáció-drift és runbook:
`CONTRACTS_HU.md`, `ARCHITECTURE_HU.md`, `CONTROL_API_HU.md`,
`PERSISTENCE_HU.md`/`THREAT_MODEL_HU.md`, és a `CLAUDE.md` két elavult
bekezdése.

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

**A parancs-visszaigazolás is elkészült (2026-09-05).** A wrapper minden
parancsról ír egy rekordot a sor mellé (`applied` vagy `rejected`, a parancs
saját azonosítójára kulcsolva), a végrehajtó pedig megvárja: az `activateFault`
csak akkor tér vissza, ha a wrapper azt mondta, hogy a fault fent van, és a
`dispatchScheduledAction` ugyanígy. Mindkét irányban fail-closed: az elutasítás
dob, és a hallgatás is, mert egy nem futó és egy néma wrapper innen nézve
egyforma, és egyik sem bizonyíték.

Az azonosító a tervből származik: azonnali faultnál a jobId, ütemezett akciónál
az actionId. Az utóbbi azért kell, mert egy flapping ciklus ugyanazt a konténert
állítja le és indítja el ugyanabban a futamban, tehát a jobId a ciklus két végén
azonos, és nem tudná megkülönböztetni a két kimenetet.

Két dolog szándékosan nem outcome: a **retry** (mert a wrapper még alkalmazhatja),
és a **hiányzó azonosító** (kézzel hajtott wrappernél nincs, aki várna rá).
Az elutasítás azonosítója a nyers payloadról olvasódik, mert épp a parse bukott
el; enélkül egy hibás parancs csendben karanténba kerülne, és a hívó kivárná a
teljes időtúllépést egy válaszra, ami sosem jönne.

**Amit ez nem bizonyít:** a csatorna **laborban még nem futott**. A Docker-labor
nem elérhető, ezért csak unit tesztek fedik, három negatív kontrollal. Ez
ugyanaz a helyzet, mint a `plan.md` §2 tételei: a kód kész, a bizonyíték hátra.
Első labor-menetnél ezt kell nézni: az `outcomes/` könyvtár feltöltődik-e, és
egy szándékosan hibás parancs valóban megbuktatja-e az aktiválást.

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

### Amit az 5. nap eddig elvégzett (2026-09-05)

A live-lock körüli hibacsokor, ami az „egy live futam egyszerre" garanciát ette.

- **A lock elengedése a megszerző kísérlethez van kötve.** Két egyidejű `start`
  ugyanarra a futamra mindkettő sikeresen „megszerzi" a lockot: az egyik
  létrehozza, a másik állónak találja. A vesztes ezután az idempotencia-
  ujjlenyomaton elbukik, és a `catch`-ben **puszta runKey alapján** engedte el a
  lockot — vagyis a nyertesét, épp amikor az a faultot alkalmazta, és egy
  harmadik futam elvihette a labort. Mostantól csak az engedhet el, aki
  létrehozta.
- **Az abort már nem ragasztja be a futamot.** A végrehajtó-hálózat ellenőrzése
  a *perzisztált átmenetek után* futott, ezért egy live devnet futam abortja a
  `recovery` állapotban maradt — ami se nem terminális, se nem rekoncilálható —,
  és a preflight minden live, nem terminális futamot aktív kísérletnek számol.
  Egyetlen abortált vázlat így **minden későbbi live futamot blokkolt** a
  telepítésen, operátori kiúttal nem. Az ellenőrzés most minden írás előtt fut.
- **A `create` elutasítja a live futamot bármely hálózaton, amit a végrehajtó
  nem ér el.** Az egyetlen végrehajtó a Docker-labor, `regtest`-hez kötve, a
  `network` alapértéke viszont `devnet` volt — tehát a puszta `{ mode: 'live' }`
  ilyet gyártott.
- **A lock csak bizonyítottan tiszta labor után jár vissza.** Sikertelen recovery
  után a `faultMayBeActive` igaz marad; a slot átadása a következő futamnak épp
  az, amit a lock megakadályozni hivatott. Ide ember kell, nem a következő
  kísérlet.
- **A finalizálás nem éhezik ki.** A jelölt-lekérdezés 50-es lapot húzott, és a
  már riportoltakat *utólag* szűrte — de egy lezárt futam állapota többé nem
  változik, tehát a legrégebbi 50 riportolt futam örökre kitöltötte a lapot, és
  újabb futam sosem került sorra. A futam most megjegyzi, hogy a riportja
  elkészült, és a lekérdezés eleve kizárja.
- Négy negatív kontroll, mind ellenőrizve. A dupla `start` tesztjét **valódi
  egyidejűségre** kellett átírni: sorosan futtatva a második kísérlet előbb
  elbukik, és hozzá sem ér a lockhoz — az első változatom ezért zölden maradt a
  javítás nélkül is.

**A második menetben (2026-09-05):**

- **A dispatcher nem sorol be olyat, amit végre sem tud hajtani.** Az ütemezett
  `fault-clear` bekerült a táblába, de a fordítás szándékosan elutasítja, mert az
  recovery dolga — így a sor lookupja sosem találta meg, elbukott, felment a
  próbálkozási plafonig, és **minden netem-futam hamis „sikertelen akció" sorokat
  hagyott maga után**, dispatcher-hibát írva le ott, ahol nem volt.
- **A live lock láthatóvá és oldhatóvá vált.** Eddig semmi nem jelentette, ki
  tartja a labort: a `GET /runs?live=true` futam-projekciókat olvas, nem a
  lockot, tehát egy olyan birtokos, akire egy futam sem mutat, láthatatlan volt,
  és az egyetlen tünet az volt, hogy órákon át minden indítás `LIVE_RUN_LOCKED`-öt
  adott. Most van `GET /lock`, és van safety-admin `POST /lock/release`, ami
  **megnevezteti a várt futamot** és **elutasít, ha a birtokos futam még él** —
  egy futó kísérlet alól kinyitni a slotot pontosan az, ahogy két fault kerül egy
  laborra.

**Átsorolva a 6. utáni munkára, indoklással: a tervezett vég.** Ma a netem-fault
nem a terv szerinti végén szűnik meg, hanem a wrapper saját TTL-jén,
`időtartam + 120 s`-mal később. A túllógás valós, de a fault **magától elmúlik**,
tehát nem marad a hoston. A rendes javítás nem mechanikus: a wrapper egyetlen
`clear <jobId>` parancsot ismer, a terv `fault-clear`-je viszont `scope: 'run'`,
és ugyanaz a fordító adja a recovery-célpontokat is, ahol a `fault-clear`
felvétele korábban bizonyítottan hibát okozott. Ehhez tartozik a per-akció lease
is, amit ma a futam-szintű lease felülír. Ezt együtt kell megcsinálni, és
**laborban kell bizonyítani**, ami itt nem elérhető — ezért nem tákolom össze
vakon. A `recoveredTip` wrapper-visszaigazoláshoz kötése ugyanennek a
csomagnak a része.

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

### Amit a 6. nap eddig elvégzett (2026-09-05)

- **A horgonyzott futam végre látja azt a kört, amire pozicionálva lett.** A
  kapu a ciklus kezdete + fázis magasságra teszi a faultot, mert ott van a
  contribution-ablak — a kört viszont a *ciklus kezdete* nevezi meg, két
  blokkal korábban, és a mérés a ciklus-kezdeteket kereste a megfigyelési
  ablakban. A kettő pontosan `dkgPhaseBlocks`-szal tért el, ezért a futam épp
  azt az egy kört nem látta, amiért létezett, és **minden horgonyzott futam
  „nincs mit értékelni" eredményt adott**. A körök mostantól a **saját DKG-
  munkájuk** szerint tartoznak a méréshez, és a **fault-ablakhoz**, nem a
  megfigyelésihez: a warm-up azért van, hogy az állandósult mutatókat ne
  olvassuk reagálás közben, egy kör viszont nem állandósult mutató, hanem maga
  az esemény.
- **Egy második szeletelés csendben visszacsinálta az elsőt.** A pillanatkép
  ugyanazzal a tartománnyal újraszűrt, tehát a javítás önmagában hatástalan
  maradt volna. Ez csak azért derült ki, mert a teszt a valódi geometriát
  reprodukálta, nem a fixtúra kényelmes magasságait.
- **A küszöbök az érvényben lévő profilból jönnek.** Eddig 44 és 41 volt
  beégetve, két helyen literál típusként is. A laborban, ahol a profil 3/2/2, ez
  **egy nem létező hálózatot mért**: a margó mindig negatív volt, és minden
  riport `degraded` vagy `not-evaluable` lett, bármit is csinált a fault. Ha a
  küszöb ismeretlen, az mostantól **ismeretlenként** jelenik meg, nem nullaként —
  különben minden fault túlélhetőnek látszana.

### A 6. nap második menete (2026-09-05)

- **A `chain-synced` preflight már nem egyenlőséget követel.** Eddig a node
  csúcsának pontosan azon a magasságon kellett állnia, ahol a draft készült,
  vagyis a validate-nek és az armnak **egy blokkon belül** kellett lezárulnia —
  devneten 150 másodperc, a gyakorlatban kevesebb. Egy ennél lassabb futam olyan
  okból bukott el, aminek a hálózathoz semmi köze. A snapshot kora eddig is
  korlátozva volt; most blokkban is korlátozott, ami az a mértékegység, amiben az
  elcsúszás valóban számít. A csúcs alatti node továbbra is elutasítva, mert az
  nem láthatta, amit a draft leír.
- **A seed kikerült a rombolási sugárból.** A `host-outage` eddig a hoszt minden
  `service-control` célpontját vitte, a seedet is, a `network-degradation` pedig
  külön engedte a `seed` szerepet. A seed az, ahonnan az explorer RPC- és
  ZMQ-bizonyítéka jön: leállítani nem a vizsgált hálózatot rontja, hanem a
  mérést — és az eredmény hálózati leletnek látszana.
- **A flapping staker-korlátja egyezik a staker-limittel.** A séma tízet
  engedett, miközben a limit öt. A blokktermelés ezeken a démonokon áll; tízet
  flappelni más kísérlet, mint tíz masternode-ot.
- Három negatív kontroll. A staker-korlátét át kellett írnom: a fixtúrában csak
  öt staker van, tehát a hatodik kérése hiány miatt amúgy is elbukott, és a
  tesztem a szabály nélkül is zöld maradt volna.

**Átsorolva:** a `phase:'dkg'` elutasítása és a formálódó kvórum tagságának
kiszámolása. A `CalculateQuorum` determinisztikus a MN-listából és a ciklus-kezdő
blokk hash-éből, tehát reimplementálható — de **a node saját tesztvektoraival kell
hitelesíteni**, mielőtt egy scenario ráépül, különben egy rosszul újraírt
kiválasztás pont azokat a tagokat célozná, amelyek nem is tagok. Ez önálló,
bizonyítható munka, nem a 6. nap függeléke.

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

### Amit a 7. nap eddig elvégzett (2026-09-05)

- **Egy eseményíró típusonként.** Két írónk volt ugyanazokra a lánc-átmenetekre,
  és a kulcsaik csak részben egyeztek. A `banned`, `revived` és `registered`
  pontos lánc-magasságon ütközött, ezért a poller sora nyert, és a walker
  blokk-pontos sora **csendben elveszett**. A `penalty_up`, a `service_changed`
  és a `removed` viszont nem ütközött — a poller azon a magasságon kulcsolta
  őket, ahol épp pollozott —, tehát **mindegyik kétszer íródott**, és minden
  lezárt kísérlet kétszer számolta őket.

  A lánc-átmenetek mostantól a walkeré: a saját magasságukon olvassa őket a
  láncból, és a reorg-visszagörgetés újra eldobja őket, ha az őket hordozó
  blokkok elvesznek. A poller egyiket sem tudja. Ami nála marad, az a Sentinel-
  főkönyv, amit a `MnStateDiff` egyáltalán nem hordoz — plusz a `removed`
  *állapotjelölés*, mert enélkül a sor örökre élőként számolódna.
- **A `quorumHeight` nem a bányászati magasság többé.** A konszenzus a
  `qcTx.height`-et `pindexPrev+1`-re állítja (`commitment.cpp:201`), vagyis a
  bányászat magasságára — így a mező a nevével ellentétes értéket hordozott, és
  **minden sorban `quorumHeight === minedHeight`** volt. Most a ciklusból
  származik. Ismeretlen profilnál a node saját mezője marad, mert kitalálni
  rosszabb lenne, mint pontatlanul megnevezni.
- **A walker nem gyárt hamis büntetést.** Két úton tehette. A büntetés-térkép
  magasságonként lép előre, a kurzor viszont csak a batch végén íródik ki, tehát
  egy közbeni hiba a térképet a kurzor **elé** vitte — és a PoSe-büntetés
  blokkonként egyet csökken, így az újrajátszás minden büntetett node-ot frissen
  büntetettnek olvasott. Ez ugyanaz a kitalált mulasztás, amit a magvetés
  megelőzni hivatott, csak más úton. Most a hiba eldobja a magvetést, ami egy
  extra listdiff a következő körben, cserébe a térkép pontosan a kurzorhoz
  igazodik.

  A másik: a blokk-szinkron reorg-visszagörgetése hívja a `reset`-et, és ezt
  menet közben is megteheti. Az a walk aztán üres térképpel ment tovább — ahol
  minden node első látásnak tűnik, tehát minden büntetett növekedésnek — és a
  végén a **saját kurzorát írta a visszagörgetett fölé**. Generációszámláló
  került rá: aki alatt közben megfordult a lánc, eldobja a batch-ét.

  Ez most fontosabb, mint korábban volt: a walker lett az egyetlen írója
  ezeknek az eseményeknek, tehát amit kitalál, az maga a rekord.
- **A `minedHeight` már része a „kész" fogalmának.** A saját kommentje azt
  ígérte, hogy „a következő poll kitölti", de a frissítési szabály nem nyúl
  hozzá többé, amint a kör késznek számít — az pedig a `quorum info` válaszán
  múlt. Ez a gyűjtő a node csúcsán fut, a blokk-indexer viszont mögötte, tehát
  egy frissen bányászott commitmenthez tartozó kör **örökre null** magassággal
  maradt. A reorg-visszaállítás épp `minedHeight` szerint vág, vagyis pontosan
  azokat a köröket nem érte el, amelyeket a legvalószínűbb, hogy egy reorg
  elvisz.
- **Az `effectiveSize` a kör saját magasságán.** A `CalculateQuorum` a kör
  alapblokkjának listájából merít, a gyűjtő viszont a mai számot használta.
  Emiatt egy ban-hullám **mindkét irányban átírta a történelmet**: közben egy
  valóban 152 taggal elbukott kör `impossible`-ként rögzült és többé nem került
  elő, utána pedig a ténylegesen lehetetlen körök bukásnak látszottak. Most az
  indexelt pillanatképekből jön, körönként. Ahol nincs pillanatkép, marad a mai
  szám — ez a korábbi viselkedés, és a lánc korai szakaszát fedi, ahol a szám
  nem mozgott.
- **A ZMQ-vevő már nem hal meg csendben.** A ciklus eddig naplózott és
  visszatért, a socket viszont nem nullázódott, tehát a `connected` **továbbra
  is élő hallgatót jelentett** — és a ChainLock-időzítés észrevétlenül lecsúszott
  arra, amit az egyeztető poll lát, vagyis ötperces felbontásra, esemény-időként
  bemutatva. Épp az az egy mező volt hibás, ami ezt megmondta volna. Most a
  ciklus vége nullázza a socketet, lezárja, és exponenciálisan visszalépő
  újracsatlakozást ütemez (2 s-tól 60 s-ig), amit a `stop` elvág. Mellékesen: egy
  hibás keret `-1` sorszáma többé nem kerül a térképbe, mert eddig a **következő**
  üzenetet is összehasonlíthatatlanná tette.
- **A latencia-percentilisek már nem kevernek kétféle mérést.** A másodperces
  sorozat minden lockolt blokkot beszámolt, forrástól függetlenül — pedig egy
  ChainLock kétféleképp ér el egy blokkot: a rá kiadott CLSIG-gel, és az
  egyeztető pollal, ami **minden ősét** is megjelöli, mert a `hashchainlock`
  csak arra a blokkra tüzel, amelyet a CLSIG megnevez. A pollos érték
  `most − blokkidő`, tehát akár egy teljes poll-intervallumnyi várakozást
  hordoz, és semmit nem mond arról, milyen gyorsan érkezett a lock. Ezek
  uralták a percentiliseket. A modell saját kommentje már eddig is kimondta,
  hogy a kettőt nem szabad összeátlagolni — mégis az történt.
- **A batch közbeni reorg többé nem megy át.** Eddig csak a batch **utolsó**
  hash-e volt ellenőrizve, a következő tickben. Egy indexelés közben landoló
  reorg így egyenesen bekerült: az elhagyott lánc blokkjai egy érvényes csúcs
  alá íródtak, és fölöttük semmi nem mondott ellent, tehát későbbi
  visszagörgetésnek sem volt oka rájuk nézni. Most minden blokknak meg kell
  neveznie az előzőt.

**Átsorolva:** a kör-rekord teljes egyeztetése a commitment-indexből. Ez a nap
legnagyobb tétele, és a mostani javítások jó részét éppen az teszi majd
feleslegessé — de önálló migrációt és visszamenőleges újraépítést jelent az egész
láncra, amit **élő adaton kell bizonyítani**, nem unit tesztekkel. A közbenső
javítások addig is a helyükön tartják a rekordot.

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

### Amit a 8. nap eddig elvégzett (2026-09-05)

- **A nyitóoldal egy profilról szól, és megmondja, melyikről.** Eddig profil
  nélkül kérte a health-timeline-t, a szerver pedig csak paraméterre szűr —
  tehát a formation rate, a mediánok és a hibastreak **öt egymásba fésült
  ütemezésen** számolódott (llmq_50_60 24 blokkonként, llmq_60_75 48-anként,
  llmq_400_60 72-enként, llmq_400_85 576-onként, ami itt sosem formálódhat, és
  llmq_defcon). Ez pontosan az a keverés, amit a projekt saját jegyzete tilt.
  A betöltés most kétfázisú: előbb eldől, melyik profil ír alá a csúcson, és
  csak utána kérünk számokat. Ha ez nem dönthető el, az oldal **kimondja**, és
  nem mutat kevert számot — egy öt ütemezésre kiterjedő érték rosszabb, mint a
  semmi, mert válasznak látszik.
- **A kör háromállapotú lett.** Eddig a sikertelen kör piros pill volt egy `0`
  mellett, a formálódott és tizenkettőt büntető kör pedig zöld pill egy sima
  `12`-vel: **az incidens volt zöld és a nem-esemény piros**. Most
  `formed · clean`, `formed · punished N` (borostyán, kiemelve) és
  `did not form` semleges színnel — a büntetett cella pedig **szavakkal** felel
  ott, ahol a puszta nulla félrevezet, mert az hiányzó értéknek olvasódik, nem
  állításnak. Az `impossible` külön szöveget kap (`could not form`), mert a
  gyűjtő komoly munkával különbözteti meg a bukástól, és az oldal nem
  moshatja össze újra.
- **Az első kliens-tesztek.** A workspace-nek eddig **egyetlen tesztje sem
  volt**; most van futtatója, a gyökér `npm test` mindkét workspace-t futtatja,
  és a két tiszta modul 11 teszttel van fedve.
- **Közös `.err` és `.note`.** Az egyik egyetlen oldalon volt definiálva, a
  másik egy másikon, miközben tizenhárom oldal rendereli — vagyis egy kivétellel
  minden hibasáv stílus nélküli szövegtörzs volt, ami tartalomnak látszik, nem
  hibának.

### A 8. nap második menete (2026-09-05) — a nap ezzel lezárult

- **Egy poller, és a lassú válasz többé nem nyer** (#94). Tizenhárom oldal és a
  shell külön `setInterval`-t vitt, és mindegyik ugyanazt a hármat rontotta el: a
  rejtett fül tovább kérdezett (egy háttérfül percenként lekérte a teljes
  ChainLock-riportot, örökre); semmi nem szakította meg a lecserélt kérést, tehát
  szűrőváltásnál a *lassabb, régi* válasz nyert, és az oldal az előző szűrő adatán
  állapodott meg; a megszakított kérés pedig a `catch`-ben landolt, vagyis hibának
  látszott, ami nem volt az. A `PollController` egy helyen tartja az intervallumot,
  a `visibilitychange`-et, a futásonkénti `AbortController`-t és a
  sorozat-őrt — utóbbi az, ami akkor is helyes marad, ha a hívást nem lehet
  megszakítani. Vele jött `errorMessage`/`isAbortError` (az elsőből tizenhárom
  kézi másolat volt, a másodikból nulla) és a közös `pagerStyles`: három oldal
  vitte a lapozó bájtra azonos másolatát, és csak az egyiken volt fókuszgyűrű.
- **A kör egy objektum lett** (#95). A szerver a gyűjtő megírása óta kiszolgálja a
  `/quorum-rounds/:id`-t — tagok `valid` flaggel, churn, a kör profilparaméterei —
  és **semmi nem hivatkozott rá**: a sor kiírta, hogy hat tag bukott, és nem
  lehetett megkérdezni, melyik hat, egy olyan oldalon, aminek ez a célja. Az új
  `/round/<roundKey>` a verdiktet **mondatban** nyitja, a tagokat operátoronként
  csoportosítja (bukottak elöl), és megmutatja a profilt úgy, ahogy az a körre rá
  volt írva. Kiderült közben, hogy **a nyitóoldal saját táblája** még mindig a régi
  módon olvasta a kört (piros `failed` pill és sima `0` a zöld `formed` és a sima
  `12` mellett) — a legtöbbet olvasott tábla az oldalon, hónapokkal a szabály
  leírása után. Most ugyanazt a `roundVerdict`-et hívja, és a health-chart is: a
  borostyán jel a **büntető** kör, a nem formálódott kör pedig halvány, ahol eddig
  a diagram leghangosabb eleme volt (`--crit`).
- **Kontraszt, táblák, billentyűzet** (#96). Az `--ink-3` **3,19:1** volt azon a
  felületen, amin a legtöbbet ül — a 4,5:1 alatt —, és ő viszi a mértékegységeket,
  az időbélyegeket és minden gondolatjelet, ami azt jelenti, hogy „ez az érték nem
  létezik". A palettát végigmérve még két szövegszín bukott: sötétben a `--crit`
  (3,30:1 — a hibasáv és a health-cellák), világosban a `--warn` (3,81:1 — a
  büntetett darabszám). A `styles/contrast.test.ts` most **magát a stíluslapot
  olvassa**, és bukik minden 4,5:1 alatti szövegtokenre és 3:1 alatti diagramjelre.
  Fájlból olvas, nem `?raw` importtal: a vitest kicseréli a CSS-importot üres
  sztringre, amivel minden állítás átment volna — miközben semmit nem mér.
  Mellette: 151 oszlopfejléc kapott `scope`-ot, 26 tábla `<caption>`-t, három
  oldal szegmenskapcsolója `aria-pressed`-et, és a diagram minden köre
  fókuszálható lett, saját felolvasott mondattal — eddig a számok egyetlen
  helyen léteztek, egy egérrel elérhető tooltipben.
- **Beavatkozás-jelvények** (#96). Egy kör, amit öt leállított masternode mellett
  vagy közvetlenül egy revive után mértek, igaz szám egy olyan hálózatról, amiből
  nem szabad általánosítani — a jegyzet őrzi azt a kört, ami 0,16-os healthtel és
  42 büntetett taggal zárt, pusztán mert a revive-olt tagoknak még nem volt
  meshük. A deklarált kísérlet-ablakba vagy egy revive utáni két körbe eső sorok
  ezt most kiírják, és a futásra linkelnek. A távolság **a profil köreiben**
  számolódik, nem blokkban, tehát ugyanazt jelenti 24 és 72 blokkos ütemen.
  Ugyanitt tűnt el a fejléc `900 formed / 12 failed` sora: öt ütemezés együtt,
  health nélkül — vagyis formation rate-nek olvasódott minden oldalon.
- **Egy definíció válaszonként** (#97). Tizenegy válaszforma csak a kliensben élt,
  kézzel másolva; négyük a szerverben is létezett külön. Most a `shared/`-ben
  vannak, és minden útvonal **annotálva** küldi őket — ez teszi a driftet
  fordítási hibává üres panel helyett. Az első, ami így kiesett, éles volt: a
  `StakingHealth.byHost` a szervertől **`null`** jön, ha egyetlen kifizetési
  szkript sem köthető géphez, a kliens típusa viszont nem-null volt és rögtön
  `.hosts`-ot olvasott rajta. Két kisebb: a staking-útvonal `host` mezőt is küld
  minden stakerhez, a DSL `missedProTxHashes`-t, és a `DslEpochRow.detectedAt`
  `Date` volt, ami csak azért nézett ki jól, mert a `JSON.stringify` átalakítja.
- **Kliens-tesztek: 11 → 79.** `PollController` (7, negatív kontrollal),
  `groupByOperator` (6), `roundSentence` (4), `router` (9, benne hogy a `/rounds`
  szekciót nem nyeli el a `/round/:id`), `interventions` (8), kontraszt (6, magával
  a WCAG-számítással is ellenőrizve), `format` (13, benne a BigInt-út: a supply
  túl van a `Number.MAX_SAFE_INTEGER`-en), `classifyNetwork` (8, a minSize-határ
  mindkét oldala) és `lineSegments` (7: a nem formálódott kör **rés**, sosem nulla).

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

### Amit a 9. nap elvégzett (2026-09-05)

- **Minden shell-szkript ellenőrzés alá került, shebang alapján** (#98). A két
  legfontosabb fájl — `defcon-chaos` és `defcon-chaos-ssh`, root parancs és SSH
  forced-command production hosztokon — nem `.sh`-ra végződik, tehát a `*.sh`
  glob pont őket hagyta ki. 13 szkript, alapértelmezett szigorúsággal (info is
  számít); minden elnyomás egy `# shellcheck disable=` a során, indoklással.
  Amit talált: két SC2087 (`fleet-deploy.sh` heredocjai — szándékos helyi
  behelyettesítés, most le van írva, melyik változó melyik oldalé), egy SC2029,
  egy SC2209, hat SC2016, és egy **SC2015 az SSH-wrapper netem-argumentum-
  validációjában**: az `A && B && C || die` if-then-else-nek olvasódik és nem az.
  Helyes volt, de root alatt futó parancs argumentum-ellenőrzése ne igényeljen
  második olvasást — ciklus lett belőle.
- **A shellcheck verziója rögzítve, checksummal** (#98). A runner-image 0.9-et
  hoz, ami hat `A && B || die` validációra panaszkodik, amit a 0.11 rendben
  talál (`die` kilép). Ugyanaz a fa helyben átment, CI-ben bukott — egy kapu,
  aminek a jelentése a hónap runner-image-étől függ, nem kapu.
- **`node --check`, `py_compile`, és egy valódi import-ellenőrzés** (#98). A
  lab-szkriptek a `server/dist`-ből importálnak: egy átnevezés `server/src`-ben
  hibátlanul elemezhető és futásidőben törött szkriptet hagy maga után.
  `ops/check-imports.mjs` minden relatív specifikálót felold és az ES-modulokat
  be is tölti, hogy a névvel importált kötéseket ellenőrizze. Negatív kontroll:
  a `labNodeName` átnevezése a buildben mind a nyolc hívási helyet megnevezve
  bukik.
- **gitleaks a fán, nem a történeten** (#98). A történet rotációs döntés, nem
  build-lépés — a repó egy ilyen nyitott döntést már hordoz —, és egy kapu, ami
  minden push-on bukik, amíg valaki meg nem hozza, olyan kapu, amit megtanulnak
  figyelmen kívül hagyni. A fában egyetlen találat volt: az upstream publikált
  regtest spork-kulcsa (ott van a DeFCoN saját `feature_sporks.py`-jában),
  **pontos értékre** engedélyezve, indoklással.
- **És a kapu bizonyítja, hogy tud bukni** (#98). `ops/check-secret-gate.sh`
  kétszer fut: a fa legyen tiszta, és egy **véletlenszerűen generált** beültetett
  hitelesítő adat buktassa meg. Az első változat `ghp_` + ábécé + számjegyek
  volt, amit a gitleaks helyesen kihagy placeholderként — vagyis egy negatív
  kontroll, ami sosem bukhatott volna, pont az a hibaosztály, amiért ez a nap
  létezik.
- **A chaos-teszt megkérdezi a kernelt** (#99). Eddig hamis `tc` ellen futott, és
  **0 %-os losszal**: nem tudta megkülönböztetni a működő faultot a semmitől.
  Most két netns, veth-pár, a valódi wrapper az egyikben, datagramok számolva a
  másikban. Mérve: 100 % loss a célportról 0/20; **más forrásportról 20/20** — ez
  az a tulajdonság, ami miatt egyszer az operátor SSH-ja szakadt meg; `clear`
  után 20/20 és visszaáll a deklarált baseline (új handle-lel, ahogy a `plan.md`
  írja). A hoszt saját telepítését nem érinti: privát mount-namespace-ben tmpfs
  és bind-mount áll a valódi útvonalak helyén. Negatív kontroll: a wrappert
  `loss 0%`-ra rontva a teszt kimondja, hogy a fault nem érkezik meg.
- **A rossz viselkedést rögzítő tesztek** (#99). Ötből három már a 4-7. nappal
  megszűnt (partíció címmel és előzetes elutasítással; lejárt lease karanténban,
  sosem nyugtázva; küszöbök a hatályos profilból, az ismeretlen ismeretlenként).
  A mérési fixture **11 blokkos faultot** használt 6 blokkos plafon mellett — most
  a `SCENARIO_LIMITS`-ből származik, és kiderült, miért volt hosszú: hat blokknál
  a kör, amire a fault irányult, kiesett az ablakból, mert **egy kört a
  contribution-fázisa** — `[start+2, start+4)` — azonosít, nem az a magasság,
  amiről el van nevezve. A `failed` mint végleges ítélet mellé pedig odakerült,
  mi teszi biztonságossá (a write-oldal három szabálya) és mit nem fed le (egy
  reorg a bányászati ablak alatt).
- **Megkérdezzük az adatbázist és az útvonalakat** (#100). Három állítás, ami
  MongoDB-ről és HTTP-ről szól, nem a kódunkról, és egyiket sem ellenőrizte
  semmi: a kör egyszer íródik, az első megfigyelés megváltoztathatatlan, és
  egyetlen publikus végpont sem ad ki hosztcímet. Fake repository egyiket sem
  tudja megbuktatni — nincs egyedi indexe. Valódi MongoDB (CI-ben 8.0
  service container, helyben eldobható példány), **nulla új npm-függőség**.
  A söprés az első futásán talált egy éles veszélyt: a `/peers/propagation`
  nyersen adta ki a megfigyelő-azonosítókat hat mezőben, azok pedig az
  `OBSERVER_HOST` értékei, amit az ingest-séma IPv4-címként is elfogad. A mai
  telepítés címkéket használ, tehát semmi nem volt kint; egyetlen IP-re
  keresztelt observer publikálta volna. Az ajtóban redaktálunk azóta, és
  `redactHostId` megtartja az olvasható címkét, mert az nem cím.
- **A gyűjtő teljes írási útja valódi DB felett** (#101). Az egységtesztjei
  `vi.fn()`-ekre cserélik a modelleket — a döntéseket jól mérik, de nem tudják
  elkapni azt, ami itt a legtöbbe kerül: **a Mongoose strict módban szó nélkül
  eldobja az ismeretlen mezőket**. Egy séma-átnevezés után a gyűjtő ugyanazt az
  update-et építi, a driver elfogadja, az érték sosem landol, és az API örökre
  null-t felel. Negatív kontroll: a `punishedCount` séma-útvonalát átnevezve a
  dokumentum `undefined`-dal jön vissza, és két integrációs teszt bukik,
  miközben minden egységteszt zöld marad.
- **`npm audit` a CI-ben** (#101): high és critical bukik, minden más
  kiírásra kerül. A három moderate találat mind `qs`, a `body-parser`
  `~6.15.1` pinjén keresztül, és ez a szerver nincs rajta azon a kódúton —
  `overrides` egy nem létező sebezhetőségért sértene deklarált tartományt.

**Átsorolva:** a másik négy írószolgáltatás (`sync`, `masternodePoller`,
`mnListDiff`, `chainLock`) teljes írási útja valódi DB felett. A
repository-szintű állítások — egyediség, `$setOnInsert`, egyidejű írás — most
már mind fedve vannak, és a `quorumRound` végponttól végpontig is; a maradék
négy ugyanezt a mintát követi, önálló fake-RPC-forgatókönyvekkel, és nem fér
bele ebbe a napba anélkül, hogy a többi tétel csúszna.

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
