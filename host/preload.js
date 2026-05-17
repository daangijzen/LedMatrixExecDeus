const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Connection
    getPorts: () => ipcRenderer.invoke('get-ports'),
    connect: (portPath) => ipcRenderer.invoke('connect', portPath),
    disconnect: () => ipcRenderer.invoke('disconnect'),

    // Patterns
    sendPattern: (patternNum) => ipcRenderer.invoke('send-pattern', patternNum),
    clearDisplay: () => ipcRenderer.invoke('clear-display'),

    // Raw commands
    sendRawCommand: (command) => ipcRenderer.invoke('send-raw-command', command),

    // Image
    openImageFile: () => ipcRenderer.invoke('open-image-file'),
    sendImage: (imageData) => ipcRenderer.invoke('send-image', imageData),

    // Video
    startVideoMode: () => ipcRenderer.invoke('start-video-mode'),
    sendFrame: (frameData) => ipcRenderer.invoke('send-frame', frameData),
    stopVideoMode: () => ipcRenderer.invoke('stop-video-mode'),

    // Events
    onConnectionLost: (callback) => ipcRenderer.on('connection-lost', callback),
    onConnectionRestored: (callback) => ipcRenderer.on('connection-restored', callback),
    onSerialData: (callback) => ipcRenderer.on('serial-data', callback)
});