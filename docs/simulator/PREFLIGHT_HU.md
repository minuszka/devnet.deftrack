# Devnet Simulator – preflight és célpontfeloldás

Állapot: 5. napi implementáció

## Sorrendi invariáns

A privát target snapshot a `SimulationRun` létrehozása előtt készül. Ennek oka, hogy a run metadata – scenario, paraméter, seed és kiválasztási populáció – létrehozás után immutable. A preflight ellenőrzi ezt a snapshotot, de nem cserélheti ki csendben frissebb vagy más targetekre.

A `prepareSimulationDraft()` ezért:

1. feloldja és ellenőrzi a teljes engedélyezett target inventoryt;
2. az aktuális quorum proTx hash-eit egyértelmű target ID-kre képezi;
3. elkészíti a determinisztikus DryRun tervet;
4. visszaadja az immutable run metadatát és a tervet;
5. nem ír adatbázisba és nem indít külső műveletet.

Hiányos inventory esetén nincs részleges/best-effort terv.

## Mapping-ellenőrzés

Az explicit privát registry kapcsolata:

```text
proTxHash → targetId → hostRef → unitRef + P2P port
                         └────→ host observer → binary hash + chain height
```

Blokkoló hibák többek között:

- duplikált target ID, proTx, host/unit vagy host/port;
- duplikált runtime MN/host evidence;
- hiányzó vagy nem aktív proTx;
- az on-chain MN host és a registry host eltérése;
- hiányzó vagy stale host observer;
- a host lemaradt vagy a tip elé került;
- hiányzó/malformed pinned SHA-256 build hash;
- ismeretlen vagy eltérő futó binary hash;
- üres vagy duplikált capability lista;
- hibás host, unit vagy port mapping.

Csak `enabled=true`, `maintenance=false` és a kért `regtest/devnet` hálózathoz tartozó target kerülhet a snapshotba. A mappingből publikus DTO nem készül; host, unit és port privát marad.

## Kiválasztási módok

- seedelt, determinisztikus random minta;
- teljes host az anchor target alapján;
- teljes operator-csoport;
- aktuális quorumtagok proTx listája.

A host- és operator-csoport sem lépheti túl a 20 targetes blast-radius limitet. A quorumtaglista duplikált vagy feloldhatatlan tag esetén fail closed.

## Preflight checkek

Az `evaluateSimulationPreflight()` tiszta értékelő. Minden check strukturált `required` vagy `warning` eredményt és külön public/private üzenetet ad.

Required checkek élő futás előtt:

- `network-identity`: pontos chain név és genesis hash; csak devnet vagy explicit regtest;
- `chain-synced`: nincs IBD, blocks = headers = snapshot height;
- `explorer-synced`: megengedett lag, friss sync és nincs missing height/error;
- `target-resolved`: teljes, egyértelmű és nem stale immutable snapshot;
- `target-build-match`: minden target a pinned buildet futtatja;
- `observer-fresh`: coverage, frissesség és stale-target limit;
- `targets-active`: aktív MN és aktuális host height;
- `no-active-experiment`: nincs másik live simulation vagy running experiment;
- `recovery-ready`: friss worker, megfelelő wrapper, tiszta fault state minden érintett targeten;
- `quorum-stable`: quorum-scenario esetén friss, stabil, teljes méretű és teljesen feloldott membership;
- `baseline-ready`: arm előtt elegendő mérési minta.

Az initial preflightnál a még nem kész baseline és a nem szükséges quorum check warning lehet. Required hiba esetén `passed=false`; warning csak a data-quality confidence értékét csökkenti.

## Baseline, warm-up és cooldown

Alap policy a jelenlegi 24 blokkos DKG intervallumhoz:

- baseline: 3 teljes DKG intervallum, azaz 72 blokk;
- minimum 3 resolved DKG round;
- minimum 80% ChainLock-minta, azaz 58/72 blokk;
- fault után az első 2 blokk warm-up, mérésből kizárva;
- recovery után 4 blokk cooldown, mérésből kizárva.

A magasságtartományok explicitek és nem fedhetik át egymást. Korai chainen a baseline kezdete 0-ra clampelődik, de a 72 mintás minimum nem lazul: ha nincs elég adat, az arm blokkolva marad.

## Data quality

A snapshot tartalmazza:

- observer coverage százalék;
- stale target szám;
- explorer lag;
- missing height lista;
- `high`, `medium` vagy `low` confidence.

Required hiba `low`, csak warning vagy ZMQ sequence gap `medium`, teljesen tiszta evidence `high`.

## Biztonsági határ

Az 5. napi kód nem hív RPC-t, MongoDB-t, SSH-t, Dockert, `systemctl`-t, `tc`-t vagy firewallt. Evidence-adatot kap paraméterként, így egységtesztben bizonyíthatóan determinisztikus. A tényleges read-only adatforrás-összeállítás és a state transition a 6. napi Control API feladata; fault executor továbbra sincs.
