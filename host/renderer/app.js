/**
 * LED Matrix Video Player
 * Main application logic
 */

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const TARGET_FPS = 30;
const NO_SIGNAL_CHECK_INTERVAL = 3000;

let isConnected = false;
let videoLoaded = false;
let isPlaying = false;
let isStreaming = false;
let streamInterval = null;
let noSignalInterval = null;
let lastFrameSent = Date.now();

// Color mode settings
let colorMode = '4color';
let brightnessThreshold = 128;

// DOM Elements
const video = document.getElementById('video-player');
const canvasOriginal = document.getElementById('video-canvas-original');
const canvasRGB565 = document.getElementById('video-canvas');
const ctxOriginal = canvasOriginal.getContext('2d');
const ctxRGB565 = canvasRGB565.getContext('2d');
ctxOriginal.imageSmoothingEnabled = false;
ctxRGB565.imageSmoothingEnabled = false;

/* ==============================================================================
 * INITIALIZATION
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎬 Video Player starting...');
    await refreshPorts();
    setupEventListeners();
    updateUI();
    startNoSignalCheck();
});

/* ==============================================================================
 * EVENT LISTENERS
 * ============================================================================== */

function setupEventListeners() {
    // Connection
    document.getElementById('refresh-ports').addEventListener('click', refreshPorts);
    document.getElementById('connect-btn').addEventListener('click', connect);
    document.getElementById('disconnect-btn').addEventListener('click', disconnect);

    // Video controls
    document.getElementById('load-video-btn').addEventListener('click', loadVideo);
    document.getElementById('play-btn').addEventListener('click', playVideo);
    document.getElementById('pause-btn').addEventListener('click', pauseVideo);
    document.getElementById('stop-btn').addEventListener('click', stopVideo);
    document.getElementById('stream-btn').addEventListener('click', toggleStreaming);

    // Quick actions
    document.getElementById('blackout-btn').addEventListener('click', sendBlackout);

    // Timeline
    document.getElementById('timeline-slider').addEventListener('input', seekVideo);

    // Settings
    document.getElementById('loop-enabled').addEventListener('change', updateVideoSettings);
    document.getElementById('playback-speed').addEventListener('input', updatePlaybackSpeed);

    // Color mode settings
    document.querySelectorAll('input[name="colormode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            colorMode = e.target.value;
            console.log('🎨 Color mode changed to:', colorMode);
            if (videoLoaded) {
                drawFrame();
            }
        });
    });

    document.getElementById('brightness-threshold').addEventListener('input', (e) => {
        brightnessThreshold = parseInt(e.target.value);
        document.getElementById('threshold-value').textContent = brightnessThreshold;
        console.log('💡 Threshold changed to:', brightnessThreshold);
        if (videoLoaded) {
            drawFrame();
        }
    });

    // Video events
    video.addEventListener('loadedmetadata', onVideoLoaded);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onVideoEnded);
    video.addEventListener('play', () => isPlaying = true);
    video.addEventListener('pause', () => isPlaying = false);
}

/* ==============================================================================
 * COLOR QUANTIZATION
 * ============================================================================== */

/**
 * Convert RGB888 to 1-bit RGB palette
 */
function quantizeColor(r, g, b) {
    switch (colorMode) {
        case '4color':
            return quantize4Color(r, g, b);
        case '7color':
            return quantize7Color(r, g, b);
        case 'monochrome':
            return quantizeMonochrome(r, g, b);
        case 'pwm':
            return quantizePWM(r, g, b);
        default:
            return quantize4Color(r, g, b);
    }
}

/**
 * 4-Color mode: R, G, B, W only
 */
function quantize4Color(r, g, b) {
    const threshold = brightnessThreshold;

    // If all values low, return black
    if (r < threshold && g < threshold && b < threshold) {
        return 0x0000; // Black
    }

    // If all values high, return white
    if (r >= threshold && g >= threshold && b >= threshold) {
        return 0xFFFF; // White (R+G+B full)
    }

    // Find dominant color
    const max = Math.max(r, g, b);

    // Return dominant color only
    if (r === max && r >= threshold) {
        return 0xF800; // Red only
    } else if (g === max && g >= threshold) {
        return 0x07E0; // Green only
    } else if (b === max && b >= threshold) {
        return 0x001F; // Blue only
    }

    return 0x0000; // Default black
}

/**
 * 7-Color mode: R, G, B, C, M, Y, W
 */
function quantize7Color(r, g, b) {
    const threshold = brightnessThreshold;

    // Threshold each channel independently
    const rOn = r >= threshold;
    const gOn = g >= threshold;
    const bOn = b >= threshold;

    // Combine to RGB565
    let color = 0x0000;
    if (rOn) color |= 0xF800;  // Red channel full
    if (gOn) color |= 0x07E0;  // Green channel full
    if (bOn) color |= 0x001F;  // Blue channel full

    return color;
}

/**
 * Monochrome mode: Black or White only
 */
function quantizeMonochrome(r, g, b) {
    // Convert to grayscale using standard weights
    const gray = (r * 0.299 + g * 0.587 + b * 0.114);

    return gray >= brightnessThreshold ? 0xFFFF : 0x0000;
}

/**
 * PWM Dithering mode (placeholder for step 2)
 */
function quantizePWM(r, g, b) {
    // For now, return full RGB565 (will implement PWM later)
    const r5 = r >> 3;
    const g6 = g >> 2;
    const b5 = b >> 3;
    return (r5 << 11) | (g6 << 5) | b5;
}

/* ==============================================================================
 * NO SIGNAL DETECTION
 * ============================================================================== */

function startNoSignalCheck() {
    noSignalInterval = setInterval(() => {
        if (isConnected && !isStreaming) {
            const timeSinceLastFrame = Date.now() - lastFrameSent;

            if (timeSinceLastFrame > NO_SIGNAL_CHECK_INTERVAL) {
                sendNoSignalFrame();
            }
        }
    }, NO_SIGNAL_CHECK_INTERVAL);
}

function sendNoSignalFrame() {
    const canvas = document.createElement('canvas');
    canvas.width = MATRIX_WIDTH;
    canvas.height = MATRIX_HEIGHT;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

    ctx.fillStyle = '#FF0000';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO CONNECTION', MATRIX_WIDTH / 2, MATRIX_HEIGHT / 2);

    const imageData = ctx.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
    const frame = convertToRGB565(imageData);
    window.electronAPI.sendFrame(frame);
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
        option.textContent = `${port.path}${port.manufacturer ? ' - ' + port.manufacturer : ''}`;
        select.appendChild(option);
    });
}

async function connect() {
    const portPath = document.getElementById('port-select').value;
    if (!portPath) {
        alert('Please select a serial port');
        return;
    }

    try {
        const result = await window.electronAPI.connect(portPath);
        if (result.success) {
            isConnected = true;
            updateUI();
            setStatus('Connected to ' + portPath, 'success');
            handleStartupBehavior();
        } else {
            alert('Connection failed: ' + result.error);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
}

async function disconnect() {
    try {
        stopStreaming();
        await window.electronAPI.disconnect();
        isConnected = false;
        updateUI();
        setStatus('Disconnected', 'info');
    } catch (error) {
        console.error('Disconnect error:', error);
    }
}

/* ==============================================================================
 * QUICK ACTIONS
 * ============================================================================== */

async function sendBlackout() {
    const blackFrame = new Array(MATRIX_WIDTH * MATRIX_HEIGHT).fill(0x0000);
    try {
        await window.electronAPI.sendFrame(blackFrame);
        lastFrameSent = Date.now();
        setStatus('Blackout sent', 'success');
    } catch (error) {
        console.error('Error sending blackout:', error);
    }
}

/* ==============================================================================
 * VIDEO LOADING
 * ============================================================================== */

async function loadVideo() {
    try {
        const result = await window.electronAPI.openVideoFile();

        if (result.success) {
            console.log('📂 Loading video:', result.path);

            video.src = result.path;
            video.load();

            const filename = result.path.split(/[\\/]/).pop();
            document.getElementById('video-filename').textContent = filename;
            document.getElementById('video-filename').title = result.path;

            document.getElementById('no-video-message').style.display = 'none';

            setStatus('Loading video...', 'info');
        }
    } catch (error) {
        console.error('Error loading video:', error);
        setStatus('Error loading video: ' + error.message, 'error');
    }
}

function onVideoLoaded() {
    videoLoaded = true;

    console.log('✅ Video loaded');
    console.log('   Duration:', video.duration, 'seconds');
    console.log('   Size:', video.videoWidth, 'x', video.videoHeight);

    document.getElementById('video-resolution').textContent = `${video.videoWidth}×${video.videoHeight}`;
    document.getElementById('video-duration').textContent = formatTime(video.duration);
    document.getElementById('total-time').textContent = formatTime(video.duration);

    document.getElementById('play-btn').disabled = false;
    document.getElementById('pause-btn').disabled = false;
    document.getElementById('stop-btn').disabled = false;
    document.getElementById('timeline-slider').disabled = false;

    if (isConnected) {
        document.getElementById('stream-btn').disabled = false;
    }

    drawFrame();

    setStatus('Video loaded successfully', 'success');
}

/* ==============================================================================
 * VIDEO PLAYBACK
 * ============================================================================== */

function playVideo() {
    if (!videoLoaded) return;
    video.play();
    setStatus('Playing', 'success');
}

function pauseVideo() {
    if (!videoLoaded) return;
    video.pause();
    setStatus('Paused', 'info');
}

function stopVideo() {
    if (!videoLoaded) return;
    video.pause();
    video.currentTime = 0;
    setStatus('Stopped', 'info');
}

function seekVideo(e) {
    if (!videoLoaded) return;
    const percent = e.target.value / 100;
    video.currentTime = video.duration * percent;
}

function onTimeUpdate() {
    if (!videoLoaded) return;

    const percent = (video.currentTime / video.duration) * 100;
    document.getElementById('timeline-slider').value = percent;
    document.getElementById('current-time').textContent = formatTime(video.currentTime);

    drawFrame();
}

function onVideoEnded() {
    const loopEnabled = document.getElementById('loop-enabled').checked;
    if (loopEnabled) {
        video.currentTime = 0;
        video.play();
    } else {
        setStatus('Video ended', 'info');
    }
}

function updateVideoSettings() {
    video.loop = document.getElementById('loop-enabled').checked;
}

function updatePlaybackSpeed(e) {
    const speed = parseFloat(e.target.value);
    video.playbackRate = speed;
    document.getElementById('speed-value').textContent = speed.toFixed(1) + 'x';
}

/* ==============================================================================
 * FRAME EXTRACTION & STREAMING
 * ============================================================================== */

/**
 * Draw current video frame to both canvases
 */
function drawFrame() {
    if (!videoLoaded) return;

    // Draw original (RGB888)
    ctxOriginal.drawImage(video, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

    // Draw quantized RGB565 preview
    const imageData = ctxOriginal.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
    const rgb565ImageData = convertImageDataToRGB565Preview(imageData);
    ctxRGB565.putImageData(rgb565ImageData, 0, 0);
}

/**
 * Convert ImageData to RGB565 preview (for display)
 */
function convertImageDataToRGB565Preview(imageData) {
    const data = imageData.data;
    const preview = ctxRGB565.createImageData(MATRIX_WIDTH, MATRIX_HEIGHT);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Quantize
        const rgb565 = quantizeColor(r, g, b);

        // Convert back to RGB888 for preview
        const r5 = (rgb565 >> 11) & 0x1F;
        const g6 = (rgb565 >> 5) & 0x3F;
        const b5 = rgb565 & 0x1F;

        preview.data[i] = (r5 << 3) | (r5 >> 2);
        preview.data[i + 1] = (g6 << 2) | (g6 >> 4);
        preview.data[i + 2] = (b5 << 3) | (b5 >> 2);
        preview.data[i + 3] = 255;
    }

    return preview;
}

/**
 * Convert ImageData to RGB565 array with quantization
 */
function convertToRGB565(imageData) {
    const data = imageData.data;
    const frame = new Array(MATRIX_WIDTH * MATRIX_HEIGHT);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Quantize based on selected mode
        frame[i / 4] = quantizeColor(r, g, b);
    }

    return frame;
}

/**
 * Extract current frame and convert to RGB565
 */
function extractFrame() {
    if (!videoLoaded) return null;

    const imageData = ctxOriginal.getImageData(0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);
    return convertToRGB565(imageData);
}

/**
 * Send frame to matrix
 */
async function sendFrame() {
    const frame = extractFrame();
    if (!frame) return;

    try {
        await window.electronAPI.sendFrame(frame);
        lastFrameSent = Date.now();
    } catch (error) {
        console.error('Error sending frame:', error);
        stopStreaming();
        setStatus('Streaming error: ' + error.message, 'error');
    }
}

/**
 * Toggle streaming to matrix
 */
function toggleStreaming() {
    if (isStreaming) {
        stopStreaming();
    } else {
        startStreaming();
    }
}

function startStreaming() {
    if (!isConnected || !videoLoaded) return;

    isStreaming = true;
    document.getElementById('stream-btn').textContent = '⏹️ Stop Streaming';
    document.getElementById('stream-btn').classList.remove('btn-success');
    document.getElementById('stream-btn').classList.add('btn-danger');

    if (!isPlaying) {
        playVideo();
    }

    const frameInterval = 1000 / TARGET_FPS;
    streamInterval = setInterval(() => {
        if (isPlaying) {
            sendFrame();
        }
    }, frameInterval);

    setStatus('Streaming to matrix @ ' + TARGET_FPS + ' FPS', 'success');
}

function stopStreaming() {
    if (!isStreaming) return;

    isStreaming = false;
    if (streamInterval) {
        clearInterval(streamInterval);
        streamInterval = null;
    }

    document.getElementById('stream-btn').textContent = '🚀 Stream to Matrix';
    document.getElementById('stream-btn').classList.remove('btn-danger');
    document.getElementById('stream-btn').classList.add('btn-success');

    setStatus('Streaming stopped', 'info');
}

/* ==============================================================================
 * STARTUP BEHAVIOR
 * ============================================================================== */

function handleStartupBehavior() {
    if (!videoLoaded) return;

    const startup = document.querySelector('input[name="startup"]:checked').value;

    switch (startup) {
        case 'hold':
            video.currentTime = 0;
            drawFrame();
            sendFrame();
            break;

        case 'autoplay':
            startStreaming();
            break;

        case 'black':
            sendBlackout();
            break;
    }
}

/* ==============================================================================
 * UI UPDATES
 * ============================================================================== */

function updateUI() {
    const statusEl = document.getElementById('connection-status');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const streamBtn = document.getElementById('stream-btn');
    const blackoutBtn = document.getElementById('blackout-btn');

    if (isConnected) {
        statusEl.className = 'status connected';
        statusEl.textContent = '🟢 Connected';
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        blackoutBtn.disabled = false;
        if (videoLoaded) {
            streamBtn.disabled = false;
        }
    } else {
        statusEl.className = 'status disconnected';
        statusEl.textContent = '⚫ Disconnected';
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        streamBtn.disabled = true;
        blackoutBtn.disabled = true;
    }
}

function setStatus(message, type = 'info') {
    const statusEl = document.getElementById('player-status');
    statusEl.textContent = message;

    statusEl.style.color = {
        'success': '#10b981',
        'error': '#ef4444',
        'info': '#9ca3af'
    }[type] || '#9ca3af';
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}