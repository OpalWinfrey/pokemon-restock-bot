#!/bin/bash
cd "$(dirname "$0")"

echo "============================================"
echo "  Pokemon Restock Bot - Starting up..."
echo "============================================"
echo ""

# Check .env
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Create it first."
  exit 1
fi

# Kill any existing instance so we never run two at once
if pgrep -f "node src/index.js" > /dev/null; then
  echo "Stopping existing bot process..."
  pkill -9 -f "node src/index.js" 2>/dev/null
  sleep 1
fi

echo "Starting bot... (Ctrl+C to stop)"
echo ""

node src/index.js
