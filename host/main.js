/**
 * Electron Main Process
 * Handles window management and IPC communication
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let mainWindow;
let serialPort = null;
let isConnected = false;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const FRAME_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT * 2;

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
        title: 'LED Matrix Control',
        backgroundColor: '#1a1a2e'
    });

    mainWindow.loadFile('renderer/index.html');

    // Open DevTools in development
    mainWindow.webContents.openDevTools();
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
 * IPC HANDLERS - Communication with renderer
 * ============================================================================== */

/**
 * Get list of available serial ports
 */
ipcMain.handle('get-ports', async () => {
    console.log('📡 [MAIN] get-ports called');  // ⬅️ NIEUW: Debug log
    try {
        const ports = await SerialPort.list();
        console.log('✅ [MAIN] Found ports:', ports);  // ⬅️ NIEUW: Debug log
        return ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer,
            serialNumber: port.serialNumber
        }));
    } catch (error) {
        console.error('❌ [MAIN] Error listing ports:', error);  // ⬅️ NIEUW: Debug log
        return [];
    }
});

/**
 * Connect to serial port
 */
ipcMain.handle('connect', async (event, portPath) => {
    try {
        if (serialPort && serialPort.isOpen) {
            await serialPort.close();
        }

        serialPort = new SerialPort({
            path: portPath,
            baudRate: 2000000
        });

        return new Promise((resolve, reject) => {
            serialPort.on('open', () => {
                isConnected = true;
                console.log('Connected to', portPath);
                resolve({ success: true, port: portPath });
            });

            serialPort.on('error', (err) => {
                isConnected = false;
                console.error('Serial error:', err);
                reject({ success: false, error: err.message });
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
 * Send frame to matrix
 */
ipcMain.handle('send-frame', async (event, frameData) => {
    try {
        if (!serialPort || !serialPort.isOpen) {
            return { success: false, error: 'Not connected' };
        }

        // frameData is array of RGB565 values
        const buffer = Buffer.alloc(FRAME_SIZE);
        for (let i = 0; i < frameData.length; i++) {
            buffer.writeUInt16LE(frameData[i], i * 2);
        }

        return new Promise((resolve, reject) => {
            serialPort.write(buffer, (err) => {
                if (err) {
                    reject({ success: false, error: err.message });
                } else {
                    resolve({ success: true });
                }
            });
        });
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