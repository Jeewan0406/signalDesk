# SignalDesk

Trading analysis and 24/7 price alarms for **Bitcoin, Solana, XRP and Gold**, as one app for **Windows, Mac, iPhone and Android**.

- **Live data** from Binance, OKX, Kraken and CoinDCX, with automatic fallback if one exchange is down. Gold uses the real spot price (OKX XAU-USD index) plus TradingView's OANDA:XAUUSD chart.
- **Professional multi-timeframe analysis** (15m, 1h, 4h, daily, weekly): trend (EMA 20/50/200 + ADX), momentum (RSI, MACD, Stoch RSI), market structure (higher highs/lows), volume (OBV), RSI divergences and Bollinger squeezes.
- **Predicted floor and ceiling**: support/resistance zones built from confluence. That means swing highs/lows on four timeframes, volume-profile nodes, Fibonacci levels, key moving averages, daily/weekly pivots, previous day/week/month extremes and round numbers. Each zone gets a strength score, a "chance it holds" estimate and a "chance price gets there" estimate.
- **Forecasts for the next hours, days and weeks**: direction with probability, target price, the level that proves the view wrong, and **how long** the move should take (minutes, hours or days).
- **What drives the price**: war and conflict, geopolitics, central banks, cyber attacks/hacks, regulation and institutional flows, read from BBC, Al Jazeera, CNBC, MarketWatch, CoinDesk, Cointelegraph and the GDELT world-events database. Futures funding, open interest, long/short ratio and the Fear & Greed index are included too.
- **AI analyst** reads all of the above and writes a reasoned desk forecast with bull/base/bear scenarios. It runs **free** on Google Gemini, with Groq as a free backup and Claude as an optional paid choice.
- **Alarms**: when price reaches the predicted floor (likely bounce) or ceiling (likely stall), when a level breaks, or at your own prices. They come from a free 24/7 GitHub server through the **ntfy** app, so they arrive **even when SignalDesk is closed**.
- **Prices in USD and INR** (live USDT/INR from CoinDCX).

> **Honest note on accuracy.** No person or program can promise that a price "will not go below" a level. SignalDesk shows the most likely turning zones and *probabilities*. Each probability is calibrated on that market's own history, and the app shows the track record next to it. Use a stop-loss. This is not financial advice.

## Setup

See **[docs/SETUP.md](docs/SETUP.md)**. It takes about 15 minutes, once.

## How it fits together

```
 Exchanges / news ──► GitHub Actions "24/7 monitor" (every 5 min)
                         │  analysis + AI analyst + alarm rules
                         ├──► ntfy push ──► your phone / computer (app closed or open)
                         └──► data branch: latest.json
                                   │
 Apps (same code everywhere) ◄─────┘   + live prices straight from the exchanges
   • iPhone / any browser: GitHub Pages (Add to Home Screen)
   • Windows / Mac: Electron app (keeps running in the tray)
   • Android: Capacitor app (APK)
```

| Folder | What it is |
|---|---|
| `src/core` | Analysis engine: data providers, indicators, levels, forecasts, event drivers |
| `src/web` | The app (React). Runs in the browser, Electron and Capacitor |
| `server` | 24/7 monitor, alarm rules, AI analyst, news collector, ntfy sender |
| `desktop` | Electron shell (tray, notifications, start with computer) |
| `android` | Capacitor Android project |
| `config/alerts.json` | Your custom price alerts for the 24/7 server |
| `.github/workflows` | monitor (every 5 min), web app deploy, desktop/Android builds |

## Adding a coin later

Open `src/core/assets.ts`, copy a block (Ethereum is already prepared, set `enabled: true`), and push. The analysis, alarms and every screen pick it up automatically.

## Developing

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run monitor:dry
```

`npm run monitor:dry` runs one server cycle locally without sending alarms. It writes `data/latest.json`.
