/**
 * Electron Main Process - Video Player
 * Optimized for maximum throughput
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let mainWindow;
let serialPort = null;
let isConnected = false;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const FRAME_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT * 2;

// Pre-allocate buffer to avoid repeated allocation
const frameBuffer = Buffer.allocUnsafe(FRAME_SIZE);

/**
 * Create main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'LED Matrix Video Player',
        backgroundColor: '#1a1a2e'
    });

    mainWindow.loadFile('renderer/index.html');

    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (serialPort && serialPort.isOpen) {
        serialPort.close();
    }
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
 * IPC HANDLERS
 * ============================================================================== */

/**
 * Open file picker for video
 */
ipcMain.handle('open-video-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

/**
 * Get list of available serial ports
 */
ipcMain.handle('get-ports', async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer,
            serialNumber: port.serialNumber
        }));
    } catch (error) {
        console.error('❌ Error listing ports:', error);
        return [];
    }
});

/**
 * Connect to serial port with optimized settings
 */
ipcMain.handle('connect', async (event, portPath) => {
    try {
        if (serialPort && serialPort.isOpen) {
            await serialPort.close();
        }

        serialPort = new SerialPort({
            path: portPath,
            baudRate: 3000000,
            // Optimization: larger buffer, disable flow control for max speed
            highWaterMark: FRAME_SIZE * 4,  // Buffer 4 frames
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
                console.log('✅ Connected to', portPath);
                resolve({ success: true, port: portPath });
            });

            serialPort.on('error', (err) => {
                isConnected = false;
                console.error('❌ Serial error:', err);
            });
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/**
 * Disconnect from serial port
 */
ipcMain.handle('disconnect', async () => {
    try {
        if (serialPort && serialPort.isOpen) {
            await serialPort.close();
            isConnected = false;
            return { success: true };
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/**
 * Send frame to matrix - OPTIMIZED
 */
ipcMain.handle('send-frame', async (event, frameData) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        // OPTIMIZATION: Write directly to pre-allocated buffer
        // Avoid creating new buffer each frame
        for (let i = 0; i < frameData.length; i++) {
            frameBuffer.writeUInt16LE(frameData[i], i * 2);
        }

        // OPTIMIZATION: Use callback-free write for speed
        // Don't wait for write completion
        serialPort.write(frameBuffer);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/**
 * Get connection status
 */
ipcMain.handle('get-status', async () => {
    return {
        connected: isConnected,
        port: serialPort ? serialPort.path : null
    };
});