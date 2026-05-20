/**
 * LED Matrix Video Player - Main Process (Museum Edition)
 * Auto-connect and auto-play support
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
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

// Long-running stability improvements
const MAX_LINE_BUFFER_SIZE = 1024;
const ENABLE_VERBOSE_LOGGING = false;
let frameCount = 0;
let lastStatsLog = Date.now();

// Auto-play configuration
let autoplayConfig = null;
let isAutoplayMode = false;

/* ==============================================================================
 * CONFIGURATION
 * ============================================================================== */

function loadAutoplayConfig() {
    try {
        const configPath = path.join(__dirname, 'autoplay.json');
        if (fs.existsSync(configPath)) {
            let content = fs.readFileSync(configPath, 'utf8');
            // Remove BOM if present
            content = content.replace(/^\uFEFF/, '');
            autoplayConfig = JSON.parse(content);
            console.log('✓ Autoplay config loaded:', autoplayConfig);
            return true;
        }
    } catch (e) {
        console.warn('⚠️ Failed to load autoplay config:', e.message);
    }
    return false;
}

function getDefaultVideoPath() {
    if (!autoplayConfig?.defaultVideoPath) return null;

    const videoPath = path.join(__dirname, autoplayConfig.defaultVideoPath);
    if (fs.existsSync(videoPath)) {
        return videoPath;
    }

    console.warn('⚠️ Default video not found:', videoPath);
    return null;
}

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

    // Auto-start sequence when window is ready
    mainWindow.webContents.once('did-finish-load', () => {
        if (autoplayConfig?.enabled) {
            setTimeout(startAutoplaySequence, 2000);
        }
    });
}

app.whenReady().then(() => {
    loadAutoplayConfig();
    createWindow();
});

app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ==============================================================================
 * AUTO-PLAY SEQUENCE
 * ============================================================================== */

async function startAutoplaySequence() {
    if (!autoplayConfig?.enabled) return;

    console.log('🚀 Starting autoplay sequence...');
    isAutoplayMode = true;

    sendToWindow('autoplay-status', { status: 'starting', message: 'Autoplay sequence starting...' });

    // Step 1: Auto-connect
    if (autoplayConfig.autoConnect) {
        const connected = await autoConnectToDevice();
        if (!connected) {
            console.error('❌ Autoplay failed: Could not connect');
            sendToWindow('autoplay-status', { status: 'error', message: 'Failed to connect to device' });
            return;
        }
    }

    // Step 2: Wait a moment for device to be fully ready
    if (isConnected) {
        console.log('⏳ Waiting for device to stabilize...');
        await new Promise(r => setTimeout(r, 1000));
    }

    // Step 3: Auto-play video
    if (autoplayConfig.autoPlayVideo && isConnected) {
        const videoPath = getDefaultVideoPath();
        if (videoPath) {
            console.log('📹 Auto-loading video:', videoPath);
            sendToWindow('autoplay-load-video', { path: videoPath });
        } else {
            console.warn('⚠️ No default video configured');
            sendToWindow('autoplay-status', { status: 'warning', message: 'No default video found' });
        }
    }

    console.log('✓ Autoplay sequence complete');
}

// async function autoConnectToDevice() {
//     const maxAttempts = autoplayConfig?.reconnectAttempts || 10;
//     const delay = autoplayConfig?.reconnectDelay || 3000;
//     const patterns = autoplayConfig?.portPatterns || ['ttyUSB', 'COM', 'ttyACM'];
//
//     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//         console.log(`🔌 Connection attempt ${attempt}/${maxAttempts}...`);
//         sendToWindow('autoplay-status', {
//             status: 'connecting',
//             message: `Searching for Matrix Portal S3... (${attempt}/${maxAttempts})`
//         });
//
//         try {
//             const ports = await SerialPort.list();
//
//             console.log('📋 Available ports:', ports.map(p => ({
//                 path: p.path,
//                 manufacturer: p.manufacturer,
//                 vendorId: p.vendorId,
//                 productId: p.productId
//             })));
//
//             let candidatePorts = [];
//
//             // Priority 1: Look for Adafruit Vendor ID (239A)
//             const adafruitPorts = ports.filter(p =>
//                 p.vendorId && p.vendorId.toUpperCase() === '239A'
//             );
//
//             if (adafruitPorts.length > 0) {
//                 console.log('✅ Found Adafruit device(s) by VID:', adafruitPorts.map(p => `${p.path} (VID:${p.vendorId})`));
//                 candidatePorts.push(...adafruitPorts);
//             }
//
//             // Priority 2: Add all ports matching patterns (but not already added)
//             const patternPorts = ports.filter(p =>
//                 patterns.some(pattern => p.path.includes(pattern))
//             );
//
//             for (const port of patternPorts) {
//                 if (!candidatePorts.find(p => p.path === port.path)) {
//                     candidatePorts.push(port);
//                 }
//             }
//
//             // Priority 3: If still no candidates and only one port exists, try it
//             if (candidatePorts.length === 0 && ports.length === 1) {
//                 candidatePorts.push(ports[0]);
//                 console.log('✓ Using only available port:', ports[0].path);
//             }
//
//             console.log(`📍 Will try ${candidatePorts.length} candidate port(s)`);
//
//             // Try each candidate port - STOP on first success
//             for (const targetPort of candidatePorts) {
//                 console.log(`🔌 Trying: ${targetPort.path} (${targetPort.manufacturer || 'Unknown'})`);
//
//                 const result = await connectToPort(targetPort.path);
//
//                 if (result.success) {
//                     console.log('✅ Successfully connected and validated:', targetPort.path);
//                     sendToWindow('autoplay-status', {
//                         status: 'connected',
//                         message: `Connected to Matrix Portal (${targetPort.path})`
//                     });
//
//                     // Update UI with selected port
//                     sendToWindow('port-selected', { path: targetPort.path });
//
//                     // SUCCESS - Return immediately, don't try other ports
//                     return true;
//                 } else {
//                     console.log(`❌ ${targetPort.path} rejected: ${result.error}`);
//                     // Continue to next candidate port
//                 }
//             }
//
//             if (candidatePorts.length === 0) {
//                 console.log('⚠️ No matching devices found');
//             } else {
//                 console.log('⚠️ None of the candidate ports validated as Matrix Portal');
//             }
//
//         } catch (e) {
//             console.warn('Connection attempt error:', e.message);
//         }
//
//         // Only retry if we haven't succeeded yet
//         if (attempt < maxAttempts) {
//             console.log(`⏳ Waiting ${delay}ms before next attempt...`);
//             await new Promise(r => setTimeout(r, delay));
//         }
//     }
//
//     // All attempts failed
//     return false;
// }

async function autoConnectToDevice() {
    const maxAttempts = autoplayConfig?.reconnectAttempts || 10;
    const delay = autoplayConfig?.reconnectDelay || 3000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔌 Connection attempt ${attempt}/${maxAttempts}...`);
        sendToWindow('autoplay-status', {
            status: 'connecting',
            message: `Searching for Matrix Portal S3... (${attempt}/${maxAttempts})`
        });

        try {
            const ports = await SerialPort.list();

            console.log('📋 Available ports:', ports.map(p => ({
                path: p.path,
                manufacturer: p.manufacturer,
                vendorId: p.vendorId,
                productId: p.productId
            })));

            // Find ONLY Adafruit device (VID: 239A)
            const adafruitPort = ports.find(p =>
                p.vendorId && p.vendorId.toUpperCase() === '239A'
            );

            if (!adafruitPort) {
                console.log('⚠️ No Adafruit device found (VID:239A)');
            } else {
                console.log('✅ Found Adafruit device:', adafruitPort.path, `(VID:${adafruitPort.vendorId})`);

                // Try to connect - NO validation needed, we trust the VID
                const result = await connectToPort(adafruitPort.path);

                if (result.success) {
                    console.log('✅ Successfully connected to:', adafruitPort.path);
                    sendToWindow('autoplay-status', {
                        status: 'connected',
                        message: `Connected to Matrix Portal (${adafruitPort.path})`
                    });
                    sendToWindow('port-selected', { path: adafruitPort.path });

                    // SUCCESS - Done!
                    return true;
                } else {
                    console.log(`❌ ${adafruitPort.path} connection failed: ${result.error}`);
                }
            }

        } catch (e) {
            console.warn('Connection attempt error:', e.message);
        }

        // Only retry if we haven't succeeded yet
        if (attempt < maxAttempts) {
            console.log(`⏳ Waiting ${delay}ms before next attempt...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // All attempts failed
    return false;
}

/* ==============================================================================
 * AUTO-RECONNECT ON DISCONNECT
 * ============================================================================== */

async function handleDisconnection() {
    console.log('🔌 Connection lost, attempting auto-reconnect...');

    if (isAutoplayMode && autoplayConfig?.autoConnect) {
        await new Promise(r => setTimeout(r, 2000));

        const reconnected = await autoConnectToDevice();
        if (reconnected) {
            console.log('✓ Auto-reconnected successfully');
            sendToWindow('autoplay-resume');
        }
    }
}

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

function log(type, ...args) {
    if (ENABLE_VERBOSE_LOGGING) {
        console.log(`[${type}]`, ...args);
    }
}

function logStats() {
    const now = Date.now();
    if (now - lastStatsLog > 60000) {
        console.log(`✓ Running | Frames: ${frameCount} | Connected: ${isConnected}`);
        lastStatsLog = now;
        frameCount = 0;
    }
}

/* ==============================================================================
 * SERIAL HANDLING
 * ============================================================================== */

function handleSerialLine(line) {
    if (!line) return;

    if (line === 'R') {
        sendToWindow('esp32-ready');
        frameCount++;
        logStats();
    } else {
        log('📥', line);
    }

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

                // Setup handlers immediately
                serialPort.on('error', error => {
                    console.error('❌ Serial error:', error.message);
                    isConnected = false;
                    sendToWindow('connection-lost');
                });

                serialPort.on('close', () => {
                    console.log('🔌 Port closed');
                    isConnected = false;
                    sendToWindow('connection-lost');
                    handleDisconnection();
                });

                serialPort.on('data', data => {
                    const raw = data.toString('latin1');
                    for (let i = 0; i < raw.length; i++) {
                        const ch = raw[i];
                        if (ch === '\n') {
                            const line = serialLineBuffer.trim();
                            serialLineBuffer = '';
                            if (line) {
                                console.log(`[${portPath}] RX:`, line);
                                handleSerialLine(line);
                            }
                        } else if (ch !== '\r') {
                            serialLineBuffer += ch;

                            if (serialLineBuffer.length > MAX_LINE_BUFFER_SIZE) {
                                console.warn('⚠️ Line buffer overflow, clearing');
                                serialLineBuffer = '';
                            }

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

                // Success! Port is open and ready
                isConnected = true;
                currentPortPath = portPath;
                console.log('✅ Connected to', portPath);
                resolve({ success: true, port: portPath });
            });
        });
    } catch (e) {
        console.error('❌ Connection error:', e.message);
        return { success: false, error: e.message };
    }
}

function cleanup() {
    videoStreaming = false;
    if (serialPort?.isOpen) {
        try {
            serialPort.removeAllListeners();
            serialPort.close();
        } catch (_) {}
    }
}

/* ==============================================================================
 * IPC HANDLERS
 * ============================================================================== */

ipcMain.handle('get-autoplay-config', async () => {
    return autoplayConfig;
});

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
        isAutoplayMode = false;
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
        frameCount = 0;
        lastStatsLog = Date.now();
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

        const chunkSize = 2048;
        for (let i = 0; i < buf.length; i += chunkSize) {
            await writeToPort(buf.slice(i, Math.min(i + chunkSize, buf.length)));
            await new Promise(r => setImmediate(r));
        }

        return { success: true };
    } catch (e) {
        console.error('❌ Frame send error:', e.message);
        return { success: false, error: e.message };
    }
});