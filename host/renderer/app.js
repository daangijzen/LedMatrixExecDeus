/**
 * LED Matrix Display Controller - Frontend
 * Supports images, videos, and GIFs with color mode selection
 */

let isConnected = false;
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.imageSmoothingEnabled = false;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;

// Color modes
let colorMode = 'rgb565';  // 'rgb565', 'rgb888', 'dithered'
let ditherEnabled = false;

// Video/GIF playback
let videoElement = null;
let gifFrames = null;
let isPlaying = false;
let playbackInterval = null;
let currentFrame = 0;

// Serial console
let consoleLines = [];
const MAX_CONSOLE_LINES = 500;

// Frame synchronization
let readyForNextFrame = true;
let droppedFrames = 0;
let totalFrames = 0;

/* ==============================================================================
 * INITIALIZATION
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎨 LED Matrix Controller starting...');
    await refreshPorts();
    setupEventListeners();
    updateUI();

    // Load saved settings
    const savedMode = localStorage.getItem('colorMode');
    if (savedMode) {
        colorMode = savedMode;
        document.getElementById('color-mode').value = savedMode;
    }

    // Initialize console
    addConsoleMessage('System', 'LED Matrix Controller ready', 'system');
});

/* ==============================================================================
 * EVENT LISTENERS
 * ============================================================================== */

function setupEventListeners() {
    // Connection
    document.getElementById('refresh-ports').addEventListener('click', refreshPorts);
    document.getElementById('connect-btn').addEventListener('click', connect);
    document.getElementById('disconnect-btn').addEventListener('click', disconnect);

    // Serial command buttons
    document.querySelectorAll('.cmd-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const command = btn.dataset.command;
            sendRawCommand(command);
        });
    });

    // Custom command
    document.getElementById('send-custom-cmd').addEventListener('click', sendCustomCommand);
    document.getElementById('custom-cmd-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendCustomCommand();
        }
    });

    // Pattern buttons
    document.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pattern = btn.dataset.pattern;
            sendPattern(pattern);
        });
    });

    // Clear button
    document.getElementById('clear-btn').addEventListener('click', clearDisplay);

    // Image loading
    document.getElementById('load-image-btn').addEventListener('click', loadMedia);

    // Playback controls
    document.getElementById('play-btn').addEventListener('click', playVideo);
    document.getElementById('pause-btn').addEventListener('click', pauseVideo);
    document.getElementById('stop-btn').addEventListener('click', stopVideo);

    // Color mode
    document.getElementById('color-mode').addEventListener('change', async (e) => {
        colorMode = e.target.value;
        ditherEnabled = colorMode === 'rgb565-dithered';
        localStorage.setItem('colorMode', colorMode);
        setStatus('Color mode: ' + colorMode.toUpperCase(), 'info');
        addConsoleMessage('System', `Color mode changed to ${colorMode.toUpperCase()}`, 'info');

        // Auto-refresh current image if one is loaded
        if (videoElement && !isPlaying) {
            // Redraw current frame with new color mode
            ctx.drawImage(videoElement, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
            const imageData = ctx.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
            const rgb565Array = convertToRGB565(imageData, ditherEnabled);

            setStatus('Updating with new color mode...', 'info');
            const result = await window.electronAPI.sendImage(Array.from(rgb565Array));

            if (result.success) {
                setStatus(`Color mode updated: ${colorMode.toUpperCase()}`, 'success');
            }
        }
    });

    // FPS slider
    document.getElementById('fps-slider').addEventListener('input', (e) => {
        document.getElementById('fps-value').textContent = e.target.value;
        if (isPlaying && videoElement) {
            // Restart playback with new FPS
            pauseVideo();
            playVideo();
        }
    });

    // Console controls
    document.getElementById('clear-console').addEventListener('click', clearConsole);

    // Connection events
    window.electronAPI.onConnectionLost(() => {
        isConnected = false;
        updateUI();
        setStatus('Connection lost - attempting to reconnect...', 'error');
        addConsoleMessage('System', 'Connection lost - attempting to reconnect...', 'error');
    });

    window.electronAPI.onConnectionRestored(() => {
        isConnected = true;
        updateUI();
        setStatus('Connection restored!', 'success');
        addConsoleMessage('System', 'Connection restored!', 'success');
    });

    window.electronAPI.onSerialData((event, data) => {
        console.log('Serial:', data);
        addConsoleMessage('RX', data, 'received');

        // Handle READY signal for frame sync
        if (data === 'R') {
            readyForNextFrame = true;
        }
    });
}

/* ==============================================================================
 * SERIAL CONSOLE
 * ============================================================================== */

function addConsoleMessage(prefix, message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const line = {
        timestamp,
        prefix,
        message,
        type
    };

    consoleLines.push(line);

    // Limit console lines
    if (consoleLines.length > MAX_CONSOLE_LINES) {
        consoleLines.shift();
    }

    const consoleEl = document.getElementById('serial-console');
    const lineEl = document.createElement('div');
    lineEl.className = `console-line console-${type}`;
    lineEl.innerHTML = `
        <span class="console-time">${timestamp}</span>
        <span class="console-prefix">[${prefix}]</span>
        <span class="console-message">${escapeHtml(message)}</span>
    `;

    consoleEl.appendChild(lineEl);

    // Auto-scroll if enabled
    const autoScroll = document.getElementById('auto-scroll').checked;
    if (autoScroll) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    // Update line count
    document.getElementById('console-lines').textContent = `Lines: ${consoleLines.length}`;
}

function clearConsole() {
    consoleLines = [];
    document.getElementById('serial-console').innerHTML = '';
    document.getElementById('console-lines').textContent = 'Lines: 0';
    addConsoleMessage('System', 'Console cleared', 'system');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ==============================================================================
 * SERIAL COMMANDS
 * ============================================================================== */

async function sendRawCommand(command) {
    if (!isConnected) {
        alert('Not connected to matrix');
        return;
    }

    try {
        addConsoleMessage('TX', `Command: ${command}`, 'sent');
        const result = await window.electronAPI.sendRawCommand(command);
        if (result.success) {
            setStatus(`Command '${command}' sent`, 'success');
        } else {
            alert('Failed to send command: ' + result.error);
            addConsoleMessage('Error', result.error, 'error');
        }
    } catch (error) {
        console.error('Error sending command:', error);
        addConsoleMessage('Error', error.message, 'error');
    }
}

async function sendCustomCommand() {
    const input = document.getElementById('custom-cmd-input');
    const command = input.value.trim();

    if (!command) {
        alert('Please enter a command');
        return;
    }

    await sendRawCommand(command);
    input.value = '';
}

/* ==============================================================================
 * PORT MANAGEMENT
 * ============================================================================== */

async function refreshPorts() {
    const select = document.getElementById('port-select');
    const ports = await window.electronAPI.getPorts();

    select.innerHTML = '<option value="">-- Select Port --</option>';
    ports.forEach(port => {
        const option = document.createElement('option');
        option.value = port.path;
        let label = port.path;
        if (port.manufacturer) {
            label += ` - ${port.manufacturer}`;
        }
        option.textContent = label;
        select.appendChild(option);
    });

    addConsoleMessage('System', `Found ${ports.length} serial port(s)`, 'info');
}

async function connect() {
    const portPath = document.getElementById('port-select').value;
    if (!portPath) {
        alert('Please select a serial port');
        return;
    }

    setStatus('Connecting...', 'info');
    addConsoleMessage('System', `Connecting to ${portPath}...`, 'info');

    try {
        const result = await window.electronAPI.connect(portPath);
        if (result.success) {
            isConnected = true;
            updateUI();
            setStatus('Connected to ' + portPath, 'success');
            addConsoleMessage('System', `Connected to ${portPath}`, 'success');
        } else {
            alert('Connection failed: ' + result.error);
            setStatus('Connection failed', 'error');
            addConsoleMessage('Error', 'Connection failed: ' + result.error, 'error');
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
        setStatus('Connection error', 'error');
        addConsoleMessage('Error', error.message, 'error');
    }
}

async function disconnect() {
    try {
        await stopVideo();
        await window.electronAPI.disconnect();
        isConnected = false;
        updateUI();
        setStatus('Disconnected', 'info');
        addConsoleMessage('System', 'Disconnected', 'info');
    } catch (error) {
        console.error('Disconnect error:', error);
        addConsoleMessage('Error', error.message, 'error');
    }
}

/* ==============================================================================
 * PATTERN CONTROL
 * ============================================================================== */

async function sendPattern(patternNum) {
    if (!isConnected) {
        alert('Not connected to matrix');
        return;
    }

    await stopVideo();

    try {
        addConsoleMessage('TX', `Pattern command: ${patternNum}`, 'sent');
        const result = await window.electronAPI.sendPattern(patternNum);
        if (result.success) {
            const patterns = ['Blackout', 'Rainbow', 'Moving Bars', 'Solid Colors'];
            setStatus('Pattern: ' + patterns[patternNum], 'success');
            addConsoleMessage('System', `Pattern set to: ${patterns[patternNum]}`, 'success');
        } else {
            alert('Failed to send pattern: ' + result.error);
            addConsoleMessage('Error', result.error, 'error');
        }
    } catch (error) {
        console.error('Error sending pattern:', error);
        addConsoleMessage('Error', error.message, 'error');
    }
}

async function clearDisplay() {
    if (!isConnected) {
        alert('Not connected to matrix');
        return;
    }

    await stopVideo();

    try {
        addConsoleMessage('TX', 'Clear display command: C', 'sent');
        const result = await window.electronAPI.clearDisplay();
        if (result.success) {
            ctx.clearRect(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
            setStatus('Display cleared', 'success');
            addConsoleMessage('System', 'Display cleared', 'success');
        } else {
            alert('Failed to clear: ' + result.error);
            addConsoleMessage('Error', result.error, 'error');
        }
    } catch (error) {
        console.error('Error clearing:', error);
        addConsoleMessage('Error', error.message, 'error');
    }
}

/* ==============================================================================
 * COLOR CONVERSION
 * ============================================================================== */

/* ==============================================================================
 * COLOR CONVERSION WITH MULTIPLE MODES
 * ============================================================================== */

function applyColorMode(imageData) {
    const data = imageData.data;

    switch(colorMode) {
        case 'gameboy':
            // Game Boy green palette (4 shades)
            const gbPalette = [
                [15, 56, 15],      // Darkest
                [48, 98, 48],      // Dark
                [139, 172, 15],    // Light
                [155, 188, 15]     // Lightest
            ];
            for (let i = 0; i < data.length; i += 4) {
                const gray = (data[i] + data[i+1] + data[i+2]) / 3;
                const idx = Math.floor(gray / 64);  // 0-3
                const color = gbPalette[Math.min(idx, 3)];
                data[i] = color[0];
                data[i+1] = color[1];
                data[i+2] = color[2];
            }
            break;

        case 'grayscale':
            for (let i = 0; i < data.length; i += 4) {
                const gray = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
                data[i] = data[i+1] = data[i+2] = gray;
            }
            break;

        case 'sepia':
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
            }
            break;

        case 'highcontrast':
            for (let i = 0; i < data.length; i += 4) {
                data[i] = data[i] > 127 ? 255 : 0;
                data[i+1] = data[i+1] > 127 ? 255 : 0;
                data[i+2] = data[i+2] > 127 ? 255 : 0;
            }
            break;
    }

    return imageData;
}

function convertToRGB565(imageData, useDithering = false) {
    const rgb565Array = new Uint16Array(MATRIX_WIDTH * MATRIX_HEIGHT);

    // Apply color mode transformation first
    const processedData = applyColorMode(imageData);

    if (useDithering) {
        // Floyd-Steinberg dithering
        const data = new Uint8ClampedArray(processedData.data);

        for (let y = 0; y < MATRIX_HEIGHT; y++) {
            for (let x = 0; x < MATRIX_WIDTH; x++) {
                const i = (y * MATRIX_WIDTH + x) * 4;
                const j = y * MATRIX_WIDTH + x;

                const oldR = data[i];
                const oldG = data[i + 1];
                const oldB = data[i + 2];

                // Quantize to RGB565
                const newR = Math.round(oldR / 255 * 31) * 8;
                const newG = Math.round(oldG / 255 * 63) * 4;
                const newB = Math.round(oldB / 255 * 31) * 8;

                rgb565Array[j] = ((newR & 0xF8) << 8) | ((newG & 0xFC) << 3) | (newB >> 3);

                // Calculate error
                const errR = oldR - newR;
                const errG = oldG - newG;
                const errB = oldB - newB;

                // Distribute error to neighbors
                if (x < MATRIX_WIDTH - 1) {
                    data[i + 4] += errR * 7/16;
                    data[i + 5] += errG * 7/16;
                    data[i + 6] += errB * 7/16;
                }
                if (y < MATRIX_HEIGHT - 1) {
                    if (x > 0) {
                        data[i + MATRIX_WIDTH * 4 - 4] += errR * 3/16;
                        data[i + MATRIX_WIDTH * 4 - 3] += errG * 3/16;
                        data[i + MATRIX_WIDTH * 4 - 2] += errB * 3/16;
                    }
                    data[i + MATRIX_WIDTH * 4] += errR * 5/16;
                    data[i + MATRIX_WIDTH * 4 + 1] += errG * 5/16;
                    data[i + MATRIX_WIDTH * 4 + 2] += errB * 5/16;
                    if (x < MATRIX_WIDTH - 1) {
                        data[i + MATRIX_WIDTH * 4 + 4] += errR * 1/16;
                        data[i + MATRIX_WIDTH * 4 + 5] += errG * 1/16;
                        data[i + MATRIX_WIDTH * 4 + 6] += errB * 1/16;
                    }
                }
            }
        }
    } else {
        // Simple conversion
        for (let i = 0, j = 0; i < processedData.data.length; i += 4, j++) {
            const r = processedData.data[i];
            const g = processedData.data[i + 1];
            const b = processedData.data[i + 2];

            // Convert to RGB565
            rgb565Array[j] = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
        }
    }

    return rgb565Array;
}

/* ==============================================================================
 * IMAGE HANDLING
 * ============================================================================== */

async function loadMedia() {
    if (!isConnected) {
        alert('Not connected to matrix');
        return;
    }

    await stopVideo();

    try {
        const result = await window.electronAPI.openImageFile();
        if (!result.success) return;

        const filePath = result.path;
        const ext = filePath.split('.').pop().toLowerCase();

        setStatus('Loading media...', 'info');
        addConsoleMessage('System', `Loading ${ext.toUpperCase()} file...`, 'info');

        if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
            await loadVideo(filePath);
        } else if (ext === 'gif') {
            await loadGif(filePath);
        } else {
            await loadStaticImage(filePath);
        }
    } catch (error) {
        console.error('Error loading media:', error);
        alert('Error: ' + error.message);
        setStatus('Error loading media', 'error');
        addConsoleMessage('Error', error.message, 'error');
    }
}

async function loadStaticImage(filePath) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = async () => {
            // Draw to canvas
            ctx.drawImage(img, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

            // Get image data
            const imageData = ctx.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

            // Convert to RGB565
            const rgb565Array = convertToRGB565(imageData, ditherEnabled);

            // Send to matrix
            setStatus('Sending image to matrix...', 'info');
            addConsoleMessage('System', `Sending image (${MATRIX_WIDTH}x${MATRIX_HEIGHT}, ${rgb565Array.length * 2} bytes)...`, 'info');

            const sendResult = await window.electronAPI.sendImage(Array.from(rgb565Array));

            if (sendResult.success) {
                document.getElementById('image-info').textContent =
                    `Image: ${img.width}x${img.height} → 192x32 (${colorMode.toUpperCase()})`;
                setStatus('Image sent successfully!', 'success');
                addConsoleMessage('System', 'Image sent successfully', 'success');
                resolve();
            } else {
                alert('Failed to send image: ' + sendResult.error);
                addConsoleMessage('Error', sendResult.error, 'error');
                reject(new Error(sendResult.error));
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        img.src = filePath;
    });
}

async function loadVideo(filePath) {
    if (videoElement) {
        videoElement.pause();
        videoElement.src = '';
    }

    videoElement = document.createElement('video');
    videoElement.src = filePath;
    videoElement.loop = true;
    videoElement.muted = true;

    await new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = () => {
            document.getElementById('image-info').textContent =
                `Video: ${videoElement.videoWidth}x${videoElement.videoHeight}, ` +
                `${videoElement.duration.toFixed(1)}s`;

            // Show playback controls
            document.getElementById('playback-controls').style.display = 'flex';

            setStatus('Video loaded - press Play', 'success');
            addConsoleMessage('System', `Video loaded: ${videoElement.videoWidth}x${videoElement.videoHeight}`, 'success');
            resolve();
        };
        videoElement.onerror = () => reject(new Error('Failed to load video'));
    });
}

async function loadGif(filePath) {
    const img = new Image();
    img.src = filePath;

    await new Promise((resolve, reject) => {
        img.onload = () => {
            videoElement = img;
            gifFrames = [img];

            document.getElementById('image-info').textContent =
                `GIF: ${img.width}x${img.height}`;
            document.getElementById('playback-controls').style.display = 'flex';

            setStatus('GIF loaded - press Play', 'success');
            addConsoleMessage('System', `GIF loaded: ${img.width}x${img.height}`, 'success');
            resolve();
        };
        img.onerror = () => reject(new Error('Failed to load GIF'));
    });
}

/* ==============================================================================
 * VIDEO PLAYBACK
 * ============================================================================== */

async function playVideo() {
    if (!videoElement) return;

    try {
        // Reset frame statistics
        readyForNextFrame = true;
        droppedFrames = 0;
        totalFrames = 0;

        // Only start video mode if not already playing
        if (!isPlaying) {
            addConsoleMessage('TX', 'Start video mode command: V', 'sent');
            const result = await window.electronAPI.startVideoMode();
            if (!result.success) {
                alert('Failed to start video mode: ' + result.error);
                addConsoleMessage('Error', result.error, 'error');
                return;
            }
        }

        isPlaying = true;
        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;
        document.getElementById('stop-btn').disabled = false;

        const fps = parseInt(document.getElementById('fps-slider').value);
        const frameDelay = 1000 / fps;

        if (videoElement.play) {
            await videoElement.play();
        }

        let lastFrameTime = 0;
        let frameCount = 0;
        let sendingFrame = false;  // Prevent frame overlap

        const sendFrame = async (timestamp) => {
            if (!isPlaying) return;

            // Only send if enough time has passed AND ESP32 is ready
            if (timestamp - lastFrameTime >= frameDelay) {
                lastFrameTime = timestamp;
                frameCount++;
                totalFrames++;

                if (readyForNextFrame) {
                    readyForNextFrame = false;  // Lock until ESP32 signals ready

                    // Draw current video frame to canvas
                    ctx.drawImage(videoElement, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

                    // Get image data and convert (disable dithering for video!)
                    const imageData = ctx.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
                    const rgb565Array = convertToRGB565(imageData, false);  // false = no dithering!

                    // Send frame (non-blocking)
                    window.electronAPI.sendFrame(Array.from(rgb565Array))
                        .then(() => {
                            // Log every 30 frames with stats
                            if (frameCount % 30 === 0) {
                                const dropRate = ((droppedFrames / totalFrames) * 100).toFixed(1);
                                addConsoleMessage('System',
                                    `Streaming... (${frameCount} frames, ${droppedFrames} dropped [${dropRate}%])`,
                                    'info');
                            }
                        })
                        .catch((error) => {
                            console.error('Frame send error:', error);
                            addConsoleMessage('Error', 'Frame send error: ' + error.message, 'error');
                            readyForNextFrame = true;  // Unlock on error
                            pauseVideo();
                        });
                } else {
                    // Frame drop: ESP32 not ready yet
                    droppedFrames++;
                    if (droppedFrames % 10 === 0) {
                        console.warn(`Dropped ${droppedFrames} frames so far`);
                    }
                }
            }

            if (isPlaying) {
                requestAnimationFrame(sendFrame);
            }
        };

        requestAnimationFrame(sendFrame);
        setStatus(`Playing at ${fps} FPS`, 'success');
        addConsoleMessage('System', `Video playback started at ${fps} FPS`, 'success');

    } catch (error) {
        console.error('Playback error:', error);
        setStatus('Playback error', 'error');
        addConsoleMessage('Error', error.message, 'error');
        isPlaying = false;
    }
}

async function pauseVideo() {
    isPlaying = false;
    if (videoElement && videoElement.pause) {
        videoElement.pause();
    }
    document.getElementById('play-btn').disabled = false;
    document.getElementById('pause-btn').disabled = true;
    setStatus('Paused', 'info');
    addConsoleMessage('System', 'Playback paused', 'info');

    // Don't stop video mode on ESP32, just pause the frontend streaming
    // The ESP32 will stay in video mode ready for more frames
}
async function stopVideo() {
    isPlaying = false;

    if (videoElement) {
        if (videoElement.pause) {
            videoElement.pause();
            videoElement.currentTime = 0;
        }
        videoElement = null;
    }

    gifFrames = null;
    currentFrame = 0;

    document.getElementById('playback-controls').style.display = 'none';
    document.getElementById('play-btn').disabled = false;
    document.getElementById('pause-btn').disabled = true;
    document.getElementById('stop-btn').disabled = true;

    try {
        addConsoleMessage('TX', 'Stop video command: S', 'sent');
        await window.electronAPI.stopVideoMode();
        setStatus('Stopped', 'info');
        addConsoleMessage('System', 'Playback stopped', 'info');
    } catch (error) {
        console.error('Stop error:', error);
        addConsoleMessage('Error', error.message, 'error');
    }
}

/* ==============================================================================
 * UI UPDATES
 * ============================================================================== */

function updateUI() {
    const statusEl = document.getElementById('connection-status');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const patternBtns = document.querySelectorAll('.pattern-btn');
    const cmdBtns = document.querySelectorAll('.cmd-btn');
    const loadImageBtn = document.getElementById('load-image-btn');
    const clearBtn = document.getElementById('clear-btn');
    const customCmdInput = document.getElementById('custom-cmd-input');
    const sendCustomBtn = document.getElementById('send-custom-cmd');

    if (isConnected) {
        statusEl.className = 'status connected';
        statusEl.textContent = '🟢 Connected';
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        patternBtns.forEach(btn => btn.disabled = false);
        cmdBtns.forEach(btn => btn.disabled = false);
        loadImageBtn.disabled = false;
        clearBtn.disabled = false;
        customCmdInput.disabled = false;
        sendCustomBtn.disabled = false;
    } else {
        statusEl.className = 'status disconnected';
        statusEl.textContent = '⚫ Disconnected';
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        patternBtns.forEach(btn => btn.disabled = true);
        cmdBtns.forEach(btn => btn.disabled = true);
        loadImageBtn.disabled = true;
        clearBtn.disabled = true;
        customCmdInput.disabled = true;
        sendCustomBtn.disabled = true;
    }
}

function setStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.style.color = {
        'success': '#10b981',
        'error': '#ef4444',
        'info': '#9ca3af'
    }[type] || '#9ca3af';
}