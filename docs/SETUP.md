# SignalDesk: complete setup guide

Follow the parts in order. Each part says **where to go** and **what to click**.
Total time: about 30–40 minutes, once.

| Part | What you set up | Needed? |
|---|---|---|
| A | Give Claude access to your GitHub repo, so the code can be uploaded | Yes |
| B | Turn on GitHub Pages (your web app / iPhone app) | Yes |
| C | Install ntfy on your phones and create your alarm channel | Yes |
| D | Connect the alarm channel to the 24/7 server and start it | Yes |
| E | Open the web app and test an alarm | Yes |
| F | AI analyst (free with Google Gemini) | Recommended |
| G | Windows, Mac and Android apps | Optional |
| H | Let the app save settings to GitHub | Optional |

Your repository: **https://github.com/Jeewan0406/signalDesk**

---

## Part A — Give Claude access to your repository

The code can only be uploaded after the Claude GitHub App is allowed to use your repository.

1. Open **https://github.com/apps/claude/installations/select_target** and sign in to GitHub if asked.
2. Click your account **Jeewan0406**.
3. Under **Repository access**, choose **Only select repositories**.
4. Click **Select repositories** and pick **signalDesk**.
5. Click **Install** (or **Save** if it was installed before).
6. If GitHub says it is already installed and nothing changes, open **https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1** and connect GitHub again.
7. Tell Claude **"done"**. Claude uploads the code.

**Check:** open https://github.com/Jeewan0406/signalDesk. You should now see folders such as `.github`, `android`, `server`, `src` and the file `README.md`.

---

## Part B — Turn on GitHub Pages

This publishes the web app. On iPhone, this web app *is* your app.

1. Open https://github.com/Jeewan0406/signalDesk.
2. Click **Settings** (top bar, far right; the gear icon).
3. In the left menu, under **Code and automation**, click **Pages**.
4. Under **Build and deployment → Source**, open the drop-down and choose **GitHub Actions**. It saves by itself.

**Check that GitHub Actions is allowed:**

1. Click the **Actions** tab (top bar).
2. If you see a yellow box saying workflows are disabled, click **"I understand my workflows, go ahead and enable them"**.

---

## Part C — Install ntfy and create your alarm channel

ntfy is a free app that receives the alarms. It works even when SignalDesk is closed and your phone is locked.

### C1. Choose your private channel name

Make up a long name that nobody can guess. Use only small letters, numbers and `-`, for example:

```
signaldesk-k7rq2mx9tbv4
```

**Write it down.** Anyone who knows this name can read your alarms, so don't share it. You will type the exact same name in three places: the ntfy app(s), GitHub, and the SignalDesk app.

### C2. iPhone

1. Open the **App Store**, search **ntfy** (white bell icon, developer *Philipp Heckel*), or open https://apps.apple.com/app/ntfy/id1625396347
2. Tap **Get**, then open the app.
3. When it asks **"ntfy Would Like to Send You Notifications"**, tap **Allow**.
4. Tap **+** (top right).
5. In **Topic name**, type your channel name exactly. Leave **Use another server** switched off.
6. Tap **Subscribe**.

If you tapped *Don't Allow* by mistake: iPhone **Settings → Notifications → ntfy →** switch on **Allow Notifications**, with **Sounds** and **Banners** on.

### C3. Android

1. Open **Google Play**, search **ntfy**, or open https://play.google.com/store/apps/details?id=io.heckel.ntfy
2. Tap **Install**, then **Open**.
3. If it asks to allow notifications, tap **Allow**.
4. Tap the round **+** button (bottom right).
5. In **Topic name**, type your channel name exactly.
6. Leave **Use another server** unticked. Tick **Instant delivery** so alarms arrive at once, even when the phone is asleep.
7. Tap **Subscribe**.
8. Stop Android from putting ntfy to sleep: phone **Settings → Apps → ntfy → Battery →** choose **Unrestricted** (on some phones: **Battery optimisation → Don't optimise**).

### C4. Computer (optional)

1. Open **https://ntfy.sh/app** in Chrome, Edge or Safari.
2. Click **Subscribe to topic**, type your channel name, then click **Subscribe**.
3. When it asks for notification permission, click **Grant now / Allow**.

### C5. Test ntfy by itself

1. On a computer, open **https://ntfy.sh/app** and click your channel in the left menu (subscribe first as in C4).
2. Type `test` in the message box at the bottom and press **Enter**.
3. Your iPhone and Android phone should show the notification within a few seconds.

---

## Part D — Connect the alarms to the 24/7 server

### D1. Save the channel name as a GitHub secret

1. Open https://github.com/Jeewan0406/signalDesk → **Settings**.
2. In the left menu, under **Security**, click **Secrets and variables → Actions**.
3. Click the green **New repository secret** button.
4. **Name:** `NTFY_TOPIC` (exactly like this, in capitals).
5. **Secret:** your channel name from C1.
6. Click **Add secret**.

### D2. Start the 24/7 monitor

1. Click the **Actions** tab.
2. In the left list, click **24/7 monitor**.
3. On the right, click **Run workflow**, then the green **Run workflow** button.
4. After a few seconds a new run appears. Wait for the **green tick** (about 1–3 minutes).

From now on GitHub runs it by itself about every 5 minutes, day and night.

**Check:** on the **Code** tab, open the branch drop-down (it shows `main`). A branch named **data** should now exist. That is where the server publishes its analysis.

---

## Part E — Open the web app and test an alarm

### E1. Make sure the web app is published

1. **Actions** tab → left list → **Deploy web app**.
2. The top run should have a **green tick**. If it has a red ✗ (because Pages was not on yet), click **Run workflow → Run workflow** and wait for the green tick (about 2 minutes).
3. **Settings → Pages** now shows **"Your site is live at https://jeewan0406.github.io/signalDesk/"**.

### E2. Add it to your iPhone home screen

1. On the iPhone, open **Safari** (not Chrome) and go to **https://jeewan0406.github.io/signalDesk/**
2. Tap the **Share** button (square with an arrow up).
3. Scroll down, tap **Add to Home Screen**, then **Add**.
4. Open **SignalDesk** from the home screen.

On Android you can do the same in Chrome (**⋮ menu → Install app**), or install the real app in Part G.

### E3. Test a full alarm

1. In SignalDesk, tap **Alarms** (bottom bar on the phone, top bar on a computer).
2. In **Your private alarm channel**, paste your channel name from C1. Do not press *Generate*, because that would make a new name.
3. Tap **Send test alarm**.
4. All your phones should show **"SignalDesk test alarm"**. ✅

**Check the server:** at the top of the Alarms page you should see a green dot with **"Server running · last check X min ago"**.

---

## Part F — AI analyst (FREE with Google Gemini)

The AI analyst reads the charts and the world news (wars, geopolitics, central banks, cyber attacks, crypto) and writes a forecast with reasons, targets and scenarios. It runs on the **free** Google Gemini API: no credit card is needed.

### F1. Get a free Gemini API key

1. Open **https://aistudio.google.com/apikey** and sign in with your Google (Gmail) account.
2. If asked, accept the terms of service.
3. Click **Create API key**. If it asks for a project, choose **Create API key in new project**.
4. Copy the key (it starts with `AIza`). Keep it private.

### F2. Save it in GitHub

1. https://github.com/Jeewan0406/signalDesk → **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `GEMINI_API_KEY`
3. **Secret:** paste the key, then click **Add secret**.

### F3. Check it works

1. **Actions → 24/7 monitor → Run workflow** (as in D2) and wait for the green tick.
2. Click the finished run → **monitor** → open the **Run monitor** step. Look for a line like:
   `AI done via Google Gemini (free tier) / gemini-flash-latest: risk-off; BTC bearish 55, ...`
3. Open SignalDesk → any coin → the **AI analyst** card now shows the forecast, and the home screen shows the **Risk regime** summary.

### F4. Free backup: Groq (optional, recommended)

If Gemini's free quota runs out for the day, SignalDesk can switch to Groq automatically (also free).

1. Open **https://console.groq.com/keys** and sign in (Google, GitHub or email).
2. Click **Create API Key**, name it `signaldesk`, then click **Submit**.
3. Copy the key (it starts with `gsk_`). It is shown only once.
4. On GitHub add another secret: **Name:** `GROQ_API_KEY`, **Secret:** the key.

### How often it runs (free)

- Default: **every 30 minutes**, plus right after a floor/ceiling alarm.
- Gemini's free tier (as of late 2026) allows about **20 requests a day on Flash** and about **500 a day on Flash-Lite**. SignalDesk uses Flash first, then switches to Flash-Lite automatically when Flash's daily quota is used. Quotas reset every day at midnight US Pacific time.
- Groq's free tier fits about **25 runs a day**, so it works best as a backup or at **every hour** or slower.
- Change it in the app: **Settings → 24/7 server settings** (needs Part H), or edit `config/settings.json` on GitHub (✏️ pencil → change the numbers → **Commit changes**):

  ```json
  { "aiProvider": "auto", "aiIntervalMinutes": 30, "approachAlerts": false }
  ```

  `aiProvider` can be `auto` (free providers first), `gemini`, `groq` or `anthropic`.

Free-tier note: on Google's free tier, Google may use what is sent to improve its products. SignalDesk sends only public market data and news headlines, nothing personal.

### Paid option: Claude (optional)

If you later want Anthropic's Claude instead: create a key at **https://console.anthropic.com** (with credit added), save it as secret `ANTHROPIC_API_KEY`, and set `aiProvider` to `anthropic`. It costs roughly $0.15–0.25 per run.

---

## Part G — Windows, Mac and Android apps (optional)

### G1. Build them

1. **Actions** tab → left list → **Build apps**.
2. Click **Run workflow → Run workflow**.
3. Wait about 15–25 minutes until all parts show a green tick.

### G2. Download

1. Go to the **Code** tab. On the right side, under **Releases**, click the newest release (for example *SignalDesk build 1*).
2. Under **Assets**, download the file for your device.

### G3. Install

- **Windows:** download `SignalDesk-…-win-x64.exe` and double-click it. If Windows says *"Windows protected your PC"*, click **More info → Run anyway** (the app is not code-signed). After installing, SignalDesk keeps running in the tray (bottom-right, near the clock) when you close the window. Right-click the tray icon and tick **Start with computer**.
- **Mac:** download `…-mac-arm64.dmg` for Apple M1/M2/M3/M4 or `…-mac-x64.dmg` for Intel Macs. Open it and drag SignalDesk into **Applications**. The first time, **right-click** the app → **Open** → **Open**.
- **Android:** on the phone, download `SignalDesk-…-android.apk` and open it. If asked, allow **Install unknown apps** for your browser, then tap **Install**. When the app asks to send notifications, tap **Allow**.

---

## Part H — Let the app save settings to GitHub (optional)

Needed if you want to change the AI schedule from the app, or have your own price alerts checked 24/7.

1. On GitHub, click your **profile picture** (top right) → **Settings**.
2. In the left menu, at the bottom, click **Developer settings → Personal access tokens → Fine-grained tokens**.
3. Click **Generate new token**.
   - **Token name:** `signaldesk-app`
   - **Expiration:** choose for example 1 year.
   - **Repository access:** **Only select repositories → signalDesk**.
   - **Permissions → Repository permissions → Contents:** **Read and write**.
4. Click **Generate token** and copy it (it starts with `github_pat_`).
5. In SignalDesk: **Settings → GitHub sync**.
   - **Repository:** `Jeewan0406/signalDesk`
   - **Token:** paste it.

Now you can:
- **Settings → 24/7 server settings:** choose how often the AI runs, then tap **Save to 24/7 server**.
- **Alarms → Your price alerts:** add your own prices, then tap **Sync to 24/7 server**.

The token is saved only on that device. Repeat step 5 on each device where you want to change settings.

---

## Everyday use

- **Floor alarm 🟢:** price reached the predicted best-buy zone (likely bounce).
- **Ceiling alarm 🔴:** price reached the predicted best-sell zone (likely stall).
- **Broke below floor / above ceiling ⚠️:** the zone did not hold. The alarm tells you the next level.
- Tap an alarm in ntfy to open that coin in SignalDesk.

## If something does not work

| Problem | What to do |
|---|---|
| No alarms on the phone | Check that the ntfy channel name is exactly the same in ntfy, in the GitHub secret `NTFY_TOPIC` and in the app. Repeat the test in C5. |
| App says "Server offline" | **Actions → 24/7 monitor**: is the latest run green? If it is red, open it and send Claude a screenshot. |
| Web app link shows 404 | **Settings → Pages** must say *Source: GitHub Actions*. Then run **Deploy web app** again. |
| AI analyst card is empty | Check the `GEMINI_API_KEY` secret, then run **24/7 monitor** once. The app's **Settings → 24/7 server settings** shows the last AI problem, if any. |
| GitHub runs are a few minutes late | That is normal for GitHub's free scheduler. The server still checks the 1-minute highs and lows since its last run, so touches are not missed. |

SignalDesk shows probabilities, not certainties. It is not financial advice; always use a stop-loss.
