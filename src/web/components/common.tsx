import type { ReactNode } from "react";
import { formatInr, formatPct, formatUsd } from "../../core/format";
import type { AssetConfig, Candle, Direction } from "../../core/types";
import { useMarket } from "../store";

export function Price({ usd, decimals, className, inrOnly }: { usd: number | null | undefined; decimals: number; className?: string; inrOnly?: boolean }) {
  const { settings, usdInr } = useMarket();
  const mode = inrOnly ? "inr" : settings.currency;
  if (mode === "inr" && usdInr) return <span className={`num ${className ?? ""}`}>{formatInr(usd, usdInr)}</span>;
  return <span className={`num ${className ?? ""}`}>{formatUsd(usd, decimals)}</span>;
}

/** Secondary INR line shown under USD prices when currency = both. */
export function InrLine({ usd }: { usd: number | null | undefined }) {
  const { settings, usdInr } = useMarket();
  if (settings.currency !== "both" || !usdInr || !usd) return null;
  return <div className="num muted small">{formatInr(usd, usdInr)}</div>;
}

export function Pct({ v, digits = 2 }: { v: number | null | undefined; digits?: number }) {
  const cls = v === null || v === undefined ? "" : v > 0 ? "up" : v < 0 ? "down" : "neutral";
  return <span className={`num ${cls}`}>{formatPct(v, digits)}</span>;
}

export function dirClass(d: Direction | "bullish" | "bearish" | undefined) {
  return d === "up" || d === "bullish" ? "up" : d === "down" || d === "bearish" ? "down" : "neutral";
}

export function DirBadge({ dir, probUp, label }: { dir: Direction; probUp: number; label?: string }) {
  const word = dir === "up" ? "Bullish" : dir === "down" ? "Bearish" : "Neutral";
  const p = dir === "down" ? 1 - probUp : dir === "up" ? probUp : probUp;
  return (
    <span className={`badge ${dirClass(dir)}`}>
      {dir === "up" ? "▲" : dir === "down" ? "▼" : "◆"} {label ?? word} {dir === "neutral" ? `${Math.round(p * 100)}% up` : `${Math.round(p * 100)}%`}
    </span>
  );
}

export function Arrow({ dir }: { dir: Direction }) {
  return <span className={`arrow ${dirClass(dir)}`}>{dir === "up" ? "↗" : dir === "down" ? "↘" : "↔"}</span>;
}

export function AssetIcon({ asset, size = 34 }: { asset: AssetConfig; size?: number }) {
  const label = asset.id === "GOLD" ? "Au" : asset.id.slice(0, 3);
  return (
    <span className="asset-icon" style={{ background: asset.color, width: size, height: size, fontSize: size * 0.34, color: asset.id === "GOLD" ? "#3a2a00" : "#fff" }}>
      {label}
    </span>
  );
}

export function Sparkline({ candles, color, height = 44 }: { candles: Candle[] | undefined; color: string; height?: number }) {
  if (!candles || candles.length < 2) return <div className="skeleton" style={{ height }} />;
  const pts = candles.slice(-48).map((c) => c.c);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const w = 300;
  const span = max - min || 1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${height - 3 - ((v - min) / span) * (height - 6)}`).join(" L");
  const id = `g${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,${height} L${d} L${w},${height} Z`} fill={`url(#${id})`} />
      <path d={`M${d}`} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="meter">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title !== undefined && (
        <h3 className="card-title">
          <span>{title}</span>
          {right}
        </h3>
      )}
      {children}
    </section>
  );
}

export function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const angle = (value / 100) * 180 - 90;
  const color = value <= 25 ? "var(--down)" : value <= 45 ? "#f08a3e" : value <= 55 ? "var(--neutral)" : value <= 75 ? "#8bc34a" : "var(--up)";
  return (
    <div className="row" style={{ gap: 14 }}>
      <svg width="108" height="62" viewBox="0 0 108 62" aria-label={`Fear and Greed ${value}`}>
        <defs>
          <linearGradient id="fg" x1="0" x2="1">
            <stop offset="0" stopColor="#f0475a" />
            <stop offset="0.5" stopColor="#a0a7b8" />
            <stop offset="1" stopColor="#16c784" />
          </linearGradient>
        </defs>
        <path d="M8 56 A46 46 0 0 1 100 56" fill="none" stroke="url(#fg)" strokeWidth="9" strokeLinecap="round" />
        <g transform={`rotate(${angle} 54 56)`}>
          <line x1="54" y1="56" x2="54" y2="18" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="54" cy="56" r="5" fill="var(--text)" />
      </svg>
      <div>
        <div className="price-big num" style={{ color }}>
          {value}
        </div>
        <div className="small muted">{label}</div>
      </div>
    </div>
  );
}

export const Icon = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};
