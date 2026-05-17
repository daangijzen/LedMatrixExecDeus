/**
 * LED Matrix Display Controller - Electron Main Process
 * Supports images, videos, and GIFs
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');

let mainWindow;
let serialPort = null;
let isConnected = false;
let reconnectTimer = null;
let currentPortPath = null;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const FRAME_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT * 2;

// Video streaming state
let videoStreaming = false;
let streamingInterval = null;

/* ==============================================================================
 * WINDOW MANAGEMENT
 * ============================================================================== */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'LED Matrix Display Controller',
        backgroundColor: '#1a1a2e'
    });

    mainWindow.loadFile('renderer/index.html');

    // Optional: Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

/* ==============================================================================
 * SERIAL PORT MANAGEMENT
 * ============================================================================== */

function cleanup() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
    }
    if (serialPort && serialPort.isOpen) {
        serialPort.close();
    }
    videoStreaming = false;
}

async function attemptReconnect() {
    if (!currentPortPath || isConnected) return;

    console.log('🔄 Attempting to reconnect to', currentPortPath);

    try {
        const ports = await SerialPort.list();
        const portExists = ports.some(p => p.path === currentPortPath);

        if (portExists) {
            const result = await connectToPort(currentPortPath);
            if (result.success) {
                console.log('✅ Reconnected successfully');
                mainWindow.webContents.send('connection-restored');
                return;
            }
        }
    } catch (error) {
        console.error('Reconnect attempt failed:', error);
    }

    // Schedule next attempt
    reconnectTimer = setTimeout(attemptReconnect, 2000);
}

async function connectToPort(portPath) {
    try {
        if (serialPort && serialPort.isOpen) {
            await serialPort.close();
        }

        serialPort = new SerialPort({
            path: portPath,
            baudRate: 921600,
            autoOpen: false
        });

        return new Promise((resolve, reject) => {
            serialPort.open((err) => {
                if (err) {
                    isConnected = false;
                    reject({ success: false, error: err.message });
                    return;
                }

                isConnected = true;
                currentPortPath = portPath;

                // Set up error handling
                serialPort.on('error', (error) => {
                    console.error('❌ Serial port error:', error);
                    isConnected = false;
                    mainWindow.webContents.send('connection-lost');
                    attemptReconnect();
                });

                serialPort.on('close', () => {
                    console.log('🔌 Port closed');
                    isConnected = false;
                    mainWindow.webContents.send('connection-lost');
                    if (currentPortPath) {
                        attemptReconnect();
                    }
                });

                // Set up data handler for responses
                serialPort.on('data', (data) => {
                    const response = data.toString().trim();
                    console.log('📥', response);
                    mainWindow.webContents.send('serial-data', response);
                });

                console.log('✅ Connected to', portPath);

                // Send ping to verify connection
                setTimeout(() => {
                    serialPort.write('P');
                }, 200);

                resolve({ success: true, port: portPath });
            });
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendCommandWithAck(command, timeoutMs = 1000) {
    if (!serialPort || !serialPort.isOpen) {
        throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            serialPort.removeListener('data', handler);
            reject(new Error('Command timeout'));
        }, timeoutMs);

        const handler = (data) => {
            const response = data.toString().trim();
            if (response.startsWith('OK:') || response.startsWith('ERROR:')) {
                clearTimeout(timeout);
                serialPort.removeListener('data', handler);

                if (response.startsWith('ERROR:')) {
                    reject(new Error(response));
                } else {
                    resolve(response);
                }
            }
        };

        serialPort.on('data', handler);
        serialPort.write(command);
    });
}

/* ==============================================================================
 * IPC HANDLERS - CONNECTION
 * ============================================================================== */

ipcMain.handle('get-ports', async () => {
    try {
        const ports = await SerialPort.list();
        console.log('📋 Available ports:', ports.length);
        return ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer || '',
            vendorId: port.vendorId,
            productId: port.productId
        }));
    } catch (error) {
        console.error('Error listing ports:', error);
        return [];
    }
});

ipcMain.handle('connect', async (event, portPath) => {
    try {
        const result = await connectToPort(portPath);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('disconnect', async () => {
    try {
        currentPortPath = null;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (serialPort && serialPort.isOpen) {
            await serialPort.close();
            isConnected = false;
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ==============================================================================
 * IPC HANDLERS - COMMANDS
 * ============================================================================== */

ipcMain.handle('send-pattern', async (event, patternNum) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        await sendCommandWithAck(patternNum.toString());
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-display', async () => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        await sendCommandWithAck('C');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('send-raw-command', async (event, command) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        serialPort.write(command);
        console.log('📤 Sent raw command:', command);
        return { success: true };
    } catch (error) {
        console.error('Error sending raw command:', error);
        return { success: false, error: error.message };
    }
});

/* ==============================================================================
 * IPC HANDLERS - IMAGE
 * ============================================================================== */

ipcMain.handle('open-image-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'All Media', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'mp4', 'webm', 'mov', 'avi'] },
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] },
            { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

ipcMain.handle('send-image', async (event, imageData) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        console.log('📤 Sending image upload command...');

        // Send 'I' command and wait for ready
        await sendCommandWithAck('I', 2000);

        // Convert imageData array to buffer (little-endian RGB565)
        const buffer = Buffer.allocUnsafe(FRAME_SIZE);
        for (let i = 0; i < imageData.length; i++) {
            buffer.writeUInt16LE(imageData[i], i * 2);
        }

        console.log('📤 Sending image data:', buffer.length, 'bytes');

        // Send the image data in chunks
        const chunkSize = 1024;
        for (let i = 0; i < buffer.length; i += chunkSize) {
            const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length));
            await new Promise((resolve, reject) => {
                serialPort.write(chunk, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Wait for confirmation
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('✅ Image sent successfully');
        return { success: true };
    } catch (error) {
        console.error('❌ Error sending image:', error);
        return { success: false, error: error.message };
    }
});

/* ==============================================================================
 * IPC HANDLERS - VIDEO
 * ============================================================================== */

ipcMain.handle('start-video-mode', async () => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        await sendCommandWithAck('V', 2000);
        videoStreaming = true;
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('send-frame', async (event, frameData) => {
    if (!serialPort || !serialPort.isOpen || !videoStreaming) {
        return { success: false, error: 'Not in video mode' };
    }

    try {
        // Send 'F' command WITHOUT waiting for ACK
        serialPort.write('F');

        // Small delay to let ESP32 process the command
        await new Promise(resolve => setTimeout(resolve, 5));

        // Send frame data
        const buffer = Buffer.allocUnsafe(FRAME_SIZE);
        for (let i = 0; i < frameData.length; i++) {
            buffer.writeUInt16LE(frameData[i], i * 2);
        }

        // Send in larger chunks for speed
        const chunkSize = 2048;  // Increased from 1024
        for (let i = 0; i < buffer.length; i += chunkSize) {
            const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length));
            await new Promise((resolve, reject) => {
                serialPort.write(chunk, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            // Tiny delay between chunks
            await new Promise(resolve => setImmediate(resolve));
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-video-mode', async () => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        videoStreaming = false;
        await sendCommandWithAck('S');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});