// Platform bridge: the same web code runs in a browser / iPhone home-screen
// app (PWA), inside Electron (Windows/Mac) and inside Capacitor (Android).

import { Capacitor } from "@capacitor/core";

interface NativeBridge {
  platform: "electron";
  notify(title: string, body: string): void;
  getAutoLaunch(): Promise<boolean>;
  setAutoLaunch(on: boolean): Promise<void>;
}

declare global {
  interface Window {
    signaldeskNative?: NativeBridge;
  }
}

export type PlatformKind = "electron" | "android" | "ios-native" | "web";

export function platform(): PlatformKind {
  if (typeof window !== "undefined" && window.signaldeskNative?.platform === "electron") return "electron";
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform() === "android" ? "android" : "ios-native";
  return "web";
}

/** Native shells can reach APIs without CORS headers (e.g. CoinDCX for INR). */
export const isNative = () => platform() !== "web";

export function isStandalonePwa(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

let notifId = 1;

export async function notificationPermission(): Promise<"granted" | "denied" | "default"> {
  const p = platform();
  if (p === "electron") return "granted";
  if (p === "android" || p === "ios-native") {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const s = await LocalNotifications.checkPermissions();
    return s.display === "granted" ? "granted" : s.display === "denied" ? "denied" : "default";
  }
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const p = platform();
  if (p === "electron") return true;
  if (p === "android" || p === "ios-native") {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const s = await LocalNotifications.requestPermissions();
    return s.display === "granted";
  }
  if (!("Notification" in window)) return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function showNotification(title: string, body: string): Promise<void> {
  const p = platform();
  if (p === "electron") {
    window.signaldeskNative!.notify(title, body);
    return;
  }
  if (p === "android" || p === "ios-native") {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({ notifications: [{ id: notifId++, title, body }] });
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: title });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch {
    new Notification(title, { body });
  }
}

/** Short two-tone alarm sound (works while the app is open). */
export function beep(up: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tones = up ? [660, 880, 1100] : [880, 660, 440];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t);
      o.stop(t + 0.17);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio not available */
  }
}
