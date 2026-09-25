# Hindsight

![A young bull learning from historical market evidence](docs/images/hindsight-banner.png)

**Practice onchain trading decisions before you know the ending.**

**Powered by Nansen API.**

Hindsight is a blind historical replay for traders. Read a masked price chart, choose **BUY** or **SELL**, inspect historical onchain evidence, and decide whether to change your call. Then reveal the token and simulated outcome. Compare your first and final choices with a fixed-rule opponent and an always-buy baseline. No wallet connection or real money.

The replay makes it easier to inspect how evidence affected your decision while keeping the outcome hidden until your choices are locked. One good result does not prove good reasoning or an investment edge.

> **Disclaimer:** Hindsight is for learning and educational purposes only. Nothing in this project is financial or investment advice (NFA). Do your own research (DYOR) and make your own decisions before taking any financial action.

You can also clone Hindsight to test your own historical metrics and fixed comparison rules. See [Customize your own replay](#customize-your-own-replay) after your first round.

## Play your first round locally

A fresh checkout has no prepared scenarios. To play locally, you need **Bun 1.4.1** (pinned in [package.json](package.json)), your own Nansen API key, and a credit budget. Preparing one screened scenario has a planning estimate of **42 Nansen credits before retries**; this is not a provider billing ceiling. If you already have privately prepared scenarios in your local database, skip steps 2 and 3.

1. Install dependencies and initialize the local database. Setup does not contact Nansen.

   ```bash
   bun install --frozen-lockfile
   test -f .env.local || cp .env.example .env.local
   bun run setup
   ```

2. In `.env.local`, set your server-side key and local credit cap:

   ```dotenv
   NANSEN_API_KEY=your_nansen_api_key
   NANSEN_MAX_CREDITS=42
   ```

3. Prepare one Ethereum intraday scenario. Replace `YYYY-MM-DD` with a UTC date at least three days in the past so the full outcome window has elapsed. This command makes paid provider requests; both the local and command credit caps must be positive and finite.

   ```bash
   bun run data:build -- --max-credits 42 --as-of YYYY-MM-DD --count 1 --chain ethereum
   ```

4. Start the app and open [localhost:3000](http://localhost:3000).

   ```bash
   bun run dev
   ```

Run `bun run usage:report` to inspect local request accounting. Cache hits can reduce the cost; retries and uncertain requests can exhaust the local cap. See [Configuration and private data](#configuration-and-private-data) for the full credit breakdown and data-use limits.

## How it works

1. Choose a prepared Solana memecoin or exploratory Ethereum token pool and a replay duration: 30 days of hourly history with a 24-hour outcome, or 30 daily candles with a seven-day outcome. The app selects a hidden token from that pool.
2. Read the masked chart and record your first choice. The token, dates, evidence, and future prices remain hidden.
3. Inspect seven days of historical onchain evidence, then lock your final choice. The fixed-rule opponent's choice appears after yours is locked.
4. Reveal the asset and outcome. Compare your first and final choices with the opponent and always-buy baseline, then inspect the evidence provenance.

SELL means staying out of the asset, not opening a short position. BUY uses the round's fixed execution, fee, and slippage assumptions. Rounds persist across refreshes in the same browser session.

To practice deliberately, note why the chart led to your first choice. After the evidence appears, identify which metric changed your view, or why none did. At reveal, compare the reasoning behind both choices as well as their simulated results. Hindsight does not keep a decision journal; record those notes yourself if you want to compare your thinking across rounds.

## Configuration and private data

[.env.example](.env.example) contains the local configuration template. SQLite storage defaults to `.data/hindsight.sqlite`; local environment files and data are ignored by Git.

The `data:prepare-one`, `data:build`, and `smoke:nansen` commands require both local and command credit caps. Ordinary startup, builds, and tests do not call the provider. To refresh older scenarios, run an explicit preparation command with an as-of date whose full outcome window has elapsed, then restart the app.

Fresh-call planning costs are 42 credits for the first screened scenario: screener 5, two price calls 2, two DEX pages 10, and historical holders 25. Each additional scenario sharing that screener costs 37 credits; explicit `data:prepare-one` also costs 37 before retries. No extra DEX pages are fetched. Cache hits can reduce cost; retries and uncertain requests retain additional reservations and can exhaust the local cap. These estimates are not retry-inclusive billing ceilings.

Prepared scenarios are private by default. Do not publish Nansen data, derived displays, demos, or screenshots unless written permission covers that exact use. The MIT license covers this repository's code; it does not grant rights to third-party data.

For production, run `bun run build` followed by `bun run start`. Run one Bun server process with persistent SQLite storage.

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

New to the codebase? Copy this prompt into your coding assistant from the repository root. You can add your own market or research question at the end; if you leave it as written, the assistant should choose a small first experiment.

```text
Help me build my first custom Hindsight replay. Read README.md and AGENTS.md first. I am new to this codebase, so briefly explain the historical metric and fixed comparison rule you choose, then implement one small, complete experiment using the existing Bun, React, TypeScript, and SQLite stack. If I have not specified a market or research question, choose a beginner-friendly one supported by a historical Nansen endpoint.

Keep the replay blind: anchor historical evidence to the frozen cutoff and apply an assumed availability delay; show evidence only after my first choice, the opponent's choice only after my final choice, and identity and future prices only at reveal. Keep the rule deterministic, handle missing or incomplete data explicitly, and use invented fixtures for tests. Keep API keys and raw provider responses on the server. Do not make paid provider requests or publish prepared data. Update the relevant preparation, domain, response, UI, and test code, then run the repository's lint, typecheck, unit, browser, and build checks.

When done, explain in plain language what changed, how I can try it locally, what each check found, any preparation credit cost, and what the historical data cannot prove. Ask me only for information that is required to proceed safely.
```

The included replay focuses on established onchain tokens. Solana screening selects Nansen's reconstructed `Memecoins` and `AI Meme` sectors; Ethereum screening uses the broader non-stablecoin universe. Both require at least $250,000 volume, $100,000 liquidity, and 30 days of token age. Selection is deterministic and does not depend on the proposed signal or future outcomes. Sector tags may be revised; they do not prove contemporaneous classification. Explicit `data:prepare-one` token requests bypass sector screening.

The experimental `smart-dex-accumulation-v1` opponent uses seven days of historical DEX activity ending at the cutoff, with the existing assumed 24-hour availability delay. [Historical Who Bought/Sold](https://docs.nansen.ai/api/backtesting-data/historical-token-who-bought-sold) supplies separate BUY and SELL pages for the four Smart Trader label classes and their four legacy Smart Dex Trader equivalents. Each request uses a $10 minimum **net directional USD volume** and at most 1,000 wallets. The union is therefore a filtered cohort, not all Smart Money activity. No CEX or exchange-flow metric is requested or used.

Token pressure is `(tokens bought − tokens sold) / (tokens bought + tokens sold)`, displayed as a percentage. Breadth counts token-net buyers and sellers across complete wallet records from both pages. BUY requires positive pressure, at least two net buyers, and more buyers than sellers; SELL requires the exact inverse. Otherwise the rule abstains. Gross USD DEX turnover provides activity context, and top-10 holder concentration provides separate risk context; neither votes. USD and token direction can differ when trade prices change. Missing or malformed records, conflicting duplicates, incomplete pagination, and zero token volume make the signal unavailable. The two-wallet threshold is a heuristic; predictive alpha remains unproven until chronological evaluation against fixed baselines.

New scenario identities include the evidence schema, normalizer, and rule versions. The picker only starts scenarios using the current `smart-dex-accumulation-v1` rule, and its counts are scoped to the selected duration. Previously stored rounds retain the legacy flow-and-holder rule and evidence and remain readable by their existing round URLs, but they are not mixed into new rounds. Treat this implementation as a research example, not a complete trading model. It supports established-token swing research, not fresh-launch scalping.

To add or replace a metric:

1. Choose an appropriate endpoint from the [Nansen API documentation](https://docs.nansen.ai/api/overview). A blind replay needs historical data anchored to the round cutoff; do not substitute a current snapshot that could leak future information.
2. Add the endpoint and credit cost in `src/server/nansen/client.ts`, then validate and normalize its response in `src/server/nansen/contracts.ts`. Keep raw provider payloads out of the domain and client.
3. Fetch the input during scenario preparation in `src/server/nansen/preparation.ts`. Freeze its cutoff, availability delay, request fingerprint, provider version, and coverage state with the scenario.
4. Extend the evidence schema in `src/domain/model.ts`. Update any pure calculation or fixed opponent rule in `src/domain/engine.ts`, including explicit behavior for missing or incomplete data.
5. Expose the metric at the correct stage in `src/domain/dto.ts` and render it in `src/client/components/EvidenceCards.tsx`. Evidence may appear only after the first choice; identity, dates, and future prices remain hidden until reveal.
6. Add invented provider fixtures and regression coverage. Update credit estimates and CLI guidance if preparation costs change, then run the full verification commands above.

Keep API keys and paid requests server-side. Ordinary startup, builds, and tests must remain offline, and any prepared Nansen data stays private unless you have written permission for the exact public use. For a broader introduction to Nansen features and onchain concepts, see [How to Use Nansen](https://academy.nansen.ai/collections/8035002-how-to-use-nansen).

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
