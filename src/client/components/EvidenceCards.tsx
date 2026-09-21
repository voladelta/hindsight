import { ArrowDownUp, ChartPie, Layers3, LockKeyhole } from "lucide-react";
import type { Evidence, Measurement } from "../../domain/model";

function value(item: Measurement | undefined, unit: string) {
  if (!item) return "Locked";
  if (item.status === "unavailable") return "Unavailable";
  const number = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Math.abs(item.value));
  const sign = item.value > 0 && unit !== "%" ? "+" : item.value < 0 ? "−" : "";
  return unit === "USD"
    ? `${sign}$${number}`
    : `${sign}${number}${unit === "%" ? "%" : " tokens"}`;
}

export function EvidenceCards({ evidence }: { evidence?: Evidence }) {
  const modern = !evidence || "tokenPressurePercent" in evidence;
  const cards = modern
    ? [
        {
          title: "Smart Money token pressure",
          icon: ArrowDownUp,
          item: evidence?.tokenPressurePercent,
          unit: "%",
          description:
            "Net tokens bought divided by total tokens traded over 7 days.",
        },
        {
          title: "Smart Money breadth",
          icon: Layers3,
          item: evidence?.buyerCount,
          unit: "wallets",
          display:
            evidence?.buyerCount.status === "available" &&
            evidence.sellerCount.status === "available"
              ? `${evidence.buyerCount.value} buyers / ${evidence.sellerCount.value} sellers`
              : undefined,
          description:
            "Token-net buyers versus sellers in the historical Smart Trader cohort, filtered to at least $10 net directional USD activity.",
        },
        {
          title: "DEX turnover",
          icon: ArrowDownUp,
          item: evidence?.grossVolumeUsd,
          unit: "USD",
          description:
            "Gross USD bought plus sold by the same cohort. Activity context, not a directional vote.",
        },
        {
          title: "Top 10 concentration",
          icon: ChartPie,
          item: evidence?.concentrationPercent,
          unit: "%",
          description:
            "Share of supply held by the ten holders at the cutoff. Risk context, not a directional vote.",
        },
      ]
    : [
        {
          title: "Smart Trader net flow",
          icon: ArrowDownUp,
          item: evidence?.flowUsd,
          unit: "USD",
          description: "Net flow over the 7-day evidence window, in USD.",
        },
        {
          title: "Top 10 concentration",
          icon: ChartPie,
          item: evidence?.concentrationPercent,
          unit: "%",
          description:
            "Share of supply held by the ten holders selected at the cutoff.",
        },
        {
          title: "Selected holders’ balance",
          icon: Layers3,
          item: evidence?.balanceChangeTokens,
          unit: "tokens",
          description:
            "Their 7-day net balance change, in token units. Not proof of trades.",
        },
      ];
  return (
    <section className="evidence-section" aria-labelledby="evidence-heading">
      <div className="section-heading">
        <h2 id="evidence-heading">The onchain evidence</h2>
        <span>
          {evidence
            ? "Historical window · 7 days"
            : "Unlocks after your first choice"}
        </span>
      </div>
      <div className={`evidence-grid${modern ? " evidence-grid-dex" : ""}`}>
        {cards.map(
          ({ title, icon: Icon, item, unit, description, ...card }, index) => (
            <article
              className={`evidence-card ${evidence ? "" : "is-locked"}`}
              key={title}
            >
              <div className="evidence-top">
                <Icon size={18} />
                <span>0{index + 1}</span>
              </div>
              <h3>{title}</h3>
              <p
                className={`evidence-value ${!item || item.status === "unavailable" ? "muted" : ""}`}
              >
                {!evidence && <LockKeyhole size={19} />}
                {("display" in card && card.display) || value(item, unit)}
              </p>
              <p>
                {!evidence
                  ? "Make your first call to see this evidence."
                  : item?.status === "unavailable"
                    ? "Coverage is incomplete. Missing data is not zero."
                    : description}
              </p>
            </article>
          ),
        )}
      </div>
    </section>
  );
}
