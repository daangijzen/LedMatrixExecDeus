/**
 * LED Matrix Video Player - Frontend (Museum Edition)
 */

let isConnected = false;
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.imageSmoothingEnabled = false;

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;

let videoElement = null;
let isPlaying = false;
let streamActive = false;
let autoplayConfig = null;

/* ==============================================================================
 * INIT
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    autoplayConfig = await window.electronAPI.getAutoplayConfig();

    await refreshPorts();
    setupEventListeners();
    updateUI();
    log('System ready');

    if (autoplayConfig?.enabled) {
        setStatus('Autoplay mode enabled - waiting for device...', 'info');
    }
});

/* ==============================================================================
 * EVENT LISTENERS
 * ============================================================================== */

function setupEventListeners() {
    document.getElementById('refresh-ports').addEventListener('click', refreshPorts);
    document.getElementById('connect-btn').addEventListener('click', connect);
    document.getElementById('disconnect-btn').addEventListener('click', disconnect);

    document.getElementById('test-pattern-btn').addEventListener('click', () => sendCommand('T'));
    document.getElementById('clear-btn').addEventListener('click', () => sendCommand('C'));
    document.getElementById('reset-btn').addEventListener('click', resetDevice);

    document.getElementById('load-video-btn').addEventListener('click', loadVideo);
    document.getElementById('play-btn').addEventListener('click', playVideo);
    document.getElementById('stop-btn').addEventListener('click', stopVideo);

    // ESP32 ready signal
    window.electronAPI.onEsp32Ready(async () => {
        if (!streamActive || !isPlaying || !videoElement) return;
        await pushFrame();
    });

    window.electronAPI.onConnectionLost(() => {
        isConnected = false;
        isPlaying = false;
        streamActive = false;
        updateUI();
        setStatus('Connection lost - attempting reconnect...', 'error');
    });

    window.electronAPI.onSerialData((data) => {
        console.log('ESP32:', data);
    });

    // Autoplay events
    window.electronAPI.onAutoplayStatus((data) => {
        console.log('Autoplay:', data.status, data.message);
        setStatus(data.message, data.status === 'error' ? 'error' : 'info');

        if (data.status === 'connected') {
            isConnected = true;
            updateUI();
        }
    });

    window.electronAPI.onAutoplayLoadVideo((data) => {
        console.log('Auto-loading video:', data.path);
        loadVideoFromPath(data.path);
    });

    window.electronAPI.onAutoplayResume(() => {
        console.log('Auto-resuming playback');
        if (videoElement && !isPlaying) {
            setTimeout(() => playVideo(), 1000);
        }
    });

    // NEW: Auto-select port in UI when connected
    window.electronAPI.onPortSelected((data) => {
        const portSelect = document.getElementById('port-select');
        // Find and select the option
        for (let i = 0; i < portSelect.options.length; i++) {
            if (portSelect.options[i].value === data.path) {
                portSelect.selectedIndex = i;
                console.log('✓ Port auto-selected in UI:', data.path);
                break;
            }
        }
    });
}

/* ==============================================================================
 * PORT MANAGEMENT
 * ============================================================================== */

async function refreshPorts() {
    const sel = document.getElementById('port-select');
    const ports = await window.electronAPI.getPorts();
    sel.innerHTML = '<option value="">-- Select Port --</option>';
    ports.forEach(p => {
        const o = document.createElement('option');
        o.value = p.path;
        o.textContent = p.manufacturer ? `${p.path} - ${p.manufacturer}` : p.path;
        sel.appendChild(o);
    });
    log(`Found ${ports.length} port(s)`);
}

async function connect() {
    const portPath = document.getElementById('port-select').value;
    if (!portPath) {
        alert('Select a port first');
        return;
    }

    setStatus('Connecting...', 'info');
    const r = await window.electronAPI.connect(portPath);

    if (r.success) {
        isConnected = true;
        updateUI();
        setStatus(`Connected to ${portPath}`, 'success');
        log(`Connected to ${portPath}`);
    } else {
        alert('Connection failed: ' + r.error);
        setStatus('Connection failed', 'error');
    }
}

async function disconnect() {
    await stopVideo();
    await window.electronAPI.disconnect();
    isConnected = false;
    updateUI();
    setStatus('Disconnected', 'info');
    log('Disconnected');
}

/* ==============================================================================
 * COMMANDS
 * ============================================================================== */

async function sendCommand(cmd) {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    await stopVideo();
    const r = await window.electronAPI.sendCommand(cmd);

    if (r.success) {
        const names = { T: 'Test Pattern', C: 'Clear' };
        setStatus(names[cmd] || 'Command sent', 'success');
        log(`Sent: ${cmd}`);
    } else {
        alert('Failed: ' + r.error);
    }
}

/* ==============================================================================
 * VIDEO HANDLING
 * ============================================================================== */

async function loadVideo() {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const url = URL.createObjectURL(file);
        await loadVideoFromPath(url);
    };

    input.click();
}

async function loadVideoFromPath(videoPath) {
    setStatus('Loading video...', 'info');

    if (videoElement?.pause) {
        videoElement.pause();
        videoElement.src = '';
    }

    videoElement = document.createElement('video');
    videoElement.src = videoPath;
    videoElement.loop = true;
    videoElement.muted = true;
    videoElement.playsInline = true;

    try {
        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                document.getElementById('video-info').textContent =
                    `${videoElement.videoWidth}x${videoElement.videoHeight}, ${videoElement.duration.toFixed(1)}s`;
                document.getElementById('playback-controls').style.display = 'flex';
                setStatus('Video loaded — press Play', 'success');
                log(`Video loaded: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                resolve();
            };
            videoElement.onerror = () => reject(new Error('Failed to load video'));
        });

        // Auto-play if enabled
        if (autoplayConfig?.autoPlayVideo && isConnected) {
            setTimeout(() => playVideo(), 500);
        }
    } catch (e) {
        console.error('Video load error:', e);
        setStatus('Failed to load video', 'error');
    }
}

async function playVideo() {
    if (!videoElement || !isConnected) return;

    try {
        if (!streamActive) {
            log('Starting video mode...');
            const r = await window.electronAPI.startVideoMode();
            if (!r.success) {
                alert('Failed: ' + r.error);
                return;
            }
            streamActive = true;
        }

        isPlaying = true;
        document.getElementById('play-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;

        if (videoElement.play) await videoElement.play();

        setStatus('Playing video', 'success');
        log('Playback started');

        await pushFrame();

    } catch (e) {
        console.error('playVideo error:', e);
        isPlaying = false;
        setStatus('Playback error', 'error');
        log('Error: ' + e.message);
    }
}

async function stopVideo() {
    isPlaying = false;
    streamActive = false;

    if (videoElement) {
        if (videoElement.pause) {
            videoElement.pause();
            videoElement.currentTime = 0;
        }
    }

    document.getElementById('play-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;

    log('Stopping video mode...');
    await window.electronAPI.stopVideoMode();
    setStatus('Stopped', 'info');
    log('Stopped');
}

async function resetDevice() {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    if (!confirm('Are you sure you want to reset the device? This will restart the ESP32.')) {
        return;
    }

    setStatus('Resetting device...', 'info');
    log('Sending reset command...');

    try {
        await stopVideo();
        const r = await window.electronAPI.resetDevice();

        if (r.success) {
            setStatus('Device is resetting...', 'success');
            log('Device reset command sent - will reconnect in 3 seconds');

            // UI feedback tijdens reset
            isConnected = false;
            updateUI();

            // Na 3 seconden proberen we automatisch te reconnecten
            setTimeout(() => {
                setStatus('Reconnecting after reset...', 'info');
            }, 3000);
        }
    } catch (e) {
        console.error('Reset error:', e);
        setStatus('Reset failed: ' + e.message, 'error');
        log('Reset error: ' + e.message);
    }
}

async function pushFrame() {
    if (!streamActive || !isPlaying || !videoElement) return;

    try {
        ctx.drawImage(videoElement, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
        const imageData = ctx.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
        const rgb565 = convertToRGB565(imageData);

        await window.electronAPI.sendFrame(Array.from(rgb565));

    } catch (e) {
        console.error('pushFrame error:', e);
    }
}

/* ==============================================================================
 * COLOR CONVERSION
 * ============================================================================== */

function convertToRGB565(imageData) {
    const out = new Uint16Array(MATRIX_WIDTH * MATRIX_HEIGHT);
    const data = imageData.data;

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        out[j] = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    }

    return out;
}

/* ==============================================================================
 * UI HELPERS
 * ============================================================================== */

function updateUI() {
    const on = isConnected;
    document.getElementById('connection-status').className = on ? 'status connected' : 'status disconnected';
    document.getElementById('connection-status').textContent = on ? '🟢 Connected' : '⚫ Disconnected';
    document.getElementById('connect-btn').disabled = on;
    document.getElementById('disconnect-btn').disabled = !on;
    document.getElementById('test-pattern-btn').disabled = !on;
    document.getElementById('clear-btn').disabled = !on;
    document.getElementById('reset-btn').disabled = !on;
    document.getElementById('load-video-btn').disabled = !on;
}

function setStatus(msg, type = 'info') {
    const el = document.getElementById('status-message');
    el.textContent = msg;
    const colors = { success: '#10b981', error: '#ef4444', info: '#9ca3af' };
    el.style.color = colors[type] || colors.info;
}

function log(msg) {
    console.log(msg);
}

function addLog(msg) {
    const el = document.getElementById('log-output');
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
}