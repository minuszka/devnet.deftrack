# Porting the v23 switchover instruments to the production explorer

**Status: a specification, not a change.** Everything below was read from
`d:\www\DeFCoN_Explorer` on 2026-09-10 with a negative control on every search;
nothing in that repository was modified. This project's CLAUDE.md says the
reference projects are read-only, so the work this file describes needs the
owner's explicit go before a line of it is written.

## Why it is owed

The v23 plan's phase 2 (the "v23 mainnet átállás" page) gates the release on
the mainnet explorer knowing the Q60 profile and measuring adoption **at least
a week before H−120**, because H−120 is the real deadline and there is no brake
after it. The devnet explorer got its half on 2026-09-10:
`GET /api/v1/masternodes/versions`, the software census that answers 152 of 152
here. The production side is what the go/no-go actually reads, and it does not
exist yet.

## The constraint that shapes all of it

**The mainnet explorer node had 55 connections today against 217 registered
masternodes** (its own public `/api/network`, read 2026-09-10). Any reading
taken from a peer table is therefore a **sample of at most a quarter of the
network**, not a census, and must publish its own coverage next to every share
it prints.

The devnet gets away with the same mechanism for the opposite reason: the fleet
dials the seed, so the seed's 169 peers are 161 inbound and 151 of 152
masternodes authenticate there. Nothing about that transfers to mainnet, where
the explorer is one node among many that operators may or may not connect to.

Three ways out, none of them chosen here, all of them measurable before they
are believed:

1. Raise the explorer node's inbound capacity and let coverage grow over days —
   cheap, slow, and it never reaches everyone.
2. An outbound prober: `protx list` gives every masternode's service address;
   a short connect that reads the version handshake and disconnects covers the
   whole set. This is real work and it is the only path to a genuine census.
3. Accept the sample and publish it as one. Honest, and probably not enough for
   a go/no-go that needs ≥ 90 %.

## What the production explorer already has (verified today)

| Thing | Where | Note |
|---|---|---|
| Per-node version store | `server/src/models/NodeInventory.ts` | `walletVersion`, `protocolVersion`, `lastVersionObservedAt`, `masternodeProTxHash`, keyed `ip:port` |
| A scanner that fills it | `server/src/services/nodeInventory.service.ts` | several sources: seed node, peer table, DNS seeder, pre-release list |
| Peer versions on the masternode list | `server/src/routes/v1/masternodes.v1.routes.ts` | maps `getpeerinfo` rows to masternodes **by host IP** (`parsePeerHost(peer.addr)`) |
| A public network snapshot | `server/src/routes/network.routes.ts` | what `/api/network` serves |

So the raw material is there. What is missing is an adoption *measurement* over
masternodes, the switchover's arithmetic, and the Q60 vocabulary.

## D1 — attribute a version to a masternode by MNAUTH, not by IP

`verified_proregtx_hash` occurs **zero times** in that repository (control: a
term that does exist, `parsePeerHost`, is found four times, so the search
works). Every version currently attributed to a masternode is attributed by
host address.

That is wrong wherever an operator runs more than one masternode on a machine,
which is the normal case: this devnet runs up to 14 per host, and a mainnet
operator with ten nodes behind one address would have all ten counted as
whatever the first peer row said.

Port `server/src/domain/nodeVersions.ts` (pure, 3 functions) and the writing
pattern of `server/src/services/nodeVersion.service.ts` from this repository:
a peer row that carries `verified_proregtx_hash` names the masternode exactly,
and the version is written onto that masternode's row with the sighting time.
Keep the IP path as a fallback for full nodes, and never let it overwrite a
value MNAUTH established.

Tests, mirroring the devnet's: a peer without a verified ProTx contributes
nothing; the same masternode connected twice is counted once; a stale sighting
is reported as stale rather than dropped or counted as current.

## D2 — adoption, scoped to masternodes, with its denominator visible

An endpoint the go/no-go can read, shaped like the devnet's
`/api/v1/masternodes/versions`:

- `total` = every **active** masternode from the list, not every connected peer;
- `known` / `stale` / `unknown` sum to `total`, with the staleness window stated
  in the answer;
- `byVersion[].share` over `total`;
- **`coverage`** — `known / total` — published beside them, because on mainnet
  it is a fraction and the reader must see it;
- `targetRelease` / `targetProtocol` for v23, so the page can say "N of 217
  ready" rather than making the reader do the join.

The failure this shape exists to prevent is the one the devnet already
documented: a ratio over the nodes that happened to be connected reads high
exactly when the missing ones are the problem.

## D3 — the countdown to H−120 and H

H is not pinned yet, and the page must be correct before it is. Config carries
`V23_ACTIVATION_HEIGHT` (unset by default) and the derived
`formationGateHeight = H − (signingActiveQuorumCount + 1) × dkgInterval`
= H − 120 for Q60.

- H unset: the page says the height is not fixed and shows the adoption number
  the decision will be made on. It never invents a date.
- H set: blocks to H−120 and to H, plus an estimate in time — from the
  **mean** block interval, never the median. Intervals are exponential, the
  median is 0.693 of the mean, and reading the median against the target makes
  a chain within 8 % of it look 25 % fast (CLAUDE.md, measurement caveats).
- Past H−120: the page says the deadline has passed and what that means for a
  node still on the old binary — it will reject the first `llmq_defcon`
  commitment as `bad-qc-invalid` and fork off.

## D4 — the Q60 vocabulary (the phase-2 first bullet, and the largest piece)

The production explorer's quorum views know the profiles mainnet forms today.
For v23 they need type 7, `formationGateHeight`, the `impossible` round status
and the reconstructed schedule — all of which exist here in
`server/src/config/llmq.ts` and `server/src/domain/dkgSchedule.ts`, with tests.
This is a port of a model, not an idea, and it is the part that needs the most
care: a round below the formation gate is **not** a failed round, and writing
it as one inflates the first real round's failure streak. This repository made
that exact mistake and had to backfill eleven rows.

## Order, and what each step is worth

1. **D2 + D1** — without them there is no adoption number, and the go/no-go has
   nothing to read. D1 is what makes D2 true rather than plausible.
2. **D3** — cheap once D2 exists, and it is what operators see.
3. **D4** — needed before H−120 so the switchover is legible on the day, but it
   does not gate the decision to pin H.

## Owner's decision, in one line each

- May the production repository be edited for this, and by whom?
- Which of the three coverage routes: raise inbound capacity, build the prober,
  or publish a sample and say so?
- Where does the countdown live — the production site (mainnet audience,
  mainnet data), or a separate page?
