const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  chess: (action, payload) => ipcRenderer.invoke('chess', action, payload),
  onChess: callback => { const handler = (_event, payload) => callback(payload); ipcRenderer.on('chess-update', handler); return () => ipcRenderer.removeListener('chess-update', handler); },
  resizeOverlay: height => ipcRenderer.invoke("resize-overlay", height),
  quit: () => ipcRenderer.invoke("quit"),
  openCaptureLog: () => ipcRenderer.invoke("capture-log"),
  speak: text => ipcRenderer.invoke('speak', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  call: (action, payload) => ipcRenderer.invoke('assistant', action, payload),
  sources: () => ipcRenderer.invoke('sources'),
  capture: id => ipcRenderer.invoke('capture', id),
  scan: () => ipcRenderer.invoke('scan'),
  onScan: callback => { const handler = (_event, payload) => callback(payload); ipcRenderer.on('scan-result', handler); return () => ipcRenderer.removeListener('scan-result', handler); },
  pin: value => ipcRenderer.invoke('pin', value)
});
