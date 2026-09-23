# devnet.deftrack

An explorer for the DeFCoN **devnet** (`defcon-q60`), live at
[devnet.deftrack.xyz](https://devnet.deftrack.xyz). Its primary job is to record every DKG round —
including the ones that did not happen — and to attribute masternode failures, so that quorum
configuration changes can be compared against a measured baseline. It observes the network; it never
touches consensus.

**DEVNET — a test network. Its coins have no value.**

## What it records

- DKG / LLMQ rounds for every quorum profile, reconstructed from the expected schedule, so a round that
  failed to form is a row, not a gap
- PoSe penalties, bans and revivals, block by block
- ChainLock coverage and InstantSend behaviour
- Sentinel Layer (service PoSe) epochs and commitments
- the Experiments record: every intervention on the network, with its hypothesis declared before the
  outcome is known

## Layout

| Path | What |
|---|---|
| `shared/` | types shared by server and client |
| `server/` | Express + Mongoose indexer and API (`/api/v1/...`) |
| `client/` | Lit front-end, built with Vite |
| `ops/` | deployment, backup, fleet and measurement tooling |
| `docker/` | the regtest lab image |
| `docs/` | the rollout record and operational runbooks |

## Development

```bash
npm install            # workspaces: shared, server, client
npm run typecheck      # all three workspaces
npm run build          # shared -> server -> client
npm run dev            # server :4100 + client :5190 (Vite proxies /api)
npm test               # server unit tests (vitest)
```

The server needs a MongoDB instance and a DeFCoN node's RPC; see `.env.example`. `CLAUDE.md` holds the
verified facts about the node that the explorer relies on, with source references.

## Documentation

- [`docs/devnet-rollouts.md`](docs/devnet-rollouts.md) — what has been deployed to the devnet, and when
- [`docs/MONGO_BACKUP_RUNBOOK.md`](docs/MONGO_BACKUP_RUNBOOK.md) — the nightly database backup
- [`docs/NGINX_HEADERS_RUNBOOK.md`](docs/NGINX_HEADERS_RUNBOOK.md) — security headers on the served site

## License

MIT
