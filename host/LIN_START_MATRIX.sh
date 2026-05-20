#!/bin/bash

echo "========================================"
echo "LED Matrix Museum Installation Starter"
echo "========================================"
echo ""

cd "$(dirname "$0")/host"

echo "[1/2] Checking Node modules..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "[2/2] Starting application..."
echo ""
echo "Press Ctrl+C to stop"
echo ""

npm start