const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groundview', {
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options)
});
