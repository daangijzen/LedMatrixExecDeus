/**
 * LED Matrix Video Player - Frontend with Live Streaming + YouTube
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
let streamSource = null; // 'file', 'url', 'webcam', 'screen', 'youtube'

/* ==============================================================================
 * INIT
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    await refreshPorts();
    setupEventListeners();
    updateUI();
    log('System ready');
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

    document.getElementById('load-video-btn').addEventListener('click', loadVideoFile);
    document.getElementById('load-url-btn').addEventListener('click', loadFromURL);
    document.getElementById('load-webcam-btn').addEventListener('click', loadWebcam);
    document.getElementById('load-screen-btn').addEventListener('click', loadScreenCapture);

    // Allow Enter key to load URL
    document.getElementById('url-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadFromURL();
    });

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
        setStatus('Connection lost', 'error');
    });

    window.electronAPI.onSerialData((data) => {
        console.log('RX:', data);
        addLog(data);
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
 * VIDEO SOURCE LOADING
 * ============================================================================== */

async function loadVideoFile() {
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

        await setupVideoElement(URL.createObjectURL(file), 'file', file.name);
    };

    input.click();
}

async function loadFromURL() {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    const urlInput = document.getElementById('url-input');
    const url = urlInput.value.trim();

    if (!url) {
        alert('Please enter a URL or YouTube link');
        return;
    }

    // Check if it's a YouTube URL
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        await loadYouTube(url);
    } else {
        // Try to load as direct video URL
        await setupVideoElement(url, 'url', url);
    }
}

async function loadYouTube(input) {
    // Extract video ID from various YouTube URL formats
    let videoId = input;

    // Full URL: youtube.com/watch?v=ID
    const match1 = input.match(/[?&]v=([^&]+)/);
    if (match1) videoId = match1[1];

    // Short URL: youtu.be/ID
    const match2 = input.match(/youtu\.be\/([^?]+)/);
    if (match2) videoId = match2[1];

    // Embed URL: youtube.com/embed/ID
    const match3 = input.match(/embed\/([^?]+)/);
    if (match3) videoId = match3[1];

    // Clean up any trailing parameters
    videoId = videoId.split('&')[0].split('?')[0];

    setStatus('Loading YouTube video...', 'info');
    log(`Loading YouTube video ID: ${videoId}`);

    try {
        await setupYouTubePlayer(videoId);
    } catch (e) {
        alert('Failed to load YouTube video:\n' + e.message + '\n\nTip: Try using Screen Capture and capture a YouTube tab instead!');
        log('YouTube error: ' + e.message);
    }
}

async function setupYouTubePlayer(videoId) {
    // Note: Due to browser security restrictions, we can't directly capture YouTube iframes
    // The best approach is to use Screen Capture feature

    alert(
        'YouTube Direct Playback:\n\n' +
        'Due to browser security restrictions, direct YouTube playback is limited.\n\n' +
        'RECOMMENDED METHOD:\n' +
        '1. Open YouTube video in browser\n' +
        '2. Click "🖥️ Screen Capture" button\n' +
        '3. Select the browser tab with YouTube\n' +
        '4. Click Play!\n\n' +
        'This gives you full quality and control!'
    );

    // Clear the URL input
    document.getElementById('url-input').value = '';

    throw new Error('Use Screen Capture for YouTube');
}

async function loadWebcam() {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    try {
        setStatus('Requesting webcam access...', 'info');

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });

        if (videoElement?.pause) {
            videoElement.pause();
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
        }

        videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        videoElement.muted = true;
        videoElement.playsInline = true;

        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                streamSource = 'webcam';
                document.getElementById('video-info').textContent =
                    `Webcam: ${videoElement.videoWidth}x${videoElement.videoHeight}`;
                document.getElementById('playback-controls').style.display = 'flex';
                setStatus('Webcam ready — press Play', 'success');
                log(`Webcam loaded: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                resolve();
            };
            videoElement.onerror = () => reject(new Error('Failed to load webcam'));
        });

    } catch (e) {
        alert('Webcam access denied or unavailable:\n' + e.message);
        log('Webcam error: ' + e.message);
    }
}

async function loadScreenCapture() {
    if (!isConnected) {
        alert('Not connected');
        return;
    }

    try {
        setStatus('Select screen or window to capture...', 'info');

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });

        if (videoElement?.pause) {
            videoElement.pause();
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
        }

        videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        videoElement.muted = true;
        videoElement.playsInline = true;

        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                streamSource = 'screen';
                document.getElementById('video-info').textContent =
                    `Screen Capture: ${videoElement.videoWidth}x${videoElement.videoHeight}`;
                document.getElementById('playback-controls').style.display = 'flex';
                setStatus('Screen capture ready — press Play', 'success');
                log(`Screen capture: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                resolve();
            };
            videoElement.onerror = () => reject(new Error('Failed to capture screen'));
        });

    } catch (e) {
        alert('Screen capture cancelled or unavailable:\n' + e.message);
        log('Screen capture error: ' + e.message);
    }
}

async function setupVideoElement(src, source, name) {
    setStatus('Loading video...', 'info');

    if (videoElement?.pause) {
        videoElement.pause();
        if (videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(track => track.stop());
        }
        videoElement.src = '';
    }

    videoElement = document.createElement('video');
    videoElement.src = src;
    videoElement.loop = (source === 'file');
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = () => {
            streamSource = source;
            const duration = videoElement.duration !== Infinity ?
                `, ${videoElement.duration.toFixed(1)}s` : '';
            document.getElementById('video-info').textContent =
                `${name}\n${videoElement.videoWidth}x${videoElement.videoHeight}${duration}`;
            document.getElementById('playback-controls').style.display = 'flex';
            setStatus('Video loaded — press Play', 'success');
            log(`Video loaded: ${videoElement.videoWidth}x${videoElement.videoHeight} (${source})`);

            // Clear URL input on success
            document.getElementById('url-input').value = '';

            resolve();
        };
        videoElement.onerror = () => {
            let errorMsg = 'Failed to load video';
            if (videoElement.error) {
                switch (videoElement.error.code) {
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMsg = 'Network error - check URL or connection';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMsg = 'Decode error - unsupported format';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMsg = 'Source not supported - try a direct video URL (.mp4, .webm)';
                        break;
                }
            }
            reject(new Error(errorMsg));
        };
    }).catch(e => {
        alert(e.message);
        log('Load error: ' + e.message);
        throw e;
    });
}

/* ==============================================================================
 * PLAYBACK
 * ============================================================================== */

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

        setStatus(`Playing ${streamSource}`, 'success');
        log('Playback started');

        // Kick off first frame
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
            if (streamSource !== 'file') {
                videoElement.currentTime = 0;
            }
        }

        if (videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(track => track.stop());
        }

        videoElement = null;
    }

    document.getElementById('playback-controls').style.display = 'none';
    document.getElementById('play-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;

    log('Stopping video mode...');
    await window.electronAPI.stopVideoMode();
    setStatus('Stopped', 'info');
    log('Stopped');
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
    document.getElementById('load-video-btn').disabled = !on;
    document.getElementById('load-webcam-btn').disabled = !on;
    document.getElementById('load-screen-btn').disabled = !on;
    document.getElementById('url-input').disabled = !on;
    document.getElementById('load-url-btn').disabled = !on;
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