# LED Matrix Video Player - Installation Guide

## Disclaimer
if at any point the LED screens on the outside don't work, you can always contact URLAND so I can remote in trough teamviewer to reset the installation.

## Quick Start

1. **Upload firmware** to ESP32 (one-time via PlatformIO)
2. **Place video** in `host/content/default.mp4`
3. **Double-click** `WIN_START_MATRIX.bat` (Windows) or `LIN_START_MATRIX.sh` (Linux/Mac)

The application will automatically:
- Connect to the ESP32 device
- Load the default video
- Start playback

**Note for Linux/Mac users:** Run `chmod +x LIN_START_MATRIX.sh` first to make the script executable.

---

## Configuration

Edit `host/autoplay.json` to customize behavior:

```json
{
  "enabled": true,
  "autoConnect": true,
  "autoPlayVideo": true,
  "defaultVideoPath": "content/default.mp4",
  "reconnectAttempts": 10,
  "reconnectDelay": 3000
}
```

### Configuration Options

| Option | Type | Description |
| --- | --- | --- |
| `enabled` | boolean | Enable/disable autoplay mode |
| `autoConnect` | boolean | Automatically connect to device on startup |
| `autoPlayVideo` | boolean | Automatically start video playback |
| `defaultVideoPath` | string | Path to default video file (relative to `host/`) |
| `reconnectAttempts` | number | Number of reconnection attempts if connection is lost |
| `reconnectDelay` | number | Delay between reconnection attempts (milliseconds) |

---

## Video Content

### Supported Formats

- **Recommended:** MP4 (H.264 codec)
- **Resolution:** Any (will be scaled to 192x32)
- **Frame rate:** 24-30 fps recommended

### Adding Videos

1. Place video files in `host/content/` folder
2. Update `defaultVideoPath` in if needed `autoplay.json`
3. Restart the application

### File Naming Suggestions

`host/content/  ├── default.mp4          (main content)  ├── backup.mp4           (fallback)  └── seasonal/      ├── christmas.mp4      └── summer.mp4`

---


## Installation Requirements

### Prerequisites

- **Node.js** v16 or higher ([download](https://nodejs.org/))
- **USB driver** for ESP32 (usually auto-installed)

### First-Time Setup

`cd hostnpm install`

This is handled automatically by the startup scripts.

---


## Troubleshooting

### No Connection

- ✓ Check USB cable is connected
- ✓ Verify ESP32 is powered on
- ✓ Check COM port in Device Manager (Windows) or `ls /dev/tty*` (Linux/Mac)
- ✓ Restart the application

### Video Won't Load

- ✓ Check file format (MP4 recommended)
- ✓ Verify file path in `autoplay.json`
- ✓ Ensure file isn't corrupted (test in VLC player)

### Application Crashes After Days

- ✓ Restart via startup script
- ✓ Check system logs in application folder
- ✓ Verify USB cable quality (poor cables cause disconnects)

### Port Detection Issues

Edit and add your specific port pattern: `autoplay.json`

`{  "portPatterns": [    "ttyUSB",    "ttyACM",    "cu.usbserial",    "cu.usbmodem",    "COM"  ]}`

---


## Remote Support

### TeamViewer

TeamViewer is installed for remote assistance. Contact Urland for support.

### SSH Monitoring (Linux/Mac)

For headless installations, use `screen` to keep the app running:

`# Start in screen sessionscreen -S ledmatrix./LIN_START_MATRIX.sh# Detach: Ctrl+A, then D# Reattach later: screen -r ledmatrix`

### View Logs

Logs are printed to the console. To save logs to a file:

**Windows:**

`WIN_START_MATRIX.bat > logs.txt 2>&1`

**Linux/Mac:**

`./LIN_START_MATRIX.sh > logs.txt 2>&1`

---


## Manual Operation

If autoplay is disabled, you can control the display manually:

### Via Application UI

1. Connect to device
2. Load video file
3. Click "Play"

### Via Serial Commands

Connect via serial terminal (921600 baud) and send:

- Show test pattern `T`
- `C` - Clear display
- `V` - Start video mode
- `S` - Stop video mode

---


## Performance Tips

### For Long-Term Installations (Weeks/Months)

1. **Disable verbose logging** in : `main.js`

`const ENABLE_VERBOSE_LOGGING = false;`

1. **Use low-resolution video** (saves bandwidth):
    - Max 480p source recommended
    - Application scales down to 192x32 anyway
2. **Loop short clips** instead of hours-long videos:
    - Better for memory management
    - Easier to update content
3. **Setup auto-restart** (optional):

   **Windows Task Scheduler:**

    - Create task to run on startup `WIN_START_MATRIX.bat`
    - Set to restart on failure

   **Linux systemd:**


`sudo nano /etc/systemd/system/ledmatrix.service`

`[Unit]Description=LED Matrix Video PlayerAfter=network.target[Service]Type=simpleUser=youruserWorkingDirectory=/path/to/LedMatrixExecDeusExecStart=/path/to/LIN_START_MATRIX.shRestart=alwaysRestartSec=10[Install]WantedBy=multi-user.target`

`sudo systemctl enable ledmatrixsudo systemctl start ledmatrix`

---


## Full Reset Procedure

If everything fails:

1. **Close application** (Ctrl+C or close window)
2. **Unplug USB** from ESP32
3. **Delete** `host/node_modules` folder
4. **Run startup script** again
5. **Reconnect USB** when prompted

If still not working, contact Urland for remote support via TeamViewer.

---


## Technical Specifications

- **Display Resolution:** 192x32 pixels
- **Color Depth:** RGB565 (16-bit)
- **Frame Size:** 12,288 bytes per frame
- **Serial Speed:** 921600 baud
- **USB Protocol:** CDC ACM (Virtual Serial Port)

---


## Support

For technical support or questions:

- **Remote Support:** TeamViewer (contact Urland)

---

---

**Version:** 1.0.0

**Last Updated:** 2026-05-20