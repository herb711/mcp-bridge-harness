const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessApi', {
  invoke: (request) => ipcRenderer.invoke('harness:api', request),
  openPath: (filePath) => ipcRenderer.invoke('harness:openPath', filePath),
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
