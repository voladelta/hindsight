# Hindsight repository instructions

## Project

Hindsight is a blind historical decision-replay game built with Nansen data. Contributors can change historical metrics, evidence, and fixed comparison rules while keeping the replay blind and the data private. Read [README.md](README.md) when you need the player flow, local setup, or customization steps. Use the existing Bun, Vite, React, TypeScript, and SQLite stack. Check `package.json` for runtime versions and commands.

Keep changes within the requested scope and preserve unrelated work. Keep setup reproducible with the committed lockfile. Do not add accounts, wallets, real trading, subscriptions, leaderboards, multiplayer, or runtime LLM strategies without an explicit request.

## Replay boundaries

The server owns round state and outcomes. Build a separate response object for each stage. Never send database records or raw provider responses to clients.

- **Before the first choice:** show the masked chart and permitted assumptions. Omit token identity, dates, evidence, opponent choices, and future prices.
- **After the first choice:** release historical evidence, but keep the opponent, identity, dates, and future prices hidden.
- **After the final choice:** release the opponent's choice, but keep identity, dates, and future prices hidden.
- **At reveal:** release identity, dates, and outcome. Mark the outcome unscorable when execution prices are missing.

Scope each round to its anonymous session. Validate state transitions and idempotency in transactions. Reject cross-origin writes. Freeze each round's cutoff, availability delay, execution times, provider versions, fees, slippage, and rule version.

Keep domain functions independent of storage, networking, wall clocks, and UI. Evaluate opponent rules from historical evidence alone. Normalize charts and axes using visible history only. The interface labels the persisted `CASH` action as SELL; it means holding cash, not opening a short position.

Use historical endpoints for historical labels and screening. Preserve missing values, coverage warnings, and unscorable outcomes. `ownership_percentage` is a fraction; balance changes do not prove trades. Disclose that reconstructed history and assumed availability delays do not establish what was published at the time. Do not present one improved decision as proof of an investment edge.

## Data and credentials

Keep API keys and session secrets on the server and out of logs, screenshots, client assets, and commits. Commit only invented provider fixtures. Keep local environment files, databases, and private caches ignored; `.env.example` must contain no secrets.

Builds, startup, tests, and CI must not make paid provider requests. A provider request requires an explicit preparation or smoke command, a server-side key, and positive finite local and command credit caps. Keep reservations for ambiguous or timed-out attempts until reconciled. Do not purchase credits, initiate payments, connect wallets, or execute trades.

Public demos may use prepared scenarios only when written permission covers the exact provider data and derived displays. Attribution and the repository's code license do not grant data redistribution rights. Do not add public data exports or arbitrary upstream proxies.

## Verification

For application changes, run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, and `bun run build`. Keep unit, route, and browser tests isolated from outbound networking. Run live smoke tests only when explicitly requested.

Add a regression test for each correctness fix. Check serialized responses, HTML, errors, and client assets for premature disclosure; CSS hiding is not an access boundary. For documentation-only changes, check formatting, links and paths, and consistency with the code.

Report the checks actually run, their results, and any remaining limitations. Keep durable setup information in the README; do not add internal handoff, planning, or session-status documents unless requested.
