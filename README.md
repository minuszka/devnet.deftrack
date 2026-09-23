# A measurement explorer for the DeFCoN devnet

[![CI](https://github.com/minuszka/devnet.deftrack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/minuszka/devnet.deftrack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Built for the `defcon-q60` devnet.

Most block explorers show what happened. This one also records what *should* have happened and
did not: every scheduled DKG round is reconstructed from the chain's own schedule, so a quorum that
failed to form is a row in the record, not a silent gap. Masternode failures are attributed to
operators, and every deliberate intervention on the network is logged with its hypothesis declared
before the outcome is known. The result is a baseline that quorum and PoSe configuration changes can
be measured against.

The explorer only observes. It never signs, stakes or touches consensus.

> **Test network.** The devnet's coins have no value.

## Features

| Area | What is recorded |
|---|---|
| **Quorum rounds** | Every DKG round of every LLMQ profile, formed or failed, with health ratio, punished members and the profile parameters in force at that height |
| **PoSe** | Penalties, bans and revivals block by block, ban waves, and per-operator reliability |
| **ChainLocks** | Coverage and observed lock latency, from the first lock ever seen |
| **Sentinel Layer** | Service-PoSe epochs and commitments: who was marked missed, unobserved or absent |
| **Block production** | Staking health, producer concentration by host, block arrival lag |
| **Experiments** | Every rollout, outage and parameter test, with hypothesis, expected result and frozen outcome |
| **Simulator** | Fault scenarios planned and run against a local regtest lab, never against the live devnet |

## Architecture

```
 DeFCoN node ──RPC──┐
 (seed, devnet)     ├──► server  ──► MongoDB
 ZMQ (localhost) ───┘   Express        ▲
                        indexer        │
                        + /api/v1 ◄────┴──── client (Lit, Vite)
```

| Path | Contents |
|---|---|
| [`shared/`](shared/) | Types and contracts shared by server and client |
| [`server/`](server/) | Express + Mongoose: the chain indexer, collectors, and the `/api/v1` API |
| [`client/`](client/) | Lit 3 single-page front-end, built with Vite |
| [`ops/`](ops/) | Deployment, backup, fleet and measurement tooling, with its own tests |
| [`docker/`](docker/) | The regtest lab image used by the simulator |
| [`docs/`](docs/) | The rollout record and operational runbooks |

Every API response uses the envelope `{ success, data }`; paged endpoints always return the true
`total` alongside the page. Route inputs are validated with zod and bounded.

## Getting started

### Requirements

- Node.js 24 (see [`.node-version`](.node-version); `>=22` is enforced)
- MongoDB 8.0
- RPC access to a DeFCoN node on the `defcon-q60` devnet (`-devnet=defcon-q60`)

### Setup

From a clone of this repository:

```bash
npm install
cp .env.example .env        # then fill in MongoDB and node RPC settings
npm run dev                 # server on :4100, client on :5190 (Vite proxies /api)
```

`.env.example` documents every setting. Keep the node's RPC and ZMQ bound to localhost; the explorer
is designed to run beside the node, or to reach it over an SSH tunnel.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and client in watch mode |
| `npm run build` | Builds `shared`, then `server`, then `client` |
| `npm run typecheck` | Type-checks all three workspaces |
| `npm test` | Server and client unit tests (Vitest) |
| `npm run test:integration` | Integration tests against a throwaway MongoDB (`MONGODB_TEST_URI`) |
| `npm run verify:secrets` | The secret-scanning gate CI runs on every push |

## Documentation

- [`docs/devnet-rollouts.md`](docs/devnet-rollouts.md) — every binary rollout to the devnet, and what it changed
- [`docs/MONGO_BACKUP_RUNBOOK.md`](docs/MONGO_BACKUP_RUNBOOK.md) — the nightly database backup and restore check
- [`docs/NGINX_HEADERS_RUNBOOK.md`](docs/NGINX_HEADERS_RUNBOOK.md) — security headers on the served site
- [`CLAUDE.md`](CLAUDE.md) — verified facts about the node the explorer relies on, with source references

## Security

This repository is public. Never commit `.env`, RPC credentials, API keys, private keys or non-public
host addresses; CI runs a secret gate that fails on credentials and routable IPv4 addresses. If you find
a security issue, please report it privately to the maintainer rather than opening a public issue.

## License

Released under the [MIT License](LICENSE).
