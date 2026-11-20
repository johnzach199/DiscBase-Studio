const { app, BrowserWindow, shell } = require('electron');
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
  const { server } = await startAppServer({
    port: 0, // Let OS pick an available port so desktop instances never collide
    dataDir: userDataDir,
    appRoot: app.getAppPath(),
    isProduction: true,
  });
  serverInstance = server;
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 3000;
}

async function createWindow() {
  const port = await startLocalBackend();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'DiscBase Studio',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
