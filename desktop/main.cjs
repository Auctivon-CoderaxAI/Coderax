const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { promises: fs } = require("node:fs");
const { join } = require("node:path");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const {
  INSTALLER_ASSET,
  RELEASES_PAGE,
  checkForDesktopUpdate,
  downloadReleaseAsset,
  parseChecksum,
  sha256,
} = require("./updater.cjs");
const { isSafeWebUrl, isSameServerOrigin, normalizeServerUrl } = require("./server-url.cjs");

const execFileAsync = promisify(execFile);

const appId = "ai.coderax.desktop";
const setupPath = join(__dirname, "setup.html");
const setupFileUrl = pathToFileURL(setupPath).href;
let appWindow;
let setupWindow;
let activeServerUrl;
let updateOperation = null;
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
  return app.isPackaged
    ? join(process.resourcesPath, "Coderax.ico")
    : join(__dirname, "build", "Coderax.ico");
}

function settingsPath() {
  return join(app.getPath("userData"), "settings.json");
}

function isSetupSender(event) {
  return event.senderFrame?.url === setupFileUrl;
}

function isAppSender(event) {
  if (!appWindow || appWindow.isDestroyed() || event.sender !== appWindow.webContents) {
    return false;
  }
  return isSameServerOrigin(event.senderFrame?.url, activeServerUrl);
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
  await fs.writeFile(tempPath, `${JSON.stringify({ serverUrl }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tempPath, filePath);
}

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Change Coderax Server…", click: () => void openSetupWindow() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates…",
          accelerator: "CmdOrCtrl+U",
          click: () => void runUpdateCheck(currentWindow()),
        },
        { type: "separator" },
        { label: "About Coderax", click: showAbout },
      ],
    },
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
          cancelId: 1,
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
        detail:
          "Check the address and your connection. Use File > Change Coderax Server to update the address.",
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
      preload: join(__dirname, "app-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
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
            allowRunningInsecureContent: false,
          },
        },
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
    height: 660,
    minWidth: 520,
    minHeight: 560,
    resizable: true,
    title: "Connect to Coderax",
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
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
  ipcMain.handle("settings:get-server", async (event) =>
    isSetupSender(event) ? readServerUrl() : null,
  );
  ipcMain.handle("settings:connect", async (event, input) => {
    if (!isSetupSender(event)) {
      return { ok: false, message: "Open the Coderax connection window and try again." };
    }

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
  ipcMain.handle("update:check", async (event) => {
    if (!isSetupSender(event) && !isAppSender(event)) {
      return { ok: false, message: "Open Coderax and try again." };
    }
    return runUpdateCheck(isAppSender(event) ? appWindow : setupWindow);
  });

  await openInitialWindow();
}

function currentWindow() {
  if (appWindow && !appWindow.isDestroyed()) return appWindow;
  if (setupWindow && !setupWindow.isDestroyed()) return setupWindow;
  return undefined;
}

function showUpdateDialog(parent, options) {
  return parent && !parent.isDestroyed()
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);
}

/**
 * The repository and its releases are private, so an anonymous GitHub API call
 * cannot list them. Use an explicit token when provided, then reuse the token
 * from an authenticated GitHub CLI session when the machine has one.
 */
async function resolveUpdateToken() {
  const configured = [
    process.env.CODERAX_UPDATE_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
  ].find((value) => typeof value === "string" && value.trim());
  if (configured) return configured.trim();

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function runUpdateCheck(parent) {
  if (updateOperation) return updateOperation;
  updateOperation = performUpdateCheck(parent).finally(() => {
    updateOperation = null;
  });
  return updateOperation;
}

function launchInstaller(installerPath) {
  return new Promise((resolve, reject) => {
    const installer = spawn(installerPath, ["/S", "--force-run"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    installer.once("error", reject);
    installer.once("spawn", () => {
      installer.unref();
      resolve();
    });
  });
}

async function performUpdateCheck(parent) {
  const owner = parent && !parent.isDestroyed() ? parent : currentWindow();

  let release;
  try {
    release = await checkForDesktopUpdate({
      currentVersion: app.getVersion(),
      token: await resolveUpdateToken(),
    });
  } catch (error) {
    const status = error && error.status;
    const detail =
      status === 401 || status === 403 || status === 404
        ? "The release repository is private. Set CODERAX_UPDATE_TOKEN to a GitHub token with read access, or sign in with the GitHub CLI (gh auth login)."
        : error.message || "The update service could not be reached.";
    await showUpdateDialog(owner, {
      type: "error",
      title: "Update check failed",
      message: "Coderax could not check for desktop updates.",
      detail: `${detail}\n\nYou can download the installer from the GitHub releases page.`,
      buttons: ["Open releases page", "Close"],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) void shell.openExternal(RELEASES_PAGE);
    });
    return { ok: false, message: detail };
  }

  if (!release) {
    await showUpdateDialog(owner, {
      type: "info",
      title: "Coderax is up to date",
      message: `Coderax Desktop ${app.getVersion()} is the latest version.`,
    });
    return { ok: true, status: "current" };
  }

  const confirmation = await showUpdateDialog(owner, {
    type: "question",
    title: "Update available",
    message: `Coderax Desktop ${release.version} is available.`,
    detail: `You have ${app.getVersion()}. Download and install the update now?`,
    buttons: ["Download and install", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (confirmation.response !== 0) return { ok: true, status: "deferred" };

  try {
    const token = await resolveUpdateToken();
    const [installer, checksums] = await Promise.all([
      downloadReleaseAsset({ url: release.installer.url, token }),
      downloadReleaseAsset({ url: release.checksums.url, token }),
    ]);
    const expected = parseChecksum(checksums.toString("utf8"), INSTALLER_ASSET);
    if (!expected) {
      throw new Error("The release checksum is missing or malformed.");
    }
    if (sha256(installer) !== expected) {
      throw new Error("The downloaded installer failed checksum verification.");
    }

    const installerPath = join(app.getPath("temp"), `Coderax-${release.version}.exe`);
    await fs.writeFile(installerPath, installer, { mode: 0o700 });
    await launchInstaller(installerPath);
    app.quit();
    return { ok: true, status: "installing" };
  } catch (error) {
    const detail = error.message || "The update could not be downloaded.";
    await showUpdateDialog(owner, {
      type: "error",
      title: "Update failed",
      message: "Coderax could not install the update.",
      detail,
    });
    return { ok: false, message: detail };
  }
}

function showAbout() {
  const window = appWindow && !appWindow.isDestroyed() ? appWindow : setupWindow;
  if (window && !window.isDestroyed()) {
    const about = `Coderax Desktop ${app.getVersion()}\nConnect to your Coderax deployment in a dedicated window.`;
    void dialog.showMessageBox(window, { type: "info", title: "About Coderax", message: about });
  }
}
