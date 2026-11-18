const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("signaldeskNative", {
  platform: "electron",
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (on) => ipcRenderer.invoke("set-auto-launch", on),
});
