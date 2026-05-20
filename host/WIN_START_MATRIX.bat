@echo off
     echo ========================================
     echo LED Matrix Museum Installation Starter
     echo ========================================
     echo.

     cd /d "%~dp0"

     echo [1/2] Checking Node modules...
     if not exist "node_modules\" (
         echo Installing dependencies...
         call npm install
     )

     echo [2/2] Starting application...
     echo.
     echo Press Ctrl+C to stop
     echo.

     npm start

     pause