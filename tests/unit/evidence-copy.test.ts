import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceCards } from "../../src/client/components/EvidenceCards";
import type { Evidence } from "../../src/domain/model";

describe("evidence labels", () => {
  it("uses wallet units when the seller count is unavailable", () => {
    const evidence: Evidence = {
      tokenPressurePercent: { status: "available", value: 12 },
      buyerCount: { status: "available", value: 2 },
      sellerCount: { status: "unavailable", reason: "INCOMPLETE_DEX" },
      grossVolumeUsd: { status: "available", value: 1000 },
      concentrationPercent: { status: "available", value: 32 },
    };

    const html = renderToStaticMarkup(
      createElement(EvidenceCards, { evidence }),
    );

    expect(html).toContain("2 wallets");
    expect(html).not.toContain("2 tokens");
  });
});
