# Üzemeltetési kézikönyv – hibaszimulátor

A 22. nap dokumentációs csomagjának első fele: hogyan használja az admin a
szimulátort, hogyan kerül fel és le a laborról és a flottáról, mi a teendő,
ha egy futam nem áll helyre magától, és hogyan kell azonnal leállítani
mindent. A második fele, az eredmények olvasása és a scenario-katalógus,
a [RESULTS_HU.md](RESULTS_HU.md)-ban van. Minden állítás a kódból olvasható
vissza; ahol egy szám a kódban él, a forrás neve mellette áll.

## 1. Kinek mi szabad

Két szerep van, és a szerep a scenario kockázati osztályához kötött
(`simulationPolicy.ts`, `approval`):

| Szerep | Indíthat | Nem indíthat |
|---|---|---|
| `operator` | `low` és `medium` kockázatú scenario (`clear-recover`, `mn-stop`, `staker-stop`, `dsl-fault`) | `high` (host-kiesés, quorumtag-kiesés, flapping, hálózati fault, izoláció) |
| `safety-admin` | mind | – |

Csak a `safety-admin` engedheti el kézzel a live lockot
(`POST /admin/simulations/lock/release`); az `operator` kérése
`APPROVAL_DENIED`-dal tér vissza.

A böngészős belépés a `/admin` oldalon történik (`dd-admin-shell`), az
identitást a szerver a `x-admin-api-key` fejlécből vagy a session-cookie-ból
olvassa. A laboron a „identity proxy” bárki a loopbackről, aki a
`x-lab-identity` fejlécet állítja; ez csak azért elfogadható, mert a labor
bizalmi határa maga a loopback.

## 2. Egy futam élete

A futam állapotgépe (`simulationRunState.ts`) egyirányú, és minden
átmenet auditált:

```
draft → preflight → scheduled → baseline → armed → activation_pending
      → fault_active → observing → recovery → cooldown → completed
```

Bármelyik nem-terminális állapotból `abort` visz a `recovery`-be, és onnan
`aborted`-be. A `failed` állapotból csak `recover` van kiút.

Az admin oldalról ezek a lépések látszanak (a teljes végpontlista a
[CONTROL_API_HU.md](CONTROL_API_HU.md)-ban):

1. **Létrehozás** – `POST /admin/simulations/runs`: scenario, paraméterek,
   seed, hálózat. Élő futam csak `regtest` hálózatra jöhet létre; a `create`
   elutasítja a `live && network !== 'regtest'` kombinációt.
2. **Validálás és dry-run** – `POST …/validate`, `GET …/dry-run`: a terv
   determinisztikus (`planFingerprint`), a célpontok a seedből és a
   scenario-névtérből választódnak, a hatásbecslés a *tényleges* profil
   küszöbeivel számol, nem literálokkal. Itt születik a Sentinel-elvárás is a
   `dsl-fault` tervekhez (`impact.dsl`), amihez a jelentés később méri magát.
3. **Arm** – `POST …/arm`: preflight (target-leképezés, quorumtagság, baseline
   hossza és egészsége, data quality), célpont-snapshot befagyasztása, live
   lock megszerzése. A preflight `409`-cel utasít vissza, ha az alapvonal
   nem elég hosszú vagy egy másik élő futam tartja a labort.
4. **Start** – `POST …/start`: a fault a wrapperen át élesedik; a futam csak
   akkor lép `fault_active`-ba, ha a wrapper visszaigazolta. Ami nem
   alkalmazható teljesen, az nem indul el: a végrehajtó fail-closed.
5. **Megfigyelés** – a megfigyelő-sweep viszi `observing`-ba, az ütemezett
   lépéseket (újraindítás, Sentinel-clear) a dispatcher adja ki a saját
   idejükben.
6. **Tervezett vég** – a terv utolsó lépése után egy másodperccel a
   dispatcher `planned-end` akciót ad ki, ami abort-szándék nélkül viszi a
   futamot `recovery`-be; a helyreállítás igazolja a tiszta labort, majd
   `cooldown` (15 perc, `COOLDOWN_BUDGET_MS`) és `completed`.
7. **Jelentés** – a mérési szolgáltatás akkor véglegesít, amikor az ablak
   DKG-körei lezárultak; a jelentés a `GET /simulations/runs/:runKey`
   publikus végponton olvasható, redakció után.

Minden mutáló kérés `X-Idempotency-Key` fejlécet kér (8–200 karakter); az
ismételt kérés ugyanazt a választ adja, nem ismétli a műveletet.

### Parancssorból

`ops/lab-walkthrough.mjs` végigviszi a fenti lépéseket egy laboron:

```bash
node ops/lab-walkthrough.mjs --scenario dsl-fault --fault-kind response-drop \
  --epochs 1 --target mn02 --attempts 1
```

`--abort-active` elveszi a labort egy még élő futamtól, **a cooldownban
lévőt is** – egy `completed`-re váró futamot ezzel `aborted`-dé teszünk.
Új futam előtt inkább várjuk meg a cooldown végét.

## 3. Telepítés és eltávolítás

### Labor (Docker, helyi gép)

| Lépés | Parancs |
|---|---|
| Image | `bash ops/lab-image.sh <build-src-dir> [tag]` – `defcond` és `defcon-cli` egy minimális kontextusból, kiírja az image-beli sha256-ot |
| Bring-up | `node ops/lab-bringup.mjs [--dsl]` – 8 konténer, quorum-formálás; `--dsl` a Sentinelt genezistől indítja és bekapcsolja a fault-injectiont |
| Explorer | `node ops/lab-serve.mjs` – `deftrack_lab` DB, port 4210; a compose-ból veszi a blokkidőt és a DSL aktivációs magasságot, és induláskor kiírja őket |
| Wrapper | `node ops/lab-wrapper.mjs` – a fault-állapot tulajdonosa, `.lab-state/state.json`, fájl-alapú parancssor |
| Targetek | `node ops/lab-register-targets.mjs` – a konténerek mint célpontok, minden képességgel; image-csere után újra kell futtatni (`NODE_BUILD_MISMATCH`) |
| Bontás | `docker compose -f lab-compose.yml down -v`, majd a `mn*_data` volume-ok és a `.lab-state` törlése |

Ismert csapdák: a konténerek újraindítása (`docker restart`) után a node **új
RPC-sütit** generál, ezért a lab-serve és a segédfolyamatok 401-et kapnak,
amíg újra nem indítjuk őket; a régi volume-ok túlélhetik a `down -v`-t, ha a projektnév
változott; a bring-up alatt a miner futnia kell; egy reindex után a
spork-állapot elveszik (`sporkupdate` a spork-kulcsos node-on); a konténer
újralétrehozása után a cookie változik, a lab-serve-et újra kell indítani.

### Flotta (VPS-ek, csak külön jóváhagyással)

A flotta-oldali csomag az `ops/chaos/` (12. nap): root tulajdonú
`defcon-chaos` wrapper, amely csak logikai target- és job-azonosítót fogad,
a unit/interfész/port hármast a root tulajdonú `targets.conf`-ból olvassa
(sosem source-olja), minden parancs előtt helyreállítási rekordot ír, és
egy 15 másodperces systemd-timer törli a lejárt rekordokat akkor is, ha a
hívó eltűnt. Az explorer VPS **nem** kap SSH-hitelesítőt; a szállítás a jump
hoston futó `defcon-chaos-ssh` dolga (`BatchMode=yes`, jelszavas belépés
tiltva, szigorú host-key, rögzített wrapper-útvonal, `sudo -n`).

```bash
bash ops/chaos/verify.sh                       # statikus ellenőrzés, CI is futtatja
bash ops/chaos/install.sh --targets <privát targets.conf> --operator <név>   # a pilot hoston
bash ops/chaos/uninstall.sh                    # csak miután minden rekord átment a recovery-n
```

Az `ops/deploy.sh` ezt sosem futtatja. A 13. napi pilot (read-only
telepítés, marker-próba, node leállítása nélkül) és a 14. napi élő pilot
külön jóváhagyást kér, és a devnet futó kísérletei alatt nem indul.

## 4. Helyreállítási runbook

A helyreállítás három rétegű, és a rétegek egymástól függetlenül működnek:

1. **A node-oldali TTL.** A wrapper minden joba lejárattal születik; a
   watchdog akkor is törli, ha az orchestrator meghalt. A Sentinel-faultot a
   node maga is lejáratja magasság szerint (`faultinject`, következő
   epoch-határ + `epochs · 24`).
2. **A futam lease-e.** Ha a tervezett vég nem tudta elvinni a futamot
   `recovery`-be, a reconcile-sweep a `faultLeaseExpiresAtMs` lejártakor
   `system_timeout`-tal teszi meg, abort-szándékkal; a futam ilyenkor
   `aborted`-del zár, és a rekord ezt mondja, nem `completed`-et.
3. **Az operátor `recover` kérése.** `POST …/recover` bármely nem-terminális
   állapotból: törli a várakozó akciókat, kiadja a clear-eket, visszaolvassa
   a célpontokat (`faultinject list`, qdisc, service-állapot), és csak
   `allClear` esetén engedi el a live lockot.

Mit nézz meg, ha egy futam nem záródik:

| Tünet | Hol nézd | Teendő |
|---|---|---|
| `recovery`-ben áll, nincs `recovery_succeeded` | `GET …/history`; a wrapper `outcomes/` mappája | `POST …/recover` az operátortól; ha a wrapper nem válaszol, indítsd újra a wrappert, a state.json a folyamattal él |
| `failed` | a recovery-jelentés `findings` mezője | a talált maradék (qdisc, futó fault) kézi törlése a laboron, majd `recover` újra |
| a live lock foglalt, de nincs élő futam | `GET /admin/simulations/lock` | `safety-admin` `POST …/lock/release`; előtte ellenőrizd, hogy a labor tiszta |
| `NODE_BUILD_MISMATCH` a preflightban | target-regiszter | `lab-register-targets` újrafuttatása az új image után |
| a jelentés nem készül el | a `measurement finalized` sor a lab-serve logban | a DKG-köröknek le kell zárulniuk az ablak után; laboron 15 s-os blokkoknál ~17 perc |

A devneten a DKG-PoSe-ban egy scenario mellékhatása, nem a szimulátor dolga:
egy leállított masternode-ot a sorsolás bannolhat, és az újraindítás ezt
nem oldja. A revive (`protx update_service`) operátori művelet a seed
tárcájából, finanszírozott díjcímről; a futam rekordja mondja ki, hogy a
mérésen kívül történt.

## 5. Vészleállítás

Sorrendben, a legkevésbé rombolótól:

1. **Abort** – `POST …/abort` a futamra: azonnali `recovery`, a várakozó
   akciók törlése, clear-ek kiadása. Ez a normál vészfék.
2. **Lock elengedése** – ha az abort nem tud lefutni, `safety-admin`
   `POST /lock/release`; ettől még a faultok a wrapper TTL-jéig élhetnek.
3. **Wrapper leállítása** – a labor wrapperének leállítása *nem* törli a
   faultokat; a `state.json` és a `commands/` marad, újraindításkor a boot
   recovery visszavonja, ami lejárt. A flottán a systemd-timer teszi ugyanezt
   a hívó nélkül is.
4. **Node-oldali kézi törlés** – laboron `docker exec <node> tc qdisc del
   dev eth0 root`, illetve `defcon-cli faultinject clear <id>`; flottán a
   `defcon-chaos clear <target> <job>`.
5. **Konténer újraindítás** – a Sentinel-faultok a folyamattal halnak
   (bizonyítva: 21. nap, mn03), a qdisc a netns-szel.

A vészleállítás után a futam rekordját `aborted`-ként kell hagyni, nem
törölni: a törlés a `DELETE …/runs/:runKey`, és csak a soha el nem indult
tervezetekre való.

## 6. Ismert korlátok

- **Csak `regtest` élő futam.** A control service elutasít minden nem-regtest
  élő futamot, a labor végrehajtója pedig csak a saját Compose-projektjének
  konténereit érinti (`allowedContainerProject`). A devnet-flotta a 13–14.
  nap pilotja után, külön jóváhagyással jön.
- **Kiesés-plafon:** `MAX_OUTAGE_BLOCKS = 6` blokk (`scenarioRegistry.ts`),
  azaz devneten 900 s, laboron 90 s; legfeljebb 20 célpont. A hosszabb kiesés
  nem magasabb plafon, hanem másik mérés (lásd
  [OUTAGE_WINDOWS_HU.md](OUTAGE_WINDOWS_HU.md)).
- **A quorum-margó a laboron ismeretlen lehet.** Ha a dry-run nem látja a
  formálódó quorum tagságát, a DKG- és ChainLock-elvárás `unknown`, és az
  összkép `not-evaluable` marad akkor is, ha a Sentinel-elvárás teljesült.
- **Hét masternode-os laboron két hiány már mass-outage guard.** A Sentinel
  15%-os szelepe 7 tagnál 1,05-nél nyit; a jelentés az ilyen epochot
  `guardedEpochs`-ként számolja és kihagyja az elvárás-ellenőrzésből.
- **A ChainLock-latencia csak megfigyelés.** A lock érkezését a ZMQ adja,
  a felbontás a poll-intervallum; a watcher indulása előtt lockolt blokkok
  `null`-t hordoznak. A lock-before-first-sight versenyt a szerver már
  visszaszámolja, de a lefedettség sosem lesz definíció szerint 100%.
- **A `commitment-skip` fault nem jósolható** a jelentés szintjén: egy
  másik bányász commitolhatja a határt. A jelentés ezt `not-evaluable`-nak
  mondja, nem sikernek vagy kudarcnak.
- **A jelentés-ablak a fault magasságából indul**, két blokk bemelegítéssel
  és négy blokk lecsengéssel; ami e kívül történt, nincs benne.
