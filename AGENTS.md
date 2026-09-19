# Repository instructions

## Project

Hindsight is a blind historical decision-replay game for traders building market and onchain intuition with Nansen data. It is also a cloneable reference implementation: contributors may customize the historical metrics, evidence, and fixed comparison rules while preserving the blind-replay and data-safety constraints below. Read [README.md](README.md) for the purpose, player flow, setup, and customization path. Use the existing Bun, Vite, React, TypeScript, and SQLite stack; runtime versions and commands are defined in `package.json`.

Keep changes within the requested scope and preserve unrelated work. Keep setup reproducible with the committed lockfile. Do not add accounts, wallets, real trading, subscriptions, leaderboards, multiplayer, or runtime LLM strategies without an explicit request.

## Correctness

- The server owns round state and outcomes. Construct stage-specific response objects; never send database records or raw provider responses to clients.
- Blind responses must omit token identity, dates, evidence, opponent choices, and future prices. Unlock evidence after the first choice, the opponent after the final choice, and identity and future prices only at reveal.
- Scope rounds to their anonymous session. Validate transitions and idempotency in transactions, and protect writes against cross-origin requests.
- Freeze each round's cutoff, availability delay, execution times, provider versions, fees, slippage, and rule version.
- Keep domain functions independent of storage, networking, wall clocks, and UI. Evaluate opponent rules from historical evidence alone. Normalize charts and axes using visible history only.
- The interface labels `CASH` as SELL. It means holding cash, not a short position; preserve the persisted API value.
- Use historical endpoints for historical labels and screening. Preserve missing values, coverage warnings, and unscorable outcomes. `ownership_percentage` is a fraction; balance changes do not prove trades.
- Disclose that reconstructed history and assumed availability delays do not establish what was published at the time. Do not present one improved decision as proof of an investment edge.

## Data and credentials

Keep API keys and session secrets server-side and out of logs, screenshots, client assets, and commits. Only invented provider fixtures belong in the repository. Keep local environment files, databases, and private caches ignored; `.env.example` must contain no secrets.

Builds, startup, tests, and CI must not make paid provider requests. Provider requests require an explicit preparation or smoke command, a server-side key, and positive finite local and command credit caps. Keep reservations for ambiguous or timed-out attempts until reconciled. Do not purchase credits, initiate payments, connect wallets, or execute trades.

Public demos may use prepared scenarios only when written permission covers the exact provider data and derived displays. Attribution and the repository's code license do not grant data redistribution rights. Do not add public data exports or arbitrary upstream proxies.

## Verification

For application changes, run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, and `bun run build`. Keep unit, route, and browser tests isolated from outbound networking; live smoke tests are separate and opt-in.

Add a regression test for each correctness fix. Check serialized responses, HTML, errors, and client assets for premature disclosure; CSS hiding is not an access boundary. For documentation-only changes, check formatting, paths, and consistency with the code.

Report the checks actually run, their results, and any remaining limitations. Keep durable setup information in the README; do not add internal handoff, planning, or session-status documents unless requested.
