export function formatPrice(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const d = v >= 1000 ? Math.min(decimals, 2) : decimals;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatUsd(v: number | null | undefined, decimals = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `$${formatPrice(v, decimals)}`;
}

/** Indian-style grouping (1,23,45,678) for rupee prices. */
export function formatInr(usd: number | null | undefined, rate: number | null | undefined): string {
  if (!usd || !rate || !Number.isFinite(usd * rate)) return "—";
  const v = usd * rate;
  const d = v >= 1000 ? 0 : 2;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function formatPct(v: number | null | undefined, digits = 2, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function unit(hours: number): { div: number; name: string } {
  if (hours < 1) return { div: 1 / 60, name: "minutes" };
  if (hours < 48) return { div: 1, name: "hours" };
  if (hours < 24 * 14) return { div: 24, name: "days" };
  return { div: 24 * 7, name: "weeks" };
}

/** "35–50 minutes", "6–14 hours", "2–4 days", "1–3 weeks". */
export function formatDurationRange(minH: number, maxH: number): string {
  const u = unit((minH + maxH) / 2);
  const a = Math.max(1, Math.round(minH / u.div));
  const b = Math.max(a + 1, Math.round(maxH / u.div));
  return `${a}–${b} ${u.name}`;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
