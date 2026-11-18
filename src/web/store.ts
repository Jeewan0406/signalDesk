// App state: runs the same analysis engine as the server, locally, on fresh
// exchange data every 2 minutes; streams live prices; merges in the server
// snapshot (news, AI analyst, INR rate, 24/7 alarm history); and checks
// in-app alarms on every live tick.

import { useSyncExternalStore } from "react";
import { analyzeFromCandles, fetchCandleSet } from "../core/analyze";
import { ENABLED_ASSETS, getAsset } from "../core/assets";
import { formatUsd } from "../core/format";
import type { CandleSet } from "../core/levels";
import { fetchDerivatives, fetchFearGreed, fetchLastPrice, fetchUsdInr } from "../core/providers";
import type { AssetAnalysis, AssetConfig, Derivatives, FiredAlert, PublishedSnapshot } from "../core/types";
import { beep, isNative, showNotification } from "./platform";
import { loadSettings, saveSettings, type Settings } from "./settings";

export interface AssetState {
  analysis: AssetAnalysis | null;
  candles: CandleSet;
  livePrice: number | null;
  liveAt: number;
  error: string | null;
  loading: boolean;
  origin: "local" | "server" | null;
  derivatives: Derivatives | null;
}

export interface MarketState {
  assets: Record<string, AssetState>;
  snapshot: PublishedSnapshot | null;
  snapshotError: string | null;
  usdInr: number | null;
  fearGreed: { value: number; label: string } | null;
  localAlerts: FiredAlert[];
  live: boolean;
  lastRefresh: number;
  settings: Settings;
}

const ALERT_LOG_KEY = "signaldesk.localAlerts.v1";
const COOLDOWN_KEY = "signaldesk.cooldowns.v1";

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

class MarketStore {
  private state: MarketState;
  private listeners = new Set<() => void>();
  private preferred = new Map<string, number>();
  private lastTick: Record<string, number> = {};
  private ws: WebSocket | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private started = false;

  constructor() {
    const assets: Record<string, AssetState> = {};
    for (const a of ENABLED_ASSETS) {
      assets[a.id] = { analysis: null, candles: {}, livePrice: null, liveAt: 0, error: null, loading: true, origin: null, derivatives: null };
    }
    this.state = {
      assets,
      snapshot: null,
      snapshotError: null,
      usdInr: null,
      fearGreed: null,
      localAlerts: readLS<FiredAlert[]>(ALERT_LOG_KEY, []),
      live: false,
      lastRefresh: 0,
      settings: loadSettings(),
    };
  }

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<MarketState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private setAsset(id: string, patch: Partial<AssetState>) {
    this.set({ assets: { ...this.state.assets, [id]: { ...this.state.assets[id], ...patch } } });
  }

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    saveSettings(settings);
    const dataChanged = patch.dataUrl !== undefined && patch.dataUrl !== this.state.settings.dataUrl;
    this.set({ settings });
    if (dataChanged) void this.loadSnapshot().then(() => this.refreshAll());
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.loadSnapshot().then(() => this.refreshAll());
    this.timers.push(setInterval(() => void this.loadSnapshot(), 60_000));
    this.timers.push(setInterval(() => void this.refreshAll(), 120_000));
    this.timers.push(setInterval(() => void this.pollPrices(), 10_000));
    this.connectWs();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - this.state.lastRefresh > 60_000) {
        void this.loadSnapshot();
        void this.refreshAll();
      }
    });
  }

  async loadSnapshot() {
    const url = this.state.settings.dataUrl;
    if (!url) {
      this.set({ snapshot: null, snapshotError: null });
      return;
    }
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as PublishedSnapshot;
      this.set({ snapshot: snap, snapshotError: null, usdInr: snap.usdInr ?? this.state.usdInr, fearGreed: snap.fearGreed ?? this.state.fearGreed });
      // Fill in assets we could not analyse locally.
      for (const [id, a] of Object.entries(snap.assets)) {
        const cur = this.state.assets[id];
        if (cur && (!cur.analysis || cur.origin === "server")) this.setAsset(id, { analysis: a, origin: "server", loading: false });
      }
    } catch (err) {
      this.set({ snapshotError: `Could not load server data: ${(err as Error).message}` });
    }
  }

  async refreshAll() {
    const tasks: Promise<unknown>[] = ENABLED_ASSETS.map((a) => this.refreshAsset(a));
    if (!this.state.fearGreed || Date.now() - this.state.lastRefresh > 30 * 60_000) {
      tasks.push(fetchFearGreed().then((fg) => fg && this.set({ fearGreed: fg })));
    }
    if (isNative() && !this.state.usdInr) tasks.push(fetchUsdInr().then((r) => r && this.set({ usdInr: r })));
    await Promise.allSettled(tasks);
    this.set({ lastRefresh: Date.now() });
  }

  async refreshAsset(asset: AssetConfig) {
    try {
      const [{ set, source }, derivatives] = await Promise.all([
        fetchCandleSet(asset, { browser: !isNative(), preferred: this.preferred }),
        fetchDerivatives(asset, { browser: !isNative() }).catch(() => null),
      ]);
      const snap = this.state.snapshot;
      // Browsers cannot read OKX's long/short ratio (no CORS): borrow it from the server snapshot.
      const snapDer = snap?.assets[asset.id]?.derivatives;
      if (derivatives && derivatives.longShortRatio === null && snapDer?.longShortRatio) derivatives.longShortRatio = snapDer.longShortRatio;
      const ai = snap?.ai?.assets.find((v) => v.id === asset.id) ?? null;
      const analysis = analyzeFromCandles(asset, set, source, {
        news: snap?.news ?? [],
        derivatives,
        fearGreed: this.state.fearGreed ?? snap?.fearGreed ?? null,
        ai,
        aiAgeHours: snap?.ai ? (Date.now() - snap.ai.generatedAt) / 3_600_000 : undefined,
      });
      this.setAsset(asset.id, { analysis, candles: set, error: null, loading: false, origin: "local", derivatives });
      if (!this.lastTick[asset.id]) this.lastTick[asset.id] = analysis.price;
    } catch (err) {
      const fallback = this.state.snapshot?.assets[asset.id];
      this.setAsset(asset.id, {
        error: (err as Error).message,
        loading: false,
        ...(fallback && !this.state.assets[asset.id].analysis ? { analysis: fallback, origin: "server" as const } : {}),
      });
    }
  }

  // ---- Live prices ------------------------------------------------------
  private connectWs() {
    const streams = ENABLED_ASSETS.filter((a) => a.binanceStream && a.sources[0].provider === "binance").map((a) => `${a.binanceStream}@miniTicker`);
    if (!streams.length || typeof WebSocket === "undefined") return;
    try {
      const ws = new WebSocket(`wss://data-stream.binance.vision/stream?streams=${streams.join("/")}`);
      this.ws = ws;
      ws.onopen = () => this.set({ live: true });
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { data: { s: string; c: string } };
          const asset = ENABLED_ASSETS.find((a) => a.binanceStream === msg.data.s.toLowerCase());
          if (asset) this.onTick(asset, Number(msg.data.c));
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        this.set({ live: false });
        setTimeout(() => this.connectWs(), 5000);
      };
      ws.onerror = () => ws.close();
    } catch {
      this.set({ live: false });
    }
  }

  private async pollPrices() {
    if (document.visibilityState === "hidden" && !isNative()) return;
    const wsAssets = new Set(this.state.live ? ENABLED_ASSETS.filter((a) => a.binanceStream && a.sources[0].provider === "binance").map((a) => a.id) : []);
    await Promise.allSettled(
      ENABLED_ASSETS.filter((a) => !wsAssets.has(a.id)).map(async (a) => {
        const p = await fetchLastPrice(a, { browser: !isNative() });
        if (Number.isFinite(p) && p > 0) this.onTick(a, p);
      }),
    );
  }

  private onTick(asset: AssetConfig, price: number) {
    const cur = this.state.assets[asset.id];
    // Throttle UI updates to ~2 per second per asset.
    if (cur.livePrice === price && Date.now() - cur.liveAt < 500) return;
    this.setAsset(asset.id, { livePrice: price, liveAt: Date.now() });
    this.checkLocalAlarms(asset, price);
  }

  // ---- In-app alarms ------------------------------------------------------
  private checkLocalAlarms(asset: AssetConfig, price: number) {
    const s = this.state.settings;
    const prev = this.lastTick[asset.id];
    this.lastTick[asset.id] = price;
    if (!s.inAppAlarms || !prev) return;
    const a = this.state.assets[asset.id].analysis;
    const d = asset.decimals;
    const h1 = a?.timeframes.find((t) => t.tf === "1h");
    const buf = 0.3 * (h1?.indicators.atr ?? price * 0.004);
    const out: { kind: FiredAlert["kind"]; key: string; title: string; msg: string }[] = [];
    if (a?.floor) {
      const z = a.floor.zone;
      if (prev > z.high && price <= z.high)
        out.push({ kind: "floor-hit", key: `${asset.id}:floor:${Math.round(z.center)}`, title: `${asset.id} hit the predicted FLOOR`, msg: `${formatUsd(price, d)} is in the floor zone ${formatUsd(z.low, d)}-${formatUsd(z.high, d)} (strength ${z.strength}, ${Math.round(a.floor.holdProb * 100)}% hold estimate).` });
      if (prev >= z.low - buf && price < z.low - buf)
        out.push({ kind: "floor-break", key: `${asset.id}:floor-break:${Math.round(z.center)}`, title: `${asset.id} broke below the floor`, msg: `${formatUsd(price, d)} broke the floor zone at ${formatUsd(z.low, d)}. The floor did not hold.` });
      if (s.approachAlarms && price > z.high && price - z.high < buf * 2.5 && prev - z.high >= buf * 2.5)
        out.push({ kind: "approach-floor", key: `${asset.id}:approach-floor:${Math.round(z.center)}`, title: `${asset.id} approaching the floor`, msg: `${formatUsd(price, d)}, floor zone starts at ${formatUsd(z.high, d)}.` });
    }
    if (a?.ceiling) {
      const z = a.ceiling.zone;
      if (prev < z.low && price >= z.low)
        out.push({ kind: "ceiling-hit", key: `${asset.id}:ceiling:${Math.round(z.center)}`, title: `${asset.id} hit the predicted CEILING`, msg: `${formatUsd(price, d)} is in the ceiling zone ${formatUsd(z.low, d)}-${formatUsd(z.high, d)} (strength ${z.strength}, ${Math.round(a.ceiling.holdProb * 100)}% cap estimate).` });
      if (prev <= z.high + buf && price > z.high + buf)
        out.push({ kind: "ceiling-break", key: `${asset.id}:ceiling-break:${Math.round(z.center)}`, title: `${asset.id} broke above the ceiling`, msg: `${formatUsd(price, d)} broke out above ${formatUsd(z.high, d)}.` });
      if (s.approachAlarms && price < z.low && z.low - price < buf * 2.5 && z.low - prev >= buf * 2.5)
        out.push({ kind: "approach-ceiling", key: `${asset.id}:approach-ceiling:${Math.round(z.center)}`, title: `${asset.id} approaching the ceiling`, msg: `${formatUsd(price, d)}, ceiling zone starts at ${formatUsd(z.low, d)}.` });
    }
    for (const c of s.customAlerts.filter((x) => x.asset === asset.id)) {
      const crossed = c.type === "above" ? prev < c.price && price >= c.price : prev > c.price && price <= c.price;
      if (crossed)
        out.push({ kind: "custom", key: `custom:${c.id}`, title: `${asset.id} ${c.type === "above" ? "rose above" : "fell below"} ${formatUsd(c.price, d)}`, msg: `Now ${formatUsd(price, d)}.${c.note ? ` ${c.note}` : ""}` });
    }
    if (!out.length) return;
    const cool = readLS<Record<string, number>>(COOLDOWN_KEY, {});
    const now = Date.now();
    const fresh = out.filter((o) => !cool[o.key] || now - cool[o.key] > (o.kind.startsWith("approach") ? 4 : 8) * 3_600_000);
    if (!fresh.length) return;
    const fired: FiredAlert[] = fresh.map((o) => {
      cool[o.key] = now;
      return { id: `${o.key}:${now}`, asset: asset.id, kind: o.kind, title: o.title, message: o.msg, price, at: now };
    });
    writeLS(COOLDOWN_KEY, cool);
    const localAlerts = [...fired, ...this.state.localAlerts].slice(0, 100);
    writeLS(ALERT_LOG_KEY, localAlerts);
    this.set({ localAlerts });
    for (const f of fired) {
      void showNotification(f.title, f.message);
      if (s.alarmSound) beep(f.kind === "floor-hit" || f.kind === "ceiling-break");
    }
  }

  clearLocalAlerts() {
    writeLS(ALERT_LOG_KEY, []);
    this.set({ localAlerts: [] });
  }
}

export const store = new MarketStore();

export function useMarket(): MarketState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useAsset(id: string) {
  const m = useMarket();
  return { asset: getAsset(id), st: m.assets[id], market: m };
}

/** Best current price: live tick if fresh, else last analysis. */
export function currentPrice(st: AssetState | undefined): number | null {
  if (!st) return null;
  if (st.livePrice && Date.now() - st.liveAt < 120_000) return st.livePrice;
  return st.analysis?.price ?? st.livePrice ?? null;
}
