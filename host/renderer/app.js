/**
 * Frontend Application Logic
 */

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;

// RGB565 Colors
const COLORS = {
    BLACK:   0x0000,
    WHITE:   0xFFFF,
    WHITE_DIM: 0x8410,  // ~50% brightness white (ADDED)
    RED:     0xF800,
    GREEN:   0x07E0,
    BLUE:    0x001F,
    YELLOW:  0xFFE0,
    MAGENTA: 0xF81F,
    CYAN:    0x07FF
};

let isConnected = false;

/* ==============================================================================
 * INITIALIZATION
 * ============================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 [RENDERER] App starting...');  // ⬅️ NIEUW: Debug log
    await refreshPorts();
    setupEventListeners();
    updateConnectionStatus();
});

/* ==============================================================================
 * EVENT LISTENERS
 * ============================================================================== */

function setupEventListeners() {
    // Port management
    document.getElementById('refresh-ports').addEventListener('click', refreshPorts);
    document.getElementById('connect-btn').addEventListener('click', connect);
    document.getElementById('disconnect-btn').addEventListener('click', disconnect);

    // Quick actions
    document.querySelectorAll('.btn-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            handleQuickAction(action);
        });
    });
}

/* ==============================================================================
 * PORT MANAGEMENT
 * ============================================================================== */

async function refreshPorts() {
    console.log('🔍 [RENDERER] Refreshing ports...');  // ⬅️ NIEUW: Debug log

    const select = document.getElementById('port-select');

    try {
        const ports = await window.electronAPI.getPorts();
        console.log('✅ [RENDERER] Received ports:', ports);  // ⬅️ NIEUW: Debug log

        select.innerHTML = '<option value="">-- Select Port --</option>';

        ports.forEach(port => {
            const option = document.createElement('option');
            option.value = port.path;
            option.textContent = `${port.path}${port.manufacturer ? ' - ' + port.manufacturer : ''}`;
            select.appendChild(option);
        });

        console.log('✅ [RENDERER] Port list updated');  // ⬅️ NIEUW: Debug log
    } catch (error) {
        console.error('❌ [RENDERER] Error refreshing ports:', error);  // ⬅️ NIEUW: Debug log
        alert('Error getting ports: ' + error.message);
    }
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
            updateConnectionStatus();
            console.log('Connected to', portPath);
        } else {
            alert('Connection failed: ' + result.error);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
}

async function disconnect() {
    try {
        await window.electronAPI.disconnect();
        isConnected = false;
        updateConnectionStatus();
        console.log('Disconnected');
    } catch (error) {
        console.error('Disconnect error:', error);
    }
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const actionButtons = document.querySelectorAll('.btn-action');

    if (isConnected) {
        statusEl.className = 'status connected';
        statusEl.textContent = '🟢 Connected';
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        actionButtons.forEach(btn => btn.disabled = false);
    } else {
        statusEl.className = 'status disconnected';
        statusEl.textContent = '⚫ Disconnected';
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        actionButtons.forEach(btn => btn.disabled = true);
    }
}

/* ==============================================================================
 * FRAME GENERATION
 * ============================================================================== */

function createSolidFrame(color) {
    const frame = new Array(MATRIX_WIDTH * MATRIX_HEIGHT).fill(color);
    return frame;
}

function createTestPattern() {
    const frame = new Array(MATRIX_WIDTH * MATRIX_HEIGHT);

    for (let y = 0; y < MATRIX_HEIGHT; y++) {
        for (let x = 0; x < MATRIX_WIDTH; x++) {
            const section = Math.floor(x / (MATRIX_WIDTH / 6));
            let color;

            switch(section) {
                case 0: color = COLORS.RED; break;
                case 1: color = COLORS.GREEN; break;
                case 2: color = COLORS.BLUE; break;
                case 3: color = COLORS.YELLOW; break;
                case 4: color = COLORS.MAGENTA; break;
                default: color = COLORS.CYAN; break;
            }

            frame[y * MATRIX_WIDTH + x] = color;
        }
    }

    return frame;
}

/* ==============================================================================
 * QUICK ACTIONS
 * ============================================================================== */

async function handleQuickAction(action) {
    if (!isConnected) {
        alert('Please connect to the matrix first');
        return;
    }

    let frame;

    switch(action) {
        case 'blackout':
            frame = createSolidFrame(COLORS.BLACK);
            break;
        case 'white':
            frame = createSolidFrame(COLORS.WHITE_DIM);  // ⬅️ CHANGED: Use dimmed white
            break;
        case 'red':
            frame = createSolidFrame(COLORS.RED);
            break;
        case 'green':
            frame = createSolidFrame(COLORS.GREEN);
            break;
        case 'blue':
            frame = createSolidFrame(COLORS.BLUE);
            break;
        case 'test':
            frame = createTestPattern();
            break;
        default:
            return;
    }

    try {
        const result = await window.electronAPI.sendFrame(frame);
        if (!result.success) {
            console.error('Send failed:', result.error);
        } else {
            console.log('Frame sent:', action);
        }
    } catch (error) {
        console.error('Error sending frame:', error);
    }
}