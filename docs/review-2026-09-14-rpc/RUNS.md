# Futtatások és reprodukció

Vizsgált detached munkafa: `D:\www\deftrack-review-rpc-65dcadf`, HEAD `65dcadf3c314a93aced4abc103eb60045880dac4`. A közös checkout nem változott át. Az artifact-scriptek ezt a munkafát várják. Az itt felsorolt ismétlés helyi teszteket indít; telepítést nem végez.

## K1 és K3

PowerShell, a saját munkafából:

```powershell
git rev-parse HEAD
npm run build -w shared
npm run typecheck
npm test
wsl --exec pgrep -a mongod
# Csak az azonosított, eldobható helyi példány használható.
$env:MONGODB_TEST_URI = 'mongodb://' + ([string]::Join('.', @(127,0,0,1))) + ':27018'
npm run test:integration
```

A shared build, a typecheck, az npm test és az integrációs suite exit kódja 0. Az eredeti futtatások kimenete a `shared-build.log`, `k1-typecheck.log`, `k1-test.log`, `k3-integration.log` fájlokban van. K3-nál a suite generálja és törli a saját tesztadatbázisait. Más Mongo-példánnyal ne ismételd.

A meglévő gyökér-függőségek junctionon át voltak elérhetők. A saját server és client `node_modules/@devnet-deftrack/shared` hivatkozása a saját munkafa shared könyvtárára mutatott, hogy a közös shared-fejlesztés ne kerüljön a mérésbe.

## Saját reprodukció és mutációk

A bizonyítékkönyvtárból:

```powershell
node ./agent-measurement.mjs
python ./run-controls.py
python ./run-own-default.py
python ./final-evidence.py
```

- `agent-measurement.mjs`: kizárólag helyi, eldobható HTTP-szerver; valódi időzített bontás, lassú újrahasznált kérés, külön kérés-timeout. Eredmény: `agent-measurement.json`.
- `run-controls.py`: a nyolc meglévő célzott teszt, majd öt memóriabeli mutáció. Minden variánshoz külön konfiguráció és napló. A mutált kód nem kerül alkalmazásfájlba. A script végén a három fájl hash-azonosságát is ellenőrzi. A script exit 0-ja nem jelenti a mutánsok sikerét: az egyes tesztfuttatások exit kódjai a `negative-controls.json` fájlban vannak.
- `run-own-default.py`: a saját `defaults.test.ts` eredeti és hibás default melletti futtatása. A hibás változat exit 1 értéke az elvárt negatív eredmény.
- `final-evidence.py`: revíziók, hash-ek, verziók, a rögzített naplóösszesítés; a Node-forrás olvasása. Nem indít távoli tesztet.

A kiegészítő runner első indításakor a Windows alapértelmezett szövegkódolása miatt nem sikerült a Unicode naplót elmenteni. A review-runner UTF-8 naplóírásra állítása után mindkét változatot újrafuttattam; a végleges naplók és eredmények ezekből származnak.

## Távoli, kizárólag olvasási ellenőrzés

`collect-readonly.py` helyben futott. SSH-n a korábban megadott célhoz csak journal-lekérdezést, verzióolvasást, git revízióolvasást és `systemctl show` állapotolvasást küldött. A journal időablaka 2026-09-14 00:00–04:00 UTC. A teljes kimenet csak a helyi folyamat memóriájába érkezett; mentés előtt időbélyegekre és előre megadott eseménycímkékre szűrte. Nem futott távoli script és nem történt szolgáltatásmódosítás.

Az olvasási script egyben a helyi Core forrásából a timeout-definíciót és a PR/merge CI-státuszát is lekéri. Újraindítása új pillanatfelvétellel felülírja ezeket a review-bizonyítékokat; történeti összehasonlításhoz az eredetit előbb helyben külön kell megőrizni.
