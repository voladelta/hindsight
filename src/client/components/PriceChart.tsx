import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { LockKeyhole } from "lucide-react";
import type { RoundDTO } from "../../domain/dto";

export function PriceChart({ round }: { round: RoundDTO }) {
  const container = useRef<HTMLDivElement>(null);
  const revealed = round.state === "REVEALED";
  const intraday = round.chart.unit === "hour";
  const unitLabel = intraday ? "Hour" : "Day";
  const historyLabel = intraday ? "30 visible days, hourly" : "30 visible days";
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a2aaa0",
        fontFamily: "Inter Variable, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#252c25", style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        tickMarkFormatter: (time: number) =>
          `${unitLabel} ${Math.round(time / 3600)}`,
        rightOffset: 1,
        barSpacing: intraday ? 3 : 18,
      },
      localization: {
        timeFormatter: (time: number) =>
          `${unitLabel} ${Math.round(time / 3600)}`,
        priceFormatter: (price: number) => price.toFixed(1),
      },
      crosshair: {
        vertLine: { color: "#9ca98e", labelBackgroundColor: "#343e30" },
        horzLine: { color: "#55614e", labelBackgroundColor: "#343e30" },
      },
      handleScroll: false,
      handleScale: false,
    });
    const history = chart.addSeries(AreaSeries, {
      lineColor: "#b7d998",
      topColor: "#b7d99820",
      bottomColor: "#b7d99800",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      ...(revealed
        ? {}
        : {
            autoscaleInfoProvider: () => ({
              priceRange: {
                minValue: round.chart.axis[0],
                maxValue: round.chart.axis[1],
              },
            }),
          }),
    });
    history.setData(
      round.chart.points.map((point) => ({
        time: (point.period * 3600) as UTCTimestamp,
        value: point.price,
      })),
    );
    if (round.state === "REVEALED") {
      const future = chart.addSeries(LineSeries, {
        color: "#d6bd8b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      // The availability gap remains whitespace. Missing outcomes never get filled.
      future.setData(
        round.outcome.points.map((point) => ({
          time: (point.period * 3600) as UTCTimestamp,
          ...(point.price === null ? {} : { value: point.price }),
        })),
      );
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [round, revealed, intraday, unitLabel]);

  return (
    <>
      <div className="chart-wrap">
        <div
          ref={container}
          className="price-chart"
          role="img"
          aria-label={`Indexed price chart: ${historyLabel}${revealed ? " and revealed outcome" : ", future hidden"}. A data table follows.`}
        />
        {!revealed && (
          <div className="future-placeholder">
            <LockKeyhole size={18} />
            <span>{intraday ? "The next 24 hours" : "The next 7 days"}</span>
            <small>Hidden until reveal</small>
          </div>
        )}
      </div>
      <div className="chart-caption">
        <span>
          <i className="legend-dot" />
          Visible history
          {revealed && (
            <>
              <i className="legend-dot outcome-dot" />
              Outcome · opening references
            </>
          )}
        </span>
        <span>
          {unitLabel} 1 = 100 · {intraday ? "hourly" : "daily"}
        </span>
      </div>
      <details className="chart-data">
        <summary>View chart data as a table</summary>
        <div className="table-scroll">
          <table>
            <caption>
              Price index, normalized to the first visible close. The 24-hour
              availability gap is omitted.
            </caption>
            <thead>
              <tr>
                <th>{unitLabel}</th>
                <th>Price index</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {round.chart.points.map((p) => (
                <tr key={p.period}>
                  <td>{p.period}</td>
                  <td>{p.price.toFixed(2)}</td>
                  <td>Historical close</td>
                </tr>
              ))}
              {round.state === "REVEALED" &&
                round.outcome.points.map((p) => (
                  <tr key={p.period}>
                    <td>{p.period}</td>
                    <td>{p.price?.toFixed(2) ?? "Unavailable"}</td>
                    <td>Outcome open</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
