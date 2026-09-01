# Simulator fejlesztési handoff

Aktuális fázis: 5. nap kész – fail-closed preflight, baseline és target resolution

Aktuális branch: `feat/devnet-chaos-orchestrator`

Előző napi commit: `727a710 feat: add safe simulation dry-run planner`

## Elkészült az 1–4. napon

- Bizalmi határok, mainnet hard-disable terv és orchesztráció/mérés szétválasztása.
- Persistálható run state machine, timeout/recovery/restart reconcile.
- Determinisztikus run/action ID és egyetlen live-run lock ABA-védelemmel.
- Standalone MongoDB-kompatibilis event-first/CAS persistencia és append-only audit.
- Privát, alapból disabled target registry.
- Nyolc zárt scenario, strict Zod validation és biztonsági limitek.
- DKG/ChainLock küszöb-, host- és staker presetek.
- Mellékhatásmentes DryRun, stabil actionterv, blast-radius/Q60 margin és Core-szimulátor hivatkozás.

## Elkészült az 5. napon

- Fail-closed `proTxHash → targetId → hostRef → unitRef/P2P port` feloldás.
- Aktív MN, host height/freshness és pinned SHA-256 node-build összevetés.
- Duplikált target/proTx/runtime evidence/unit/port felismerése.
- Enabled/non-maintenance/network scope és 20 targetes resolver-korlát.
- Determinisztikus random, teljes host, operator és aktuális quorum alapú kiválasztás.
- `prepareSimulationDraft()`: teljes candidate population + partition peer mapping immutable snapshotja és DryRun integráció.
- Feloldhatatlan vagy duplikált quorumtag esetén draft sem készül.
- 11 strukturált preflight check public/private részletekkel.
- Chain név + genesis identity, IBD/sync, explorer lag/gap, observer, build, konfliktus és recovery kapuk.
- Stale immutable target snapshot tiltása és policy szerinti teljes quorumméret ellenőrzése.
- 72 blokk / 3 DKG round / 58 ChainLock alap baseline; 2 blokk warm-up és 4 blokk cooldown exclusion.
- Data-quality confidence: required hiba `low`, warning/ZMQ gap `medium`, tiszta evidence `high`.

## Fontos sorrendi döntés

A target snapshot a run létrehozása előtt készül, mert a metadata immutable. A preflight ezt ellenőrzi, de nem írja át. A teljes candidate population kerül a privát metadatába, nem csak a kiválasztott targetek: ettől reprodukálható marad a seedelt sample, és a partition peer ID-k sem mutatnak snapshoton kívülre.

Az 5. napi domain tiszta és mellékhatásmentes. A tényleges Mongo/RPC read-only evidence assembly, a run create/transition és az admin végpont a 6. napi Control API-ban készül. Ez nem fault executor: a 6. nap végén sem lesz SSH/systemd/tc/firewall hívás.

## 5. napi fájlok

- `docs/simulator/PREFLIGHT_HU.md`
- `docs/SIMULATOR_HANDOFF.md`
- `server/src/simulator/targetResolver.ts` és tesztje
- `server/src/simulator/measurementWindows.ts` és tesztje
- `server/src/simulator/preflight.ts` és tesztje
- `server/src/simulator/draftPreparation.ts` és tesztje

## Következő pontos feladat – 6. nap

Privát Control API és fejlesztői CLI, végrehajtás nélkül:

1. szigorú admin route-ok: scenario-list, draft create, preflight, dry-run, approve/arm, status/history;
2. idempotency key minden módosító kéréshez;
3. read-only Mongo/RPC evidence assembler az 5. napi domainhez;
4. preflight eredmény és DryRun terv auditálható persistálása;
5. state transition csak sikeres required preflight és baseline után;
6. public/private DTO-redakció és admin rate limit;
7. CLI, amely ugyanazt az API-t használja;
8. továbbra sincs action worker, SSH vagy valódi fault injection.

Külső állapot/VPS-művelet történt-e: nem

Aktív fault vagy recovery timer: nincs

Felhasználói jóváhagyás szükséges-e: a 6. napi lokális API/CLI munkához nem; VPS pilot előtt igen
