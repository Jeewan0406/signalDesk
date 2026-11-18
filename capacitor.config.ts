import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.signaldesk.mobile",
  appName: "SignalDesk",
  webDir: "dist",
  backgroundColor: "#0b0e14",
  android: { allowMixedContent: false },
  plugins: {
    // Route fetch() through native HTTP so exchanges without CORS headers
    // (CoinDCX INR rate, OKX long/short ratio) work inside the app.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { iconColor: "#f0b90b" },
  },
};

export default config;
