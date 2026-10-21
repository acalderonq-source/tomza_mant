const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");
const path = require("node:path");

const START_URL = "https://tomza-mant.onrender.com/";
const LOGIN_URL = "https://tomza-mant.onrender.com/login?departamento=TALLER&next=%2Ftaller%2Fdashboard";
const APP_ORIGIN = new URL(START_URL).origin;
let mainWindow;

app.setName("Gas Tomza Sistema");
app.setAppUserModelId("com.gastomza.sistema.desktop");

function isAppUrl(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

async function openExternalAfterConfirmation(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return;
  }

  if (!["https:", "mailto:", "tel:"].includes(target.protocol)) return;

  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Cancelar", "Abrir navegador"],
    defaultId: 0,
    cancelId: 0,
    title: "Abrir enlace externo",
    message: "Este enlace se abrirá fuera de Gas Tomza Sistema.",
    detail: target.href
  });

  if (result.response === 1) await shell.openExternal(target.href);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Gas Tomza Sistema",
    icon: path.join(__dirname, "assets", "tomza.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#f3f6f8",
    webPreferences: {
      partition: "persist:gas-tomza-sistema",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      setImmediate(() => mainWindow?.loadURL(url));
    } else {
      void openExternalAfterConfirmation(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    void openExternalAfterConfirmation(url);
  });

  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      void openExternalAfterConfirmation(url);
      return;
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(START_URL);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.fromPartition("persist:gas-tomza-sistema").setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isAppUrl(webContents.getURL()) && permission === "notifications");
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
