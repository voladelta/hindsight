import { describe, expect, it } from "vitest";
import { publicRound } from "../../src/domain/dto";
import type { Round } from "../../src/domain/model";
import { fixtureScenario } from "../fixtures/scenario";

const rounds: Round[] = [
  { id: "11111111-1111-4111-8111-111111111111", state: "BLIND" },
  {
    id: "11111111-1111-4111-8111-111111111111",
    state: "EVIDENCE",
    initial: "BUY",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    state: "LOCKED",
    initial: "BUY",
    final: "CASH",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    state: "REVEALED",
    initial: "BUY",
    final: "CASH",
  },
];

describe("stage-specific response objects", () => {
  it("keeps identity, dates, evidence, opponent, and outcomes behind their stages", () => {
    const scenario = fixtureScenario(0);
    const serialized = rounds.map((round) =>
      JSON.stringify(publicRound(round, scenario)),
    );

    expect(serialized[0]).not.toMatch(
      /Test Fern|TST1|2026-08-02|flowUsd|opponent|outcome/,
    );
    expect(serialized[1]).toContain("flowUsd");
    expect(serialized[1]).not.toMatch(/Test Fern|TST1|opponent|outcome/);
    expect(serialized[2]).toContain("opponent");
    expect(serialized[2]).not.toMatch(/Test Fern|TST1|outcome/);
    expect(serialized[3]).toMatch(/Test Fern|TST1|outcome/);
  });

  it("marks overflowing modeled results unscorable", () => {
    const scenario = fixtureScenario(0);
    scenario.future[0]!.open = 1e-300;
    scenario.future.at(-1)!.open = 1e300;

    const result = publicRound(rounds[3]!, scenario);
    expect(result.state).toBe("REVEALED");
    if (result.state !== "REVEALED") throw new Error("Expected revealed DTO");

    expect(result.outcome.status).toBe("UNSCORABLE");
    expect(result.outcome.revised).toBeNull();
    expect(result.outcome.alwaysBuy).toBeNull();
  });

  it("does not serialize overflowing normalized outcome points", () => {
    const scenario = fixtureScenario(0);
    scenario.history[0]!.close = 1;
    scenario.future[3]!.open = 1e308;

    const result = publicRound(rounds[3]!, scenario);
    expect(result.state).toBe("REVEALED");
    if (result.state !== "REVEALED") throw new Error("Expected revealed DTO");

    expect(result.outcome.points[3]!.price).toBeNull();
  });
});
