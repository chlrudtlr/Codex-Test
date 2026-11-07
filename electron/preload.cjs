const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daynote', {
  load: () => ipcRenderer.invoke('calendar:load'),
  save: data => ipcRenderer.invoke('calendar:save', data),
  flush: data => ipcRenderer.sendSync('calendar:flush', data),
  settings: () => ipcRenderer.invoke('settings:get'),
  setAutoLaunch: enabled => ipcRenderer.invoke('settings:auto-launch', enabled)
});
