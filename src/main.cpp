/**
 * @file main.cpp
 * @brief USB Streaming LED Matrix Controller with WiFi Fallback
 *
 * Dual-mode operation:
 * - USB MODE (default): Receives raw RGB565 pixel data via Serial
 * - WiFi MODE: Web interface for remote control
 *
 * Button Controls:
 * - BUTTON_UP (hold): Switch to WiFi mode
 * - BUTTON_DOWN (hold): Switch to USB mode
 *
 * @author [Daan Gijzen & Claude]
 * @date 2026
 */

#include <Arduino.h>
#include <Adafruit_Protomatter.h>

// Conditionally include WiFi if enabled
#ifdef WIFI_ENABLED
#include <WiFiNINA.h>
#include <WiFiUdp.h>
#include "secrets.h"
#endif

/* ==============================================================================
 * CONFIGURATION CONSTANTS
 * ============================================================================== */

// Matrix dimensions
#define MATRIX_WIDTH  192
#define MATRIX_HEIGHT 32
#define FRAME_SIZE (MATRIX_WIDTH * MATRIX_HEIGHT * 2)  // RGB565 = 2 bytes per pixel

// Hardware pin definitions for buttons
#define BUTTON_UP   2
#define BUTTON_DOWN 3

// Button timing
#define BUTTON_HOLD_TIME 1000  // ms to hold button for mode switch
#define BUTTON_DEBOUNCE  50    // ms debounce delay

// Serial settings
#define SERIAL_BAUD 2000000    // 2Mbps for fastest USB streaming
#define CHUNK_SIZE 512         // Read in chunks to avoid buffer overflow

/* ==============================================================================
 * OPERATING MODES
 * ============================================================================== */

enum OperatingMode {
    MODE_USB,    // Stream from USB Serial
    MODE_WIFI    // WiFi web control
};

OperatingMode currentMode = MODE_USB;  // Start in USB mode
bool modeJustChanged = false;

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
 * FRAME BUFFER
 * ============================================================================== */

uint16_t frameBuffer[MATRIX_WIDTH * MATRIX_HEIGHT];
static int bytesReceived = 0;

/* ==============================================================================
 * BUTTON STATE TRACKING
 * ============================================================================== */

unsigned long buttonUpPressTime = 0;
unsigned long buttonDownPressTime = 0;
bool buttonUpPressed = false;
bool buttonDownPressed = false;

/* ==============================================================================
 * DISPLAY FUNCTIONS
 * ============================================================================== */

/**
 * @brief Displays mode indicator on matrix
 */
void displayModeIndicator() {
    matrix.fillScreen(0);
    matrix.setTextSize(3);
    matrix.setTextColor(currentMode == MODE_USB ? 0x07E0 : 0x001F);  // Green for USB, Blue for WiFi
    matrix.setCursor(10, 8);

    if (currentMode == MODE_USB) {
        matrix.print("USB MODE");
    } else {
        matrix.print("WiFi MODE");
    }

    matrix.show();
}

/**
 * @brief Displays IP address in WiFi mode
 */
void displayIPAddress(uint8_t ip1, uint8_t ip2, uint8_t ip3, uint8_t ip4) {
    matrix.fillScreen(0);
    matrix.setTextSize(2);
    matrix.setTextColor(0xFFFF);  // White
    matrix.setCursor(5, 4);
    matrix.print("IP:");
    matrix.setCursor(5, 20);
    matrix.print(ip1);
    matrix.print(".");
    matrix.print(ip2);
    matrix.print(".");
    matrix.print(ip3);
    matrix.print(".");
    matrix.print(ip4);
    matrix.show();
}

/**
 * @brief Shows "Waiting..." message
 */
void displayWaiting() {
    matrix.fillScreen(0);
    matrix.setTextSize(3);
    matrix.setTextColor(0xF81F);  // Magenta
    matrix.setCursor(10, 8);
    matrix.print("WAITING...");
    matrix.show();
}

/* ==============================================================================
 * BUTTON HANDLING
 * ============================================================================== */

/**
 * @brief Checks button states and handles mode switching
 */
void handleButtons() {
    unsigned long now = millis();

    // Read button states (LOW = pressed with INPUT_PULLUP)
    bool upNow = (digitalRead(BUTTON_UP) == LOW);
    bool downNow = (digitalRead(BUTTON_DOWN) == LOW);

    // BUTTON UP - Switch to WiFi mode
    if (upNow && !buttonUpPressed) {
        buttonUpPressed = true;
        buttonUpPressTime = now;
    } else if (!upNow && buttonUpPressed) {
        buttonUpPressed = false;
    } else if (upNow && buttonUpPressed) {
        if (now - buttonUpPressTime >= BUTTON_HOLD_TIME && currentMode != MODE_WIFI) {
            #ifdef WIFI_ENABLED
            Serial.println("=== Switching to WiFi MODE ===");
            currentMode = MODE_WIFI;
            modeJustChanged = true;
            buttonUpPressed = false;
            #else
            Serial.println("WiFi mode not enabled! Compile with -DWIFI_ENABLED");
            #endif
        }
    }

    // BUTTON DOWN - Switch to USB mode
    if (downNow && !buttonDownPressed) {
        buttonDownPressed = true;
        buttonDownPressTime = now;
    } else if (!downNow && buttonDownPressed) {
        buttonDownPressed = false;
    } else if (downNow && buttonDownPressed) {
        if (now - buttonDownPressTime >= BUTTON_HOLD_TIME && currentMode != MODE_USB) {
            Serial.println("=== Switching to USB MODE ===");
            currentMode = MODE_USB;
            modeJustChanged = true;
            buttonDownPressed = false;
        }
    }
}

/* ==============================================================================
 * USB STREAMING MODE
 * ============================================================================== */


void handleUSBStreaming() {
    // Read available data in chunks
    while (Serial.available() > 0 && bytesReceived < FRAME_SIZE) {
        int toRead = min(Serial.available(), FRAME_SIZE - bytesReceived);
        toRead = min(toRead, CHUNK_SIZE);

        Serial.readBytes((char*)frameBuffer + bytesReceived, toRead);
        bytesReceived += toRead;
    }

    // If we have a complete frame, display it
    if (bytesReceived >= FRAME_SIZE) {
        // Display frame directly without brightness limiting
        matrix.drawRGBBitmap(0, 0, frameBuffer, MATRIX_WIDTH, MATRIX_HEIGHT);
        matrix.show();

        // Reset for next frame
        bytesReceived = 0;

        // Clear any excess data
        while (Serial.available() > 0) {
            Serial.read();
        }
    }
}

/* ==============================================================================
 * WiFi MODE (only compiled if WIFI_ENABLED is defined)
 * ============================================================================== */

#ifdef WIFI_ENABLED

WiFiUDP udp;
WiFiServer server(80);
bool wifiConnected = false;
bool udpStarted = false;

/**
 * @brief Connects to WiFi network
 */
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        return;
    }

    Serial.print("Connecting to WiFi: ");
    Serial.println(SECRET_SSID);

    WiFi.disconnect();
    delay(100);
    WiFi.begin(SECRET_SSID, SECRET_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        IPAddress ip = WiFi.localIP();
        Serial.print("Connected! IP: ");
        Serial.println(ip);

        displayIPAddress(ip[0], ip[1], ip[2], ip[3]);

        server.begin();
        udp.begin(8888);
        udpStarted = true;

        delay(3000);
    } else {
        Serial.println("WiFi connection failed!");
        wifiConnected = false;
    }
}

/**
 * @brief Handles WiFi UDP streaming
 */
void handleWiFiStreaming() {
    if (!wifiConnected || !udpStarted) return;

    int packetSize = udp.parsePacket();
    if (packetSize == FRAME_SIZE) {
        udp.read((char*)frameBuffer, FRAME_SIZE);
        matrix.drawRGBBitmap(0, 0, frameBuffer, MATRIX_WIDTH, MATRIX_HEIGHT);
        matrix.show();
    }
}

/**
 * @brief Simple web server for status
 */
void handleWebServer() {
    if (!wifiConnected) return;

    WiFiClient client = server.available();
    if (!client) return;

    String request = "";
    while (client.connected()) {
        if (client.available()) {
            char c = client.read();
            request += c;

            if (c == '\n' && request.endsWith("\r\n\r\n")) {
                IPAddress ip = WiFi.localIP();

                client.println("HTTP/1.1 200 OK");
                client.println("Content-Type: text/html");
                client.println("Connection: close");
                client.println();

                client.println("<!DOCTYPE html><html><head>");
                client.println("<title>LED Matrix - WiFi Mode</title>");
                client.println("<style>body{font-family:Arial;background:#1a1a2e;color:#fff;text-align:center;padding:50px;}</style>");
                client.println("</head><body>");
                client.println("<h1>LED Matrix Controller</h1>");
                client.println("<h2>WiFi Mode Active</h2>");
                client.println("<p>Send UDP frames to port 8888</p>");
                client.println("<p>Frame size: 12,288 bytes (RGB565)</p>");
                client.print("<p>IP: ");
                client.print(ip);
                client.println("</p>");
                client.println("<p><small>Hold DOWN button to switch to USB mode</small></p>");
                client.println("</body></html>");
                break;
            }
        }
    }

    client.stop();
}

#endif  // WIFI_ENABLED

/* ==============================================================================
 * SETUP FUNCTION
 * ============================================================================== */

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(100);

    Serial.println("\n\n===========================================");
    Serial.println("LED Matrix USB Streaming Controller");
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

    #ifdef WIFI_ENABLED
    Serial.println("WiFi: ENABLED");
    #else
    Serial.println("WiFi: DISABLED");
    #endif

    Serial.println("===========================================\n");

    ProtomatterStatus status = matrix.begin();
    if (status != PROTOMATTER_OK) {
        Serial.println("ERROR: Matrix initialization failed!");
        while (true) {
            delay(1000);
        }
    }

    Serial.println("Matrix initialized successfully!");

    pinMode(BUTTON_UP, INPUT_PULLUP);
    pinMode(BUTTON_DOWN, INPUT_PULLUP);

    memset(frameBuffer, 0, FRAME_SIZE);

    displayModeIndicator();
    delay(2000);

    Serial.println("\n=== USB MODE ACTIVE ===");
    Serial.println("Waiting for frame data...");
    Serial.println("Commands:");
    Serial.println("  - Send 12,288 bytes of RGB565 data for full frame");
    #ifdef WIFI_ENABLED
    Serial.println("  - Hold UP button: Switch to WiFi mode");
    Serial.println("  - Hold DOWN button: Return to USB mode");
    #endif
    Serial.println();

    displayWaiting();
}

/* ==============================================================================
 * MAIN LOOP
 * ============================================================================== */

void loop() {
    handleButtons();

    if (modeJustChanged) {
        modeJustChanged = false;
        displayModeIndicator();
        delay(2000);

        #ifdef WIFI_ENABLED
        if (currentMode == MODE_WIFI) {
            connectWiFi();
        } else {
            displayWaiting();
            Serial.println("Ready for USB streaming...");
            bytesReceived = 0;  // Reset receive counter
        }
        #else
        displayWaiting();
        #endif
    }

    if (currentMode == MODE_USB) {
        handleUSBStreaming();
    }
    #ifdef WIFI_ENABLED
    else if (currentMode == MODE_WIFI) {
        handleWiFiStreaming();
        handleWebServer();
    }
    #endif
}