import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const combinations = [
  ["BUY", "BUY"],
  ["BUY", "CASH"],
  ["CASH", "BUY"],
  ["CASH", "CASH"],
] as const;

const choiceLabel = (choice: "BUY" | "CASH") =>
  choice === "CASH" ? "SELL" : choice;

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "127.0.0.1" || hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
});

for (const [initial, final] of combinations) {
  test(`${initial} to ${final} completes a historical replay`, async ({
    page,
  }) => {
    const stageBodies: string[] = [];
    page.on("response", async (response) => {
      if (response.url().includes("/api/rounds")) {
        stageBodies.push(await response.text());
      }
    });

    await page.goto("/");
    await expect(page.getByLabel("Intraday · 24 hours")).toBeChecked();
    await page.getByRole("button", { name: "Start round" }).click();
    await expect(
      page.getByRole("heading", { name: "Stage 1: Make your first choice" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: choiceLabel(initial), exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Stage 2: Review onchain evidence" }),
    ).toBeVisible();
    await expect(page.getByText("Smart Money token pressure")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Stage 2: Review onchain evidence" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: choiceLabel(final), exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Lock final choice (${choiceLabel(final)})`,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Stage 3: Final choice locked" }),
    ).toBeVisible();
    await expect(page.getByText("Fixed-rule opponent choice")).toBeVisible();
    await expect(
      page.getByText("smart-dex-accumulation-v1", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Stage 3: Final choice locked" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Reveal next 24 hours" }).click();
    await expect(
      page.getByRole("heading", { name: "Stage 4: Outcome revealed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Test Fern/ }),
    ).toBeVisible();
    await expect(page.getByText("24-hour simulated results")).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Final value" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Profit or loss" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        initial === final
          ? "Your first and final choices produced the same simulated result."
          : /Your final choice changed this simulated result by/,
      ),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Stage 4: Outcome revealed" }),
    ).toBeVisible();

    const blind = stageBodies.find((body) => body.includes('"state":"BLIND"'));
    const evidence = stageBodies.find((body) =>
      body.includes('"state":"EVIDENCE"'),
    );
    const locked = stageBodies.find((body) =>
      body.includes('"state":"LOCKED"'),
    );
    expect(blind).not.toMatch(
      /Test Fern|TST1|2026-08-02|evidence|opponent|outcome/,
    );
    expect(evidence).not.toMatch(/Test Fern|TST1|opponent|outcome/);
    expect(locked).not.toMatch(/Test Fern|TST1|outcome/);
  });
}

test("missing evidence abstains and a missing exact price stays unscorable", async ({
  page,
}) => {
  async function finishCurrentRound() {
    await page.getByRole("button", { name: "BUY", exact: true }).click();
    await page.getByRole("button", { name: "Lock final choice (BUY)" }).click();
    await page.getByRole("button", { name: "Reveal next 24 hours" }).click();
    await expect(
      page.getByRole("heading", { name: "Stage 4: Outcome revealed" }),
    ).toBeVisible();
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Start round" }).click();
  for (let index = 0; index < 3; index += 1) {
    await finishCurrentRound();
    if (index === 1) {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Data and assumptions" })
        .click();
      await expect(
        page.getByRole("dialog").getByText("SELL", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("dialog").getByText("CASH", { exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Start new round" }).last().click();
    await page.getByRole("button", { name: "Start round" }).click();
  }

  await page.getByRole("button", { name: "BUY", exact: true }).click();
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Lock final choice (BUY)" }).click();
  await expect(page.getByText("ABSTAIN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reveal next 24 hours" }).click();
  await page.getByRole("button", { name: "Start new round" }).last().click();
  await page.getByRole("button", { name: "Start round" }).click();

  await finishCurrentRound();
  await expect(page.getByText("Outcome cannot be scored")).toBeVisible();
  await expect(page.getByText("N/A", { exact: true }).first()).toBeVisible();
});

test("load and creation errors explain recovery without server text", async ({
  page,
}) => {
  await page.goto("/play/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("alert")).toContainText(
    "Select Hindsight to return home",
  );
  await page.getByRole("button", { name: "Hindsight", exact: true }).click();

  await page.route("**/api/rounds", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "INTERNAL_TEST_DETAIL" }),
    }),
  );
  await page.getByRole("button", { name: "Start round", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not open a new round",
  );
  await expect(page.getByRole("alert")).toContainText(
    "try starting a new round again",
  );
  await expect(page.getByText("INTERNAL_TEST_DETAIL")).toHaveCount(0);
});

test("reload recovers saved choices and reveal after lost responses", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start round", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stage 1: Make your first choice" }),
  ).toBeVisible();

  for (const step of [
    {
      endpoint: "initial",
      button: "BUY",
      error: "Could not confirm your first choice was saved.",
      heading: "Stage 2: Review onchain evidence",
    },
    {
      endpoint: "final",
      button: "Lock final choice (BUY)",
      error: "Could not confirm your final choice was locked.",
      heading: "Stage 3: Final choice locked",
    },
    {
      endpoint: "reveal",
      button: "Reveal next 24 hours",
      error: "Could not display the outcome.",
      heading: "Stage 4: Outcome revealed",
    },
  ]) {
    const pattern = `**/api/rounds/*/${step.endpoint}`;
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: step.button, exact: true }).click();

    await expect(page.getByRole("alert")).toContainText(step.error);
    await expect(page.getByRole("alert")).toContainText(
      "Reload the round to check its status.",
    );
    await page.unroute(pattern);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: step.heading }),
    ).toBeVisible();
  }
});

test("landing page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start round" })).toBeEnabled();
  await expect
    .poll(() =>
      page
        .locator(".home-illustration")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Start round" }).click();
  await page.getByText("View chart data as a table").click();
  await expect(
    page.getByRole("table", { name: /Price index, normalized/ }),
  ).toBeVisible();
});

test("served HTML and client assets contain no private scenario or provider records", async ({
  page,
  request,
}) => {
  const response = await page.goto("/");
  expect(response!.ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Start round" })).toBeEnabled();
  const privateContent =
    /Test Fern|TST1|2026-08-02|So11111111111111111111111111111111111111112|bought_token_volume|is_smart_money|NANSEN_API_KEY|historical-who-bought-sold/;
  expect(await response!.text()).not.toMatch(privateContent);
  const assetPaths = await page
    .locator('script[src], link[rel="stylesheet"]')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          element.getAttribute("src") ?? element.getAttribute("href")!,
      ),
    );
  expect(assetPaths.length).toBeGreaterThan(0);
  for (const path of assetPaths) {
    const asset = await request.get(path);
    expect(asset.ok()).toBe(true);
    expect(await asset.text()).not.toMatch(privateContent);
  }
});

test("player can choose the seven-day replay", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Swing · 7 days", { exact: true }).click();
  await expect(page.getByLabel("Swing · 7 days")).toBeChecked();
  await page.getByRole("button", { name: "Start round" }).click();

  await expect(page.getByText(/30 days of daily prices/)).toBeVisible();
  await page.getByRole("button", { name: "BUY", exact: true }).click();
  await page.getByRole("button", { name: "Lock final choice (BUY)" }).click();
  await page.getByRole("button", { name: "Reveal next 7 days" }).click();

  await expect(page.getByText("7-day simulated results")).toBeVisible();
});

test("player can pick a supported token pool while unprepared networks stay clear", async ({
  page,
}) => {
  const roundBodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/rounds")) {
      roundBodies.push(await response.text());
    }
  });

  await page.goto("/");
  await expect(page.getByLabel("Solana")).toBeChecked();
  await expect(page.getByLabel("Robinhood Chain")).toHaveCount(0);

  await page.getByText("Ethereum", { exact: true }).click();
  await expect(page.getByLabel("Ethereum")).toBeChecked();
  await page.getByRole("button", { name: "Start round" }).click();

  await expect(
    page.getByRole("heading", { name: "Stage 1: Make your first choice" }),
  ).toBeVisible();
  expect(roundBodies[0]).not.toContain("Ethereum");

  await page.getByRole("button", { name: "BUY", exact: true }).click();
  await page.getByRole("button", { name: "Lock final choice (BUY)" }).click();
  await page.getByRole("button", { name: "Reveal next 24 hours" }).click();

  await expect(page.getByText(/Chain: Ethereum/)).toBeVisible();
  await page.getByRole("button", { name: "Start new round" }).last().click();
  await expect(page.getByText("Choose a token pool")).toBeVisible();
});
