const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;
let serverInstance = null;

async function startLocalBackend() {
  const userDataDir = path.join(app.getPath('userData'), 'discbase-data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  process.env.APP_DATA_DIR = userDataDir;
  process.env.APP_ROOT_DIR = app.getAppPath();
  process.env.NODE_ENV = 'production';

  // Load bundled backend server
  const serverModulePath = path.join(__dirname, '..', 'dist-server', 'server.cjs');
  const { startAppServer } = require(serverModulePath);
  const { server, port } = await startAppServer({
    port: 0, // Let OS pick an available port and await socket bind
    dataDir: userDataDir,
    appRoot: app.getAppPath(),
    isProduction: true,
  });
  serverInstance = server;
  return port;
}

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

async function createWindow() {
  // Remove the native File / Edit / View / Window / Help menu bar completely
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'DiscBase Studio',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  if (typeof mainWindow.removeMenu === 'function') {
    mainWindow.removeMenu();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    const port = await startLocalBackend();
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  } catch (err) {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    const html = `<!doctype html><html><body style="font-family:sans-serif;padding:32px;background:#0f172a;color:#f8fafc;"><h2>DiscBase Studio failed to start</h2><pre style="white-space:pre-wrap;color:#fca5a5;">${msg.replace(/</g, '&lt;')}</pre></body></html>`;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
