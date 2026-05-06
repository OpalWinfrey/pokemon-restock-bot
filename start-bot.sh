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

echo "Starting bot... (Ctrl+C to stop)"
echo ""

node src/index.js
