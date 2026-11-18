import { useState } from "react";
import { timeAgo } from "../../core/format";
import type { Timeframe } from "../../core/types";
import { AssetIcon, Card, DirBadge, InrLine, Pct, Price } from "../components/common";
import {
  AiCard,
  DerivativesBox,
  DriversList,
  FactorsList,
  FloorCeilingPanel,
  ForecastCard,
  LevelsTable,
  RangesTable,
  SignalNotes,
  TimeframeTable,
  TrackRecord,
} from "../components/panels";
import { PriceChart, type ChartOverlays } from "../components/PriceChart";
import { TradingViewWidget } from "../components/TradingViewWidget";
import { currentPrice, useAsset } from "../store";
import { AlertRow } from "./Dashboard";

const CHART_TFS: Timeframe[] = ["5m", "15m", "1h", "4h", "1d", "1w"];
const TV_INTERVAL: Record<string, string> = { "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };

export function AssetPage({ id }: { id: string }) {
  const { asset, st, market } = useAsset(id);
  const [tf, setTf] = useState<Timeframe>("1h");
  const [view, setView] = useState<"signal" | "tv">(id === "GOLD" ? "tv" : "signal");
  const [ov, setOv] = useState<ChartOverlays>({ emas: true, zones: true, volume: true });
  if (!asset || !st) return <div className="notice">Unknown asset {id}.</div>;
  const a = st.analysis;
  const price = currentPrice(st);
  const snap = market.snapshot;
  const ai = snap?.ai?.assets.find((v) => v.id === id) ?? null;
  const alerts = [...(snap?.alerts ?? []), ...market.localAlerts].filter((x) => x.asset === id).sort((x, y) => y.at - x.at).slice(0, 5);
  const theme = market.settings.theme;

  return (
    <>
      <a className="back" href="#/">
        ← Markets
      </a>
      <div className="hero">
        <div className="row" style={{ gap: 12 }}>
          <AssetIcon asset={asset} size={46} />
          <div>
            <div className="page-title" style={{ margin: 0 }}>
              {asset.name}
            </div>
            <div className="tiny faint">
              {a ? `${a.source} · ${st.origin === "server" ? `server analysis ${timeAgo(a.updatedAt)}` : `analysed ${timeAgo(a.updatedAt)}`}` : "Loading…"}
            </div>
          </div>
        </div>
        <div>
          <Price usd={price} decimals={asset.decimals} className="price-xl" />
          <InrLine usd={price} />
        </div>
        {a && (
          <div className="row wrap">
            <Pct v={a.change24hPct + (price ? (price / a.price - 1) * 100 : 0)} />
            <span className="faint small">24h</span>
            <DirBadge dir={a.forecast.direction} probUp={a.forecast.probUp} label={`${a.forecast.horizonLabel}:`} />
          </div>
        )}
      </div>
      {asset.note && <div className="notice small" style={{ marginBottom: 14 }}>{asset.note}</div>}

      <div className="grid g-main">
        <div className="stack" style={{ gap: 16 }}>
          <Card
            title={
              <span className="seg">
                <button className={view === "signal" ? "on" : ""} onClick={() => setView("signal")}>
                  SignalDesk chart
                </button>
                <button className={view === "tv" ? "on" : ""} onClick={() => setView("tv")}>
                  TradingView {id === "GOLD" ? "XAU/USD" : ""}
                </button>
              </span>
            }
            right={
              <div className="tabs">
                {CHART_TFS.map((t) => (
                  <button key={t} className={tf === t ? "on" : ""} onClick={() => setTf(t)}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          >
            {view === "signal" ? (
              <>
                <PriceChart asset={asset} tf={tf} candles={st.candles[tf]} analysis={a} livePrice={st.livePrice} overlays={ov} theme={theme} />
                <div className="spread wrap" style={{ marginTop: 8 }}>
                  <div className="legend">
                    <span>
                      <i style={{ background: "var(--up)" }} />
                      Floor zone
                    </span>
                    <span>
                      <i style={{ background: "var(--down)" }} />
                      Ceiling zone
                    </span>
                    <span>
                      <i style={{ background: "#4c8dff" }} />
                      EMA 20
                    </span>
                    <span>
                      <i style={{ background: "#f0b90b" }} />
                      EMA 50
                    </span>
                    <span>
                      <i style={{ background: "#c06cff" }} />
                      EMA 200
                    </span>
                  </div>
                  <div className="tabs">
                    {(["zones", "emas", "volume"] as const).map((k) => (
                      <button key={k} className={ov[k] ? "on" : ""} onClick={() => setOv({ ...ov, [k]: !ov[k] })}>
                        {k === "emas" ? "EMAs" : k[0].toUpperCase() + k.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <TradingViewWidget symbol={asset.tradingViewSymbol} interval={TV_INTERVAL[tf] ?? "60"} theme={theme} />
            )}
          </Card>

          {a ? (
            <>
              <Card title="Forecast">
                <div className="grid g-3">
                  {a.horizons.map((h) => (
                    <ForecastCard key={h.horizonLabel} f={h} asset={asset} price={price ?? a.price} />
                  ))}
                </div>
              </Card>
              <Card title="Predicted floor & ceiling" right={<span className="tiny faint">next 3 days</span>}>
                <FloorCeilingPanel a={a} asset={asset} />
              </Card>
              <Card title="Multi-timeframe analysis">
                <TimeframeTable tfs={a.timeframes} />
                <SignalNotes tfs={a.timeframes} />
              </Card>
              <Card title="All support & resistance zones">
                <LevelsTable a={a} asset={asset} />
              </Card>
            </>
          ) : (
            <div className="skeleton" style={{ height: 320 }} />
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="AI analyst" right={<span className="chip">{snap?.ai?.provider?.replace(/ \(.*\)$/, "") ?? "AI"}</span>}>
            <AiCard view={ai} generatedAt={snap?.ai?.generatedAt} model={snap?.ai?.model} asset={asset} enabled={!!snap?.monitor.aiEnabled} />
          </Card>
          {a && (
            <>
              <Card title="What's driving it">
                <DriversList drivers={a.drivers} empty={snap ? "No strong news drivers in the last 72 hours." : "News drivers come from the 24/7 server (Settings)."} />
              </Card>
              <Card title="How the forecast is built">
                <FactorsList f={a.forecast} />
              </Card>
              <Card title="Expected range">
                <RangesTable a={a} asset={asset} />
              </Card>
              <Card title="Futures positioning">
                <DerivativesBox a={a} />
              </Card>
              <Card title="Model track record">
                <TrackRecord tfs={a.timeframes} />
              </Card>
            </>
          )}
          <Card title="Recent alarms" right={<a className="small" href="#/alerts">Manage →</a>}>
            {alerts.length ? alerts.map((x) => <AlertRow key={x.id} a={x} showAsset={false} />) : <p className="small muted">No alarms for {asset.id} yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
