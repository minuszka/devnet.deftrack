# devnet.deftrack

A dedicated blockchain explorer for a **DeFCoN devnet**, built to observe
**LLMQ quorum formation (DKG rounds)** and **PoSe behaviour** during a
masternode test round.

> **DEVNET — test network. Coins have no value.**

## Why

The DeFCoN mainnet suffers mass PoSe ban waves and periodic chain forks. A new
ChainLock quorum profile ("Q60") is proposed to fix both, but nothing is coded
yet. Before that work starts we need a live devnet with an explorer that can
*measure* current behaviour, so the new profile is compared against a real
baseline instead of a simulation.

**This project is the measuring instrument, not the consensus change.** It does
not touch consensus code or LLMQ parameters.

## What it has to answer

1. Did the last N DKG rounds form, and with what health ratio?
2. When a round did not form, was anybody punished? (expected: **no**)
3. Which operator's nodes account for the failures?

## Layout

```
shared/   types and constants shared by server and client
server/   Express + Mongoose + TypeScript -- RPC pollers, v1 API
client/   Lit 3 + Vite SPA
```

## Requirements

- Node.js >= 22 (see `.node-version`)
- MongoDB 7.x, database `deftrack_devnet`
- A DeFCoN Core node running on the devnet, RPC reachable on `127.0.0.1`

## Getting started

```bash
npm install
cp .env.example .env      # then fill in -- keep LF line endings
npm run dev               # server on :4100, client on :5190
```

## Status

Phase 0 — scaffolding. No collectors, no API, no views yet.

## License

MIT
