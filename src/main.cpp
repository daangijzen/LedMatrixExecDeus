/**
 * @file main.cpp
 * @brief LED Matrix Image/Video Display Controller
 * Matrix Portal S3 (ESP32-S3) - USB Serial Control
 *
 * Commands via Serial:
 * '0' = Blackout
 * '1' = Rainbow gradient (animated)
 * '2' = Moving bars pattern
 * '3' = Solid colors test
 * 'I' = Start image upload (followed by raw RGB565 data)
 * 'C' = Clear display and free image buffer
 * 'V' = Start video mode (streaming frames)
 * 'F' = Single frame in video mode
 * 'S' = Stop video mode
 * 'P' = Ping (connectivity check)
 */

#include <Arduino.h>
#include <Adafruit_Protomatter.h>

/* ==============================================================================
 * CONFIGURATION
 * ============================================================================== */

#define MATRIX_WIDTH  192
#define MATRIX_HEIGHT 32
#define FRAME_SIZE (MATRIX_WIDTH * MATRIX_HEIGHT * 2)  // RGB565 = 2 bytes per pixel
#define SERIAL_BUFFER_SIZE 16384  // Larger buffer for faster transfers

// Matrix Portal S3 Pin Configuration
uint8_t rgbPins[]  = {42, 41, 40, 38, 39, 37};  // R1, G1, B1, R2, G2, B2
uint8_t addrPins[] = {45, 36, 48, 35};          // A, B, C, D
uint8_t clockPin = 2;
uint8_t latchPin = 47;
uint8_t oePin    = 14;

// Matrix initialization: 192x32 display (3x 64x32 panels)
Adafruit_Protomatter matrix(
    MATRIX_WIDTH,  // Full width (192 pixels)
    3,             // Bit depth (4 = 16 brightness levels)
    1,             // 1 tile (treat all 3 panels as one continuous display)
    rgbPins,
    4,             // 4 address pins
    addrPins,
    clockPin,
    latchPin,
    oePin,
    false
);

/* ==============================================================================
 * GLOBAL STATE
 * ============================================================================== */

enum DisplayMode {
    MODE_PATTERN = 0,
    MODE_IMAGE = 1,
    MODE_VIDEO = 2
};

uint8_t currentPattern = 0;  // 0=black, 1=rainbow, 2=bars, 3=solid
DisplayMode displayMode = MODE_PATTERN;
uint16_t animationFrame = 0;

// Double buffering for smooth video - use PSRAM on ESP32-S3
uint16_t* frameBuffer[2] = {nullptr, nullptr};  // Two buffers for ping-pong
uint8_t displayBuffer = 0;  // Which buffer is currently being displayed
uint8_t writeBuffer = 1;    // Which buffer we're writing to
uint16_t* imageBuffer = nullptr;  // Pointer to current buffer (for compatibility)
bool imageLoaded = false;

// Reception state
int imageReceiveIndex = 0;
bool receivingImage = false;
bool receivingFrame = false;
uint32_t lastDataTime = 0;
const uint32_t RECEIVE_TIMEOUT = 5000;  // 5 second timeout

// Video playback
uint32_t lastFrameTime = 0;
uint16_t videoFrameRate = 30;  // Default 30 FPS

// Heartbeat
uint32_t lastHeartbeat = 0;
const uint32_t HEARTBEAT_INTERVAL = 1000;

/* ==============================================================================
 * MEMORY MANAGEMENT
 * ============================================================================== */

bool allocateImageBuffer() {
    // Check if already allocated
    if (frameBuffer[0] != nullptr && frameBuffer[1] != nullptr) {
        return true;
    }

    // Try to allocate both buffers in PSRAM first (ESP32-S3 has PSRAM)
    frameBuffer[0] = (uint16_t*)ps_malloc(FRAME_SIZE);
    frameBuffer[1] = (uint16_t*)ps_malloc(FRAME_SIZE);

    if (frameBuffer[0] == nullptr || frameBuffer[1] == nullptr) {
        // If PSRAM fails, try regular RAM
        if (frameBuffer[0] == nullptr) {
            frameBuffer[0] = (uint16_t*)malloc(FRAME_SIZE);
        }
        if (frameBuffer[1] == nullptr) {
            frameBuffer[1] = (uint16_t*)malloc(FRAME_SIZE);
        }
    }

    // Check if allocation succeeded
    if (frameBuffer[0] == nullptr || frameBuffer[1] == nullptr) {
        Serial.println("ERROR: Failed to allocate double buffers!");

        // Clean up partial allocation
        if (frameBuffer[0] != nullptr) {
            free(frameBuffer[0]);
            frameBuffer[0] = nullptr;
        }
        if (frameBuffer[1] != nullptr) {
            free(frameBuffer[1]);
            frameBuffer[1] = nullptr;
        }

        return false;
    }

    // Clear both buffers
    memset(frameBuffer[0], 0, FRAME_SIZE);
    memset(frameBuffer[1], 0, FRAME_SIZE);

    // Set up initial pointers
    displayBuffer = 0;
    writeBuffer = 1;
    imageBuffer = frameBuffer[displayBuffer];

    Serial.println("Double buffering enabled");

    return true;
}

void freeImageBuffer() {
    if (frameBuffer[0] != nullptr) {
        free(frameBuffer[0]);
        frameBuffer[0] = nullptr;
    }
    if (frameBuffer[1] != nullptr) {
        free(frameBuffer[1]);
        frameBuffer[1] = nullptr;
    }
    imageBuffer = nullptr;
    imageLoaded = false;
}

/* ==============================================================================
 * COLOR UTILITIES
 * ============================================================================== */

// Convert HSV to RGB565
uint16_t HSVtoRGB565(uint16_t h, uint8_t s, uint8_t v) {
    uint8_t r, g, b;

    if (s == 0) {
        r = g = b = v;
    } else {
        uint16_t region = h / 43;
        uint16_t remainder = (h - (region * 43)) * 6;

        uint8_t p = (v * (255 - s)) >> 8;
        uint8_t q = (v * (255 - ((s * remainder) >> 8))) >> 8;
        uint8_t t = (v * (255 - ((s * (255 - remainder)) >> 8))) >> 8;

        switch (region) {
            case 0:  r = v; g = t; b = p; break;
            case 1:  r = q; g = v; b = p; break;
            case 2:  r = p; g = v; b = t; break;
            case 3:  r = p; g = q; b = v; break;
            case 4:  r = t; g = p; b = v; break;
            default: r = v; g = p; b = q; break;
        }
    }

    // Convert to RGB565
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

/* ==============================================================================
 * TEST PATTERNS
 * ============================================================================== */

void pattern_blackout() {
    matrix.fillScreen(0);
}

void pattern_rainbow() {
    for (int y = 0; y < MATRIX_HEIGHT; y++) {
        for (int x = 0; x < MATRIX_WIDTH; x++) {
            // Create horizontal rainbow gradient that animates
            uint16_t hue = ((x * 256 / MATRIX_WIDTH) + animationFrame) % 256;
            uint16_t color = HSVtoRGB565(hue, 255, 255);
            matrix.drawPixel(x, y, color);
        }
    }
    animationFrame = (animationFrame + 1) % 256;
}

void pattern_movingBars() {
    matrix.fillScreen(0);

    // 3 colored bars moving down
    int barWidth = 8;
    int spacing = MATRIX_HEIGHT / 3;

    uint16_t colors[3] = {
        0xF800,  // Red
        0x07E0,  // Green
        0x001F   // Blue
    };

    for (int i = 0; i < 3; i++) {
        int barY = (animationFrame + (i * spacing)) % MATRIX_HEIGHT;
        for (int x = 0; x < MATRIX_WIDTH; x++) {
            for (int b = 0; b < barWidth; b++) {
                int y = (barY + b) % MATRIX_HEIGHT;
                matrix.drawPixel(x, y, colors[i]);
            }
        }
    }

    animationFrame = (animationFrame + 1) % MATRIX_HEIGHT;
}

void pattern_solidColors() {
    // Divide screen into 4 quadrants with different colors
    int midX = MATRIX_WIDTH / 2;
    int midY = MATRIX_HEIGHT / 2;

    // Top-left: Red
    matrix.fillRect(0, 0, midX, midY, 0xF800);
    // Top-right: Green
    matrix.fillRect(midX, 0, midX, midY, 0x07E0);
    // Bottom-left: Blue
    matrix.fillRect(0, midY, midX, midY, 0x001F);
    // Bottom-right: White
    matrix.fillRect(midX, midY, midX, midY, 0xFFFF);
}

void displayImage() {
    if (imageLoaded && imageBuffer != nullptr) {
        matrix.drawRGBBitmap(0, 0, imageBuffer, MATRIX_WIDTH, MATRIX_HEIGHT);
    } else {
        // No image loaded
        matrix.fillScreen(0);
        matrix.setCursor(4, 12);
        matrix.setTextColor(0x7BEF);  // Light gray
        matrix.setTextSize(1);
        matrix.print("No image loaded");
    }
}

/* ==============================================================================
 * IMAGE/VIDEO RECEPTION - DOUBLE BUFFERED
 * ============================================================================== */

void handleDataReception() {
    // Check for timeout
    if ((receivingImage || receivingFrame) &&
        (millis() - lastDataTime > RECEIVE_TIMEOUT)) {
        Serial.println("ERROR: Reception timeout!");
        receivingImage = false;
        receivingFrame = false;
        imageReceiveIndex = 0;
        return;
    }

    // Read as much data as possible in one loop iteration (up to 512 bytes)
    int bytesRead = 0;
    while (Serial.available() > 0 && (receivingImage || receivingFrame) && bytesRead < 512) {
        if (imageReceiveIndex < FRAME_SIZE) {
            // Read byte
            uint8_t byte = Serial.read();
            lastDataTime = millis();
            bytesRead++;

            // Write to the WRITE buffer (not the display buffer)
            ((uint8_t*)frameBuffer[writeBuffer])[imageReceiveIndex] = byte;
            imageReceiveIndex++;

            // Check if frame complete
            if (imageReceiveIndex >= FRAME_SIZE) {
                if (receivingImage) {
                    // Static image mode - use write buffer as display buffer
                    receivingImage = false;
                    displayBuffer = writeBuffer;
                    imageBuffer = frameBuffer[displayBuffer];
                    imageLoaded = true;
                    displayMode = MODE_IMAGE;
                    Serial.println("OK:IMAGE_RECEIVED");
                } else if (receivingFrame) {
                    // Video frame mode - swap buffers for smooth playback
                    receivingFrame = false;
                    imageReceiveIndex = 0;

                    // ATOMIC BUFFER SWAP - this is the key to smooth video!
                    uint8_t temp = displayBuffer;
                    displayBuffer = writeBuffer;
                    writeBuffer = temp;
                    imageBuffer = frameBuffer[displayBuffer];

                    imageLoaded = true;

                    // Signal ready for next frame immediately
                    // Display happens in loop() while we receive next frame
                    Serial.write('R');
                }
                break;
            }
        }
    }
}

/* ==============================================================================
 * SERIAL COMMAND HANDLING
 * ============================================================================== */

void handleSerialCommand() {
    if (!receivingImage && !receivingFrame && Serial.available() > 0) {
        char cmd = Serial.read();

        switch (cmd) {
            case '0':
                displayMode = MODE_PATTERN;
                currentPattern = 0;
                Serial.println("OK:PATTERN_BLACKOUT");
                break;

            case '1':
                displayMode = MODE_PATTERN;
                currentPattern = 1;
                animationFrame = 0;
                Serial.println("OK:PATTERN_RAINBOW");
                break;

            case '2':
                displayMode = MODE_PATTERN;
                currentPattern = 2;
                animationFrame = 0;
                Serial.println("OK:PATTERN_BARS");
                break;

            case '3':
                displayMode = MODE_PATTERN;
                currentPattern = 3;
                Serial.println("OK:PATTERN_SOLID");
                break;

            case 'C':
            case 'c':
                // Clear display and free memory
                matrix.fillScreen(0);
                matrix.show();
                freeImageBuffer();
                displayMode = MODE_PATTERN;
                currentPattern = 0;
                imageLoaded = false;
                Serial.println("OK:CLEARED");
                break;

            case 'I':
            case 'i':
                // Start image reception
                if (!allocateImageBuffer()) {
                    Serial.println("ERROR:NO_MEMORY");
                    break;
                }
                receivingImage = true;
                receivingFrame = false;
                imageReceiveIndex = 0;
                lastDataTime = millis();
                Serial.println("OK:READY_FOR_IMAGE");
                break;

            case 'V':
            case 'v':
                // Start video mode
                if (!allocateImageBuffer()) {
                    Serial.println("ERROR:NO_MEMORY");
                    break;
                }
                displayMode = MODE_VIDEO;
                imageLoaded = false;
                Serial.println("OK:VIDEO_MODE");
                break;

            case 'F':
            case 'f':
                // Receive single frame in video mode
                if (displayMode != MODE_VIDEO || imageBuffer == nullptr) {
                    Serial.println("ERROR:NOT_IN_VIDEO_MODE");
                    break;
                }
                receivingFrame = true;
                receivingImage = false;
                imageReceiveIndex = 0;
                lastDataTime = millis();
                Serial.println("OK:READY_FOR_FRAME");
                break;

            case 'S':
            case 's':
                // Stop video mode
                displayMode = MODE_PATTERN;
                currentPattern = 0;
                Serial.println("OK:VIDEO_STOPPED");
                break;

            case 'P':
            case 'p':
                // Ping - connectivity check
                Serial.println("OK:PONG");
                break;

            default:
                // Ignore unknown commands
                break;
        }
    }
}

/* ==============================================================================
 * DISPLAY UPDATE
 * ============================================================================== */

void updateDisplay() {
    switch (displayMode) {
        case MODE_PATTERN:
            switch (currentPattern) {
                case 0:
                    pattern_blackout();
                    break;
                case 1:
                    pattern_rainbow();
                    break;
                case 2:
                    pattern_movingBars();
                    break;
                case 3:
                    pattern_solidColors();
                    break;
            }
            break;

        case MODE_IMAGE:
            displayImage();
            break;

        case MODE_VIDEO:
            if (imageLoaded && imageBuffer != nullptr) {
                matrix.drawRGBBitmap(0, 0, imageBuffer, MATRIX_WIDTH, MATRIX_HEIGHT);
            } else {
                matrix.fillScreen(0);
            }
            break;
    }

    matrix.show();
}

/* ==============================================================================
 * SETUP & LOOP
 * ============================================================================== */

void setup() {
    Serial.begin(921600);
    Serial.setRxBufferSize(SERIAL_BUFFER_SIZE);
    delay(500);

    Serial.println("\n========================================");
    Serial.println("LED Matrix Display Controller");
    Serial.println("Matrix Portal S3 - ESP32-S3");
    Serial.println("========================================");
    Serial.print("Matrix: ");
    Serial.print(MATRIX_WIDTH);
    Serial.print("x");
    Serial.print(MATRIX_HEIGHT);
    Serial.println(" pixels");
    Serial.print("Frame size: ");
    Serial.print(FRAME_SIZE);
    Serial.println(" bytes");

    // Check PSRAM
    if (psramFound()) {
        Serial.print("PSRAM: ");
        Serial.print(ESP.getPsramSize() / 1024);
        Serial.println(" KB");
    } else {
        Serial.println("WARNING: No PSRAM detected");
    }

    Serial.println("\nCommands:");
    Serial.println("  0 = Blackout");
    Serial.println("  1 = Rainbow (animated)");
    Serial.println("  2 = Moving Bars");
    Serial.println("  3 = Solid Colors");
    Serial.println("  I = Upload Image");
    Serial.println("  C = Clear Display");
    Serial.println("  V = Start Video Mode");
    Serial.println("  F = Send Frame");
    Serial.println("  S = Stop Video");
    Serial.println("  P = Ping");
    Serial.println("========================================\n");

    // Initialize matrix
    Serial.print("Initializing matrix... ");
    ProtomatterStatus status = matrix.begin();

    if (status != PROTOMATTER_OK) {
        Serial.print("FAILED! Status: ");
        Serial.println(status);
        while (1) delay(1000);
    }

    Serial.println("OK!");

    // Start with blackout
    matrix.fillScreen(0);
    matrix.show();

    Serial.println("OK:READY\n");
}

void loop() {
    // PRIORITY 1: Handle data reception (fast, non-blocking)
    if (receivingImage || receivingFrame) {
        handleDataReception();
    } else {
        // Handle commands when not receiving
        handleSerialCommand();
    }

    // PRIORITY 2: Update display
    // In video mode, always display from the current display buffer
    // The write buffer is being filled with the next frame concurrently
    if (displayMode == MODE_VIDEO && imageLoaded) {
        // Display the complete frame from display buffer
        matrix.drawRGBBitmap(0, 0, frameBuffer[displayBuffer], MATRIX_WIDTH, MATRIX_HEIGHT);
        matrix.show();
        // No delay - continue receiving next frame
    } else {
        // Normal display updates for patterns/images
        updateDisplay();

        // Control animation speed for non-video modes
        if (displayMode == MODE_PATTERN && (currentPattern == 1 || currentPattern == 2)) {
            delay(33);  // ~30 FPS for animations
        } else if (displayMode != MODE_VIDEO) {
            delay(50);  // Slower for static content
        }
    }
}