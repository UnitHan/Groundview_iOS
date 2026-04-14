#!/bin/bash
# Helper script to start iproxy for GroundView iOS

echo "Starting iproxy for GroundView iOS..."
echo "This will forward iOS device port 8100 to localhost:8100"
echo ""

# Check if iproxy is installed
if ! command -v iproxy &> /dev/null; then
    echo "❌ Error: iproxy is not installed"
    echo ""
    echo "Please install with Homebrew:"
    echo "  brew install libusbmuxd"
    echo ""
    exit 1
fi

# Check if device is connected
DEVICE_ID=$(idevice_id -l 2>/dev/null | head -1)
if [ -z "$DEVICE_ID" ]; then
    echo "❌ Error: No iOS device connected"
    echo ""
    echo "Please connect your iPhone via USB and trust this computer"
    echo ""
    exit 1
fi

echo "✓ Device found: $DEVICE_ID"
echo ""

# Check if port 8100 is already in use
if lsof -Pi :8100 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 8100 is already in use"
    echo ""
    read -p "Kill existing process and restart? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pkill -f "iproxy.*8100" 2>/dev/null
        sleep 1
    else
        echo "Cancelled"
        exit 0
    fi
fi

# Start iproxy
echo "Starting iproxy 8100:8100..."
echo ""
echo "Keep this terminal window open while using GroundView iOS"
echo "Press Ctrl+C to stop"
echo ""

iproxy 8100:8100
