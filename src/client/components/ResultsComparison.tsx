import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import type { RoundDTO } from "../../domain/dto";
import { choiceLabel } from "../choice-label";

function formatUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatPnl(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "N/A";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(val));
  if (val > 0.001) return `+${formatted}`;
  if (val < -0.001) return `−${formatted}`;
  return "$0.00";
}

function formatPct(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "N/A";
  const formatted = Math.abs(val).toFixed(2);
  if (val > 0.001) return `+${formatted}%`;
  if (val < -0.001) return `−${formatted}%`;
  return "0.00%";
}

export function ResultsComparison({
  round,
}: {
  round: Extract<RoundDTO, { state: "REVEALED" }>;
}) {
  const { identity, outcome, initial, final, opponent } = round;
  const isUnscorable = outcome.status === "UNSCORABLE";
  const intraday = "holdingHours" in round.assumptions;
  const holdingLabel = intraday ? "24-Hour" : "7-Day";
  const holdingDetail = intraday ? "24-hour holding" : "7-day holding";
  const formatInstant = (instant: string) =>
    intraday
      ? `${instant.slice(0, 16).replace("T", " ")} UTC`
      : `${instant.slice(0, 10)} UTC`;

  const deltaUsd = outcome.revisionDeltaUsd;
  const deltaPp = outcome.revisionDeltaPercentagePoints;

  const rows = [
    {
      label: "Your first choice",
      action: initial,
      result: outcome.original,
      highlight: false,
    },
    {
      label: "Your final choice",
      action: final,
      result: outcome.revised,
      highlight: true,
    },
    {
      label: "Fixed-rule opponent",
      action: opponent.action,
      result: outcome.opponent,
      highlight: false,
    },
    {
      label: "Always-buy baseline",
      action: "BUY" as const,
      result: outcome.alwaysBuy,
      highlight: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Revealed token header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-xl border border-border bg-card">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Historical Token
          </span>
          <h2 className="text-xl font-bold text-foreground">
            {identity.name}{" "}
            <span className="text-muted-foreground text-base font-normal">
              ({identity.symbol})
            </span>
          </h2>
        </div>
        <div className="text-xs text-muted-foreground font-mono flex flex-col sm:items-end gap-0.5">
          <span>Chain: {identity.chain}</span>
          <span>Cutoff: {round.cutoff.slice(0, 10)} UTC</span>
          <span>
            Holding: {formatInstant(round.entryAt)} →{" "}
            {formatInstant(round.exitAt)}
          </span>
        </div>
      </div>

      {/* Delta callout */}
      {!isUnscorable && deltaUsd !== null && deltaPp !== null && (
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-start gap-3">
          {deltaUsd > 0.001 ? (
            <TrendingUp className="text-primary size-5 shrink-0 mt-0.5" />
          ) : deltaUsd < -0.001 ? (
            <TrendingDown className="text-destructive size-5 shrink-0 mt-0.5" />
          ) : (
            <Minus className="text-muted-foreground size-5 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              {deltaUsd > 0.001 ? (
                <>
                  Your final choice changed this simulated result by{" "}
                  <span className="text-primary font-bold">
                    +{formatUsd(deltaUsd)} (+{deltaPp.toFixed(2)} percentage
                    points)
                  </span>
                  .
                </>
              ) : deltaUsd < -0.001 ? (
                <>
                  Your final choice changed this simulated result by{" "}
                  <span className="text-destructive font-bold">
                    −{formatUsd(Math.abs(deltaUsd))} ({deltaPp.toFixed(2)}{" "}
                    percentage points)
                  </span>
                  .
                </>
              ) : (
                <>
                  Your first and final choices produced the same simulated
                  result.
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Descriptive historical simulation based on $1,000 virtual capital
              with 0.1% fees and 0.25% slippage. Not evidence of investment edge
              or causal effect.
            </p>
          </div>
        </div>
      )}

      {isUnscorable && (
        <div className="p-4 rounded-xl border border-border bg-card flex items-start gap-3">
          <Info className="text-muted-foreground size-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Unscorable scenario outcome
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              One or more required outcome price references were unavailable or
              invalid. In accordance with the time policy, missing prices are
              never filled or shifted, and no numeric performance is claimed.
            </p>
          </div>
        </div>
      )}

      {/* Comparison table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-3 border-b border-border bg-secondary/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {holdingLabel} Holding Simulation Comparison
          </h3>
          <span className="text-xs text-muted-foreground">
            $1,000 virtual start · {holdingDetail}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs text-muted-foreground font-mono">
                <th className="py-2.5 px-4 font-medium">Strategy</th>
                <th className="py-2.5 px-4 font-medium">Choice</th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Final value
                </th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Profit or loss
                </th>
                <th className="py-2.5 px-4 font-medium text-right">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map(({ label, action, result, highlight }) => (
                <tr
                  key={label}
                  className={highlight ? "bg-primary/5 font-medium" : ""}
                >
                  <td className="py-3 px-4 text-foreground flex items-center gap-2">
                    {label}
                    {highlight && (
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        Final
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">
                    <span
                      className={`inline-block px-2 py-0.5 rounded ${
                        action === "BUY"
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : action === "CASH"
                            ? "bg-secondary text-secondary-foreground border border-border"
                            : "bg-muted text-muted-foreground border border-border"
                      }`}
                    >
                      {choiceLabel(action)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-foreground">
                    {formatUsd(result?.terminal)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums ${
                      (result?.pnl ?? 0) > 0.001
                        ? "text-primary"
                        : (result?.pnl ?? 0) < -0.001
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {formatPnl(result?.pnl)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums ${
                      (result?.returnPercent ?? 0) > 0.001
                        ? "text-primary"
                        : (result?.returnPercent ?? 0) < -0.001
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {formatPct(result?.returnPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
