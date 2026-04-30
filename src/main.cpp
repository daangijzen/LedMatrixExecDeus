/**
 * @file main.cpp
 * @brief LED Matrix Controller with WiFi, OSC and Web Interface
 *
 * This project controls a 192x32 LED matrix via a MatrixPortal M4.
 * Features:
 * - Scrolling text display
 * - Image upload via web interface (32x32 pixels)
 * - OSC protocol support for remote control
 * - Pixel art editor in the browser
 * - Physical buttons for color cycling
 *
 * @author [Daan Gijzen & Claude]
 * @date 2026
 */

#include <Arduino.h>
#include <Adafruit_Protomatter.h>
#include <WiFiNINA.h>
#include <WiFiUdp.h>
#include "secrets.h"

/* ==============================================================================
 * CONFIGURATION CONSTANTS
 * ============================================================================== */

// Matrix dimensions
#define MATRIX_WIDTH  192
#define MATRIX_HEIGHT 32

// Hardware pin definitions for buttons
#define BUTTON_UP   2
#define BUTTON_DOWN 3

// Image buffer size (32x32 = 1024 pixels)
#define IMAGE_BUFFER_SIZE 1024
#define MAX_IMAGE_WIDTH   32
#define MAX_IMAGE_HEIGHT  32

// Scroll settings
#define SCROLL_DELAY_MIN 10
#define SCROLL_DELAY_MAX 200
#define TEXT_SIZE_MIN    1
#define TEXT_SIZE_MAX    5

// WiFi settings
#define WIFI_CHECK_INTERVAL 5000  // ms between WiFi status checks
#define WIFI_CONNECT_TIMEOUT 30   // number of connection attempts

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
 * NETWORK OBJECTS
 * ============================================================================== */

WiFiUDP udp;                  // UDP for OSC communication
WiFiServer server(80);        // HTTP webserver on port 80
char packetBuffer[255];       // Buffer for incoming OSC packets
bool udpStarted = false;      // Flag indicating if UDP listener is active

/* ==============================================================================
 * IMAGE STORAGE
 * ============================================================================== */

uint16_t imageBuffer[IMAGE_BUFFER_SIZE];    // Static buffer for 32x32 image (RGB565)
int storedImageWidth        = 0;                  // Width of stored image
int storedImageHeight       = 0;                  // Height of stored image
bool hasStoredImage         = false;              // Flag indicating if an image is stored
int16_t imageX              = MATRIX_WIDTH;       // X position for scrolling image
bool imageScrollEnabled     = true;             // Image scroll on/off
bool imageRepeatEnabled     = true;             // NEW: Infinite repeat mode
int imageRepeatSpacing      = 5;                // NEW: Pixels between repeats
int8_t imageScrollDirection = -1;           // -1 Left, 1 Right

/* ==============================================================================
 * TEXT DISPLAY VARIABLES
 * ============================================================================== */

String scrollText           = "Verbinden met WiFi...";  // Current text to display
int16_t textX               = MATRIX_WIDTH;             // Current X position of text
int16_t textY               = 2;                       // Vertical position of text
int16_t textMinX            = 0;                                 // Minimum X (for scroll reset)
uint16_t textColor          = 0xF81F;                   // Text color (default: Magenta)
int textSize                = 4;                        // Text size (1-5)
bool scrollEnabled          = true;                     // Text scroll on/off
int alignment               = 0;                        // 0=scroll, 1=center, 2=right
bool textRepeatEnabled      = true;                   // NEW: Infinite repeat mode for text
int textRepeatSpacing       = 10;                      // NEW: Pixels between text repeats
int8_t textScrollDirection  = -1;                  // NEW: -1 = left, 1 = right

// Scroll timing
unsigned long lastScrollTime = 0;
int scrollDelay = 10;  // Delay between scroll steps (ms)

/* ==============================================================================
 * BUTTON CONTROL
 * ============================================================================== */

int currentClick = 0;    // Current color index (0-4)
bool useClick    = true; // Use buttons for color cycling

/* ==============================================================================
 * TIMING VARIABLES
 * ============================================================================== */

unsigned long lastWiFiCheck = 0;

/* ==============================================================================
 * OSC PARSER FUNCTIONS
 * ============================================================================== */

/**
 * @brief Parses a string argument from an OSC message
 *
 * OSC messages have a specific format:
 * - Address path (null-terminated, 4-byte aligned)
 * - Type tag string (e.g., ",s" for string)
 * - Arguments (4-byte aligned)
 *
 * @param buffer  Pointer to the OSC packet data
 * @param len     Length of the packet
 * @return String The parsed string argument, or empty string on error
 */
String parseOSCString(char* buffer, int len) {
    // Find end of address path
    int addressEnd = 0;
    while (addressEnd < len && buffer[addressEnd] != 0) {
        addressEnd++;
    }

    // Type tag starts at next 4-byte boundary
    int typeTagStart = ((addressEnd + 4) / 4) * 4;

    // Check if it's a string argument
    if (buffer[typeTagStart] == ',' && buffer[typeTagStart + 1] == 's') {
        // Find end of type tag
        int typeTagEnd = typeTagStart;
        while (typeTagEnd < len && buffer[typeTagEnd] != 0) {
            typeTagEnd++;
        }

        // String data starts at next 4-byte boundary
        int stringStart = ((typeTagEnd + 4) / 4) * 4;

        if (stringStart < len) {
            return String(buffer + stringStart);
        }
    }
    return "";
}

/**
 * @brief Parses an integer argument from an OSC message
 *
 * OSC integers are big-endian (network byte order).
 *
 * @param buffer  Pointer to the OSC packet data
 * @param len     Length of the packet
 * @return int32_t The parsed integer argument, or 0 on error
 */
int32_t parseOSCInt(char* buffer, int len) {
    // Find end of address path
    int addressEnd = 0;
    while (addressEnd < len && buffer[addressEnd] != 0) {
        addressEnd++;
    }

    // Type tag starts at next 4-byte boundary
    int typeTagStart = ((addressEnd + 4) / 4) * 4;

    // Check if it's an integer argument
    if (buffer[typeTagStart] == ',' && buffer[typeTagStart + 1] == 'i') {
        // Find end of type tag
        int typeTagEnd = typeTagStart;
        while (typeTagEnd < len && buffer[typeTagEnd] != 0) {
            typeTagEnd++;
        }

        // Integer data starts at next 4-byte boundary
        int intStart = ((typeTagEnd + 4) / 4) * 4;

        if (intStart + 3 < len) {
            // Convert from big-endian to native
            int32_t value = ((uint8_t)buffer[intStart] << 24) |
                            ((uint8_t)buffer[intStart + 1] << 16) |
                            ((uint8_t)buffer[intStart + 2] << 8) |
                            ((uint8_t)buffer[intStart + 3]);
            return value;
        }
    }
    return 0;
}

/* ==============================================================================
 * TEXT HELPER FUNCTIONS
 * ============================================================================== */

/**
 * @brief Recalculates text bounds and position based on alignment
 *
 * Called when text, size, or alignment changes.
 * Calculates textMinX for scroll reset and adjusts textX for alignment.
 */
void recalculateTextBounds() {
    int16_t x1, y1;
    uint16_t w, h;

    matrix.setTextSize(textSize);
    matrix.getTextBounds(scrollText.c_str(), 0, 0, &x1, &y1, &w, &h);
    textMinX = -w;

    // Adjust X position based on alignment
    switch (alignment) {
        case 1:  // Centered
            textX = (MATRIX_WIDTH - w) / 2;
            scrollEnabled = false;
            break;
        case 2:  // Right aligned
            textX = MATRIX_WIDTH - w;
            scrollEnabled = false;
            break;
        default: // Left / Scrolling
            textX = MATRIX_WIDTH;
            scrollEnabled = true;
            break;
    }
}

/* ==============================================================================
 * COLOR CYCLING FUNCTION
 * ============================================================================== */

/**
 * @brief Cycles through predefined colors
 *
 * Used by physical buttons to quickly change colors.
 *
 * @param colorIndex Index of the color (0-4)
 */
void cycleThrough(int colorIndex) {
    switch (colorIndex) {
        case 0: matrix.setTextColor(0xF800); break;  // Red
        case 1: matrix.setTextColor(0x07E0); break;  // Green
        case 2: matrix.setTextColor(0x001F); break;  // Blue
        case 3: matrix.setTextColor(0xFFFF); break;  // White
        case 4: matrix.setTextColor(0xF81F); break;  // Magenta
    }
}

/* ==============================================================================
 * WEB INTERFACE
 * ============================================================================== */

/**
 * @brief Serves the HTML page for the web interface
 *
 * Contains:
 * - Pixel Art Editor tab
 * - Image Upload tab
 * - Text & Settings tab
 *
 * @param client WiFi client to write to
 */
void serveImageUploadPage(WiFiClient& client) {
    // HTTP headers
    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: text/html");
    client.println("Connection: close");
    client.println();

    // HTML document start
    client.println("<!DOCTYPE html>");
    client.println("<html>");
    client.println("<head>");
    client.println("<meta name='viewport' content='width=device-width, initial-scale=1'>");
    client.println("<title>LED Matrix Control</title>");

    // CSS Styling
    client.println("<style>");
    client.println("body { font-family: Arial, sans-serif; max-width: 900px; margin: 20px auto; padding: 20px; background: #1a1a2e; color: #eee; }");
    client.println("h1, h2 { color: #fff; text-align: center; }");
    client.println("h2 { font-size: 18px; margin-top: 30px; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }");
    client.println(".tabs { display: flex; margin-bottom: 20px; }");
    client.println(".tab { flex: 1; padding: 15px; text-align: center; background: #16213e; cursor: pointer; border: none; color: #888; font-size: 16px; }");
    client.println(".tab.active { background: #0f3460; color: #fff; border-bottom: 3px solid #4CAF50; }");
    client.println(".tab-content { display: none; }");
    client.println(".tab-content.active { display: block; }");
    client.println(".canvas-container { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; margin: 20px 0; }");
    client.println(".canvas-wrapper { text-align: center; }");
    client.println(".canvas-wrapper h3 { margin: 5px 0; font-size: 14px; color: #aaa; }");
    client.println("canvas { border: 3px solid #4CAF50; image-rendering: pixelated; background: #000; cursor: crosshair; }");
    client.println("#editorCanvas { width: 320px; height: 320px; }");
    client.println("#previewCanvas { width: 160px; height: 160px; }");
    client.println("button { padding: 12px 20px; font-size: 16px; margin: 5px; cursor: pointer; border: none; border-radius: 5px; }");
    client.println(".btn-green { background: #4CAF50; color: white; }");
    client.println(".btn-red { background: #f44336; color: white; }");
    client.println(".btn-blue { background: #2196F3; color: white; }");
    client.println(".palette { display: flex; justify-content: center; gap: 10px; margin: 15px 0; flex-wrap: wrap; }");
    client.println(".color-btn { width: 50px; height: 50px; border: 3px solid #333; border-radius: 8px; cursor: pointer; }");
    client.println(".color-btn.active { border-color: #fff; box-shadow: 0 0 10px #fff; }");
    client.println(".controls { background: #16213e; padding: 20px; border-radius: 10px; margin: 15px 0; }");
    client.println(".control-row { display: flex; align-items: center; margin: 10px 0; gap: 10px; flex-wrap: wrap; }");
    client.println(".control-row label { min-width: 120px; }");
    client.println("input[type='text'], input[type='number'], select { padding: 10px; border-radius: 5px; border: 1px solid #444; background: #0f3460; color: #fff; font-size: 14px; }");
    client.println("input[type='range'] { flex: 1; min-width: 150px; }");
    client.println("#status { text-align: center; padding: 10px; font-size: 16px; min-height: 30px; }");
    client.println(".tools { display: flex; justify-content: center; gap: 10px; margin: 15px 0; }");
    client.println(".tool-btn { padding: 10px 15px; background: #0f3460; border: 2px solid #333; color: #fff; border-radius: 5px; cursor: pointer; }");
    client.println(".tool-btn.active { border-color: #4CAF50; background: #1a5a1a; }");
    client.println("</style>");
    client.println("</head>");
    client.println("<body>");
    client.println("<h1>LED Matrix Control Panel</h1>");

    // Tab navigation
    client.println("<div class='tabs'>");
    client.println("<button class='tab active' onclick='showTab(0)'>Pixel Editor</button>");
    client.println("<button class='tab' onclick='showTab(1)'>Image Upload</button>");
    client.println("<button class='tab' onclick='showTab(2)'>Text & Settings</button>");
    client.println("</div>");

    // --- TAB 0: PIXEL EDITOR ---
    client.println("<div id='tab0' class='tab-content active'>");
    client.println("<h2>Pixel Art Editor</h2>");

    // Color palette
    client.println("<div class='palette'>");
    client.println("<div class='color-btn active' style='background:#ff0000' data-color='0xF800' onclick='selectColor(this)'></div>");
    client.println("<div class='color-btn' style='background:#00ff00' data-color='0x07E0' onclick='selectColor(this)'></div>");
    client.println("<div class='color-btn' style='background:#0000ff' data-color='0x001F' onclick='selectColor(this)'></div>");
    client.println("<div class='color-btn' style='background:#ffffff' data-color='0xFFFF' onclick='selectColor(this)'></div>");
    client.println("<div class='color-btn' style='background:#000000; border-color:#666;' data-color='0x0000' onclick='selectColor(this)'></div>");
    client.println("</div>");

    // Drawing tools
    client.println("<div class='tools'>");
    client.println("<button class='tool-btn active' id='toolPen' onclick='selectTool(\"pen\")'>Pen</button>");
    client.println("<button class='tool-btn' id='toolFill' onclick='selectTool(\"fill\")'>Fill</button>");
    client.println("<button class='tool-btn' id='toolErase' onclick='selectTool(\"erase\")'>Eraser</button>");
    client.println("</div>");

    // Canvas
    client.println("<div class='canvas-container'>");
    client.println("<div class='canvas-wrapper'>");
    client.println("<h3>Draw Here (32x32)</h3>");
    client.println("<canvas id='editorCanvas' width='32' height='32'></canvas>");
    client.println("</div>");
    client.println("</div>");

    // Buttons
    client.println("<div style='text-align:center'>");
    client.println("<button class='btn-green' onclick='sendEditorToMatrix()'>Send to Matrix</button>");
    client.println("<button class='btn-blue' onclick='clearEditor()'>Clear Canvas</button>");
    client.println("</div>");
    client.println("</div>");

    // --- TAB 1: IMAGE UPLOAD ---
    client.println("<div id='tab1' class='tab-content'>");
    client.println("<h2>Upload Image</h2>");
    client.println("<div class='controls'>");
    client.println("<div class='control-row'>");
    client.println("<label>Color Mode:</label>");
    client.println("<select id='paletteSelect' onchange='processImage()'>");
    client.println("<option value='full'>Full Color RGB565</option>");
    client.println("<option value='retro'>Retro (RGB+W)</option>");
    client.println("</select>");
    client.println("</div>");
    client.println("<div class='control-row'>");
    client.println("<input type='file' id='fileInput' accept='image/*' style='flex:1'>");
    client.println("</div>");
    client.println("</div>");

    client.println("<div class='canvas-container'>");
    client.println("<div class='canvas-wrapper'>");
    client.println("<h3>Original</h3>");
    client.println("<canvas id='originalCanvas' width='32' height='32' style='width:160px;height:160px'></canvas>");
    client.println("</div>");
    client.println("<div class='canvas-wrapper'>");
    client.println("<h3>Preview</h3>");
    client.println("<canvas id='previewCanvas' width='32' height='32'></canvas>");
    client.println("</div>");
    client.println("</div>");

    client.println("<div style='text-align:center'>");
    client.println("<button class='btn-green' onclick='sendToMatrix()'>Send to Matrix</button>");
    client.println("<button class='btn-red' onclick='clearMatrix()'>Clear Matrix</button>");
    client.println("</div>");
    client.println("</div>");

    // --- TAB 2: TEXT & SETTINGS ---
    client.println("<div id='tab2' class='tab-content'>");
    client.println("<h2>Text Display</h2>");
    client.println("<div class='controls'>");

    // Text input
    client.println("<div class='control-row'>");
    client.println("<label>Text:</label>");
    client.println("<input type='text' id='textInput' placeholder='Enter text...' style='flex:1'>");
    client.println("<button class='btn-green' onclick='sendText()'>Send</button>");
    client.println("</div>");

    // Color selection
    client.println("<div class='control-row'>");
    client.println("<label>Text Color:</label>");
    client.println("<select id='colorSelect'>");
    client.println("<option value='0xF800'>Red</option>");
    client.println("<option value='0x07E0'>Green</option>");
    client.println("<option value='0x001F'>Blue</option>");
    client.println("<option value='0xFFFF'>White</option>");
    client.println("<option value='0xF81F'>Magenta</option>");
    client.println("<option value='0xFFE0'>Yellow</option>");
    client.println("<option value='0x07FF'>Cyan</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendColor()'>Apply</button>");
    client.println("</div>");

    // Text size
    client.println("<div class='control-row'>");
    client.println("<label>Text Size (1-5):</label>");
    client.println("<input type='number' id='sizeInput' value='1' min='1' max='5' style='width:80px'>");
    client.println("<button class='btn-blue' onclick='sendSize()'>Apply</button>");
    client.println("</div>");

    // Y position
    client.println("<div class='control-row'>");
    client.println("<label>Y Position (0-31):</label>");
    client.println("<input type='number' id='yInput' value='10' min='0' max='31' style='width:80px'>");
    client.println("<button class='btn-blue' onclick='sendY()'>Apply</button>");
    client.println("</div>");
    client.println("</div>");

    // Scroll settings
    client.println("<h2>Scroll Settings</h2>");
    client.println("<div class='controls'>");
    client.println("<div class='control-row'>");
    client.println("<label>Scroll Speed:</label>");
    client.println("<input type='range' id='speedSlider' min='10' max='200' value='50'>");
    client.println("<span id='speedValue'>50ms</span>");
    client.println("<button class='btn-blue' onclick='sendSpeed()'>Apply</button>");
    client.println("</div>");
    client.println("<div class='control-row'>");
    client.println("<label>Alignment:</label>");
    client.println("<select id='alignSelect'>");
    client.println("<option value='0'>Scroll</option>");
    client.println("<option value='1'>Center</option>");
    client.println("<option value='2'>Right</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendAlign()'>Apply</button>");
    client.println("</div>");
    client.println("<div class='control-row'>");
    client.println("<label>Image Scroll:</label>");
    client.println("<select id='imgScrollSelect'>");
    client.println("<option value='1'>Enabled</option>");
    client.println("<option value='0'>Disabled</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendImgScroll()'>Apply</button>");
    client.println("</div>");

    // NEW: Text Repeat Settings
    client.println("<div class='control-row'>");
    client.println("<label>Text Repeat:</label>");
    client.println("<select id='textRepeatSelect'>");
    client.println("<option value='0'>Once</option>");
    client.println("<option value='1'>Infinite Loop</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendTextRepeat()'>Apply</button>");
    client.println("</div>");
    client.println("<div class='control-row'>");
    client.println("<label>Text Spacing:</label>");
    client.println("<input type='number' id='textSpacingInput' value='100' min='0' max='500' style='width:80px'>");
    client.println("<span>px</span>");
    client.println("<button class='btn-blue' onclick='sendTextSpacing()'>Apply</button>");
    client.println("</div>");

    // NEW: Image Repeat Settings
    client.println("<div class='control-row'>");
    client.println("<label>Image Repeat:</label>");
    client.println("<select id='imageRepeatSelect'>");
    client.println("<option value='0'>Once</option>");
    client.println("<option value='1'>Infinite Loop</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendImageRepeat()'>Apply</button>");
    client.println("</div>");
    client.println("<div class='control-row'>");
    client.println("<label>Image Spacing:</label>");
    client.println("<input type='number' id='imageSpacingInput' value='50' min='0' max='300' style='width:80px'>");
    client.println("<span>px</span>");
    client.println("<button class='btn-blue' onclick='sendImageSpacing()'>Apply</button>");
    client.println("</div>");

    // NEW: Scroll Direction Settings
    client.println("<div class='control-row'>");
    client.println("<label>Text Direction:</label>");
    client.println("<select id='textDirectionSelect'>");
    client.println("<option value='-1'>? Left</option>");
    client.println("<option value='1'>? Right</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendTextDirection()'>Apply</button>");
    client.println("</div>");

    client.println("<div class='control-row'>");
    client.println("<label>Image Direction:</label>");
    client.println("<select id='imageDirectionSelect'>");
    client.println("<option value='-1'>? Left</option>");
    client.println("<option value='1'>? Right</option>");
    client.println("</select>");
    client.println("<button class='btn-blue' onclick='sendImageDirection()'>Apply</button>");
    client.println("</div>");

    client.println("</div>");
    client.println("</div>");

    // Status indicator
    client.println("<div id='status'></div>");

    // === JAVASCRIPT ===
    client.println("<script>");

    // Tab switching
    client.println("function showTab(n) {");
    client.println("  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===n));");
    client.println("  document.querySelectorAll('.tab-content').forEach((c,i) => c.classList.toggle('active', i===n));");
    client.println("}");

    // Pixel editor variables
    client.println("const editorCanvas = document.getElementById('editorCanvas');");
    client.println("const editorCtx = editorCanvas.getContext('2d');");
    client.println("editorCtx.imageSmoothingEnabled = false;");
    client.println("let currentColor = 0xF800;");
    client.println("let currentTool = 'pen';");
    client.println("let isDrawing = false;");
    client.println("let editorPixels = new Array(1024).fill(0);");

    // Initialize canvas
    client.println("editorCtx.fillStyle = '#000';");
    client.println("editorCtx.fillRect(0, 0, 32, 32);");

    // Color selection
    client.println("function selectColor(el) {");
    client.println("  document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));");
    client.println("  el.classList.add('active');");
    client.println("  currentColor = parseInt(el.dataset.color);");
    client.println("}");

    // Tool selection
    client.println("function selectTool(tool) {");
    client.println("  currentTool = tool;");
    client.println("  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));");
    client.println("  document.getElementById('tool' + tool.charAt(0).toUpperCase() + tool.slice(1)).classList.add('active');");
    client.println("}");

    // RGB565 to CSS color conversion
    client.println("function rgb565ToCss(rgb565) {");
    client.println("  const r = ((rgb565 >> 11) & 0x1F) << 3;");
    client.println("  const g = ((rgb565 >> 5) & 0x3F) << 2;");
    client.println("  const b = (rgb565 & 0x1F) << 3;");
    client.println("  return `rgb(${r},${g},${b})`;");
    client.println("}");

    // Draw pixel
    client.println("function drawPixel(x, y) {");
    client.println("  if (x < 0 || x >= 32 || y < 0 || y >= 32) return;");
    client.println("  const color = currentTool === 'erase' ? 0 : currentColor;");
    client.println("  editorPixels[y * 32 + x] = color;");
    client.println("  editorCtx.fillStyle = rgb565ToCss(color);");
    client.println("  editorCtx.fillRect(x, y, 1, 1);");
    client.println("}");

    // Flood fill algorithm
    client.println("function floodFill(startX, startY) {");
    client.println("  const targetColor = editorPixels[startY * 32 + startX];");
    client.println("  if (targetColor === currentColor) return;");
    client.println("  const stack = [[startX, startY]];");
    client.println("  while (stack.length) {");
    client.println("    const [x, y] = stack.pop();");
    client.println("    if (x < 0 || x >= 32 || y < 0 || y >= 32) continue;");
    client.println("    if (editorPixels[y * 32 + x] !== targetColor) continue;");
    client.println("    editorPixels[y * 32 + x] = currentColor;");
    client.println("    editorCtx.fillStyle = rgb565ToCss(currentColor);");
    client.println("    editorCtx.fillRect(x, y, 1, 1);");
    client.println("    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);");
    client.println("  }");
    client.println("}");

    // Mouse position helper
    client.println("function getEditorPos(e) {");
    client.println("  const rect = editorCanvas.getBoundingClientRect();");
    client.println("  const x = Math.floor((e.clientX - rect.left) / rect.width * 32);");
    client.println("  const y = Math.floor((e.clientY - rect.top) / rect.height * 32);");
    client.println("  return [x, y];");
    client.println("}");

    // Mouse events
    client.println("editorCanvas.addEventListener('mousedown', (e) => {");
    client.println("  const [x, y] = getEditorPos(e);");
    client.println("  if (currentTool === 'fill') { floodFill(x, y); }");
    client.println("  else { isDrawing = true; drawPixel(x, y); }");
    client.println("});");

    client.println("editorCanvas.addEventListener('mousemove', (e) => {");
    client.println("  if (!isDrawing || currentTool === 'fill') return;");
    client.println("  const [x, y] = getEditorPos(e);");
    client.println("  drawPixel(x, y);");
    client.println("});");

    client.println("editorCanvas.addEventListener('mouseup', () => isDrawing = false);");
    client.println("editorCanvas.addEventListener('mouseleave', () => isDrawing = false);");

    // Touch support
    client.println("editorCanvas.addEventListener('touchstart', (e) => {");
    client.println("  e.preventDefault();");
    client.println("  const touch = e.touches[0];");
    client.println("  const [x, y] = getEditorPos(touch);");
    client.println("  if (currentTool === 'fill') { floodFill(x, y); }");
    client.println("  else { isDrawing = true; drawPixel(x, y); }");
    client.println("});");

    client.println("editorCanvas.addEventListener('touchmove', (e) => {");
    client.println("  e.preventDefault();");
    client.println("  if (!isDrawing || currentTool === 'fill') return;");
    client.println("  const touch = e.touches[0];");
    client.println("  const [x, y] = getEditorPos(touch);");
    client.println("  drawPixel(x, y);");
    client.println("});");

    client.println("editorCanvas.addEventListener('touchend', () => isDrawing = false);");

    // Clear canvas
    client.println("function clearEditor() {");
    client.println("  editorPixels.fill(0);");
    client.println("  editorCtx.fillStyle = '#000';");
    client.println("  editorCtx.fillRect(0, 0, 32, 32);");
    client.println("}");

    // Send editor to matrix
    client.println("function sendEditorToMatrix() {");
    client.println("  status.innerHTML = '<span style=\"color:orange\">Sending...</span>';");
    client.println("  fetch('/uploadImage', {");
    client.println("    method: 'POST',");
    client.println("    headers: {'Content-Type': 'application/json'},");
    client.println("    body: JSON.stringify({ width: 32, height: 32, pixels: editorPixels })");
    client.println("  }).then(r => r.text()).then(txt => {");
    client.println("    status.innerHTML = '<span style=\"color:green\">Sent!</span>';");
    client.println("  }).catch(e => status.innerHTML = '<span style=\"color:red\">Error!</span>');");
    client.println("}");

    // Image upload variables
    client.println("const originalCanvas = document.getElementById('originalCanvas');");
    client.println("const previewCanvas = document.getElementById('previewCanvas');");
    client.println("const originalCtx = originalCanvas.getContext('2d');");
    client.println("const previewCtx = previewCanvas.getContext('2d');");
    client.println("const status = document.getElementById('status');");
    client.println("let pixelData = [];");
    client.println("let currentImage = null;");
    client.println("originalCtx.imageSmoothingEnabled = false;");
    client.println("previewCtx.imageSmoothingEnabled = false;");

    // Retro palette (RGB+W+Black)
    client.println("const retroPalette = [");
    client.println("  {r:0,g:0,b:0}, {r:255,g:0,b:0}, {r:0,g:255,b:0}, {r:0,g:0,b:255}, {r:255,g:255,b:255}");
    client.println("];");

    // Find closest color
    client.println("function findClosestColor(r, g, b, palette) {");
    client.println("  let minDist = Infinity, closest = palette[0];");
    client.println("  for(let c of palette) {");
    client.println("    const d = (r-c.r)**2 + (g-c.g)**2 + (b-c.b)**2;");
    client.println("    if(d < minDist) { minDist = d; closest = c; }");
    client.println("  }");
    client.println("  return closest;");
    client.println("}");

    // RGB to RGB565 conversion
    client.println("function convertToRGB565(r, g, b) {");
    client.println("  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);");
    client.println("}");

    // Process image
    client.println("function processImage() {");
    client.println("  if(!currentImage) return;");
    client.println("  originalCtx.drawImage(currentImage, 0, 0, 32, 32);");
    client.println("  const imageData = originalCtx.getImageData(0, 0, 32, 32);");
    client.println("  const data = imageData.data;");
    client.println("  const mode = document.getElementById('paletteSelect').value;");
    client.println("  pixelData = [];");
    client.println("  const previewData = previewCtx.createImageData(32, 32);");
    client.println("  for(let i = 0; i < data.length; i += 4) {");
    client.println("    let r = data[i], g = data[i+1], b = data[i+2];");
    client.println("    if(mode === 'retro') {");
    client.println("      const c = findClosestColor(r, g, b, retroPalette);");
    client.println("      r = c.r; g = c.g; b = c.b;");
    client.println("    }");
    client.println("    pixelData.push(convertToRGB565(r, g, b));");
    client.println("    previewData.data[i] = r; previewData.data[i+1] = g;");
    client.println("    previewData.data[i+2] = b; previewData.data[i+3] = 255;");
    client.println("  }");
    client.println("  previewCtx.putImageData(previewData, 0, 0);");
    client.println("  status.innerHTML = '<span style=\"color:green\">Ready to send!</span>';");
    client.println("}");

    // File selection
    client.println("document.getElementById('fileInput').addEventListener('change', (e) => {");
    client.println("  const file = e.target.files[0];");
    client.println("  if(!file) return;");
    client.println("  const img = new Image();");
    client.println("  img.onload = () => { currentImage = img; processImage(); };");
    client.println("  img.src = URL.createObjectURL(file);");
    client.println("});");

    // Send to matrix
    client.println("function sendToMatrix() {");
    client.println("  if(pixelData.length !== 1024) { status.innerHTML = '<span style=\"color:red\">Load image first!</span>'; return; }");
    client.println("  status.innerHTML = '<span style=\"color:orange\">Sending...</span>';");
    client.println("  fetch('/uploadImage', {");
    client.println("    method: 'POST',");
    client.println("    headers: {'Content-Type': 'application/json'},");
    client.println("    body: JSON.stringify({ width: 32, height: 32, pixels: pixelData })");
    client.println("  }).then(r => r.text()).then(txt => status.innerHTML = '<span style=\"color:green\">' + txt + '</span>')");
    client.println("  .catch(e => status.innerHTML = '<span style=\"color:red\">Error!</span>');");
    client.println("}");

    // Clear matrix
    client.println("function clearMatrix() {");
    client.println("  fetch('/clearImage', { method: 'POST' }).then(r => r.text())");
    client.println("  .then(txt => status.innerHTML = '<span style=\"color:green\">' + txt + '</span>');");
    client.println("}");

    // Speed slider
    client.println("document.getElementById('speedSlider').addEventListener('input', (e) => {");
    client.println("  document.getElementById('speedValue').textContent = e.target.value + 'ms';");
    client.println("});");

    // Generic setting sender
    client.println("function sendSetting(endpoint, data) {");
    client.println("  fetch(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) })");
    client.println("  .then(r => r.text()).then(txt => status.innerHTML = '<span style=\"color:green\">' + txt + '</span>')");
    client.println("  .catch(e => status.innerHTML = '<span style=\"color:red\">Error!</span>');");
    client.println("}");

    // Specific setting functions
    client.println("function sendText() { sendSetting('/setText', { text: document.getElementById('textInput').value }); }");
    client.println("function sendColor() { sendSetting('/setColor', { color: parseInt(document.getElementById('colorSelect').value) }); }");
    client.println("function sendSize() { sendSetting('/setSize', { size: parseInt(document.getElementById('sizeInput').value) }); }");
    client.println("function sendY() { sendSetting('/setY', { y: parseInt(document.getElementById('yInput').value) }); }");
    client.println("function sendSpeed() { sendSetting('/setSpeed', { speed: parseInt(document.getElementById('speedSlider').value) }); }");
    client.println("function sendAlign() { sendSetting('/setAlign', { align: parseInt(document.getElementById('alignSelect').value) }); }");
    client.println("function sendImgScroll() { sendSetting('/setImgScroll', { scroll: parseInt(document.getElementById('imgScrollSelect').value) }); }");
    client.println("function sendTextRepeat() { sendSetting('/setTextRepeat', { repeat: parseInt(document.getElementById('textRepeatSelect').value) }); }");
    client.println("function sendTextSpacing() { sendSetting('/setTextSpacing', { spacing: parseInt(document.getElementById('textSpacingInput').value) }); }");
    client.println("function sendImageRepeat() { sendSetting('/setImageRepeat', { repeat: parseInt(document.getElementById('imageRepeatSelect').value) }); }");
    client.println("function sendImageSpacing() { sendSetting('/setImageSpacing', { spacing: parseInt(document.getElementById('imageSpacingInput').value) }); }");
    client.println("function sendTextDirection() { sendSetting('/setTextDirection', { direction: parseInt(document.getElementById('textDirectionSelect').value) }); }");
    client.println("function sendImageDirection() { sendSetting('/setImageDirection', { direction: parseInt(document.getElementById('imageDirectionSelect').value) }); }");

    client.println("</script>");
    client.println("</body></html>");
}

/* ==============================================================================
 * JSON PARSING FUNCTIONS
 * ============================================================================== */

/**
 * @brief Parses JSON image data and fills the pixel buffer
 *
 * Expected JSON format:
 * {
 *   "width": 32,
 *   "height": 32,
 *   "pixels": [pixel0, pixel1, ..., pixel1023]
 * }
 *
 * @param jsonData  The complete JSON string
 * @param buffer    Destination buffer for pixel data (RGB565)
 * @param width     Output: width of the image
 * @param height    Output: height of the image
 * @return true     Parsing successful
 * @return false    Parsing failed
 */
bool parseImageData(String& jsonData, uint16_t* buffer, int& width, int& height) {
    Serial.println("Parsing image data...");
    Serial.print("JSON length: ");
    Serial.println(jsonData.length());

    // Find width
    int widthIdx = jsonData.indexOf("\"width\":");
    if (widthIdx == -1) return false;
    width = jsonData.substring(widthIdx + 8).toInt();

    // Find height
    int heightIdx = jsonData.indexOf("\"height\":");
    if (heightIdx == -1) return false;
    height = jsonData.substring(heightIdx + 9).toInt();

    Serial.print("Dimensions found: ");
    Serial.print(width);
    Serial.print("x");
    Serial.println(height);

    // Validate dimensions - only 32x32 allowed
    if (width != MAX_IMAGE_WIDTH || height != MAX_IMAGE_HEIGHT) {
        Serial.print("Invalid dimensions: ");
        Serial.print(width);
        Serial.print("x");
        Serial.println(height);
        return false;
    }

    // Find pixels array
    int pixelsIdx = jsonData.indexOf("\"pixels\":[");
    if (pixelsIdx == -1) {
        Serial.println("ERROR: pixels array not found!");
        return false;
    }

    int startIdx = pixelsIdx + 10;
    int endIdx = jsonData.indexOf(']', startIdx);
    if (endIdx == -1) {
        Serial.println("ERROR: pixels array end not found!");
        return false;
    }

    String pixelsStr = jsonData.substring(startIdx, endIdx);
    Serial.print("Pixels string length: ");
    Serial.println(pixelsStr.length());

    // Parse pixel values
    int pixelCount = 0;
    int lastComma = -1;

    for (int i = 0; i <= (int)pixelsStr.length(); i++) {
        if (i == (int)pixelsStr.length() || pixelsStr.charAt(i) == ',') {
            String numStr = pixelsStr.substring(lastComma + 1, i);
            numStr.trim();
            if (numStr.length() > 0 && pixelCount < IMAGE_BUFFER_SIZE) {
                buffer[pixelCount] = numStr.toInt();

                // Debug first few values
                if (pixelCount < 5) {
                    Serial.print("Parsed pixel ");
                    Serial.print(pixelCount);
                    Serial.print(": ");
                    Serial.print(numStr);
                    Serial.print(" -> ");
                    Serial.println(buffer[pixelCount]);
                }

                pixelCount++;
            }
            lastComma = i;
        }
    }

    Serial.print("Total pixels parsed: ");
    Serial.println(pixelCount);

    return pixelCount == IMAGE_BUFFER_SIZE;
}

/* ==============================================================================
 * HTTP REQUEST HANDLERS
 * ============================================================================== */

/**
 * @brief Handles image upload POST request
 *
 * @param client   WiFi client
 * @param postData The POST body containing JSON image data
 */
void handleImageUpload(WiFiClient& client, String& postData) {
    int width = 0, height = 0;
    uint16_t tempBuffer[IMAGE_BUFFER_SIZE];

    if (parseImageData(postData, tempBuffer, width, height)) {
        // Debug: show first pixel values
        Serial.println("=== RECEIVED pixel values ===");
        for (int i = 0; i < 10; i++) {
            Serial.print("Pixel ");
            Serial.print(i);
            Serial.print(": 0x");
            Serial.println(tempBuffer[i], HEX);
        }

        // Copy to permanent buffer
        Serial.println("=== COPYING UPLOADED IMAGE TO BUFFER ===");
        for (int i = 0; i < IMAGE_BUFFER_SIZE; i++) {
            imageBuffer[i] = tempBuffer[i];
        }

        storedImageWidth = width;
        storedImageHeight = height;
        hasStoredImage = true;

        // Send success response
        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: text/plain");
        client.println("Connection: close");
        client.println();
        client.println("Image uploaded successfully!");

        Serial.println("Upload complete");
    } else {
        // Send error response
        client.println("HTTP/1.1 400 Bad Request");
        client.println("Content-Type: text/plain");
        client.println("Connection: close");
        client.println();
        client.println("Failed to parse image data!");
        Serial.println("ERROR: Failed to parse image data");
    }
}

/**
 * @brief Handles clear image request
 *
 * @param client WiFi client
 */
void handleClearImage(WiFiClient& client) {
    hasStoredImage = false;
    storedImageWidth = 0;
    storedImageHeight = 0;
    imageX = MATRIX_WIDTH;

    matrix.fillScreen(0);
    matrix.show();

    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: text/plain");
    client.println("Connection: close");
    client.println();
    client.println("Matrix cleared!");

    Serial.println("Matrix cleared");
}

/**
 * @brief Handles settings POST requests
 *
 * Supported endpoints:
 * - /setText     : Change text
 * - /setColor    : Change text color (RGB565)
 * - /setSize     : Change text size
 * - /setY        : Change Y position
 * - /setSpeed    : Change scroll speed
 * - /setAlign    : Change alignment
 * - /setImgScroll: Toggle image scroll
 *
 * @param client    WiFi client
 * @param endpoint  The request endpoint
 * @param postData  The POST body containing JSON data
 */
void handleSettingsPost(WiFiClient& client, String& endpoint, String& postData) {
    // Always send OK response
    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: text/plain");
    client.println("Connection: close");
    client.println();

    if (endpoint.indexOf("/setText") >= 0) {
        int idx = postData.indexOf("\"text\":\"");
        if (idx >= 0) {
            int start = idx + 8;
            int end = postData.indexOf("\"", start);
            scrollText = postData.substring(start, end);
            recalculateTextBounds();
            hasStoredImage = false;  // Switch to text mode
            client.println("Text updated!");
            Serial.print("Text: ");
            Serial.println(scrollText);
        }
    }
    else if (endpoint.indexOf("/setColor") >= 0) {
        int idx = postData.indexOf("\"color\":");
        if (idx >= 0) {
            textColor = postData.substring(idx + 8).toInt();
            matrix.setTextColor(textColor);
            client.println("Color updated!");
            Serial.print("Color: 0x");
            Serial.println(textColor, HEX);
        }
    }
    else if (endpoint.indexOf("/setSize") >= 0) {
        int idx = postData.indexOf("\"size\":");
        if (idx >= 0) {
            int newSize = postData.substring(idx + 7).toInt();
            if (newSize >= TEXT_SIZE_MIN && newSize <= TEXT_SIZE_MAX) {
                textSize = newSize;
                recalculateTextBounds();
                client.println("Size updated!");
                Serial.print("Size: ");
                Serial.println(textSize);
            }
        }
    }
    else if (endpoint.indexOf("/setY") >= 0) {
        int idx = postData.indexOf("\"y\":");
        if (idx >= 0) {
            int newY = postData.substring(idx + 4).toInt();
            if (newY >= 0 && newY < MATRIX_HEIGHT) {
                textY = newY;
                client.println("Y position updated!");
                Serial.print("Y: ");
                Serial.println(textY);
            }
        }
    }
    else if (endpoint.indexOf("/setSpeed") >= 0) {
        int idx = postData.indexOf("\"speed\":");
        if (idx >= 0) {
            int newSpeed = postData.substring(idx + 8).toInt();
            if (newSpeed >= SCROLL_DELAY_MIN && newSpeed <= SCROLL_DELAY_MAX) {
                scrollDelay = newSpeed;
                client.println("Speed updated!");
                Serial.print("Speed: ");
                Serial.println(scrollDelay);
            }
        }
    }
    else if (endpoint.indexOf("/setAlign") >= 0) {
        int idx = postData.indexOf("\"align\":");
        if (idx >= 0) {
            int newAlign = postData.substring(idx + 8).toInt();
            if (newAlign >= 0 && newAlign <= 2) {
                alignment = newAlign;
                recalculateTextBounds();
                client.println("Alignment updated!");
            }
        }
    }
else if (endpoint.indexOf("/setImgScroll") >= 0) {
        int idx = postData.indexOf("\"scroll\":");
        if (idx >= 0) {
            imageScrollEnabled = postData.substring(idx + 9).toInt() != 0;
            if (imageScrollEnabled) imageX = MATRIX_WIDTH;
            client.println(imageScrollEnabled ? "Image scroll enabled!" : "Image scroll disabled!");
            Serial.print("Image scroll: ");
            Serial.println(imageScrollEnabled ? "ON" : "OFF");
        }
    }
    // NEW: Text Repeat
    else if (endpoint.indexOf("/setTextRepeat") >= 0) {
        int idx = postData.indexOf("\"repeat\":");
        if (idx >= 0) {
            textRepeatEnabled = postData.substring(idx + 9).toInt() != 0;
            client.println(textRepeatEnabled ? "Text repeat enabled!" : "Text repeat disabled!");
            Serial.print("Text repeat: ");
            Serial.println(textRepeatEnabled ? "ON" : "OFF");
        }
    }
    // NEW: Text Spacing
    else if (endpoint.indexOf("/setTextSpacing") >= 0) {
        int idx = postData.indexOf("\"spacing\":");
        if (idx >= 0) {
            int newSpacing = postData.substring(idx + 10).toInt();
            if (newSpacing >= 0 && newSpacing <= 500) {  // Allow 0!
                textRepeatSpacing = newSpacing;
                client.println("Text spacing updated!");
                Serial.print("Text spacing: ");
                Serial.println(textRepeatSpacing);
            }
        }
    }
    // NEW: Image Repeat
    else if (endpoint.indexOf("/setImageRepeat") >= 0) {
        int idx = postData.indexOf("\"repeat\":");
        if (idx >= 0) {
            imageRepeatEnabled = postData.substring(idx + 9).toInt() != 0;
            client.println(imageRepeatEnabled ? "Image repeat enabled!" : "Image repeat disabled!");
            Serial.print("Image repeat: ");
            Serial.println(imageRepeatEnabled ? "ON" : "OFF");
        }
    }
    // NEW: Image Spacing
    else if (endpoint.indexOf("/setImageSpacing") >= 0) {
        int idx = postData.indexOf("\"spacing\":");
        if (idx >= 0) {
            int newSpacing = postData.substring(idx + 10).toInt();
            if (newSpacing >= 0 && newSpacing <= 300) {
                imageRepeatSpacing = newSpacing;
                client.println("Image spacing updated!");
                Serial.print("Image spacing: ");
                Serial.println(imageRepeatSpacing);
            }
        }
    }
    // NEW: Text Direction
    else if (endpoint.indexOf("/setTextDirection") >= 0) {
        int idx = postData.indexOf("\"direction\":");
        if (idx >= 0) {
            int newDirection = postData.substring(idx + 12).toInt();
            if (newDirection == -1 || newDirection == 1) {
                textScrollDirection = newDirection;
                
                // Reset position based on new direction
                if (textScrollDirection == -1) {  // Left
                    textX = MATRIX_WIDTH;  // Start from right edge
                } else {  // Right
                    // Calculate text width for proper start position
                    int16_t x1, y1;
                    uint16_t w, h;
                    matrix.setTextSize(textSize);
                    matrix.getTextBounds(scrollText.c_str(), 0, 0, &x1, &y1, &w, &h);
                    textX = -(int)w;  // Start completely off-screen to the left
                }
                
                client.println(textScrollDirection == -1 ? "Text scrolling left!" : "Text scrolling right!");
                Serial.print("Text direction: ");
                Serial.println(textScrollDirection == -1 ? "LEFT" : "RIGHT");
            }
        }
    }
    // NEW: Image Direction
    else if (endpoint.indexOf("/setImageDirection") >= 0) {
        int idx = postData.indexOf("\"direction\":");
        if (idx >= 0) {
            int newDirection = postData.substring(idx + 12).toInt();
            if (newDirection == -1 || newDirection == 1) {
                imageScrollDirection = newDirection;
                
                // Reset position based on new direction
                if (imageScrollDirection == -1) {  // Left
                    imageX = MATRIX_WIDTH;  // Start from right edge
                } else {  // Right
                    imageX = -storedImageWidth;  // Start completely off-screen to the left
                }
                
                client.println(imageScrollDirection == -1 ? "Image scrolling left!" : "Image scrolling right!");
                Serial.print("Image direction: ");
                Serial.println(imageScrollDirection == -1 ? "LEFT" : "RIGHT");
            }
        }
    }
    else {
        client.println("Unknown setting");
    }
}

/**
 * @brief Main web server handler
 *
 * Processes incoming HTTP requests and routes to the appropriate handler.
 */
void handleWebServer() {
    WiFiClient client = server.available();

    if (!client) return;

    Serial.println("New client connected");

    String currentLine = "";
    String requestLine = "";
    String postData = "";
    bool isPost = false;
    int contentLength = 0;
    bool headersDone = false;

    while (client.connected()) {
        if (!client.available()) continue;

        char c = client.read();

        if (!headersDone) {
            if (c == '\n') {
                if (currentLine.length() == 0) {
                    // Headers complete
                    headersDone = true;

                    // Read POST body if present
                    if (isPost && contentLength > 0) {
                        postData.reserve(contentLength);
                        int bytesRead = 0;
                        unsigned long timeout = millis();

                        while (bytesRead < contentLength && millis() - timeout < 5000) {
                            if (client.available()) {
                                postData += (char)client.read();
                                bytesRead++;
                            }
                        }
                    }

                    // Route request to appropriate handler
                    if (requestLine.indexOf("GET /displayGraphic") >= 0) {
                        serveImageUploadPage(client);
                    }
                    else if (requestLine.indexOf("POST /uploadImage") >= 0) {
                        handleImageUpload(client, postData);
                        imageX = MATRIX_WIDTH;  // Reset scroll position
                    }
                    else if (requestLine.indexOf("POST /clearImage") >= 0) {
                        handleClearImage(client);
                    }
                    else if (requestLine.indexOf("POST /set") >= 0) {
                        handleSettingsPost(client, requestLine, postData);
                    }
                    else if (requestLine.indexOf("GET / ") >= 0) {
                        // Redirect to main page
                        client.println("HTTP/1.1 302 Found");
                        client.println("Location: /displayGraphic");
                        client.println("Connection: close");
                        client.println();
                    }
                    else {
                        // 404 Not Found
                        client.println("HTTP/1.1 404 Not Found");
                        client.println("Connection: close");
                        client.println();
                    }
                    break;
                } else {
                    // Process header line
                    if (currentLine.startsWith("GET ") || currentLine.startsWith("POST ")) {
                        requestLine = currentLine;
                        isPost = currentLine.startsWith("POST ");
                    }
                    if (currentLine.startsWith("Content-Length: ")) {
                        contentLength = currentLine.substring(16).toInt();
                    }
                    currentLine = "";
                }
            } else if (c != '\r') {
                currentLine += c;
            }
        }
    }

    client.stop();
    Serial.println("Client disconnected");
}

/* ==============================================================================
 * WIFI FUNCTIONS
 * ============================================================================== */

/**
 * @brief Connects to WiFi network
 *
 * Attempts to connect to the network defined in secrets.h.
 * On success, starts the UDP listener for OSC messages.
 *
 * Also displays available OSC commands in the serial monitor.
 */
void connectWiFi() {
    // Check if already connected
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("Already connected to WiFi!");
        IPAddress ip = WiFi.localIP();
        Serial.print("IP: ");
        Serial.println(ip);
        scrollText = "IP: " + String(ip[0]) + "." + String(ip[1]) + "." +
                     String(ip[2]) + "." + String(ip[3]);

        if (!udpStarted) {
            udp.begin(OSC_RECEIVE_PORT);
            udpStarted = true;
            Serial.print("Listening on port ");
            Serial.println(OSC_RECEIVE_PORT);
        }
        return;
    }

    Serial.print("Connecting to ");
    Serial.println(SECRET_SSID);

    WiFi.disconnect();
    delay(100);
    WiFi.begin(SECRET_SSID, SECRET_PASS);

    // Wait for connection
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < WIFI_CONNECT_TIMEOUT) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("Connected!");
        IPAddress ip = WiFi.localIP();
        Serial.print("IP: ");
        Serial.println(ip);
        scrollText = "IP: " + String(ip[0]) + "." + String(ip[1]) + "." +
                     String(ip[2]) + "." + String(ip[3]);

        udp.begin(OSC_RECEIVE_PORT);
        udpStarted = true;
        Serial.print("Listening on port ");
        Serial.println(OSC_RECEIVE_PORT);

        // Display available OSC commands
        Serial.println("\nOSC Commands:");
        Serial.println("  /text \"message\"  - Update text");
        Serial.println("  /color 0xF800    - Change color (RGB565)");
        Serial.println("  /size 2          - Text size (1-4)");
        Serial.println("  /speed 100       - Scroll speed (10-200ms)");
        Serial.println("  /y 10            - Vertical position (0-31)");
        Serial.println("  /x 0             - Horizontal position");
        Serial.println("  /align 0         - Alignment (0=scroll, 1=center, 2=right)");
        Serial.println("  /scroll 1        - Enable/disable scroll (0/1)");
    } else {
        Serial.print("Connection failed! Status: ");
        Serial.println(WiFi.status());
        scrollText = "WiFi FAILED!";
    }
}

/* ==============================================================================
 * OSC MESSAGE HANDLER
 * ============================================================================== */

/**
 * @brief Processes incoming OSC messages
 *
 * Checks for available UDP packets and processes
 * supported OSC commands.
 */
void handleOSCMessages() {
    if (WiFi.status() != WL_CONNECTED || !udpStarted) return;

    int packetSize = udp.parsePacket();
    if (!packetSize) return;

    int len = udp.read(packetBuffer, sizeof(packetBuffer) - 1);
    if (len <= 0) return;

    packetBuffer[len] = 0;

    // /text - change text
    if (strncmp(packetBuffer, "/text", 5) == 0) {
        String newText = parseOSCString(packetBuffer, len);
        if (newText.length() > 0) {
            scrollText = newText;
            recalculateTextBounds();
            Serial.print("Text: ");
            Serial.println(scrollText);
        }
    }

    // /color - change color (only if useClick is disabled)
    if (!useClick && strncmp(packetBuffer, "/color", 6) == 0 && packetBuffer[6] == 0) {
        // Try parsing as string first
        String colorStr = parseOSCString(packetBuffer, len);
        if (colorStr.length() > 0) {
            if (colorStr.startsWith("0x") || colorStr.startsWith("0X")) {
                int32_t newColor = (int32_t)strtol(colorStr.c_str(), NULL, 16);
                textColor = (uint16_t)newColor;
                matrix.setTextColor(textColor);
                Serial.print("Color: 0x");
                Serial.println(textColor, HEX);
            }
        } else {
            // Try as integer
            int32_t newColor = parseOSCInt(packetBuffer, len);
            textColor = (uint16_t)newColor;
            matrix.setTextColor(textColor);
            Serial.print("Color (int): 0x");
            Serial.println(textColor, HEX);
        }
    }
    // /size - change text size
    else if (strncmp(packetBuffer, "/size", 5) == 0) {
        int32_t newSize = parseOSCInt(packetBuffer, len);
        if (newSize >= TEXT_SIZE_MIN && newSize <= TEXT_SIZE_MAX) {
            textSize = newSize;
            recalculateTextBounds();
            Serial.print("Text size: ");
            Serial.println(textSize);
        }
    }
    // /speed - change scroll speed
    else if (strncmp(packetBuffer, "/speed", 6) == 0) {
        int32_t newSpeed = parseOSCInt(packetBuffer, len);
        if (newSpeed >= SCROLL_DELAY_MIN && newSpeed <= SCROLL_DELAY_MAX) {
            scrollDelay = newSpeed;
            Serial.print("Scroll speed: ");
            Serial.print(scrollDelay);
            Serial.println("ms");
        }
    }
    // /y - vertical position
    else if (strncmp(packetBuffer, "/y", 2) == 0 && packetBuffer[2] == 0) {
        int32_t newY = parseOSCInt(packetBuffer, len);
        if (newY >= 0 && newY < MATRIX_HEIGHT) {
            textY = newY;
            Serial.print("Y position: ");
            Serial.println(textY);
        }
    }
    // /x - horizontal position (disables scroll)
    else if (strncmp(packetBuffer, "/x", 2) == 0 && packetBuffer[2] == 0) {
        int32_t newX = parseOSCInt(packetBuffer, len);
        if (newX >= -100 && newX < MATRIX_WIDTH + 100) {
            textX = newX;
            scrollEnabled = false;
            Serial.print("X position: ");
            Serial.println(textX);
        }
    }
    // /align - change alignment
    else if (strncmp(packetBuffer, "/align", 6) == 0) {
        int32_t newAlign = parseOSCInt(packetBuffer, len);
        if (newAlign >= 0 && newAlign <= 2) {
            alignment = newAlign;
            recalculateTextBounds();
            Serial.print("Alignment: ");
            Serial.println(alignment == 0 ? "scroll" : (alignment == 1 ? "center" : "right"));
        }
    }
    // /scroll - toggle scroll
    if (strncmp(packetBuffer, "/scroll", 7) == 0) {
        int32_t enableScroll = parseOSCInt(packetBuffer, len);
        scrollEnabled = (enableScroll != 0);
        if (scrollEnabled) {
            textX = MATRIX_WIDTH;
        }
        Serial.print("Scroll: ");
        Serial.println(scrollEnabled ? "ON" : "OFF");
    }
    // NEW: /textRepeat - toggle text repeat
    else if (strncmp(packetBuffer, "/textRepeat", 11) == 0) {
        int32_t enableRepeat = parseOSCInt(packetBuffer, len);
        textRepeatEnabled = (enableRepeat != 0);
        Serial.print("Text Repeat: ");
        Serial.println(textRepeatEnabled ? "ON" : "OFF");
    }
    // NEW: /textSpacing - set text repeat spacing
    else if (strncmp(packetBuffer, "/textSpacing", 12) == 0) {
        int32_t spacing = parseOSCInt(packetBuffer, len);
        if (spacing >= 10 && spacing <= 500) {
            textRepeatSpacing = spacing;
            Serial.print("Text Spacing: ");
            Serial.println(textRepeatSpacing);
        }
    }
    // NEW: /imageRepeat - toggle image repeat
    else if (strncmp(packetBuffer, "/imageRepeat", 12) == 0) {
        int32_t enableRepeat = parseOSCInt(packetBuffer, len);
        imageRepeatEnabled = (enableRepeat != 0);
        Serial.print("Image Repeat: ");
        Serial.println(imageRepeatEnabled ? "ON" : "OFF");
    }
    // NEW: /imageSpacing - set image repeat spacing
    else if (strncmp(packetBuffer, "/imageSpacing", 13) == 0) {
        int32_t spacing = parseOSCInt(packetBuffer, len);
        if (spacing >= 10 && spacing <= 300) {
            imageRepeatSpacing = spacing;
            Serial.print("Image Spacing: ");
            Serial.println(imageRepeatSpacing);
        }
    }
    // NEW: /textDirection - set text scroll direction
    else if (strncmp(packetBuffer, "/textDirection", 14) == 0) {
        int32_t direction = parseOSCInt(packetBuffer, len);
        if (direction == -1 || direction == 1) {
            textScrollDirection = direction;
            
            // Reset position based on new direction
            if (textScrollDirection == -1) {  // Left
                textX = MATRIX_WIDTH;  // Start from right edge
            } else {  // Right
                // Calculate text width for proper start position
                int16_t x1, y1;
                uint16_t w, h;
                matrix.setTextSize(textSize);
                matrix.getTextBounds(scrollText.c_str(), 0, 0, &x1, &y1, &w, &h);
                textX = -(int)w;  // Start completely off-screen to the left
            }
            
            Serial.print("Text Direction: ");
            Serial.println(textScrollDirection == -1 ? "LEFT" : "RIGHT");
        }
    }
    // NEW: /imageDirection - set image scroll direction
    else if (strncmp(packetBuffer, "/imageDirection", 15) == 0) {
        int32_t direction = parseOSCInt(packetBuffer, len);
        if (direction == -1 || direction == 1) {
            imageScrollDirection = direction;
            
            // Reset position based on new direction
            if (imageScrollDirection == -1) {  // Left
                imageX = MATRIX_WIDTH;  // Start from right edge
            } else {  // Right
                imageX = -storedImageWidth;  // Start completely off-screen to the left
            }
            
            Serial.print("Image Direction: ");
            Serial.println(imageScrollDirection == -1 ? "LEFT" : "RIGHT");
        }
    }
}

/**
 * @brief Updates the matrix display
 *
 * Draws either the stored image or scrolling text,
 * and handles the scroll animation.
 *
 * @param currentTime Current millis() value for timing
 */
void updateDisplay(unsigned long currentTime) {
    if (currentTime - lastScrollTime < (unsigned long)scrollDelay) return;

    lastScrollTime = currentTime;

    matrix.fillScreen(0);

    if (hasStoredImage) {
        // Calculate total width including spacing
        int totalImageWidth = storedImageWidth + imageRepeatSpacing;

        // Draw stored image (with repeat if enabled)
        if (imageRepeatEnabled) {
            // Ensure minimum of 1 pixel spacing to prevent division issues
            if (totalImageWidth <= 0) totalImageWidth = storedImageWidth;

            // Draw multiple instances for seamless loop
            // We need enough instances to cover the screen + 2 extra for seamless transition
            int numInstances = (MATRIX_WIDTH / totalImageWidth) + 3;
            if (numInstances < 3) numInstances = 3;

            for (int instance = 0; instance < numInstances; instance++) {
                int instanceX = imageX + (instance * totalImageWidth);

                // Skip if this instance is completely off screen (optimization)
                if (instanceX > MATRIX_WIDTH || instanceX + storedImageWidth < 0) continue;

                for (int y = 0; y < storedImageHeight; y++) {
                    for (int x = 0; x < storedImageWidth; x++) {
                        int drawX = instanceX + x;
                        // Only draw if pixel is visible
                        if (drawX >= 0 && drawX < MATRIX_WIDTH) {
                            int idx = y * storedImageWidth + x;
                            matrix.drawPixel(drawX, y, imageBuffer[idx]);
                        }
                    }
                }
            }

            // Scroll image if enabled
            if (imageScrollEnabled) {
                imageX += imageScrollDirection;  // Use direction

                // Reset based on direction
                if (imageScrollDirection < 0) {  // Scrolling left
                    if (imageX <= -totalImageWidth) {
                        imageX += totalImageWidth;
                    }
                } else {  // Scrolling right
                    if (imageX >= totalImageWidth) {
                        imageX -= totalImageWidth;
                    }
                }
            }
        } else {
            // Original single-pass behavior
            for (int y = 0; y < storedImageHeight; y++) {
                for (int x = 0; x < storedImageWidth; x++) {
                    int drawX = imageX + x;
                    if (drawX >= 0 && drawX < MATRIX_WIDTH) {
                        int idx = y * storedImageWidth + x;
                        matrix.drawPixel(drawX, y, imageBuffer[idx]);
                    }
                }
            }

            if (imageScrollEnabled) {
                imageX += imageScrollDirection;  // Use direction

                // Reset based on direction
                if (imageScrollDirection < 0) {  // Scrolling left
                    if (imageX < -storedImageWidth) {
                        imageX = MATRIX_WIDTH;
                    }
                } else {  // Scrolling right
                    if (imageX > MATRIX_WIDTH) {
                        imageX = -storedImageWidth;
                    }
                }
            }
        }
    } else {
        // Draw scrolling text (with repeat if enabled)
        if (textRepeatEnabled && scrollEnabled) {
            // Calculate text width
            int16_t x1, y1;
            uint16_t w, h;
            matrix.setTextSize(textSize);
            matrix.getTextBounds(scrollText.c_str(), 0, 0, &x1, &y1, &w, &h);

            // Total width is text + spacing (allow 0 spacing)
            int totalTextWidth = (int)w + textRepeatSpacing;

            // Ensure minimum width
            if (totalTextWidth <= 0) totalTextWidth = w > 0 ? w : 10;

            // Calculate number of instances needed
            int numInstances = (MATRIX_WIDTH / totalTextWidth) + 3;
            if (numInstances < 3) numInstances = 3;

            // Draw multiple instances for seamless loop
            for (int instance = 0; instance < numInstances; instance++) {
                int instanceX = textX + (instance * totalTextWidth);

                // Skip if completely off screen (optimization)
                if (instanceX > MATRIX_WIDTH || instanceX + (int)w < 0) continue;

                matrix.setCursor(instanceX, textY);
                matrix.print(scrollText);
            }

            // Scroll text
            textX += textScrollDirection;  // Use direction

            // Reset based on direction
            if (textScrollDirection < 0) {  // Scrolling left
                if (textX <= -totalTextWidth) {
                    textX += totalTextWidth;
                }
            } else {  // Scrolling right
                if (textX >= totalTextWidth) {
                    textX -= totalTextWidth;
                }
            }
        } else {
            // Original single-pass behavior
            matrix.setCursor(textX, textY);
            matrix.print(scrollText);

            if (scrollEnabled) {
                textX += textScrollDirection;  // Use direction

                // Reset based on direction
                if (textScrollDirection < 0) {  // Scrolling left
                    if (textX < textMinX) {
                        textX = MATRIX_WIDTH;
                    }
                } else {  // Scrolling right
                    if (textX > MATRIX_WIDTH) {
                        textX = textMinX;
                    }
                }
            }
        }
    }

    matrix.show();
}

/* ==============================================================================
 * SETUP FUNCTION
 * ============================================================================== */

/**
 * @brief Arduino setup function - runs once at startup
 */
void setup() {
    // Initialize serial communication
    Serial.begin(115200);
    delay(1000);
    Serial.println("MatrixPortal M4 - LED Matrix Controller");
    Serial.println("========================================");

    // Initialize LED matrix
    ProtomatterStatus status = matrix.begin();
    if (status != PROTOMATTER_OK) {
        Serial.println("Matrix initialization failed!");
        while (true);  // Halt on error
    }

    // Configure matrix text settings
    matrix.setTextWrap(false);
    matrix.setTextSize(textSize);
    matrix.setTextColor(textColor);
    matrix.fillScreen(0);
    matrix.show();

    // Check WiFi module
    if (WiFi.status() == WL_NO_MODULE) {
        Serial.println("WiFi module not found!");
        while (true);  // Halt on error
    }

    String fv = WiFi.firmwareVersion();
    Serial.print("WiFi firmware: ");
    Serial.println(fv);

    // Connect to WiFi
    connectWiFi();
    recalculateTextBounds();

    // Start web server
    server.begin();
    Serial.println("Web server started!");
    Serial.println("Visit http://<IP>/displayGraphic to access control panel");

    // Configure buttons with internal pull-up resistor
    pinMode(BUTTON_UP, INPUT_PULLUP);
    pinMode(BUTTON_DOWN, INPUT_PULLUP);

    Serial.println("\nReady!");
    Serial.println("Type 'r' to retry WiFi connection");
}

/* ==============================================================================
 * MAIN LOOP
 * ============================================================================== */

/**
 * @brief Arduino loop function - runs continuously
 */
void loop() {
    unsigned long currentTime = millis();

    // Handle web server requests
    handleWebServer();

    // Handle serial commands
    if (Serial.available()) {
        char c = Serial.read();
        if (c == 'r' || c == 'R') {
            Serial.println("\n--- Reconnecting ---");
            connectWiFi();
            recalculateTextBounds();
        }
    }

    // Handle button input (LOW = pressed with INPUT_PULLUP)
    if (digitalRead(BUTTON_UP) == LOW) {
        Serial.println("Button UP pressed!");
        currentClick++;
        if (currentClick > 4) currentClick = 0;
        if (useClick) cycleThrough(currentClick);
        delay(200);  // Simple debounce
    }

    if (digitalRead(BUTTON_DOWN) == LOW) {
        Serial.println("Button DOWN pressed!");
        currentClick--;
        if (currentClick < 0) currentClick = 4;
        if (useClick) cycleThrough(currentClick);
        delay(200);  // Simple debounce
    }

    // Auto-reconnect WiFi check
    if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
        lastWiFiCheck = currentTime;
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("WiFi connection lost, reconnecting...");
            connectWiFi();
        }
    }

    // Handle OSC messages
    handleOSCMessages();

    // Update display
    updateDisplay(currentTime);
}