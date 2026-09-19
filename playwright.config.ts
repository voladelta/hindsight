import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  forbidOnly: true,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `DATABASE_PATH=.data/hindsight-e2e.sqlite DEPLOYMENT_MODE=local PORT=${port} APP_ORIGIN=${baseURL} bun tests/setup/e2e-server.ts --production`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
