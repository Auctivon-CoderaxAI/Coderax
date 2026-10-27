const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { promises: fs } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { isSafeWebUrl, normalizeServerUrl } = require("./server-url.cjs");

const appId = "ai.coderax.desktop";
const setupPath = join(__dirname, "setup.html");
const setupFileUrl = pathToFileURL(setupPath).href;
let appWindow;
let setupWindow;
let activeServerUrl;
const mediaPermissionDecisions = new Map();

app.setAppUserModelId(appId);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = appWindow && !appWindow.isDestroyed() ? appWindow : setupWindow;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(startApp);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openInitialWindow();
  });
}

function iconPath() {
  return app.isPackaged ? join(process.resourcesPath, "Coderax.ico") : join(__dirname, "build", "Coderax.ico");
}

function settingsPath() {
  return join(app.getPath("userData"), "settings.json");
}

function isSetupSender(event) {
  return event.senderFrame?.url === setupFileUrl;
}

async function readServerUrl() {
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    return normalizeServerUrl(settings.serverUrl);
  } catch {
    return null;
  }
}

async function writeServerUrl(serverUrl) {
  const filePath = settingsPath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify({ serverUrl }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Change Coderax Server…", click: () => void openSetupWindow() },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }]
    },
    { role: "help", submenu: [{ label: "About Coderax", click: showAbout }] }
  ]);
  Menu.setApplicationMenu(menu);
}

function setMediaPermission() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission !== "media" || !activeServerUrl) {
      callback(false);
      return;
    }

    let origin;
    try {
      origin = new URL(webContents.getURL()).origin;
      if (origin !== new URL(activeServerUrl).origin) {
        callback(false);
        return;
      }
    } catch {
      callback(false);
      return;
    }

    if (!mediaPermissionDecisions.has(origin)) {
      const owner = BrowserWindow.fromWebContents(webContents);
      const prompt = dialog
        .showMessageBox(owner, {
          type: "question",
          title: "Allow device access?",
          message: "Allow this Coderax server to use your camera and microphone?",
          detail: origin,
          buttons: ["Allow", "Don't allow"],
          defaultId: 1,
          cancelId: 1
        })
        .then((result) => result.response === 0)
        .catch(() => false);
      mediaPermissionDecisions.set(origin, prompt);
    }

    void mediaPermissionDecisions.get(origin).then(callback);
  });
}

function loadServer(window, serverUrl) {
  window.loadURL(serverUrl).catch(() => {
    if (window.isDestroyed()) return;
    void dialog
      .showMessageBox(window, {
        type: "error",
        title: "Can't connect to Coderax",
        message: "Coderax could not open this server.",
        detail: "Check the address and your connection. Use File > Change Coderax Server to update the address."
      })
      .catch(() => {});
  });
}

function createAppWindow(serverUrl) {
  activeServerUrl = serverUrl;
  setMediaPermission();

  if (appWindow && !appWindow.isDestroyed()) {
    loadServer(appWindow, serverUrl);
    appWindow.focus();
    return appWindow;
  }

  appWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: "Coderax",
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeWebUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
          }
        }
      };
    }

    if (url.startsWith("mailto:")) void shell.openExternal(url);
    return { action: "deny" };
  });

  appWindow.webContents.on("will-navigate", (event, url) => {
    if (!isSafeWebUrl(url)) event.preventDefault();
  });
  appWindow.on("closed", () => {
    appWindow = null;
  });
  loadServer(appWindow, serverUrl);
  return appWindow;
}

function openSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 620,
    height: 540,
    minWidth: 520,
    minHeight: 480,
    resizable: true,
    title: "Connect to Coderax",
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  setupWindow.on("closed", () => {
    setupWindow = null;
  });
  setupWindow.loadFile(setupPath);
  return setupWindow;
}

async function openInitialWindow() {
  const serverUrl = await readServerUrl();
  if (serverUrl) {
    createAppWindow(serverUrl);
    return;
  }
  openSetupWindow();
}

async function startApp() {
  installMenu();
  ipcMain.handle("settings:get-server", async (event) => (isSetupSender(event) ? readServerUrl() : null));
  ipcMain.handle("settings:connect", async (event, input) => {
    if (!isSetupSender(event)) return { ok: false, message: "Open the Coderax connection window and try again." };

    let serverUrl;
    try {
      serverUrl = normalizeServerUrl(input);
      await writeServerUrl(serverUrl);
    } catch (error) {
      return { ok: false, message: error.message || "The server address could not be saved." };
    }

    createAppWindow(serverUrl);
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    return { ok: true };
  });

  await openInitialWindow();
}

function showAbout() {
  const window = appWindow && !appWindow.isDestroyed() ? appWindow : setupWindow;
  if (window && !window.isDestroyed()) {
    const about = `Coderax Desktop ${app.getVersion()}\nConnect to your Coderax deployment in a dedicated window.`;
    void dialog.showMessageBox(window, { type: "info", title: "About Coderax", message: about });
  }
}
