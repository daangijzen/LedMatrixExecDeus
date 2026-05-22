@echo off
echo ========================================
echo LED Matrix Museum Installation Starter
echo ========================================
echo.

REM Ga naar de directory waar dit script staat
cd /d "%~dp0"

REM Controleer of Node.js geïnstalleerd is
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is niet geinstalleerd!
    echo Download Node.js van: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [1/3] Checking Node modules...
if not exist "node_modules\" (
    echo Installing dependencies (first time only)...
    call npm ci
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: npm install failed!
        pause
        exit /b 1
    )
) else (
    echo Dependencies already installed
)

echo [2/3] Checking Electron compatibility...
if exist "node_modules\electron\" (
    REM Verwijder electron om platform-specifieke versie te forceren
    echo Removing old Electron binaries...
    rmdir /s /q "node_modules\electron" 2>nul
    rmdir /s /q "node_modules\.bin" 2>nul

    echo Reinstalling Electron for this platform...
    call npm install electron@^28.0.0 --save-dev
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: Electron install failed!
        pause
        exit /b 1
    )
)

echo [3/3] Starting LED Matrix application...
echo.
echo Press Ctrl+C to stop
echo.

npm start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Application crashed!
    pause
)