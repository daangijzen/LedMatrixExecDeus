/**
 * Preload Script - Bridge between main and renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Video file picker
    openVideoFile: () => ipcRenderer.invoke('open-video-file'),

    // Serial port management
    getPorts: () => ipcRenderer.invoke('get-ports'),
    connect: (portPath) => ipcRenderer.invoke('connect', portPath),
    disconnect: () => ipcRenderer.invoke('disconnect'),
    sendFrame: (frameData) => ipcRenderer.invoke('send-frame', frameData),
    getStatus: () => ipcRenderer.invoke('get-status')
});