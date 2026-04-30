/**
 * USB Streaming Test Script
 *
 * Sends colored test patterns to the LED matrix via USB Serial
 */

const { SerialPort } = require('serialport');

const MATRIX_WIDTH = 192;
const MATRIX_HEIGHT = 32;
const FRAME_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT * 2;

// RGB565 color palette
const COLORS = {
    RED:     0xF800,
    GREEN:   0x07E0,
    BLUE:    0x001F,
    YELLOW:  0xFFE0,
    MAGENTA: 0xF81F,
    CYAN:    0x07FF,
    WHITE:   0xFFFF,
    BLACK:   0x0000
};

/**
 * Convert RGB888 to RGB565
 */
function rgbToRGB565(r, g, b) {
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

/**
 * Create a frame buffer filled with one color
 */
function createSolidFrame(color) {
    const buffer = Buffer.alloc(FRAME_SIZE);
    for (let i = 0; i < MATRIX_WIDTH * MATRIX_HEIGHT; i++) {
        buffer.writeUInt16LE(color, i * 2);
    }
    return buffer;
}

/**
 * Create a gradient frame
 */
function createGradientFrame() {
    const buffer = Buffer.alloc(FRAME_SIZE);

    for (let y = 0; y < MATRIX_HEIGHT; y++) {
        for (let x = 0; x < MATRIX_WIDTH; x++) {
            const r = Math.floor((x / MATRIX_WIDTH) * 255);
            const g = Math.floor((y / MATRIX_HEIGHT) * 255);
            const b = 128;

            const rgb565 = rgbToRGB565(r, g, b);
            const offset = (y * MATRIX_WIDTH + x) * 2;
            buffer.writeUInt16LE(rgb565, offset);
        }
    }

    return buffer;
}

/**
 * Create a checkerboard pattern
 */
function createCheckerboard(color1, color2, size = 8) {
    const buffer = Buffer.alloc(FRAME_SIZE);

    for (let y = 0; y < MATRIX_HEIGHT; y++) {
        for (let x = 0; x < MATRIX_WIDTH; x++) {
            const isColor1 = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
            const color = isColor1 ? color1 : color2;
            const offset = (y * MATRIX_WIDTH + x) * 2;
            buffer.writeUInt16LE(color, offset);
        }
    }

    return buffer;
}

/**
 * Main streaming function
 */
async function startStreaming(portPath) {
    console.log('🚀 Starting USB Streaming Test...\n');

    const port = new SerialPort({
        path: portPath,
        baudRate: 2000000  // 2Mbps
    });

    port.on('open', () => {
        console.log('✅ Serial port opened');
        console.log(`   Port: ${portPath}`);
        console.log(`   Baud: 2000000`);
        console.log(`   Frame size: ${FRAME_SIZE} bytes\n`);

        let frameCount = 0;
        let pattern = 0;

        // Send frames at slower rate for testing (10 FPS)
        const interval = setInterval(() => {
            let frame;

            switch(pattern % 4) {
                case 0:
                    frame = createSolidFrame(COLORS.RED);
                    console.log(`Frame ${frameCount}: RED`);
                    break;
                case 1:
                    frame = createSolidFrame(COLORS.GREEN);
                    console.log(`Frame ${frameCount}: GREEN`);
                    break;
                case 2:
                    frame = createSolidFrame(COLORS.BLUE);
                    console.log(`Frame ${frameCount}: BLUE`);
                    break;
                case 3:
                    frame = createCheckerboard(COLORS.WHITE, COLORS.BLACK);
                    console.log(`Frame ${frameCount}: CHECKERBOARD`);
                    break;
            }

            port.write(frame, (err) => {
                if (err) {
                    console.error('❌ Write error:', err);
                }
            });

            frameCount++;

            // Change pattern every 10 frames (~1 second at 10 FPS)
            if (frameCount % 10 === 0) {
                pattern++;
            }

        }, 100);  // 100ms = 10 FPS (slower for testing)

        // Handle Ctrl+C
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Stopping stream...');
            clearInterval(interval);
            port.close(() => {
                console.log('✅ Port closed');
                process.exit(0);
            });
        });
    });

    port.on('error', (err) => {
        console.error('❌ Serial port error:', err);
    });
}

// Main
if (process.argv.length < 3) {
    console.log('Usage: node ControllSoftware.js <PORT>');
    console.log('\nExample:');
    console.log('  Windows: node ControllSoftware.js COM11');
    console.log('  Mac:     node ControllSoftware.js /dev/tty.usbmodem14201');
    console.log('  Linux:   node ControllSoftware.js /dev/ttyACM0');
    process.exit(1);
}

startStreaming(process.argv[2]);