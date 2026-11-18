import { ENABLED_ASSETS } from "../../core/assets";
import { categoryLabel } from "../../core/drivers";
import { formatUsd, timeAgo } from "../../core/format";
import type { AssetConfig, FiredAlert } from "../../core/types";
import { Arrow, AssetIcon, Card, DirBadge, FearGreedGauge, InrLine, Pct, Price, Sparkline } from "../components/common";
import { RangeBar } from "../components/panels";
import { currentPrice, useMarket, type AssetState } from "../store";

function AssetCard({ asset, st }: { asset: AssetConfig; st: AssetState }) {
  const a = st.analysis;
  const price = currentPrice(st);
  if (!a || price === null) {
    return (
      <div className="card asset-card">
        <div className="row">
          <AssetIcon asset={asset} />
          <div className="asset-name">{asset.name}</div>
        </div>
        {st.error ? <div className="notice small">Data unavailable: {st.error.slice(0, 140)}</div> : <div className="skeleton" style={{ height: 150 }} />}
      </div>
    );
  }
  const f = a.forecast;
  const short = a.horizons[0];
  const change = a.change24hPct + ((price / a.price - 1) * 100);
  return (
    <a className="card asset-card" href={`#/asset/${asset.id}`}>
      <div className="spread">
        <div className="row">
          <AssetIcon asset={asset} />
          <div>
            <div className="asset-name">{asset.name}</div>
            <div className="tiny faint">{asset.id === "GOLD" ? "Spot XAU/USD · " : ""}{a.source}</div>
          </div>
        </div>
        <DirBadge dir={f.direction} probUp={f.probUp} label={`Days: ${f.direction === "up" ? "Bullish" : f.direction === "down" ? "Bearish" : "Neutral"}`} />
      </div>
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div>
          <Price usd={price} decimals={asset.decimals} className="price-big" />
          <InrLine usd={price} />
        </div>
        <div style={{ textAlign: "right" }}>
          <Pct v={change} />
          <div className="tiny faint">24h</div>
        </div>
      </div>
      <Sparkline candles={st.candles["1h"]} color={asset.color} />
      <RangeBar a={a} price={price} decimals={asset.decimals} />
      <div className="next-move">
        <Arrow dir={short.direction} />
        <div className="grow">
          <div className="small bold">
            {short.direction === "neutral" ? (
              <>Next hours: range-bound</>
            ) : (
              <>
                Next hours: {short.direction === "up" ? "up" : "down"} to {formatUsd(short.target1, asset.decimals)}
              </>
            )}
          </div>
          <div className="tiny muted">
            {short.direction === "neutral" ? `No clear edge (${Math.round(short.probUp * 100)}% up)` : `${Math.round((short.direction === "down" ? 1 - short.probUp : short.probUp) * 100)}% · in about ${short.eta?.label ?? "—"}`}
          </div>
        </div>
      </div>
    </a>
  );
}

export function AlertRow({ a, showAsset = true }: { a: FiredAlert; showAsset?: boolean }) {
  const good = a.kind === "floor-hit" || a.kind === "ceiling-break";
  const bad = a.kind === "ceiling-hit" || a.kind === "floor-break";
  const icon = a.kind.startsWith("approach") ? "👀" : a.kind === "custom" ? "🔔" : a.kind.endsWith("break") ? "⚠️" : a.kind === "floor-hit" ? "🟢" : "🔴";
  return (
    <div className="alert-item">
      <div className="alert-icon" style={{ background: good ? "var(--up-bg)" : bad ? "var(--down-bg)" : "var(--panel-2)" }}>
        {icon}
      </div>
      <div className="grow">
        <div className="spread">
          <b className="small">{a.title}</b>
          <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>
            {timeAgo(a.at)}
          </span>
        </div>
        <div className="small muted" style={{ whiteSpace: "pre-line" }}>
          {a.message.replace(/\n\nNot financial advice\.$/, "")}
        </div>
        {showAsset && (
          <a className="tiny" href={`#/asset/${a.asset}`}>
            Open {a.asset} →
          </a>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const m = useMarket();
  const snap = m.snapshot;
  const alerts = [...(snap?.alerts ?? []), ...m.localAlerts].sort((x, y) => y.at - x.at).slice(0, 6);
  const news = (snap?.news ?? []).filter((n) => n.categories.some((c) => c === "war" || c === "geopolitics" || c === "monetary" || c === "cyber") || n.assets.length).slice(0, 7);
  return (
    <>
      <div className="spread wrap" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="page-title">Markets</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Multi-timeframe analysis, predicted floors and ceilings, and what is driving each market.
          </p>
        </div>
      </div>

      <div className="dash">
      <div className="grid g-3 pulse">
        <Card title="Crypto sentiment">
          {m.fearGreed ? <FearGreedGauge value={m.fearGreed.value} label={m.fearGreed.label} /> : <div className="skeleton" style={{ height: 62 }} />}
        </Card>
        <Card title="Risk regime" right={snap?.ai ? <span className="tiny faint">AI · {timeAgo(snap.ai.generatedAt)}</span> : null}>
          {snap?.ai ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className={`badge ${snap.ai.riskRegime === "risk-on" ? "up" : snap.ai.riskRegime === "risk-off" ? "down" : "neutral"}`} style={{ alignSelf: "flex-start" }}>
                {snap.ai.riskRegime.toUpperCase()}
              </span>
              <div className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {snap.ai.marketSummary}
              </div>
            </div>
          ) : (
            <div className="small muted">The AI market summary appears here once the 24/7 server runs with an AI key.</div>
          )}
        </Card>
        <Card title="USD / INR">
          <div className="price-big num">{m.usdInr ? `₹${m.usdInr.toFixed(2)}` : "—"}</div>
          <div className="small muted">USDT price on CoinDCX{snap ? ` · ${timeAgo(snap.generatedAt)}` : ""}</div>
        </Card>
      </div>

      <div className="grid g-assets assets">
        {ENABLED_ASSETS.map((a) => (
          <AssetCard key={a.id} asset={a} st={m.assets[a.id]} />
        ))}
      </div>

      <div className="grid g-2 lower" style={{ alignItems: "start" }}>
        <Card title="Latest alarms" right={<a className="small" href="#/alerts">All alarms →</a>}>
          {alerts.length ? alerts.map((a) => <AlertRow key={a.id} a={a} />) : <p className="small muted">No alarms yet. They appear here when a price reaches a predicted floor or ceiling.</p>}
        </Card>
        <Card title="What's moving markets" right={<a className="small" href="#/news">All news →</a>}>
          {news.length ? (
            news.map((n) => (
              <div key={n.url + n.title} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  {n.categories.slice(0, 2).map((c) => (
                    <span key={c} className="chip">
                      {categoryLabel(c)}
                    </span>
                  ))}
                  <span className="tiny faint">
                    {n.source} · {timeAgo(n.publishedAt)}
                  </span>
                </div>
                <a className="small" href={n.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
                  {n.title}
                </a>
              </div>
            ))
          ) : (
            <p className="small muted">News and world events come from the 24/7 server. {m.settings.dataUrl ? "Waiting for data…" : "Connect it in Settings."}</p>
          )}
        </Card>
      </div>
      </div>
    </>
  );
}
