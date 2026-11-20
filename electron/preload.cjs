const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopEnv', {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  close: () => ipcRenderer.send('window-close'),
  pickSqliteFile: (opts) => ipcRenderer.invoke('pick-sqlite-file', opts),
});
