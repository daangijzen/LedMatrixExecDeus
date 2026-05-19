/**
 * @file main.cpp
 * @brief LED Matrix Video Player - Streamlined
 * Matrix Portal S3 (ESP32-S3) - USB Serial Control
 *
 * Commands:
 * 'T' = Test pattern
 * 'C' = Clear display
 * 'V' = Start video mode
 * 'F' = Full frame (followed by RGB565 data)
 * 'S' = Stop video mode
 */

#include <Arduino.h>
#include <Adafruit_Protomatter.h>

/* ==============================================================================
 * CONFIGURATION
 * ============================================================================== */

#define MATRIX_WIDTH  192
#define MATRIX_HEIGHT 32
#define FRAME_SIZE (MATRIX_WIDTH * MATRIX_HEIGHT * 2)  // RGB565 = 2 bytes per pixel

// Matrix Portal S3 Pin Configuration
uint8_t rgbPins[]  = {42, 41, 40, 38, 39, 37};
uint8_t addrPins[] = {45, 36, 48, 35};
uint8_t clockPin = 2;
uint8_t latchPin = 47;
uint8_t oePin    = 14;

Adafruit_Protomatter matrix(
    MATRIX_WIDTH,
    2,             // Bit depth
    1,             // 1 tile
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

// Double buffering in PSRAM
uint16_t* frameBuffer[2] = {nullptr, nullptr};
uint8_t displayBuffer = 0;
uint8_t writeBuffer = 1;

bool videoMode = false;
bool receivingFrame = false;
int frameReceiveIndex = 0;
uint32_t lastDataTime = 0;

const uint32_t RECEIVE_TIMEOUT = 3000;

/* ==============================================================================
 * BUFFER MANAGEMENT
 * ============================================================================== */

bool allocateBuffers() {
    if (frameBuffer[0] && frameBuffer[1]) return true;

    frameBuffer[0] = (uint16_t*)ps_malloc(FRAME_SIZE);
    frameBuffer[1] = (uint16_t*)ps_malloc(FRAME_SIZE);

    if (!frameBuffer[0] || !frameBuffer[1]) {
        Serial.println("ERROR:NO_MEMORY");
        if (frameBuffer[0]) free(frameBuffer[0]);
        if (frameBuffer[1]) free(frameBuffer[1]);
        frameBuffer[0] = frameBuffer[1] = nullptr;
        return false;
    }

    memset(frameBuffer[0], 0, FRAME_SIZE);
    memset(frameBuffer[1], 0, FRAME_SIZE);
    return true;
}

void freeBuffers() {
    if (frameBuffer[0]) { free(frameBuffer[0]); frameBuffer[0] = nullptr; }
    if (frameBuffer[1]) { free(frameBuffer[1]); frameBuffer[1] = nullptr; }
}

/* ==============================================================================
 * TEST PATTERN
 * ============================================================================== */

void showTestPattern() {
    // Simple color bars
    int barWidth = MATRIX_WIDTH / 7;
    uint16_t colors[7] = {
        0xF800,  // Red
        0xFFE0,  // Yellow
        0x07E0,  // Green
        0x07FF,  // Cyan
        0x001F,  // Blue
        0xF81F,  // Magenta
        0xFFFF   // White
    };

    for (int x = 0; x < MATRIX_WIDTH; x++) {
        uint16_t color = colors[x / barWidth];
        for (int y = 0; y < MATRIX_HEIGHT; y++) {
            matrix.drawPixel(x, y, color);
        }
    }
    matrix.show();
}

/* ==============================================================================
 * FRAME RECEPTION
 * ============================================================================== */

void handleFrameData() {
    if (!receivingFrame) return;

    // Check timeout
    if (millis() - lastDataTime > RECEIVE_TIMEOUT) {
        Serial.println("ERROR:TIMEOUT");
        receivingFrame = false;
        frameReceiveIndex = 0;
        return;
    }

    // Read data in chunks
    while (Serial.available() > 0 && frameReceiveIndex < FRAME_SIZE) {
        ((uint8_t*)frameBuffer[writeBuffer])[frameReceiveIndex++] = Serial.read();
        lastDataTime = millis();

        if (frameReceiveIndex >= FRAME_SIZE) {
            // Frame complete - swap buffers
            receivingFrame = false;
            frameReceiveIndex = 0;

            uint8_t temp = displayBuffer;
            displayBuffer = writeBuffer;
            writeBuffer = temp;

            // Signal ready for next frame
            Serial.write('R');
            break;
        }
    }
}

/* ==============================================================================
 * COMMAND HANDLING
 * ============================================================================== */

void handleCommand() {
    if (receivingFrame || !Serial.available()) return;

    char cmd = Serial.read();

    switch (cmd) {
        case 'T':
        case 't':
            videoMode = false;
            showTestPattern();
            Serial.println("OK:TEST_PATTERN");
            break;

        case 'C':
        case 'c':
            videoMode = false;
            matrix.fillScreen(0);
            matrix.show();
            Serial.println("OK:CLEAR");
            break;

        case 'V':
        case 'v':
            if (!allocateBuffers()) break;
            videoMode = true;
            Serial.println("OK:VIDEO_MODE");
            break;

        case 'F':
        case 'f':
            if (!videoMode || !frameBuffer[writeBuffer]) {
                Serial.println("ERROR:NOT_IN_VIDEO_MODE");
                break;
            }
            receivingFrame = true;
            frameReceiveIndex = 0;
            lastDataTime = millis();
            break;

        case 'S':
        case 's':
            videoMode = false;
            receivingFrame = false;
            Serial.println("OK:STOPPED");
            break;
    }
}

/* ==============================================================================
 * SETUP & LOOP
 * ============================================================================== */

void setup() {
    Serial.begin(921600);
    Serial.setRxBufferSize(16384);
    delay(300);

    Serial.println("\nLED Matrix Video Player - Streamlined");
    Serial.print("Display: ");
    Serial.print(MATRIX_WIDTH);
    Serial.print("x");
    Serial.println(MATRIX_HEIGHT);

    if (psramFound()) {
        Serial.print("PSRAM: ");
        Serial.print(ESP.getPsramSize() / 1024);
        Serial.println(" KB");
    }

    if (matrix.begin() != PROTOMATTER_OK) {
        Serial.println("ERROR:MATRIX_INIT_FAILED");
        while (1) delay(1000);
    }

    matrix.fillScreen(0);
    matrix.show();

    Serial.println("OK:READY\n");
}

void loop() {
    // Priority 1: Handle incoming frame data
    if (receivingFrame) {
        handleFrameData();
    } else {
        handleCommand();
    }

    // Priority 2: Display current frame in video mode
    if (videoMode && frameBuffer[displayBuffer]) {
        matrix.drawRGBBitmap(0, 0, frameBuffer[displayBuffer], MATRIX_WIDTH, MATRIX_HEIGHT);
        matrix.show();
    }
}