# MongoDB-mentés — runbook

Mit old meg: a devnet explorer adatbázisáról (`deftrack_devnet`) 2026-09-14-ig **semmilyen mentés nem
készült** — a VPS-en mérve: se dump, se időzítő, se cron. Az adatbázis nem a lánc gyorsítótára. Egy része
egyetlen node-ból sem olvasható vissza:

- a meg nem alakult DKG-körök, amelyek már kikerültek a `quorum listextended` ablakából;
- a nyers ZMQ-megfigyelések;
- az admin API-n bejelentett operátor-hozzárendelések;
- az Experiments futamrekordok, amelyek egy bináris-rolloutot a lánchoz kötnek;
- a szimulátor futamai.

A fájlok:

| Fájl | Mi |
|---|---|
| [`ops/mongo-backup.sh`](../ops/mongo-backup.sh) | egy mentés: dump, ellenőrzés, megtartás, ritkítás (a fejkomment a teljes szerződés) |
| [`ops/systemd/deftrack-mongo-backup.service`](../ops/systemd/deftrack-mongo-backup.service) | oneshot, sandboxolva, csak a mentési mappába írhat |
| [`ops/systemd/deftrack-mongo-backup.timer`](../ops/systemd/deftrack-mongo-backup.timer) | naponta 03:30 UTC, legfeljebb 15 perc véletlen késleltetéssel |
| [`ops/tests/mongo-backup.sh`](../ops/tests/mongo-backup.sh) | a szkript tesztje hamis `mongodump`-pal; a CI futtatja |

## Amit tudni kell, mielőtt bármihez hozzányúl az ember

- **Az archívum érzékeny.** Nem nyilvános host-címeket (operátor-hozzárendelés) és admin session-rekordokat
  tartalmaz. A mentési mappa `0700`, minden fájl `0600`, root tulajdonban. **Semmilyen másolata nem kerülhet
  a repóba**, és a gépen kívüli másolat is csak privát helyen lehet.
- **Csak olvasó felhasználóval fut** (`devnet_ro`, `read` szerep a `deftrack_devnet`-en). A jelszó egy root
  által olvasható YAML-ból megy a `mongodump --config`-ba, a parancssorba soha — ott minden helyi felhasználó
  látná (`ps`).
- **Nem pillanatkép.** Egy önálló (replica set nélküli) mongodnak nincs oplogja, amivel egy időpontra lehetne
  rögzíteni, és az indexer közben ír. Minden gyűjtemény önmagában konzisztens, a gyűjtemények között
  másodperces eltérés lehet; az indexer a következő körben rendbe teszi.
- **Egy sikertelen futás semmit nem tart meg és semmit nem töröl.** A ritkítás csak egy ellenőrzött új
  archívum után fut, így a legutóbbi jó mentést sosem cseréli le egy rosszra.
- **A futás „sikeres” szó szerint ellenőrzött:** a `mongodump` exit kódja, a gzip-folyam épsége
  (`gzip -t`), a mongodump-archívum magic száma, legalább egy gyűjtemény, és minden elkezdett gyűjteményhez
  egy „done dumping” sor. A 0-s exit egymagában semmit nem bizonyít: egy elgépelt adatbázisnévvel a
  `mongodump` 0 gyűjteményt ment és 0-val lép ki (mérve 100.18.0-val).

## Telepítés

A VPS-en, rootként, a mergelt `main`-ről (`/opt/devnet-deftrack/app`, a `ops/deploy.sh` után).

```bash
cd /opt/devnet-deftrack/app

# 1. A szkript root-tulajdonú másolatként. Nem a checkoutból fut: azt a deploy frissíti, és egy root
#    szolgáltatás, amely egy kevesebb joggal is átírható fájlt futtat, root-jog szerzésére ad utat.
install -m 0755 -o root -g root ops/mongo-backup.sh /usr/local/sbin/deftrack-mongo-backup
cmp ops/mongo-backup.sh /usr/local/sbin/deftrack-mongo-backup && echo "installed copy matches the checkout"

# 2. A jelszófájl — a jelszó kiírása nélkül. A /root/.devnet-mongo-creds `RO_PW=` sorából, YAML
#    egyszeres idézőjelek között (a benne lévő ' megduplázva).
install -d -m 0700 -o root -g root /etc/deftrack-backup
( umask 077
  pw=$(sed -n 's/^RO_PW=//p' /root/.devnet-mongo-creds)
  [ -n "$pw" ] || { echo "RO_PW not found"; exit 1; }
  printf "password: '%s'\n" "$(printf '%s' "$pw" | sed "s/'/''/g")" > /etc/deftrack-backup/mongodump.yaml )
stat -c '%a %U' /etc/deftrack-backup/mongodump.yaml          # 600 root

# 3. A mentési mappa. A unit sandboxa csak ide enged írni, és a mappának már az első indítás előtt léteznie kell.
install -d -m 0700 -o root -g root /var/backups/deftrack-mongo

# 4. A unitok.
install -m 0644 ops/systemd/deftrack-mongo-backup.service ops/systemd/deftrack-mongo-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/deftrack-mongo-backup.service /etc/systemd/system/deftrack-mongo-backup.timer
```

Ha a `RO_PW` érték a fájlban maga is idézőjelek között áll, a 2. lépés az idézőjeleket is a jelszóba
írná. Ezt az első futás megfogja (hitelesítési hiba, a unit `failed`, semmi nem marad meg); ilyenkor a fájl
formátumát kell megnézni, nem a szkriptet.

## Első futás és ellenőrzés

```bash
systemctl start deftrack-mongo-backup.service                 # a futás végéig vár
systemctl status deftrack-mongo-backup.service --no-pager      # Result=success
journalctl -u deftrack-mongo-backup.service -n 5 -o cat        # az összegző sor: méret, gyűjtemény, dokumentum

cd /var/backups/deftrack-mongo
ls -l                                                          # minden fájl -rw------- root
newest=$(ls deftrack_devnet-*.archive.gz | sort | tail -1)
sha256sum -c "${newest%.archive.gz}.sha256"
cat "${newest%.archive.gz}.manifest"                           # gyűjteményenként a dokumentumszám
```

Csak ha ez rendben van, jöhet az időzítő:

```bash
systemctl enable --now deftrack-mongo-backup.timer
systemctl list-timers deftrack-mongo-backup.timer --no-pager
```

## Mindennapi ellenőrzés

```bash
systemctl list-timers deftrack-mongo-backup.timer --no-pager   # mikor futott utoljára, mikor fut legközelebb
systemctl --failed --no-legend                                 # egy sikertelen mentés itt látszik
ls -lt /var/backups/deftrack-mongo | head                      # a legfrissebb archívum dátuma
```

Alapból a legutóbbi **14** archívum marad meg (`DEFTRACK_BACKUP_KEEP`, a unitban
`Environment=`-tel felülírható).

## Visszaállítás-próba — soha nem az élő adatbázisra

Egy mentés, amit még senki nem állított vissza, nem bizonyított mentés. A próba egy eldobható példányon
fut (helyben a WSL-es, auth nélküli mongodon, 27018-as porton), **átnevezett névtérbe**:

```bash
# a munkaállomáson; a másolat a repón kívül maradjon
scp devnet:/var/backups/deftrack-mongo/<archívum>.archive.gz devnet:/var/backups/deftrack-mongo/<archívum>.manifest <helyi mappa>/

mongorestore --host 127.0.0.1 --port 27018 --archive=<archívum>.archive.gz --gzip \
  --nsFrom='deftrack_devnet.*' --nsTo='restorecheck.*'
# gyűjteményenként a dokumentumszám egyezzen a manifesttel; utána:
mongosh --quiet mongodb://127.0.0.1:27018/restorecheck --eval 'db.dropDatabase()'
```

Az átnevezés nem opcionális: a `deftrack_devnet` név sosem tesztadatbázis, és így a próba egyetlen helyi
adatbázissal sem ütközhet.

## Valódi visszaállítás — csak tulajdonosi döntés után

Felülírja az élő adatbázist, és a mentés időpontja utáni, láncból nem pótolható adat elvész. A menet:

1. `systemctl stop deftrack-devnet` — az indexer ne írjon közben.
2. Előbb próba átnevezett névtérbe (előző pont), a manifesttel összevetve.
3. `mongorestore` a `devnet_app` felhasználóval (`readWrite` a `deftrack_devnet`-en), `--drop`-pal,
   `--nsInclude='deftrack_devnet.*'`, a jelszót ugyanúgy `--config`-fájlból, nem parancssorból.
4. `systemctl start deftrack-devnet`, majd a health: a láncadatot az indexer a node-ból pótolja.

## Gépen kívüli másolat — nyitott döntés

A VPS-en tartott mentés a gép vagy a lemez elvesztésekor maga is elvész. Ehhez döntés kell arról, hová
kerüljön a másolat, és az csak privát hely lehet. Amíg nincs döntés, a visszaállítás-próbánál lehúzott másolat
az egyetlen gépen kívüli példány.

## Eltávolítás

```bash
systemctl disable --now deftrack-mongo-backup.timer
rm -f /etc/systemd/system/deftrack-mongo-backup.service /etc/systemd/system/deftrack-mongo-backup.timer
systemctl daemon-reload
rm -f /usr/local/sbin/deftrack-mongo-backup
# a jelszófájl és a meglévő archívumok törlése külön döntés:
#   /etc/deftrack-backup/   /var/backups/deftrack-mongo/
```
