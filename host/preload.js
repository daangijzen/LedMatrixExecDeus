const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Existing
    getPorts: () => ipcRenderer.invoke('get-ports'),
    connect: (portPath) => ipcRenderer.invoke('connect', portPath),
    disconnect: () => ipcRenderer.invoke('disconnect'),
    sendCommand: (cmd) => ipcRenderer.invoke('send-command', cmd),
    startVideoMode: () => ipcRenderer.invoke('start-video-mode'),
    stopVideoMode: () => ipcRenderer.invoke('stop-video-mode'),
    sendFrame: (frameData) => ipcRenderer.invoke('send-frame', frameData),
    resetDevice: () => ipcRenderer.invoke('reset-device'),


    onEsp32Ready: (callback) => ipcRenderer.on('esp32-ready', callback),
    onConnectionLost: (callback) => ipcRenderer.on('connection-lost', callback),
    onSerialData: (callback) => ipcRenderer.on('serial-data', (_e, data) => callback(data)),

    // Autoplay support
    getAutoplayConfig: () => ipcRenderer.invoke('get-autoplay-config'),
    onAutoplayStatus: (callback) => ipcRenderer.on('autoplay-status', (_e, data) => callback(data)),
    onAutoplayLoadVideo: (callback) => ipcRenderer.on('autoplay-load-video', (_e, data) => callback(data)),
    onAutoplayResume: (callback) => ipcRenderer.on('autoplay-resume', callback),

    // NEW: Port auto-selection
    onPortSelected: (callback) => ipcRenderer.on('port-selected', (_e, data) => callback(data))
});