/**
 * LED Matrix Video Player - Main Process (Streamlined)
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let mainWindow;
let serialPort = null;
let isConnected = false;
let currentPortPath = null;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const FRAME_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT * 2;

let videoStreaming = false;
let serialLineBuffer = '';

/* ==============================================================================
 * WINDOW
 * ============================================================================== */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'LED Matrix Video Player',
        backgroundColor: '#1a1a2e'
    });
    mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ==============================================================================
 * UTILITIES
 * ============================================================================== */

function sendToWindow(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function writeToPort(data) {
    return new Promise((resolve, reject) => {
        if (!serialPort?.isOpen) {
            reject(new Error('Port not open'));
            return;
        }
        serialPort.write(data, err => err ? reject(err) : resolve());
    });
}

/* ==============================================================================
 * SERIAL HANDLING
 * ============================================================================== */

function handleSerialLine(line) {
    if (!line) return;

    // 'R' = ESP32 ready for next frame
    if (line === 'R') {
        sendToWindow('esp32-ready');
    }

    console.log('📥', line);
    sendToWindow('serial-data', line);
}

async function connectToPort(portPath) {
    try {
        if (serialPort) {
            serialPort.removeAllListeners();
            if (serialPort.isOpen) await new Promise(r => serialPort.close(r));
            serialPort = null;
        }
        serialLineBuffer = '';

        serialPort = new SerialPort({
            path: portPath,
            baudRate: 921600,
            autoOpen: false,
            highWaterMark: 16384
        });

        return new Promise(resolve => {
            serialPort.open(err => {
                if (err) {
                    isConnected = false;
                    resolve({ success: false, error: err.message });
                    return;
                }

                isConnected = true;
                currentPortPath = portPath;

                serialPort.on('error', error => {
                    console.error('❌ Serial error:', error);
                    isConnected = false;
                    sendToWindow('connection-lost');
                });

                serialPort.on('close', () => {
                    console.log('🔌 Port closed');
                    isConnected = false;
                    sendToWindow('connection-lost');
                });

                serialPort.on('data', data => {
                    const raw = data.toString('latin1');
                    for (let i = 0; i < raw.length; i++) {
                        const ch = raw[i];
                        if (ch === '\n') {
                            const line = serialLineBuffer.trim();
                            serialLineBuffer = '';
                            if (line) handleSerialLine(line);
                        } else if (ch === '\r') {
                            // skip
                        } else {
                            serialLineBuffer += ch;
                            // Handle bare 'R' byte
                            if (serialLineBuffer === 'R') {
                                const next = raw[i + 1];
                                if (next === undefined || next === '\n' || next === '\r') {
                                    handleSerialLine('R');
                                    serialLineBuffer = '';
                                }
                            }
                        }
                    }
                });

                console.log('✅ Connected to', portPath);
                resolve({ success: true, port: portPath });
            });
        });
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function cleanup() {
    videoStreaming = false;
    if (serialPort?.isOpen) {
        try { serialPort.close(); } catch (_) {}
    }
}

/* ==============================================================================
 * IPC HANDLERS
 * ============================================================================== */

ipcMain.handle('get-ports', async () => {
    try {
        return (await SerialPort.list()).map(p => ({
            path: p.path,
            manufacturer: p.manufacturer || ''
        }));
    } catch {
        return [];
    }
});

ipcMain.handle('connect', async (_e, portPath) => {
    try {
        return await connectToPort(portPath);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('disconnect', async () => {
    try {
        videoStreaming = false;
        if (serialPort) {
            serialPort.removeAllListeners();
            if (serialPort.isOpen) await new Promise(r => serialPort.close(r));
            serialPort = null;
        }
        isConnected = false;
        currentPortPath = null;
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('send-command', async (_e, command) => {
    if (!serialPort?.isOpen) return { success: false, error: 'Not connected' };
    try {
        await writeToPort(command);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('start-video-mode', async () => {
    if (!serialPort?.isOpen) return { success: false, error: 'Not connected' };
    try {
        await writeToPort('V');
        videoStreaming = true;
        // Wait for OK response
        await new Promise(r => setTimeout(r, 100));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('stop-video-mode', async () => {
    videoStreaming = false;
    if (!serialPort?.isOpen) return { success: true };
    try {
        await writeToPort('S');
        await new Promise(r => setTimeout(r, 50));
    } catch (e) {
        console.warn('stop-video-mode:', e.message);
    }
    return { success: true };
});

ipcMain.handle('send-frame', async (_e, frameData) => {
    if (!videoStreaming || !serialPort?.isOpen) {
        return { success: false, error: 'Not streaming' };
    }
    try {
        const buf = Buffer.allocUnsafe(FRAME_SIZE);
        for (let i = 0; i < frameData.length; i++) {
            buf.writeUInt16LE(frameData[i], i * 2);
        }

        await writeToPort('F');

        // Send frame data in chunks
        const chunkSize = 2048;
        for (let i = 0; i < buf.length; i += chunkSize) {
            await writeToPort(buf.slice(i, Math.min(i + chunkSize, buf.length)));
            await new Promise(r => setImmediate(r));
        }

        return { success: true };
    } catch (e) {
        console.error('send-frame error:', e);
        return { success: false, error: e.message };
    }
});