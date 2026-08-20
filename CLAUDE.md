# CLAUDE.md

Working notes for this repository. Everything here was verified against source,
not assumed — the "Verified facts" section carries file:line references so it
can be re-checked when the node is upgraded.

## What this project is

An explorer for a DeFCoN **devnet**, whose primary job is to record every DKG
round — including the ones that **did not happen** — and attribute member
failures to operators. It observes; it never touches consensus.

## Commands

```bash
npm install            # workspaces: shared, server, client
npm run typecheck      # all three workspaces
npm run build          # shared -> server -> client
npm run dev            # server :4100 + client :5190 (Vite proxies /api)
npm test               # server unit tests (vitest)
```

## Reference projects (read-only — copy from, never edit)

| Path | What | Use for |
|---|---|---|
| `~/DEFCON` (WSL Ubuntu), branch `v22.1.x` | DeFCoN Core, the build target | RPC semantics, LLMQ params |
| `d:\www\DeFCoN_Explorer\` | production explorer (deftrack.xyz) | Mongoose models, pollers, v1 route conventions, ops scripts |
| `d:\www\SCAN\` | Lit 3 explorer front-end | design system and component architecture |

The node source of truth is the **WSL** checkout, not `d:\www\DEFCON\` — the
latter sits on an unrelated branch with a deleted working tree.

## Devnet identity

| | |
|---|---|
| Network name | `defcon-q60` (identical `-devnet=` on every node, or nodes will not see each other) |
| Domain | `devnet.deftrack.xyz` |
| Database | `deftrack_devnet` |
| systemd unit | `deftrack-devnet.service` |
| Node role | plain full node + devnet seed node — **not** a masternode |

## Local development environment

MongoDB runs as a **userspace install inside WSL Ubuntu 24.04** (same OS as the
target VPS), not via Docker and not via apt — `sudo` needs a password here and
system state is better left untouched.

```
~/opt/mongodb        MongoDB 8.0.29 (tarball)
~/opt/mongosh        mongosh 2.10.0
~/devnet-mongo/      dbpath, logs, start.sh, .creds (chmod 600, never leaves the machine)
```

```bash
wsl -d Ubuntu -- ~/devnet-mongo/start.sh          # start (auth enabled, 127.0.0.1:27017)
wsl -d Ubuntu -- ~/devnet-mongo/start.sh stop     # stop
```

WSL2 forwards the port, so Windows reaches it at `127.0.0.1:27017`. Two users
exist on `deftrack_devnet`, both verified against their boundaries:

| User | Role | Used by |
|---|---|---|
| `devnet_app` | `readWrite` on `deftrack_devnet` | the server (`.env`) |
| `devnet_ro` | `read` on `deftrack_devnet` | the MongoDB MCP server |

MongoDB **8.0** rather than the 7.x the plan names: 7.x is no longer among the
supported releases. 8.0 is the long-term branch; 8.2/8.3 are rapid releases.

## MCP servers

Configured at **local** scope (`~/.claude.json`), so no connection string ever
reaches this public repository.

| Server | Purpose |
|---|---|
| `context7` | version-specific library docs (Mongoose, Express, zod, Lit) |
| `mongodb` | schema inspection — **read-only**, `deftrack_devnet` only, local instance |
| `playwright` | browser automation; used from Phase 3 to verify views render |

The MongoDB MCP takes its connection string from `MDB_MCP_CONNECTION_STRING`
plus `MDB_MCP_READ_ONLY=true`; the `--connectionString` flag is deprecated and
would print the password in `claude mcp list` output.

## Verified facts about the node (DeFCoN Core v22.1.4, `v22.1.x` @ `7227180053`)

### The devnet ChainLock quorum is `LLMQ_DEVNET`, not `LLMQ_400_60`

`src/chainparams.cpp:634` sets `llmqTypeChainLocks = LLMQ_DEVNET`.
Its parameters (`src/llmq/params.h:270-288`):

```
size 12 / minSize 7 / threshold 6 / dkgBadVotesThreshold 7
useRotation = false
dkgInterval = 24 blocks  ->  one DKG round per hour at 2.5 min blocks
```

Consequence: the devnet baseline is **not** the mainnet baseline. Profile
parameters therefore live in explorer config keyed by `llmqName` and are
snapshotted onto each round document — never hardcoded, never inferred.

### A round that does not form has no `quorumHash`

If the DKG fails, no commitment is mined, so `quorum listextended` simply does
not list the round. There is no hash to key an upsert on — yet these rows are
the entire point of the project.

So the collector reconstructs the **expected schedule** and matches observations
against it. The formula is taken from the node itself
(`src/rpc/quorums.cpp:320`):

```
quorumHeight = tipHeight - (tipHeight % dkgInterval) + quorumIndex
```

Idempotency key is synthetic:

```
roundKey = `${llmqType}:${expectedHeight}:${quorumIndex}`
```

`quorumHash` becomes an optional field, populated only when the round formed.
Upserts use a `unique` index on `roundKey` plus `$setOnInsert` for immutable
fields — the same pattern as the production ban-event collector
(`masternodePoller.service.ts:72-116`, `eventKey`), which was audited and
produces zero duplicates across restarts. Do not deviate.

### `previousConsecutiveDKGFailures` will not be in the output

`src/rpc/quorums.cpp:192` gates it behind `quorum->params.useRotation`.
`LLMQ_DEVNET` (and Q60) are **not** rotated, so the field is absent. Derive
consecutive failures from the reconstructed schedule instead.

### `-llmqdevnetparams` cannot express Q60

`src/chainparams.cpp:732-740`:

```cpp
params->size = size;
params->minSize = threshold;          // not independently settable
params->threshold = threshold;
params->dkgBadVotesThreshold = threshold;
```

`60:41` yields `60/41/41/41`; the intended `minSize = 44` is unreachable. Same
limitation as the regtest `-llmqtestparams` override. The first test round
therefore runs the **stock** `LLMQ_DEVNET` profile as a baseline.

### `quorum dkgstatus` is nearly empty on a non-masternode

The useful parts (`quorumConnections`, session phases) are guarded by
`node.mn_activeman`. Our node is not a masternode, so live DKG phase telemetry
is out of scope — observation is post-hoc, which is sufficient for the three
questions the project must answer.

### Which RPC returns what

| RPC | Returns |
|---|---|
| `quorum list [count]` | quorum hashes per LLMQ type |
| `quorum listextended [count]` | adds `numValidMembers`, `healthRatio`, `minedBlockHash`, `quorumIndex` |
| `quorum info <llmqType> <quorumHash> [includeSkShare]` | `height`, `type`, `quorumHash`, `quorumIndex`, `minedBlock`, `members[]` (`proTxHash`, `service`, `pubKeyOperator`, `valid`), `quorumPublicKey` |

`quorum info` does **not** return `numValidMembers` or `healthRatio`; those come
from `listextended`.

### Devnet masternode collateral is 1,000 DFCN

`src/chainparams.cpp:575` — `regularMnCollateral = 1000 * COIN`, against
`1000000 * COIN` on mainnet (`:232`). The test round has no financial exposure.

## Derived values to store

- `punishedCount = size - numValidMembers`
- `maxPossibleBan = size - minSize` — the structural ceiling on how many
  masternodes one round can punish. Displaying it is what makes a profile
  change legible.

## Behaviour the UI must make obvious

A failed DKG mines no commitment, and the node's punishment loop is guarded by a
non-null commitment check — so **nobody is PoSe-punished**. Failed rounds are
shown explicitly as `formed: false, punishedCount: 0`. Distinguishing "quorum
paused" from "quorum punished the network" is the whole purpose of this tool.

## Conventions

- **API envelope:** `{ success, data }`; paged endpoints always return the true
  `total` alongside the page. The production `/events` endpoint truncates at its
  limit with no indication — do not repeat that.
- **Validation:** zod on every route input; bounded `limit` / `hours`.
- **Caching:** `withCachePolicy` profiles + in-flight dedup, ported from the
  production server.
- **Commits:** no `Co-Authored-By` trailer — commits show the repository owner
  as the sole author.
- **Retention:** all TTLs >= 90 days, or disabled. The production noise TTL was
  shorter than the ban window, which made a real mainnet fork impossible to
  correlate afterwards.

## Hard constraints

- Never commit `.env`, RPC credentials, API keys, BLS keys, or non-public host
  addresses. **This repository is public** — a leaked secret must be rotated,
  not just deleted in a later commit.
- Never connect to the production deftrack MongoDB, and never reuse production
  RPC credentials or ingest tokens.
- Do not modify the reference projects.
- No market/price integrations, no migration hot-wallet tracking, no DNS-seeder
  feed — meaningless on a test chain.

## Gotchas

- `.env` with CRLF breaks `set -a; . ./.env` on Linux (`$'\r': command not
  found`). `.gitattributes` forces LF; keep it that way.
- The workspace folder name contains a space (`devnet .deftrack`) — quote paths.
- The planning-docs folder is named with 19 exclamation marks. In `.gitignore`
  the leading `!` must be escaped (`\!!!...`) or git reads it as a negation.
