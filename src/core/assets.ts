import type { AssetConfig } from "./types";

/**
 * Asset registry. To add a coin later, copy one block, change the symbols,
 * set `enabled: true`, and it flows through the analysis, the 24/7 alarms
 * and every screen of the app automatically.
 *
 * Sources are tried in order; the first one that answers is used.
 *  - binance  -> data-api.binance.vision (Binance's public market-data mirror,
 *                works from regions where api.binance.com is blocked)
 *  - okx      -> www.okx.com spot/swap candles
 *  - okx-index-> OKX index price (used for real spot gold XAU-USD)
 *  - kraken   -> api.kraken.com
 *  - coindcx  -> public.coindcx.com (server/native apps only: no browser CORS)
 */
export const ASSETS: AssetConfig[] = [
  {
    id: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    color: "#f7931a",
    sources: [
      { provider: "binance", symbol: "BTCUSDT" },
      { provider: "okx", instId: "BTC-USDT" },
      { provider: "kraken", pair: "XBTUSD" },
      { provider: "coindcx", pair: "B-BTC_USDT" },
    ],
    okxSwap: "BTC-USDT-SWAP",
    okxCcy: "BTC",
    binanceStream: "btcusdt",
    tradingViewSymbol: "BINANCE:BTCUSDT",
    newsKeywords: ["bitcoin", "btc"],
    roundStep: 1000,
    decimals: 0,
    enabled: true,
  },
  {
    id: "SOL",
    name: "Solana",
    kind: "crypto",
    color: "#9945ff",
    sources: [
      { provider: "binance", symbol: "SOLUSDT" },
      { provider: "okx", instId: "SOL-USDT" },
      { provider: "kraken", pair: "SOLUSD" },
      { provider: "coindcx", pair: "B-SOL_USDT" },
    ],
    okxSwap: "SOL-USDT-SWAP",
    okxCcy: "SOL",
    binanceStream: "solusdt",
    tradingViewSymbol: "BINANCE:SOLUSDT",
    newsKeywords: ["solana", "sol"],
    roundStep: 5,
    decimals: 2,
    enabled: true,
  },
  {
    id: "XRP",
    name: "XRP",
    kind: "crypto",
    color: "#23a8e0",
    sources: [
      { provider: "binance", symbol: "XRPUSDT" },
      { provider: "okx", instId: "XRP-USDT" },
      { provider: "kraken", pair: "XRPUSD" },
      { provider: "coindcx", pair: "B-XRP_USDT" },
    ],
    okxSwap: "XRP-USDT-SWAP",
    okxCcy: "XRP",
    binanceStream: "xrpusdt",
    tradingViewSymbol: "BINANCE:XRPUSDT",
    newsKeywords: ["xrp", "ripple"],
    roundStep: 0.05,
    decimals: 4,
    enabled: true,
  },
  {
    id: "GOLD",
    name: "Gold",
    kind: "metal",
    color: "#f0b90b",
    sources: [
      // Real spot gold index price, with volume from OKX's gold perpetual.
      { provider: "okx-index", instId: "XAU-USD", volumeInstId: "XAU-USDT-SWAP" },
      { provider: "okx", instId: "XAU-USDT-SWAP" },
      // PAXG is a token backed 1:1 by physical gold; it tracks spot closely.
      { provider: "binance", symbol: "PAXGUSDT" },
      { provider: "kraken", pair: "PAXGUSD" },
    ],
    okxSwap: "XAU-USDT-SWAP",
    tradingViewSymbol: "OANDA:XAUUSD",
    newsKeywords: ["gold", "xau", "bullion", "precious metal"],
    roundStep: 50,
    decimals: 2,
    enabled: true,
    note: "Spot gold from the OKX XAU-USD index (24/7). Chart widget shows TradingView's OANDA:XAUUSD.",
  },
  // Example for later — set enabled: true to switch it on.
  {
    id: "ETH",
    name: "Ethereum",
    kind: "crypto",
    color: "#627eea",
    sources: [
      { provider: "binance", symbol: "ETHUSDT" },
      { provider: "okx", instId: "ETH-USDT" },
      { provider: "kraken", pair: "ETHUSD" },
    ],
    okxSwap: "ETH-USDT-SWAP",
    okxCcy: "ETH",
    binanceStream: "ethusdt",
    tradingViewSymbol: "BINANCE:ETHUSDT",
    newsKeywords: ["ethereum", "eth"],
    roundStep: 100,
    decimals: 2,
    enabled: false,
  },
];

export const ENABLED_ASSETS = ASSETS.filter((a) => a.enabled);

export function getAsset(id: string): AssetConfig | undefined {
  return ASSETS.find((a) => a.id === id);
}
