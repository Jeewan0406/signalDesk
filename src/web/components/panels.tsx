import { categoryLabel } from "../../core/drivers";
import { formatPct, formatPrice, formatUsd, timeAgo } from "../../core/format";
import type { AiAssetView, AssetAnalysis, AssetConfig, Driver, FloorCeiling, Forecast, TimeframeSignal } from "../../core/types";
import { Arrow, Card, DirBadge, dirClass, InrLine, Meter, Pct, Price } from "./common";

/** Visual bar: floor zone — price — ceiling zone. */
export function RangeBar({ a, price, decimals }: { a: AssetAnalysis; price: number; decimals: number }) {
  const lo = a.floor ? a.floor.zone.low : a.ranges[2]?.low ?? price * 0.95;
  const hi = a.ceiling ? a.ceiling.zone.high : a.ranges[2]?.high ?? price * 1.05;
  const pad = (hi - lo) * 0.08;
  const min = Math.min(lo, price) - pad;
  const max = Math.max(hi, price) + pad;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const width = (l: number, h: number) => `${Math.max(1.5, ((h - l) / (max - min)) * 100)}%`;
  return (
    <div>
      <div className="range" aria-label="Price position between predicted floor and ceiling">
        <div className="range-track" />
        {a.floor && <div className="range-zone floor" style={{ left: pos(a.floor.zone.low), width: width(a.floor.zone.low, a.floor.zone.high) }} />}
        {a.ceiling && <div className="range-zone ceiling" style={{ left: pos(a.ceiling.zone.low), width: width(a.ceiling.zone.low, a.ceiling.zone.high) }} />}
        <div className="range-price" style={{ left: pos(price) }} />
      </div>
      <div className="range-labels">
        <span>
          Floor <b className="up">{a.floor ? formatUsd(a.floor.zone.center, decimals) : "—"}</b>
        </span>
        <span>
          Ceiling <b className="down">{a.ceiling ? formatUsd(a.ceiling.zone.center, decimals) : "—"}</b>
        </span>
      </div>
    </div>
  );
}

export function ForecastCard({ f, asset, price }: { f: Forecast; asset: AssetConfig; price: number }) {
  const d = asset.decimals;
  const upPct = Math.round(f.probUp * 100);
  return (
    <div className="fc">
      <div className="spread">
        <span className="small bold muted">{f.horizonLabel}</span>
        <span className={`badge ${f.confidence === "high" ? "accent" : "neutral"}`}>{f.confidence} confidence</span>
      </div>
      <div className="row">
        <Arrow dir={f.direction} />
        <div className={`headline ${dirClass(f.direction)}`}>{f.direction === "up" ? "Bullish" : f.direction === "down" ? "Bearish" : "Range / no edge"}</div>
      </div>
      <div>
        <div className="spread tiny muted">
          <span>Down {100 - upPct}%</span>
          <span>Up {upPct}%</span>
        </div>
        <div className="prob">
          <div style={{ width: `${upPct}%` }} />
        </div>
      </div>
      <div className="kv">
        {f.direction !== "neutral" ? (
          <>
            <span>Target</span>
            <span>
              <Price usd={f.target1} decimals={d} /> <Pct v={f.target1 ? (f.target1 / price - 1) * 100 : null} digits={1} />
            </span>
            {f.target2 && (
              <>
                <span>Extended target</span>
                <span>
                  <Price usd={f.target2} decimals={d} />
                </span>
              </>
            )}
            <span>Expected in</span>
            <span className="bold">{f.eta?.label ?? "—"}</span>
            <span>Wrong if price breaks</span>
            <span>
              <Price usd={f.invalidation} decimals={d} />
            </span>
          </>
        ) : (
          <>
            <span>Range top</span>
            <span>
              <Price usd={f.target1} decimals={d} />
            </span>
            <span>Range bottom</span>
            <span>
              <Price usd={f.target2} decimals={d} />
            </span>
          </>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {f.summary}
      </p>
    </div>
  );
}

function ZoneCard({ fc, kind, asset, major }: { fc: FloorCeiling; kind: "floor" | "ceiling"; asset: AssetConfig; major?: boolean }) {
  const d = asset.decimals;
  const z = fc.zone;
  const color = kind === "floor" ? "var(--up)" : "var(--down)";
  const title = `${major ? "Major " : ""}${kind === "floor" ? "Floor (best buy zone)" : "Ceiling (best sell zone)"}`;
  return (
    <div className={`zone-card ${kind}`}>
      <div className="spread">
        <span className="small bold">{title}</span>
        <span className="small muted num">{formatPct(fc.distancePct, 2)} away</span>
      </div>
      <div className="price-big num" style={{ color, fontSize: 22 }}>
        {formatUsd(z.low, d)} – {formatUsd(z.high, d)}
      </div>
      <InrLine usd={z.center} />
      <div className="kv small">
        <span>Zone strength</span>
        <span>{z.strength}/100</span>
      </div>
      <Meter value={z.strength} color={color} />
      <div className="kv small">
        <span>{kind === "floor" ? "Chance it holds if tested" : "Chance it caps the rally"}</span>
        <span className="bold">{Math.round(fc.holdProb * 100)}%</span>
        <span>Chance price gets there in {Math.round(fc.horizonHours / 24)} days</span>
        <span>{Math.round(fc.touchProb * 100)}%</span>
        <span>Times rejected before</span>
        <span>{z.touches}</span>
      </div>
      <div className="row wrap">
        {z.sources.map((s) => (
          <span key={s} className="chip">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FloorCeilingPanel({ a, asset }: { a: AssetAnalysis; asset: AssetConfig }) {
  const d = asset.decimals;
  const r3 = a.ranges.find((r) => r.hours === 168) ?? a.ranges[a.ranges.length - 1];
  const weakFloor = !a.floor || a.floor.zone.strength < 40;
  const weakCeil = !a.ceiling || a.ceiling.zone.strength < 40;
  return (
    <div className="stack">
      {a.testing && (
        <div className="notice info small">
          Price is <b>testing a {a.testing.kind} zone right now</b> at {formatUsd(a.testing.low, d)}–{formatUsd(a.testing.high, d)} (strength {a.testing.strength}). A
          decisive close outside it usually sets the next move.
        </div>
      )}
      <div className="grid g-2">
        {a.ceiling ? <ZoneCard fc={a.ceiling} kind="ceiling" asset={asset} /> : <div className="notice">No mapped ceiling nearby: price is near its highs.</div>}
        {a.floor ? <ZoneCard fc={a.floor} kind="floor" asset={asset} /> : <div className="notice">No mapped floor nearby.</div>}
      </div>
      {(weakFloor || weakCeil) && r3 && (
        <div className="notice warn small">
          {weakFloor && (
            <>
              The nearest floor is weak: price is trading below most historical support. The 7-day statistical low (1 standard deviation) is{" "}
              <b>{formatUsd(r3.low, d)}</b>.{" "}
            </>
          )}
          {weakCeil && (
            <>
              The nearest ceiling is weak. 7-day statistical high: <b>{formatUsd(r3.high, d)}</b>.
            </>
          )}
        </div>
      )}
      {(a.majorFloor || a.majorCeiling) && (
        <div className="grid g-2">
          {a.majorCeiling ? <ZoneCard fc={a.majorCeiling} kind="ceiling" asset={asset} major /> : <div />}
          {a.majorFloor ? <ZoneCard fc={a.majorFloor} kind="floor" asset={asset} major /> : <div />}
        </div>
      )}
    </div>
  );
}

export function LevelsTable({ a, asset }: { a: AssetAnalysis; asset: AssetConfig }) {
  const d = asset.decimals;
  const rows = [...a.resistances.slice(0, 6).reverse(), ...a.supports.slice(0, 6)];
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Level</th>
            <th>Zone</th>
            <th>Strength</th>
            <th className="hide-sm">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((z) => (
            <tr key={`${z.kind}${z.center}`}>
              <td className={z.kind === "support" ? "up" : "down"}>{z.kind === "support" ? "Support" : "Resistance"}</td>
              <td>
                {formatPrice(z.low, d)} – {formatPrice(z.high, d)}
              </td>
              <td style={{ minWidth: 90 }}>
                <div className="row">
                  <span style={{ width: 26 }}>{z.strength}</span>
                  <div className="grow">
                    <Meter value={z.strength} color={z.kind === "support" ? "var(--up)" : "var(--down)"} />
                  </div>
                </div>
              </td>
              <td className="hide-sm small muted" style={{ whiteSpace: "normal" }}>
                {z.sources.slice(0, 3).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TF_LABEL: Record<string, string> = { "15m": "15 min", "1h": "1 hour", "4h": "4 hours", "1d": "Daily", "1w": "Weekly" };

export function TimeframeTable({ tfs }: { tfs: TimeframeSignal[] }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Timeframe</th>
            <th>Signal</th>
            <th>Trend</th>
            <th>Structure</th>
            <th>RSI</th>
            <th>MACD</th>
            <th>ADX</th>
            <th>Prob. up</th>
          </tr>
        </thead>
        <tbody>
          {tfs.map((t) => (
            <tr key={t.tf}>
              <td className="bold">{TF_LABEL[t.tf] ?? t.tf}</td>
              <td className={t.score > 0.12 ? "up" : t.score < -0.12 ? "down" : "neutral"}>
                {t.score > 0.12 ? "Buy" : t.score < -0.12 ? "Sell" : "Neutral"} {Math.abs(t.score * 100).toFixed(0)}
              </td>
              <td className={dirClass(t.trend)}>
                {t.trend === "up" ? "Up" : t.trend === "down" ? "Down" : "Sideways"} <span className="muted small">({t.trendStrength})</span>
              </td>
              <td>{t.structure === "HH-HL" ? "Higher highs/lows" : t.structure === "LH-LL" ? "Lower highs/lows" : "Mixed"}</td>
              <td className={t.indicators.rsi > 70 ? "down" : t.indicators.rsi < 30 ? "up" : ""}>{t.indicators.rsi.toFixed(0)}</td>
              <td className={t.indicators.macdHist > 0 ? "up" : "down"}>{t.indicators.macdHist > 0 ? "Bull" : "Bear"}</td>
              <td>{Number.isFinite(t.indicators.adx) ? t.indicators.adx.toFixed(0) : "—"}</td>
              <td className={t.probUp > 0.53 ? "up" : t.probUp < 0.47 ? "down" : "neutral"}>{Math.round(t.probUp * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignalNotes({ tfs }: { tfs: TimeframeSignal[] }) {
  const notes = tfs.flatMap((t) => t.notes.map((n) => `${TF_LABEL[t.tf] ?? t.tf}: ${n}`));
  if (!notes.length) return null;
  return (
    <ul className="small muted" style={{ margin: "12px 0 0", paddingLeft: 18 }}>
      {notes.slice(0, 8).map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function TrackRecord({ tfs }: { tfs: TimeframeSignal[] }) {
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        The same rules replayed on each timeframe's recent history: how often a clear signal was followed by a move in that direction. Around 50% is a coin flip. The app
        converts these hit rates into the probabilities shown above. A rate well under 50% means the signal tends to reverse on that timeframe, so it is read in reverse.
      </p>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Timeframe</th>
              <th>Look-ahead</th>
              <th>Signals tested</th>
              <th>Hit rate</th>
            </tr>
          </thead>
          <tbody>
            {tfs.map((t) => (
              <tr key={t.tf}>
                <td>{TF_LABEL[t.tf] ?? t.tf}</td>
                <td className="muted">{t.horizonBars} bars</td>
                <td>{t.track.signals}</td>
                <td className={t.track.hitRate >= 0.55 ? "up" : t.track.hitRate < 0.47 ? "down" : "neutral"} style={{ whiteSpace: "normal" }}>
                  {(t.track.hitRate * 100).toFixed(1)}%
                  {t.track.hitRate < 0.47 && <div className="tiny muted">read in reverse</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DriversList({ drivers, empty }: { drivers: Driver[]; empty?: string }) {
  if (!drivers.length) return <p className="muted small">{empty ?? "No major drivers right now."}</p>;
  return (
    <div>
      {drivers.map((d, i) => {
        const pos = d.impact > 0.05;
        const neg = d.impact < -0.05;
        const h = Math.min(50, Math.abs(d.impact) * 50);
        return (
          <div className="driver" key={`${d.detail}${i}`}>
            <div className="impact">
              <div className="impact-bar">
                <div style={{ height: `${h}%`, background: pos ? "var(--up)" : neg ? "var(--down)" : "var(--neutral)", bottom: pos ? "50%" : undefined, top: pos ? undefined : "50%" }} />
              </div>
              <span className={pos ? "up" : neg ? "down" : "neutral"}>{pos ? "Bullish" : neg ? "Bearish" : "Neutral"}</span>
            </div>
            <div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="chip">{d.label}</span>
                {d.at && <span className="tiny faint">{timeAgo(d.at)}</span>}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.detail}
                  </a>
                ) : (
                  d.detail
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AiCard({ view, generatedAt, model, asset, enabled }: { view: AiAssetView | null; generatedAt?: number; model?: string; asset: AssetConfig; enabled: boolean }) {
  const d = asset.decimals;
  if (!view) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        {enabled
          ? "The AI analyst has not produced a view yet. It runs on the 24/7 server every few hours and immediately after big alarms."
          : "AI analyst is off. Add an ANTHROPIC_API_KEY secret to your GitHub repository to switch on the Claude analyst, which reads the news and the data and writes a reasoned forecast (see Settings → Setup guide)."}
      </p>
    );
  }
  return (
    <div className="stack">
      <div className="spread">
        <span className={`badge ${dirClass(view.bias)}`}>
          {view.bias === "bullish" ? "▲ Bullish" : view.bias === "bearish" ? "▼ Bearish" : "◆ Neutral"} · {view.confidence}% confidence
        </span>
        <span className="tiny faint">{generatedAt ? timeAgo(generatedAt) : ""}</span>
      </div>
      <div className="kv">
        <span>Horizon</span>
        <span>{view.horizon}</span>
        <span>Target</span>
        <span>
          {formatUsd(view.target, d)} <Pct v={view.expectedMovePct} digits={1} />
        </span>
        <span>Time to target</span>
        <span>{view.timeToTarget}</span>
        <span>Floor / ceiling</span>
        <span>
          <span className="up">{formatUsd(view.floor, d)}</span> / <span className="down">{formatUsd(view.ceiling, d)}</span>
        </span>
        <span>Invalidation</span>
        <span>{formatUsd(view.invalidation, d)}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {view.reasoning}
      </p>
      <div className="grid g-3" style={{ gap: 8 }}>
        {view.scenarios.map((s) => (
          <div key={s.name} className="zone-card" style={{ padding: 10 }}>
            <div className="spread small">
              <b className={s.name === "bull" ? "up" : s.name === "bear" ? "down" : ""}>{s.name[0].toUpperCase() + s.name.slice(1)}</b>
              <span className="num">{s.probability}%</span>
            </div>
            <div className="num bold">{formatUsd(s.priceTarget, d)}</div>
            <div className="tiny muted">{s.description}</div>
          </div>
        ))}
      </div>
      {view.drivers.length > 0 && (
        <div>
          {view.drivers.map((dr) => (
            <div key={dr.factor} className="small" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span className={dr.effect === "bullish" ? "up" : "down"}>{dr.effect === "bullish" ? "▲" : "▼"}</span> <b>{dr.factor}</b>{" "}
              <span className="chip">{dr.weight}</span>
              <div className="muted tiny">{dr.explanation}</div>
            </div>
          ))}
        </div>
      )}
      {model && <div className="tiny faint">Model: {model}</div>}
    </div>
  );
}

export function FactorsList({ f }: { f: Forecast }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {f.factors.map((x) => (
        <div key={x.name} className="spread small">
          <span className="muted">{x.name}</span>
          <span className={`num ${x.value > 0.001 ? "up" : x.value < -0.001 ? "down" : "neutral"}`}>
            {x.value > 0 ? "+" : ""}
            {(x.value * 100).toFixed(1)} pts
          </span>
        </div>
      ))}
      <div className="spread small bold" style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
        <span>Probability price is higher</span>
        <span className="num">{Math.round(f.probUp * 100)}%</span>
      </div>
    </div>
  );
}

export function DerivativesBox({ a }: { a: AssetAnalysis }) {
  const dv = a.derivatives;
  if (!dv) return <p className="small muted">No futures data for this asset.</p>;
  return (
    <div className="kv">
      <span>Funding rate (8h)</span>
      <span className={dv.fundingRate !== null && dv.fundingRate > 0 ? "up" : "down"}>{dv.fundingRate !== null ? `${(dv.fundingRate * 100).toFixed(4)}%` : "—"}</span>
      <span>Funding, yearly</span>
      <span>{dv.fundingAnnualPct !== null ? `${dv.fundingAnnualPct.toFixed(1)}%` : "—"}</span>
      <span>Open interest</span>
      <span>{dv.openInterestUsd ? `$${(dv.openInterestUsd / 1e6).toFixed(0)}M` : "—"}</span>
      <span>Long / short accounts</span>
      <span>{dv.longShortRatio ? dv.longShortRatio.toFixed(2) : "—"}</span>
    </div>
  );
}

export function RangesTable({ a, asset }: { a: AssetAnalysis; asset: AssetConfig }) {
  const d = asset.decimals;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Within</th>
            <th>Likely low</th>
            <th>Likely high</th>
            <th>± move</th>
          </tr>
        </thead>
        <tbody>
          {a.ranges.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="up">{formatUsd(r.low, d)}</td>
              <td className="down">{formatUsd(r.high, d)}</td>
              <td>±{r.pct.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny faint" style={{ margin: "8px 4px 0" }}>
        About 2 in 3 times, price stays inside this range (1 standard deviation of recent volatility).
      </p>
    </div>
  );
}

export { DirBadge, categoryLabel };
