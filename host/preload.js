const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Connection
    getPorts: () => ipcRenderer.invoke('get-ports'),
    connect: (portPath) => ipcRenderer.invoke('connect', portPath),
    disconnect: () => ipcRenderer.invoke('disconnect'),

    // Commands
    sendCommand: (command) => ipcRenderer.invoke('send-command', command),

    // Video
    startVideoMode: () => ipcRenderer.invoke('start-video-mode'),
    stopVideoMode: () => ipcRenderer.invoke('stop-video-mode'),
    sendFrame: (frameData) => ipcRenderer.invoke('send-frame', frameData),

    // Events
    onEsp32Ready: (callback) => ipcRenderer.on('esp32-ready', callback),
    onConnectionLost: (callback) => ipcRenderer.on('connection-lost', callback),
    onSerialData: (callback) => ipcRenderer.on('serial-data', (_e, data) => callback(data))
});