# nginx biztonsági fejlécek – telepítési runbook

Mit old meg: **F10** (a HTML-válaszról hiányzik a CSP és a HSTS). Az API-n a
helmet már küldi mindkettőt, de az **nem ugyanaz**: az nginx által kiszolgált
dokumentumra egyik sem kerül rá, és egy olvasó, aki sosem hív `/api/`-t, sosem
kapja meg őket.

A fájlok: [`ops/nginx/`](../ops/nginx/). Az **éles teljes vhost nincs a
repóban** és nem is kerül bele — a szerveren él, és ez a runbook azt írja le,
hogyan illeszkedik bele a snippet, nem azt, hogy hogyan írjuk felül.

## Amit tudni kell, mielőtt bármit hozzáér az ember

Az nginx `add_header` direktívái **nem halmozódnak**. Ha egy `location` akár
egyetlen saját `add_header`-t deklarál, azzal **eldobja az összes örökölt**
`add_header`-t a `server` blokkból — csendben, figyelmeztetés nélkül, és az
`nginx -t` ettől még sikeres.

Az éles vhost ezt eddig úgy kezelte, hogy ugyanazt a négy fejlécet **három
helyen** megismételte. Ez helyes — és pontosan ez az a szerkezet, amiben egy
ötödik fejléc kettőbe bekerül, a harmadikba nem.

Ezért van snippet: **egy fájl a teljes készlet**, és minden location, amelynek
bármi saját fejléce van, **beemeli**, majd hozzáteszi a magáét.

Minden fejléc `always`: nélküle az nginx a hibaválaszokra (4xx/5xx) nem teszi
rá. Egy 404 ezen a site-on ugyanolyan oldal, mint a többi.

## Telepítés

```bash
# 1. A snippetek a helyükre. Report-only-val kezdünk.
scp ops/nginx/security-headers.conf  devnet:/etc/nginx/snippets/deftrack-security-headers.conf
scp ops/nginx/csp-report-only.conf   devnet:/etc/nginx/snippets/deftrack-csp.conf

# 2. Biztonsági másolat az élő vhostról, dátummal.
ssh devnet 'cp /etc/nginx/sites-available/devnet.deftrack \
               /etc/nginx/sites-available/devnet.deftrack.bak-$(date +%F-%H%M)'
```

Ezután a vhostban **a négy meglévő `add_header` sor helyére** kerül két
`include`, a `server` blokkban **és** mindegyik olyan locationben, amelyiknek
saját fejléce van (`= /index.html`, `/assets/`):

```nginx
    include /etc/nginx/snippets/deftrack-security-headers.conf;
    include /etc/nginx/snippets/deftrack-csp.conf;
```

A location-specifikus `add_header Cache-Control ...` sorok **maradnak**, az
`include` után.

```bash
# 3. Szintaxis, majd újratöltés. A -t nem opcionális.
ssh devnet 'nginx -t && systemctl reload nginx'
```

## Ellenőrzés

**Izolált, élő rendszert nem érintő teszt** (saját prefix, 127.0.0.1:8099,
semmi systemctl):

```bash
npm run build
ops/nginx/verify-headers.sh client/dist
```

Végigméri a `/`, `/rounds`, `/admin`, egy content-hash-elt asset és egy **404**
válaszát, és elbukik az első hiányzó fejlécnél. Ez az egyetlen dolog, ami az
`add_header`-öröklés csapdáját elkapja — az `nginx -t` nem.

**A CSP túlélhetősége a valódi buildben:**

```bash
npm run test:csp -w client
```

A `ops/nginx/csp-enforce.conf`-ból **kiolvasott** házirendet teszi a
dokumentumra egy igazi böngészőben, és `securitypolicyviolation` eseményeket
gyűjt. Az **enforce** változatot használja, nem a report-only-t: report-only
alatt a „nincs jogsértés" és a „a házirend hatástalan" egyformán néz ki. Van
benne kontroll is, ami injektál egy inline scriptet, és megköveteli, hogy a
böngésző visszautasítsa.

**Éles ellenőrzés telepítés után:**

```bash
for p in / /rounds /admin /assets/index-*.js /nincs-ilyen-oldal; do
  curl -sS -D - -o /dev/null "https://devnet.deftrack.xyz$p" \
    | grep -iE 'HTTP/|content-security-policy|strict-transport|x-frame|x-content-type|x-robots|referrer-policy|cache-control'
done
```

## Report-only → enforce

Csak akkor, ha a report-only kör tiszta volt **azon a buildeen, ami ki van
téve**:

```bash
scp ops/nginx/csp-enforce.conf devnet:/etc/nginx/snippets/deftrack-csp.conf
ssh devnet 'nginx -t && systemctl reload nginx'
```

A két házirend szövege **karakterre azonos**, ezért az előléptetés egyetlen
fájlcsere. A `verify-headers.sh` külön ellenőrzi, hogy nem csúsztak szét — ha
valaki csak az egyiket szerkeszti, elbukik.

## Visszaállítás

```bash
ssh devnet 'cp /etc/nginx/sites-available/devnet.deftrack.bak-<dátum> \
               /etc/nginx/sites-available/devnet.deftrack && \
            nginx -t && systemctl reload nginx'
```

A `reload` nem bontja a meglévő kapcsolatokat; a régi worker kiszolgálja, amit
elkezdett. Ha csak a CSP a gond, elég a snippetet visszatenni report-only-ra és
újratölteni — a vhostot nem kell hozzányúlni.

## Ami szándékosan kimaradt

- **HSTS `preload` nincs.** A preload egy böngészőkbe beépített listára szóló,
  gyakorlatilag egyirányú bejelentkezés, és a **teljes** regisztrálható
  domainre szól — a `deftrack.xyz` pedig többet szolgál ki ennél a devnetnél.
  Nem ennek a munkának a hatásköre, és nem is olyasmi, amit mellékhatásként
  szabad megszerezni.
- **CSP `report-uri` / `report-to` nincs.** Nincs gyűjtő ezen a telepítésen, és
  egy nem létező hostra mutató riportcím konzolzajt csinál, ami hibának néz ki.
  A report-only gyűjtő nélkül is minden jogsértést megmutat a konzolon és a
  `securitypolicyviolation` eseményben — az ellenőrzés is abból dolgozik.
- **A `style-src 'unsafe-inline'` bent van, és mérés mondja, hogy miért.**
  Lásd a `csp-report-only.conf` kommentjét: a 31 számolt `style=` attribútum
  miatt kell, nem a Lit miatt. A szűkebb `style-src-attr` forma **itt** elég
  lenne, de régebbi böngészőkön csendben elbukna; a valódi szigorítás a
  kliensben van, nem a fejlécben.
