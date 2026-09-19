import { describe, expect, it } from "vitest";

async function runSmoke(
  args: string[] = [],
  environment: Record<string, string> = {},
) {
  const processHandle = Bun.spawn(["bun", "scripts/smoke-nansen.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NANSEN_API_KEY: "",
      NANSEN_MAX_CREDITS: "0",
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("Nansen smoke safety gates", () => {
  it("requires a positive local credit cap before making a request", async () => {
    const result = await runSmoke(["--max-credits", "1"], {
      NANSEN_API_KEY: "test-key-never-sent",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "NANSEN_MAX_CREDITS must be a positive finite number",
    );
  });

  it("rejects unknown options instead of weakening the budget cap", async () => {
    const result = await runSmoke(["--no-budget-cap"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown option");
  });

  it("requires a positive command credit cap", async () => {
    const result = await runSmoke([], {
      NANSEN_API_KEY: "test-key-never-sent",
      NANSEN_MAX_CREDITS: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--max-credits must be a positive finite number",
    );
  });
});
