const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopEnv', {
  isDesktop: true,
  platform: process.platform,
});
