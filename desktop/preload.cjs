const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coderaxDesktop", {
  getServerUrl: () => ipcRenderer.invoke("settings:get-server"),
  connect: (serverUrl) => ipcRenderer.invoke("settings:connect", serverUrl)
});
