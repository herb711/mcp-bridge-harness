const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessApi', {
  invoke: (request) => ipcRenderer.invoke('harness:api', request),
  openPath: (filePath) => ipcRenderer.invoke('harness:openPath', filePath),
  reinstallShim: () => ipcRenderer.invoke('harness:reinstallShim'),
  installUpdate: (payload) => ipcRenderer.invoke('harness:installUpdate', payload),
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
