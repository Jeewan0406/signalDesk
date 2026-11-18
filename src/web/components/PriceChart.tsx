import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { ema } from "../../core/indicators";
import { fetchCandles } from "../../core/providers";
import type { AssetAnalysis, AssetConfig, Candle, Timeframe } from "../../core/types";
import { isNative } from "../platform";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export interface ChartOverlays {
  emas: boolean;
  zones: boolean;
  volume: boolean;
}

export function PriceChart({
  asset,
  tf,
  candles,
  analysis,
  livePrice,
  overlays,
  theme,
}: {
  asset: AssetConfig;
  tf: Timeframe;
  candles: Candle[] | undefined;
  analysis: AssetAnalysis | null;
  livePrice: number | null;
  overlays: ChartOverlays;
  theme: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    candle: ISeriesApi<"Candlestick">;
    vol: ISeriesApi<"Histogram">;
    e20: ISeriesApi<"Line">;
    e50: ISeriesApi<"Line">;
    e200: ISeriesApi<"Line">;
  } | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [extra, setExtra] = useState<Candle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastBar = useRef<Candle | null>(null);

  // Timeframes the analysis does not keep (1m, 5m) are fetched on demand.
  useEffect(() => {
    setExtra(null);
    setErr(null);
    if (candles?.length) return;
    let alive = true;
    fetchCandles(asset, tf, 300, { browser: !isNative() })
      .then((r) => alive && setExtra(r.candles))
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [asset, tf, candles]);

  const data = candles?.length ? candles : extra;

  // Create the chart once per theme.
  useEffect(() => {
    if (!box.current) return;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssVar("--panel") }, textColor: cssVar("--muted"), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: cssVar("--border") }, horzLines: { color: cssVar("--border") } },
      rightPriceScale: { borderColor: cssVar("--border") },
      timeScale: { borderColor: cssVar("--border"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candle = c.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: "price", precision: asset.decimals, minMove: 1 / 10 ** asset.decimals },
    });
    const vol = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const lineOpts = { lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    const e20 = c.addSeries(LineSeries, { ...lineOpts, color: "#4c8dff" });
    const e50 = c.addSeries(LineSeries, { ...lineOpts, color: "#f0b90b" });
    const e200 = c.addSeries(LineSeries, { ...lineOpts, color: "#c06cff", lineWidth: 2 });
    chart.current = c;
    series.current = { candle, vol, e20, e50, e200 };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      lines.current = [];
    };
  }, [asset, theme]);

  // Data + overlays.
  useEffect(() => {
    const s = series.current;
    if (!s || !data?.length) return;
    const t = (c: Candle) => Math.floor(c.t / 1000) as UTCTimestamp;
    s.candle.setData(data.map((c) => ({ time: t(c), open: c.o, high: c.h, low: c.l, close: c.c })));
    const up = cssVar("--up");
    const down = cssVar("--down");
    s.vol.setData(
      overlays.volume ? data.map((c) => ({ time: t(c), value: c.v, color: (c.c >= c.o ? up : down) + "55" })) : [],
    );
    const closes = data.map((c) => c.c);
    const line = (vals: number[]) => (overlays.emas ? data.map((c, i) => ({ time: t(c), value: vals[i] })).filter((p) => Number.isFinite(p.value)) : []);
    s.e20.setData(line(ema(closes, 20)));
    s.e50.setData(line(ema(closes, 50)));
    s.e200.setData(line(ema(closes, 200)));
    lastBar.current = { ...data[data.length - 1] };

    for (const l of lines.current) s.candle.removePriceLine(l);
    lines.current = [];
    if (overlays.zones && analysis) {
      const add = (price: number, color: string, title: string, width: 1 | 2 | 3, style: LineStyle) =>
        lines.current.push(s.candle.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: !!title, title }));
      const floorZ = analysis.floor?.zone;
      const ceilZ = analysis.ceiling?.zone;
      for (const z of analysis.supports.slice(0, 5)) if (z !== floorZ && z.center !== floorZ?.center) add(z.center, up + "99", "", 1, LineStyle.Dotted);
      for (const z of analysis.resistances.slice(0, 5)) if (z.center !== ceilZ?.center) add(z.center, down + "99", "", 1, LineStyle.Dotted);
      if (analysis.majorFloor) add(analysis.majorFloor.zone.center, up, "MAJOR FLOOR", 1, LineStyle.Dashed);
      if (analysis.majorCeiling) add(analysis.majorCeiling.zone.center, down, "MAJOR CEILING", 1, LineStyle.Dashed);
      if (floorZ) {
        add(floorZ.high, up, "FLOOR", 2, LineStyle.Solid);
        add(floorZ.low, up, "", 2, LineStyle.Solid);
      }
      if (ceilZ) {
        add(ceilZ.low, down, "CEILING", 2, LineStyle.Solid);
        add(ceilZ.high, down, "", 2, LineStyle.Solid);
      }
      const f = analysis.forecast;
      if (f.target1 && f.direction !== "neutral") add(f.target1, "#4c8dff", "TARGET", 1, LineStyle.LargeDashed);
    }
    chart.current?.timeScale().scrollToRealTime();
  }, [data, analysis, overlays, theme]);

  // Live tick updates the last bar.
  useEffect(() => {
    const s = series.current;
    const b = lastBar.current;
    if (!s || !b || !livePrice) return;
    b.c = livePrice;
    b.h = Math.max(b.h, livePrice);
    b.l = Math.min(b.l, livePrice);
    try {
      s.candle.update({ time: Math.floor(b.t / 1000) as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    } catch {
      /* out-of-order tick */
    }
  }, [livePrice]);

  return (
    <div className="chart-box" ref={box}>
      {!data && !err && <div className="skeleton" style={{ position: "absolute", inset: 0 }} />}
      {err && (
        <div className="notice" style={{ position: "absolute", inset: 20, height: "fit-content" }}>
          Chart data unavailable: {err}
        </div>
      )}
    </div>
  );
}
