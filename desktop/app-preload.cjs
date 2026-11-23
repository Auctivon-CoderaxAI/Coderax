const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coderaxDesktop", {
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
});
