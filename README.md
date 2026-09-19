# Hindsight

![A young bull learning from historical market evidence](docs/images/hindsight-banner.png)

**Make the call before you know the ending.**

**Powered by Nansen API.**

> **Disclaimer:** Hindsight is for learning and educational purposes only. Nothing in this project is financial or investment advice (NFA). Do your own research (DYOR) and make your own decisions before taking any financial action.

Hindsight is a practice environment for traders who want to turn early luck into durable market intuition. A lucky start can reward weak reasoning and encourage larger risks; this project creates a safer feedback loop by asking you to make a decision, examine historical Nansen evidence, and then study what happened without putting capital at risk.

It is a blind historical decision-replay game. Read a masked price chart, choose **BUY** or **SELL**, inspect historical onchain evidence, and lock your final choice before revealing the outcome. Compare your first instinct and revised decision with a fixed-rule opponent and an always-buy baseline. No wallet connection or real money.

Hindsight is also a reference implementation you can clone and adapt to the markets, metrics, and research questions you care about. Start with the [Nansen API endpoint overview](https://docs.nansen.ai/api/overview) to see the available data, and use [Nansen Academy's beginner guides](https://academy.nansen.ai/collections/8035002-how-to-use-nansen) to build the onchain concepts behind your experiments.

## Play locally

Use **Bun 1.4.1**, pinned in [package.json](package.json):

```bash
bun install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
bun run setup
bun run dev
```

Open [localhost:3000](http://localhost:3000). Hindsight plays prepared, cached Nansen scenarios. A deployment with prepared data can be tried immediately, but its market snapshots will age. A fresh checkout needs your own Nansen API key to prepare scenarios; setup only applies database migrations and never makes provider requests.

For production, run `bun run build` followed by `bun run start`. Run one Bun server process with persistent SQLite storage.

## How it works

1. Choose an Ethereum or Solana token pool and a replay duration: 30 days of hourly history with a 24-hour outcome, or 30 daily candles with a seven-day outcome.
2. Read the masked chart and record your first choice.
3. Inspect the evidence, then lock your final choice to see the opponent's decision.
4. Reveal the asset and outcome, compare results, and inspect the evidence provenance.

SELL means staying out of the asset, not opening a short position. BUY uses the round's fixed execution, fee, and slippage assumptions. Rounds persist across refreshes in the same browser session.

## Development

Built with Bun, Vite, React, strict TypeScript, Tailwind, lightweight-charts, Zod, and SQLite with Drizzle.

- `src/client/` — interface and charts.
- `src/server/` — sessions, storage, round transitions, and provider adapters.
- `src/domain/` — pure evidence, rule, and simulation functions.
- `scripts/` — local setup, data preparation, and diagnostics.
- `tests/` — unit, route, and browser coverage.

```bash
bunx playwright install chromium
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run build
```

Regular tests use invented, test-only fixtures and mocked provider responses; they do not require live Nansen requests. Browser tests exercise the production build. Dependency and browser installation require network access.

Use `bun run format` to format files and `bun run doctor` for local diagnostics.

Read [AGENTS.md](AGENTS.md) before contributing. Keep changes focused, preserve stage boundaries, and include regression coverage for correctness fixes.

## Customize your own replay

The included replay is deliberately small: it combines price history with Smart Trader net flow, top-holder concentration, and selected holders' balance changes. Treat it as a worked example, not a complete trading model. A useful customization starts with one question—such as whether exchange flows, whale activity, wallet behavior, or another historical signal would have changed your decision—and adds only the data needed to explore it.

To add or replace a metric:

1. Choose an appropriate endpoint from the [Nansen API documentation](https://docs.nansen.ai/api/overview). A blind replay needs historical data anchored to the round cutoff; do not substitute a current snapshot that could leak future information.
2. Add the endpoint and credit cost in `src/server/nansen/client.ts`, then validate and normalize its response in `src/server/nansen/contracts.ts`. Keep raw provider payloads out of the domain and client.
3. Fetch the input during scenario preparation in `src/server/nansen/preparation.ts`. Freeze its cutoff, availability delay, request fingerprint, provider version, and coverage state with the scenario.
4. Extend the evidence schema in `src/domain/model.ts`. Update any pure calculation or fixed opponent rule in `src/domain/engine.ts`, including explicit behavior for missing or incomplete data.
5. Expose the metric at the correct stage in `src/domain/dto.ts` and render it in `src/client/components/EvidenceCards.tsx`. Evidence may appear only after the first choice; identity, dates, and future prices remain hidden until reveal.
6. Add invented provider fixtures and regression coverage. Update credit estimates and CLI guidance if preparation costs change, then run the full verification commands above.

Keep API keys and paid requests server-side. Ordinary startup, builds, and tests must remain offline, and any prepared Nansen data stays private unless you have written permission for the exact public use. For a broader introduction to Nansen features and onchain concepts, see [How to Use Nansen](https://academy.nansen.ai/collections/8035002-how-to-use-nansen).

## Configuration and private data

[.env.example](.env.example) contains the local configuration template. SQLite storage defaults to `.data/hindsight.sqlite`; local environment files and data are ignored by Git.

To prepare historical replays—or refresh an older prepared set with more recent market conditions—add your own server-side `NANSEN_API_KEY` and set a positive finite credit budget in `.env.local`:

```dotenv
NANSEN_API_KEY=your_nansen_api_key
NANSEN_MAX_CREDITS=37
```

Then prepare a small corpus. Replace the as-of placeholder with a UTC date whose full outcome window has already elapsed; for the default intraday replay, use a date at least three days in the past.

```bash
bun run data:build -- --max-credits 37 --as-of YYYY-MM-DD --count 1 --chain ethereum
```

Restart the app after preparation. Provider preparation is explicit and may consume Nansen credits. The `data:prepare-one`, `data:build`, and `smoke:nansen` commands require both local and command credit caps; ordinary startup, builds, and tests do not call the provider. Run `bun run usage:report` to inspect local request accounting. Credit estimates are not guaranteed billing caps.

Prepared scenarios are private by default. Do not publish Nansen data, derived displays, demos, or screenshots unless written permission covers that exact use. The MIT license covers this repository's code; it does not grant rights to third-party data.

## Limitations

- Historical data is reconstructed, not a certified recording of what was available at the time. An assumed availability buffer does not establish historical availability.
- Missing evidence stays missing; missing execution prices can leave a round unscorable. Balance changes do not prove trades.
- Simulated prices do not guarantee executable fills. An improved decision in one round does not establish an investment edge or causal effect.

## Troubleshooting

- **Missing production assets:** run `bun run build` before `bun run start`.
- **Missing browser executable:** run `bunx playwright install chromium`.
- **No scenarios available:** add a Nansen API key and run a preparation command for the selected network and duration.
- **Writes fail on another port:** align the browser URL and server origin, for example `PORT=3005 APP_ORIGIN=http://localhost:3005 bun run dev`.

## License

[MIT](LICENSE) © 2026 voladelta.
