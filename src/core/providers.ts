import type { AssetConfig, Candle, Derivatives, SourceRef, Timeframe } from "./types";

/** Fetch JSON with a timeout and one retry. Works in browsers, Electron, Capacitor and Node 18+. */
export async function getJson<T = unknown>(url: string, timeoutMs = 12000, retries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BINANCE = "https://data-api.binance.vision";
const OKX = "https://www.okx.com";
const KRAKEN = "https://api.kraken.com";
const COINDCX = "https://public.coindcx.com";

const OKX_BAR: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1Dutc",
  "1w": "1Wutc",
};

const KRAKEN_INTERVAL: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

function sortDedupe(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if ([c.o, c.h, c.l, c.c].every((x) => Number.isFinite(x) && x > 0)) map.set(c.t, c);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function binanceCandles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${Math.min(limit, 1000)}`;
  const rows = await getJson<(string | number)[][]>(url);
  return sortDedupe(
    rows.map((r) => ({ t: Number(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })),
  );
}

async function okxPaged(path: string, instId: string, tf: Timeframe, limit: number, pageSize: number): Promise<string[][]> {
  const out: string[][] = [];
  let after = "";
  for (let page = 0; page < 8 && out.length < limit; page++) {
    const url = `${OKX}${path}?instId=${instId}&bar=${OKX_BAR[tf]}&limit=${pageSize}${after ? `&after=${after}` : ""}`;
    const res = await getJson<{ code: string; data: string[][]; msg: string }>(url);
    if (res.code !== "0") throw new Error(`OKX ${res.code}: ${res.msg}`);
    if (!res.data.length) break;
    out.push(...res.data);
    after = res.data[res.data.length - 1][0];
    if (res.data.length < pageSize) break;
  }
  return out;
}

async function okxCandles(instId: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const rows = await okxPaged("/api/v5/market/candles", instId, tf, limit, 300);
  return sortDedupe(rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })));
}

/** OKX index candles (e.g. XAU-USD spot gold). Index has no volume, so it is borrowed from a traded instrument. */
async function okxIndexCandles(instId: string, tf: Timeframe, limit: number, volumeInstId?: string): Promise<Candle[]> {
  const [rows, vol] = await Promise.all([
    okxPaged("/api/v5/market/index-candles", instId, tf, limit, 100),
    volumeInstId ? okxCandles(volumeInstId, tf, limit).catch(() => [] as Candle[]) : Promise.resolve([] as Candle[]),
  ]);
  const volByT = new Map(vol.map((c) => [c.t, c.v]));
  return sortDedupe(
    rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: volByT.get(+r[0]) ?? 0 })),
  );
}

async function krakenCandles(pair: string, tf: Timeframe): Promise<Candle[]> {
  const url = `${KRAKEN}/0/public/OHLC?pair=${pair}&interval=${KRAKEN_INTERVAL[tf]}`;
  const res = await getJson<{ error: string[]; result: Record<string, unknown> }>(url);
  if (res.error?.length) throw new Error(`Kraken: ${res.error.join(",")}`);
  const key = Object.keys(res.result).find((k) => k !== "last");
  if (!key) throw new Error("Kraken: empty result");
  const rows = res.result[key] as (string | number)[][];
  return sortDedupe(rows.map((r) => ({ t: Number(r[0]) * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] })));
}

async function coindcxCandles(pair: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const url = `${COINDCX}/market_data/candles?pair=${pair}&interval=${tf}&limit=${Math.min(limit, 1000)}`;
  const rows = await getJson<{ open: number; high: number; low: number; close: number; volume: number; time: number }[]>(url);
  return sortDedupe(rows.map((r) => ({ t: r.time, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume })));
}

export function sourceLabel(s: SourceRef): string {
  switch (s.provider) {
    case "binance":
      return `Binance ${s.symbol}`;
    case "okx":
      return `OKX ${s.instId}`;
    case "okx-index":
      return `OKX index ${s.instId}`;
    case "kraken":
      return `Kraken ${s.pair}`;
    case "coindcx":
      return `CoinDCX ${s.pair}`;
  }
}

export async function fetchFromSource(s: SourceRef, tf: Timeframe, limit: number): Promise<Candle[]> {
  switch (s.provider) {
    case "binance":
      return binanceCandles(s.symbol, tf, limit);
    case "okx":
      return okxCandles(s.instId, tf, limit);
    case "okx-index":
      return okxIndexCandles(s.instId, tf, limit, s.volumeInstId);
    case "kraken":
      return krakenCandles(s.pair, tf);
    case "coindcx":
      return coindcxCandles(s.pair, tf, limit);
  }
}

export interface CandleResult {
  candles: Candle[];
  source: string;
}

export interface FetchOptions {
  /** Skip providers that a browser cannot reach because of CORS. */
  browser?: boolean;
  /** Remember which source worked per asset to keep timeframes consistent. */
  preferred?: Map<string, number>;
}

/** Fetch candles for an asset, falling back through its sources until one returns enough data. */
export async function fetchCandles(asset: AssetConfig, tf: Timeframe, limit = 500, opts: FetchOptions = {}): Promise<CandleResult> {
  const errors: string[] = [];
  const order = asset.sources.map((_, i) => i);
  const pref = opts.preferred?.get(asset.id);
  if (pref !== undefined) order.sort((a, b) => (a === pref ? -1 : b === pref ? 1 : a - b));
  for (const i of order) {
    const src = asset.sources[i];
    if (opts.browser && src.provider === "coindcx") continue;
    try {
      const candles = await fetchFromSource(src, tf, limit);
      if (candles.length < 30) throw new Error(`only ${candles.length} candles`);
      opts.preferred?.set(asset.id, i);
      return { candles: candles.slice(-limit), source: sourceLabel(src) };
    } catch (err) {
      errors.push(`${sourceLabel(src)}: ${(err as Error).message}`);
    }
  }
  throw new Error(`No data for ${asset.id} ${tf}. ${errors.join(" | ")}`);
}

/** Funding rate, open interest and long/short account ratio from OKX perpetual swaps. */
export async function fetchDerivatives(asset: AssetConfig, opts: FetchOptions = {}): Promise<Derivatives | null> {
  if (!asset.okxSwap) return null;
  const [fr, oi, ls] = await Promise.allSettled([
    getJson<{ data: { fundingRate: string }[] }>(`${OKX}/api/v5/public/funding-rate?instId=${asset.okxSwap}`),
    getJson<{ data: { oiUsd: string }[] }>(`${OKX}/api/v5/public/open-interest?instType=SWAP&instId=${asset.okxSwap}`),
    asset.okxCcy && !opts.browser
      ? getJson<{ data: string[][] }>(`${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${asset.okxCcy}&period=1H`)
      : Promise.reject(new Error("no ccy")),
  ]);
  const funding = fr.status === "fulfilled" ? Number(fr.value.data?.[0]?.fundingRate) : NaN;
  const oiUsd = oi.status === "fulfilled" ? Number(oi.value.data?.[0]?.oiUsd) : NaN;
  const lsr = ls.status === "fulfilled" ? Number(ls.value.data?.[0]?.[1]) : NaN;
  if (![funding, oiUsd, lsr].some(Number.isFinite)) return null;
  return {
    fundingRate: Number.isFinite(funding) ? funding : null,
    // OKX funds every 8h -> 3 times a day.
    fundingAnnualPct: Number.isFinite(funding) ? funding * 3 * 365 * 100 : null,
    openInterestUsd: Number.isFinite(oiUsd) ? oiUsd : null,
    longShortRatio: Number.isFinite(lsr) ? lsr : null,
  };
}

export async function fetchFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const res = await getJson<{ data: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=1");
    const d = res.data?.[0];
    return d ? { value: Number(d.value), label: d.value_classification } : null;
  } catch {
    return null;
  }
}

/** Live USDT->INR rate from CoinDCX (Indian exchange). Not reachable from a plain browser (no CORS). */
export async function fetchUsdInr(): Promise<number | null> {
  try {
    const rows = await getJson<{ market: string; last_price: string }[]>("https://api.coindcx.com/exchange/ticker");
    const row = rows.find((r) => r.market === "USDTINR");
    const v = row ? Number(row.last_price) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Lightweight last-price lookup for live updates (no candles). */
export async function fetchLastPrice(asset: AssetConfig, opts: FetchOptions = {}): Promise<number> {
  for (const s of asset.sources) {
    try {
      switch (s.provider) {
        case "binance": {
          const r = await getJson<{ price: string }>(`${BINANCE}/api/v3/ticker/price?symbol=${s.symbol}`, 8000, 0);
          return Number(r.price);
        }
        case "okx": {
          const r = await getJson<{ data: { last: string }[] }>(`${OKX}/api/v5/market/ticker?instId=${s.instId}`, 8000, 0);
          return Number(r.data[0].last);
        }
        case "okx-index": {
          const r = await getJson<{ data: { idxPx: string }[] }>(`${OKX}/api/v5/market/index-tickers?instId=${s.instId}`, 8000, 0);
          return Number(r.data[0].idxPx);
        }
        case "kraken": {
          const r = await getJson<{ result: Record<string, { c: string[] }> }>(`${KRAKEN}/0/public/Ticker?pair=${s.pair}`, 8000, 0);
          return Number(Object.values(r.result)[0].c[0]);
        }
        case "coindcx":
          if (opts.browser) continue;
          break;
      }
    } catch {
      /* try next source */
    }
  }
  throw new Error(`No live price for ${asset.id}`);
}
