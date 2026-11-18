# SignalDesk setup (about 15 minutes, once)

Everything runs on free services: GitHub (server and hosting) and ntfy (push alarms). The AI analyst is optional and is paid per use (see step 4).

## 1. Put the code on GitHub

1. Create a **public** repository on GitHub, for example `signaldesk`. A public repo gives unlimited free server minutes, which the every-5-minute checks need.
2. Push this project to it (branch `main`).

## 2. Turn on the web app (this is also the iPhone app)

1. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Open **Actions → Deploy web app → Run workflow**.
3. After 1–2 minutes your app is at `https://<your-username>.github.io/<repo-name>/`.

## 3. Turn on 24/7 alarms (ntfy)

1. Install **ntfy**: [iPhone](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) · [Windows/Mac web app](https://ntfy.sh/app).
2. Open your SignalDesk web app → **Alarms** → press **Generate** to create your private alarm channel name, then **Copy** it.
3. In the ntfy app tap **+** and subscribe to that exact channel name.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NTFY_TOPIC`
   - Value: the channel name
5. In SignalDesk, press **Send test alarm**. It should appear in ntfy within seconds.
6. Open **Actions → 24/7 monitor → Run workflow** once. After that it runs by itself about every 5 minutes. The first run creates the `data` branch that the apps read.

> Keep the channel name secret: anyone who knows it can read your alarms.

## 4. Turn on the AI analyst (optional)

The AI analyst uses **Claude** (Anthropic's model `claude-opus-5-5`). It reads the technical analysis and the latest war, geopolitics, central-bank, cyber-attack and crypto headlines, then writes a reasoned forecast for each asset with targets, a floor, a ceiling and scenarios.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) (pay-as-you-go).
2. Add it as a repository secret named `ANTHROPIC_API_KEY`.

**Cost estimate:** roughly **$0.15–0.25 per analysis run**. By default it runs every 4 hours, plus right after a floor/ceiling alarm (at most every 45 minutes). That comes to about **$1–1.50 per day**. To change how often it runs, add a repository **variable** (not a secret) `AI_INTERVAL_MINUTES`, for example `480` for every 8 hours or `120` for every 2 hours.

## 5. Install the apps

| Device | How |
|---|---|
| **iPhone** | Open your GitHub Pages link in **Safari** → Share → **Add to Home Screen**. |
| **Android** | **Actions → Build apps → Run workflow**. When it finishes, open **Releases** and download the `.apk` on your phone. Allow "install unknown apps" for your browser. |
| **Windows** | Same release: download the `.exe`. Windows may say "Windows protected your PC" because the app is not code-signed: click **More info → Run anyway**. |
| **Mac** | Same release: download the `.dmg` (`arm64` for M1–M4, `x64` for Intel). First launch: right-click the app → **Open**. |

The desktop app keeps running in the system tray when you close the window, so in-app alarms stay on. Enable **Settings → Start with my computer** to keep it always running.

## 6. Your own price alerts (optional)

- **On one device:** Alarms → *Your price alerts* → Add. These fire while the app is open.
- **24/7 (app closed):** either edit `config/alerts.json` in GitHub, for example:

  ```json
  [
    { "id": "btc-60k", "asset": "BTC", "type": "below", "price": 60000, "note": "buy zone" },
    { "id": "gold-4000", "asset": "GOLD", "type": "above", "price": 4000, "repeat": true }
  ]
  ```

  or let the app save them for you. Create a GitHub **fine-grained token** with access to this repository only and **Contents: Read and write**, paste it in SignalDesk → Settings → GitHub sync, then press **Sync to 24/7 server** on the Alarms page.

## Optional settings (repository variables)

| Variable | Default | Meaning |
|---|---|---|
| `AI_INTERVAL_MINUTES` | `240` | Minutes between scheduled AI analyst runs |
| `ALERT_APPROACH` | `false` | `true` also sends an "approaching floor/ceiling" heads-up |
| `NTFY_SERVER` | `https://ntfy.sh` | Use your own ntfy server |

Secret `NTFY_TOKEN` is only needed for a protected ntfy server.

## Good to know

- **Timing:** GitHub runs the monitor about every 5 minutes, but under heavy load a run can start 5–15 minutes late. The monitor checks the 1-minute highs and lows since the previous run, so a quick touch of a floor or ceiling between runs is still caught. While an app is open, it also checks every live price tick itself.
- **Binance** blocks its main API from US-based servers such as GitHub's, so SignalDesk uses Binance's official public market-data mirror, with OKX, Kraken and CoinDCX as backups.
- **Probabilities** near 50% mean "no edge". The *Model track record* card on each asset shows how often the signals were right historically.
- **Not financial advice.** Always use your own judgement and a stop-loss.
