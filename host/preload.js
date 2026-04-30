/**
 * Preload Script - Bridge between main and renderer process
 * Exposes safe IPC methods to renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Get available serial ports
    getPorts: () => ipcRenderer.invoke('get-ports'),

    // Connect to serial port
    connect: (portPath) => ipcRenderer.invoke('connect', portPath),

    // Disconnect from serial port
    disconnect: () => ipcRenderer.invoke('disconnect'),

    // Send frame to matrix
    sendFrame: (frameData) => ipcRenderer.invoke('send-frame', frameData),

    // Get connection status
    getStatus: () => ipcRenderer.invoke('get-status')
});