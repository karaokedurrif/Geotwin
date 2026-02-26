#!/usr/bin/env bash
set -e

# GeoTwin Development Environment Startup Script
# Kills processes on ports 3000 and 3001, starts API and Web servers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

API_LOG="/tmp/geotwin-api.log"
WEB_LOG="/tmp/geotwin-web.log"
ILLUSTRATION_LOG="/tmp/geotwin-illustration.log"

echo "🌍 GeoTwin Development Environment Setup"
echo "========================================"
echo ""

# Function to kill process on a port
kill_port() {
  local port=$1
  echo "🔍 Checking port $port..."
  
  # Use lsof to find and kill processes
  local pids=$(lsof -ti tcp:$port 2>/dev/null || true)
  
  if [ -n "$pids" ]; then
    echo "   Killing processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
  
  # Use fuser as backup to force-kill any remaining processes
  fuser -k -9 $port/tcp 2>/dev/null || true
  sleep 0.5
  
  # Verify port is free
  if lsof -ti tcp:$port 2>/dev/null; then
    echo "   ⚠️  Port $port still in use, forcing cleanup..."
    lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 1
  else
    echo "   ✅ Port $port is free"
  fi
}

# Kill existing processes on development ports
echo "📌 Step 1: Cleaning up ports..."
# First kill all dev processes
pkill -9 -f "pnpm dev" 2>/dev/null || true
pkill -9 -f "tsx.*server" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
sleep 1

# Then clean specific ports
kill_port 3000
kill_port 3001
kill_port 8001
echo ""

# Clear previous logs
> "$API_LOG"
> "$ILLUSTRATION_LOG"
> "$WEB_LOG"

# Start API server
echo "📌 Step 2: Starting API server (port 3001)..."
cd "$ROOT_DIR/apps/api"
nohup pnpm dev > "$API_LOG" 2>&1 &
API_PID=$!
echo "   API server started (PID: $API_PID)"
echo "   Logs: $API_LOG"
echo ""

# Start Web server
echo "📌 Step 3: Starting Web server (port 3000)..."
cd "$ROOT_DIR/apps/web"
nohup pnpm dev > "$WEB_LOG" 2>&1 &
WEB_PID=$!
echo "   Web server started (PID: $WEB_PID)"
echo "   Logs: $WEB_LOG"
echo ""

# Start Illustration Service (Python)
echo "📌 Step 4: Starting Illustration Service (port 8001)..."
cd "$ROOT_DIR/apps/illustration-service"
if [ -f "main.py" ]; then
  # Check if virtual environment exists
  if [ ! -d "venv" ]; then
    echo "   Creating Python virtual environment..."
    python3 -m venv venv
  fi
  
  # Activate venv and install dependencies
  source venv/bin/activate
  if [ -f "requirements.txt" ]; then
    pip install -q -r requirements.txt > /dev/null 2>&1 || true
  fi
  
  # Start the service
  nohup python3 main.py > "$ILLUSTRATION_LOG" 2>&1 &
  ILLUSTRATION_PID=$!
  echo "   Illustration service started (PID: $ILLUSTRATION_PID)"
  echo "   Logs: $ILLUSTRATION_LOG"
else
  echo "   ⚠️  Illustration service not found (optional)"
  ILLUSTRATION_PID=""
fi
echo ""

# Wait for servers to initialize
echo "📌 Step 5: Health checks..."
echo -n "   Waiting for API..."

# Retry health check for API (max 30 seconds)
API_READY=false
for i in {1..30}; do
  if curl -s -f http://localhost:3001/health > /dev/null 2>&1; then
    API_READY=true
    echo " ✅ READY"
    break
  fi
  echo -n "."
  sleep 1
done

if [ "$API_READY" = false ]; then
  echo " ⚠️  TIMEOUT (check logs)"
fi

# Wait for Web server to respond (max 30 seconds)
echo -n "   Waiting for Web..."
WEB_READY=false
for i in {1..30}; do
  if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
    WEB_READY=true
    echo " ✅ READY"
    break
  fi
  echo -n "."
  sleep 1
done

if [ "$WEB_READY" = false ]; then
  echo " ⚠️  TIMEOUT (may still be compiling)"
fi

# Check if Illustration service is listening (if enabled)
if [ -n "$ILLUSTRATION_PID" ]; then
  echo -n "   Waiting for Illustration service..."
  ILLUSTRATION_READY=false
  for i in {1..20}; do
    if lsof -i tcp:8001 -sTCP:LISTEN > /dev/null 2>&1; then
      ILLUSTRATION_READY=true
      echo " ✅ READY"
      break
    fi
    echo -n "."
    sleep 1
  done
  
  if [ "$ILLUSTRATION_READY" = false ]; then
    echo " ⚠️  TIMEOUT (check logs)"
  fi
fi

echo ""
echo "========================================"
echo "✨ GeoTwin Development Environment Ready"
echo "========================================"
echo ""
echo "📡 API Server:         http://localhost:3001"
echo "   Health:             http://localhost:3001/health"
echo "   Logs:               $API_LOG"
echo ""
echo "🌐 Web Server:         http://localhost:3000"
echo "   Logs:               $WEB_LOG"
echo ""
if [ -n "$ILLUSTRATION_PID" ]; then
echo "🎨 Illustration:       http://localhost:8001"
echo "   Logs:               $ILLUSTRATION_LOG"
echo ""
fi
echo "🔧 Commands:"
echo "   tail -f $API_LOG"
echo "   tail -f $WEB_LOG"
if [ -n "$ILLUSTRATION_PID" ]; then
echo "   tail -f $ILLUSTRATION_LOG"
fi
echo "   curl http://localhost:3001/health"
echo ""
echo "🛑 To stop: pkill -f 'pnpm dev' && pkill -f 'python3 main.py'"
echo ""
