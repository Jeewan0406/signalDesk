// SignalDesk desktop (Windows / macOS / Linux) — Electron shell around the web app.
// Keeps running in the system tray when the window is closed, so live in-app
// alarms keep working; can start automatically with the computer.

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, session, nativeImage } = require("electron");
const path = require("node:path");

const DIST = path.join(__dirname, "..", "dist");
const ICON = path.join(DIST, "icons", "icon-192.png");
let win = null;
let tray = null;
let quitting = false;

// Exchanges that do not send CORS headers (CoinDCX for the INR rate, OKX's
// long/short ratio). The desktop app is allowed to read them.
const CORS_HOSTS = ["https://api.coindcx.com/*", "https://public.coindcx.com/*", "https://www.okx.com/api/v5/rubik/*"];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: "#0b0e14",
    title: "SignalDesk",
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep live prices and alarms running when hidden
    },
  });
  win.loadFile(path.join(DIST, "index.html"));
  // Links (news, TradingView, ntfy) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:/.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      if (process.platform === "win32" && !app.__trayHintShown) {
        app.__trayHintShown = true;
        new Notification({ title: "SignalDesk is still running", body: "Alarms stay on. Use the tray icon to open or quit.", icon: ICON }).show();
      }
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setToolTip("SignalDesk — alarms on");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open SignalDesk", click: showWindow },
      { type: "separator" },
      {
        label: "Start with computer",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

ipcMain.on("notify", (_e, { title, body }) => {
  const n = new Notification({ title: String(title), body: String(body), icon: ICON, urgency: "critical" });
  n.on("click", showWindow);
  n.show();
});
ipcMain.handle("get-auto-launch", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("set-auto-launch", (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }));

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("app.signaldesk.desktop");
  session.defaultSession.webRequest.onHeadersReceived({ urls: CORS_HOSTS }, (details, cb) => {
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === "access-control-allow-origin") delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    cb({ responseHeaders: headers });
  });
  createTray();
  const hidden = app.getLoginItemSettings().wasOpenedAsHidden || process.argv.includes("--hidden");
  createWindow();
  if (hidden) win.hide();
  app.on("activate", showWindow);
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Stay alive in the tray.
});
