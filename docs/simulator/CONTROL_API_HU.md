# Simulator Control API és CLI

A 6. napi vezérlőréteg kizárólag a biztonságos DryRun életciklust hajtja
végre. Nincs action worker, SSH, service manager vagy hálózati fault injection.
Egy `live` run előkészíthető, de a recovery preflight és a `start` fail-closed
marad a 8. napi, lease-es executor elkészültéig.

## Bizalmi határ

- Privát alapútvonal: `/api/v1/admin/simulations`.
- Kötelező: `X-Admin-Api-Key` és `X-Simulation-Client: deftrack-cli-v1`.
- Minden módosító kéréshez kötelező a 8–200 karakteres
  `X-Idempotency-Key`.
- Az API nem fogad böngészős `Origin` vagy `Cookie` fejlécet. A későbbi
  session + CSRF token adminpanel külön hitelesítési adapter lesz.
- A szerepkör szerverkonfiguráció: a kliens nem adhat meg saját role-t vagy
  audit identityt.
- A privát útvonal külön 30 kérés/perc/IP limitet kap.

Kötelező identity pin-ek:

```env
SIMULATION_ADMIN_ACTOR_ID=devnet-operator
SIMULATION_ADMIN_ROLE=operator
SIMULATION_EXPECTED_CHAIN=devnet-defcon-q60
SIMULATION_EXPECTED_GENESIS_HASH=<64 hex>
SIMULATION_EXPECTED_WRAPPER_VERSION=<8. napi wrapper-verzió>
```

Az utolsó érték hiánya nem akadályozza a DryRun-t, mert ott recovery worker
nem szükséges; live preflightnál viszont nincs kerülőút.

## Végpontok

- `GET /scenarios`
- `POST /runs`
- `POST /runs/:runKey/validate`
- `GET /runs/:runKey/dry-run`
- `POST /runs/:runKey/arm`
- `POST /runs/:runKey/start`
- `POST /runs/:runKey/abort`
- `POST /runs/:runKey/recover`
- `GET /runs/:runKey`
- `GET /runs/:runKey/history`

A publikus, csak olvasható lista ettől külön a `/api/v1/simulations` alatt
érhető el. A Mongo lekérdezés kötelező allowlist-projekciót használ; sem a
`hostRef`, sem a `unitRef`, sem a `preflight.privateDetail`, sem az audit actor
nem kerülhet a válaszba. A DTO ezt második védelmi rétegként ismét kizárja.

## Jóváhagyás

A scenario registry `riskClass` értéke tényleges kapu:

- `operator`: low és medium;
- `safety-admin`: low, medium és high.

Az `arm` kérésben a kliensnek vissza kell igazolnia a registry aktuális
kockázati osztályát. A role és a riskClass sem írható felül a requestből.

## Biztonsági időzítés és baseline

A kliens nem küldhet `runExpiresAtMs` értéket. A szerver a validált DryRun
akcióterv összes `faultLeaseSeconds`, action-expiry, recovery- és cooldown
ablakából vezeti le. Így egy hostoldali TTL nem élheti túl a run biztonsági
burkát.

A baseline policy szintén kód-tulajdonú: 24 blokkos DKG-intervallum, legalább
3 lezárt kör, 80% ChainLock coverage, 2 blokk warm-up és 4 blokk cooldown. A
hívó sem teljes, sem részleges policy override-ot nem adhat.

Az azonosíthatatlan megfigyelt masternode-host (`hostRef === null`) blokkolja
a draftot. Ez szándékos fail-closed döntés: nélküle a
`proTxHash → targetId → hostRef → unitRef` lánc nem bizonyítható, miközben a
snapshot még élesíthető lenne.

## CLI

Build után:

```powershell
npm --prefix server run build
$env:ADMIN_API_KEY = '<kulcs>'
$env:SIMULATION_API_URL = 'http://127.0.0.1:4100'
npm --prefix server run simulator -- scenarios
```

Teljes DryRun életciklus egy paranccsal:

```powershell
npm --prefix server run simulator -- dry-lifecycle `
  --scenario-file .\scenario.json `
  --risk medium `
  --idempotency-prefix local-check-001
```

Ez sorrendben create, validate, dry-run lekérés, arm, start és status kérést
végez. Az API-kulcsot nem írja ki.
