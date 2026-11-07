const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daynote', {
  load: () => ipcRenderer.invoke('calendar:load'),
  save: data => ipcRenderer.invoke('calendar:save', data),
  flush: data => ipcRenderer.sendSync('calendar:flush', data),
  exportTodo: request => ipcRenderer.invoke('calendar:export', request),
  settings: () => ipcRenderer.invoke('settings:get'),
  setTheme: theme => ipcRenderer.invoke('settings:theme', theme),
  setAutoLaunch: enabled => ipcRenderer.invoke('settings:auto-launch', enabled)
});
