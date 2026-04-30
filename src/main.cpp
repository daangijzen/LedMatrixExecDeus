/**
 * @file main.cpp
 * @brief USB Streaming LED Matrix Controller with Frame Buffering
 *
 * Triple-buffered streaming with timer-based display for smooth playback
 *
 * @author [Daan Gijzen & Claude]
 * @date 2026
 */

#include <Arduino.h>
#include <Adafruit_Protomatter.h>

/* ==============================================================================
 * CONFIGURATION CONSTANTS
 * ============================================================================== */

// Matrix dimensions
#define MATRIX_WIDTH  192
#define MATRIX_HEIGHT 32
#define FRAME_SIZE (MATRIX_WIDTH * MATRIX_HEIGHT * 2)  // RGB565 = 2 bytes per pixel

// Serial settings
#define SERIAL_BAUD 3000000    // 3Mbps for fastest USB streaming
#define CHUNK_SIZE 2048        // Larger chunks for better throughput

// Frame buffer settings
#define NUM_BUFFERS 3          // Triple buffering for smooth playback
#define TARGET_FPS 24          // Fixed display rate (adjustable via serial command)

/* ==============================================================================
 * HARDWARE CONFIGURATION
 * ============================================================================== */

// RGB data pins for the LED matrix
uint8_t rgbPins[]  = {7, 8, 9, 10, 11, 12};

// Address pins (for row selection)
uint8_t addrPins[] = {17, 18, 19, 20};

// Control pins
uint8_t clockPin = 14;
uint8_t latchPin = 15;
uint8_t oePin    = 16;

// Matrix object initialization
Adafruit_Protomatter matrix(
    MATRIX_WIDTH, 1, 1, rgbPins, sizeof(addrPins), addrPins,
    clockPin, latchPin, oePin, false
);

/* ==============================================================================
 * FRAME BUFFER RING QUEUE
 * ============================================================================== */

// Triple buffer: one receiving, one ready, one displaying
uint16_t frameBuffers[NUM_BUFFERS][MATRIX_WIDTH * MATRIX_HEIGHT];

volatile int writeBuffer = 0;      // Buffer currently being written to
volatile int readBuffer = -1;      // Buffer ready to display (-1 = none)
volatile int displayBuffer = -1;   // Buffer currently on screen

static int bytesReceived = 0;
volatile bool newFrameReady = false;

/* ==============================================================================
 * TIMING & STATS
 * ============================================================================== */

volatile unsigned long lastDisplayTime = 0;
volatile unsigned long frameCount = 0;
volatile unsigned long droppedFrames = 0;
unsigned long statsTimer = 0;

/* ==============================================================================
 * DISPLAY TIMER (Software-based for Arduino compatibility)
 * ============================================================================== */

unsigned long displayInterval = 1000 / TARGET_FPS;  // ms between frames

/**
 * @brief Updates display at fixed rate if new frame is available
 */
void updateDisplay() {
    unsigned long now = millis();

    if (now - lastDisplayTime >= displayInterval) {
        if (readBuffer >= 0) {
            // New frame available - display it
            displayBuffer = readBuffer;
            matrix.drawRGBBitmap(0, 0, frameBuffers[displayBuffer], MATRIX_WIDTH, MATRIX_HEIGHT);
            matrix.show();

            readBuffer = -1;  // Mark as consumed
            frameCount++;
            lastDisplayTime = now;
        }
        // If no frame ready, just skip (will repeat previous frame naturally)
    }
}

/* ==============================================================================
 * USB STREAMING WITH BUFFERING
 * ============================================================================== */

void handleUSBStreaming() {
    // Read available data in chunks
    while (Serial.available() > 0 && bytesReceived < FRAME_SIZE) {
        int toRead = min(Serial.available(), FRAME_SIZE - bytesReceived);
        toRead = min(toRead, CHUNK_SIZE);

        Serial.readBytes((char*)frameBuffers[writeBuffer] + bytesReceived, toRead);
        bytesReceived += toRead;
    }

    // If we have a complete frame
    if (bytesReceived >= FRAME_SIZE) {
        // Check if we're overrunning (display can't keep up)
        if (readBuffer >= 0) {
            droppedFrames++;  // Previous frame not displayed yet
        }

        // Promote current write buffer to ready
        readBuffer = writeBuffer;

        // Move to next write buffer (ring buffer)
        writeBuffer = (writeBuffer + 1) % NUM_BUFFERS;

        // Skip display buffer if it's still in use
        if (writeBuffer == displayBuffer) {
            writeBuffer = (writeBuffer + 1) % NUM_BUFFERS;
        }

        // Reset for next frame
        bytesReceived = 0;

        // Clear any excess data to stay synchronized
        while (Serial.available() > 0) {
            Serial.read();
        }
    }
}

/* ==============================================================================
 * STATISTICS & MONITORING
 * ============================================================================== */

void printStats() {
    unsigned long now = millis();
    if (now - statsTimer >= 5000) {  // Every 5 seconds
        float actualFPS = frameCount / 5.0;

        Serial.print("? Stats | FPS: ");
        Serial.print(actualFPS, 1);
        Serial.print(" | Dropped: ");
        Serial.print(droppedFrames);
        Serial.print(" | Buffers: W=");
        Serial.print(writeBuffer);
        Serial.print(" R=");
        Serial.print(readBuffer);
        Serial.print(" D=");
        Serial.println(displayBuffer);

        frameCount = 0;
        droppedFrames = 0;
        statsTimer = now;
    }
}

/* ==============================================================================
 * SETUP FUNCTION
 * ============================================================================== */

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(100);

    Serial.println("\n===========================================");
    Serial.println("LED Matrix USB Streaming Controller");
    Serial.println("Triple-Buffered with Fixed Display Rate");
    Serial.println("===========================================");
    Serial.print("Matrix: ");
    Serial.print(MATRIX_WIDTH);
    Serial.print("x");
    Serial.println(MATRIX_HEIGHT);
    Serial.print("Frame size: ");
    Serial.print(FRAME_SIZE);
    Serial.println(" bytes");
    Serial.print("Serial baud: ");
    Serial.println(SERIAL_BAUD);
    Serial.print("Buffers: ");
    Serial.println(NUM_BUFFERS);
    Serial.print("Target FPS: ");
    Serial.println(TARGET_FPS);
    Serial.print("SRAM per buffer: ");
    Serial.print(FRAME_SIZE);
    Serial.print(" bytes (Total: ");
    Serial.print(FRAME_SIZE * NUM_BUFFERS);
    Serial.println(" bytes)");
    Serial.println("===========================================\n");

    ProtomatterStatus status = matrix.begin();
    if (status != PROTOMATTER_OK) {
        Serial.println("ERROR: Matrix initialization failed!");
        while (true) {
            delay(1000);
        }
    }

    Serial.println("? Matrix initialized successfully!");

    // Clear all frame buffers
    for (int i = 0; i < NUM_BUFFERS; i++) {
        memset(frameBuffers[i], 0, FRAME_SIZE);
    }

    matrix.fillScreen(0);
    matrix.show();

    lastDisplayTime = millis();
    statsTimer = millis();

    Serial.println("? Ready for USB streaming...");
    Serial.println("? Stats will be printed every 5 seconds\n");
}

/* ==============================================================================
 * MAIN LOOP
 * ============================================================================== */

void loop() {
    // Handle incoming USB data
    handleUSBStreaming();

    // Update display at fixed rate
    updateDisplay();

    // Print statistics
    printStats();
}