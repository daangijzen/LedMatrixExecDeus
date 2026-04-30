/**
 * LED Matrix Video Player
 * Main application logic - OPTIMIZED
 */

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;

let targetFPS = 24;
let isConnected = false;
let videoLoaded = false;
let isPlaying = false;
let isStreaming = false;
let lastFrameTime = 0;

// Color mode settings
let colorMode = '4color';
let brightnessThreshold = 128;

// DOM Elements
const video = document.getElementById('video-player');
const canvasOriginal = document.getElementById('video-canvas-original');
const canvasRGB565 = document.getElementById('video-canvas');
const ctxOriginal = canvasOriginal.getContext('2d', { willReadFrequently: true });
const ctxRGB565 = canvasRGB565.getContext('2d', { willReadFrequently: true });
ctxOriginal.imageSmoothingEnabled = false;
ctxRGB565.imageSmoothingEnabled = false;

// Pre-allocate frame array to avoid garbage collection
const frameArray = new Uint16Array(MATRIX_WIDTH * MATRIX_HEIGHT);

/* ==============================================================================
 * INITIALIZATION
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎬 Video Player starting...');
    await refreshPorts();
    setupEventListeners();
    updateUI();
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

    // FPS slider
    document.getElementById('target-fps').addEventListener('input', updateTargetFPS);

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

    // Reset threshold button
    document.getElementById('reset-threshold-btn').addEventListener('click', () => {
        brightnessThreshold = 128;
        document.getElementById('brightness-threshold').value = 128;
        document.getElementById('threshold-value').textContent = 128;
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
 * COLOR QUANTIZATION - OPTIMIZED
 * ============================================================================== */

/**
 * Convert RGB888 to RGB565 with quantization - OPTIMIZED
 */
function quantizeColor(r, g, b) {
    switch (colorMode) {
        case '4color':
            return quantize4Color(r, g, b);
        case '7color':
            return quantize7Color(r, g, b);
        case 'monochrome':
            return quantizeMonochrome(r, g, b);
        default:
            return quantize4Color(r, g, b);
    }
}

/**
 * 4-Color mode: R, G, B, W only
 */
function quantize4Color(r, g, b) {
    const threshold = brightnessThreshold;

    if (r < threshold && g < threshold && b < threshold) {
        return 0x0000;
    }

    if (r >= threshold && g >= threshold && b >= threshold) {
        return 0xFFFF;
    }

    const max = Math.max(r, g, b);

    if (r === max && r >= threshold) {
        return 0xF800;
    } else if (g === max && g >= threshold) {
        return 0x07E0;
    } else if (b === max && b >= threshold) {
        return 0x001F;
    }

    return 0x0000;
}

/**
 * 7-Color mode: R, G, B, C, M, Y, W
 */
function quantize7Color(r, g, b) {
    const threshold = brightnessThreshold;

    const rOn = r >= threshold;
    const gOn = g >= threshold;
    const bOn = b >= threshold;

    let color = 0x0000;
    if (rOn) color |= 0xF800;
    if (gOn) color |= 0x07E0;
    if (bOn) color |= 0x001F;

    return color;
}

/**
 * Monochrome mode: Black or White only
 */
function quantizeMonochrome(r, g, b) {
    const gray = (r * 0.299 + g * 0.587 + b * 0.114);
    return gray >= brightnessThreshold ? 0xFFFF : 0x0000;
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
    frameArray.fill(0x0000);
    try {
        await window.electronAPI.sendFrame(Array.from(frameArray));
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

function updateTargetFPS(e) {
    targetFPS = parseInt(e.target.value);
    document.getElementById('fps-value').textContent = targetFPS;
    console.log('🎯 Target FPS changed to:', targetFPS);

    if (isStreaming) {
        stopStreaming();
        startStreaming();
    }
}

/* ==============================================================================
 * FRAME EXTRACTION & STREAMING - OPTIMIZED
 * ============================================================================== */

/**
 * Draw current video frame to both canvases
 */
function drawFrame() {
    if (!videoLoaded) return;

    ctxOriginal.drawImage(video, 0, 0, MATRIX_WIDTH, MATRIX_HEIGHT);

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

        const rgb565 = quantizeColor(r, g, b);

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
 * Convert ImageData to RGB565 array - OPTIMIZED
 */
function convertToRGB565(imageData) {
    const data = imageData.data;

    // Write directly to pre-allocated array
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        frameArray[j] = quantizeColor(data[i], data[i + 1], data[i + 2]);
    }

    return frameArray;
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
 * Send frame to matrix - OPTIMIZED
 */
async function sendFrame() {
    const frame = extractFrame();
    if (!frame) return;

    try {
        // Fire and forget - don't await
        window.electronAPI.sendFrame(Array.from(frame));
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

/**
 * Start streaming - OPTIMIZED with requestAnimationFrame
 */
function startStreaming() {
    if (!isConnected || !videoLoaded) return;

    isStreaming = true;
    document.getElementById('stream-btn').textContent = '⏹️ Stop Streaming';
    document.getElementById('stream-btn').classList.remove('btn-success');
    document.getElementById('stream-btn').classList.add('btn-danger');

    if (!isPlaying) {
        playVideo();
    }

    const frameInterval = 1000 / targetFPS;
    lastFrameTime = performance.now();

    // Use requestAnimationFrame for better timing
    function streamLoop() {
        if (!isStreaming) return;

        const now = performance.now();
        const elapsed = now - lastFrameTime;

        if (elapsed >= frameInterval && isPlaying) {
            sendFrame();
            lastFrameTime = now;
        }

        requestAnimationFrame(streamLoop);
    }

    requestAnimationFrame(streamLoop);

    setStatus(`Streaming @ ${targetFPS} FPS`, 'success');
}

function stopStreaming() {
    if (!isStreaming) return;

    isStreaming = false;

    document.getElementById('stream-btn').textContent = '🚀 Stream to Matrix';
    document.getElementById('stream-btn').classList.remove('btn-danger');
    document.getElementById('stream-btn').classList.add('btn-success');

    setStatus('Streaming stopped', 'info');
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