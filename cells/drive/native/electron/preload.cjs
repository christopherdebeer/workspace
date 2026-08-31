const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('driveNative', {
  openExternal: (url) => ipcRenderer.invoke('drive:open-external', url),
});
