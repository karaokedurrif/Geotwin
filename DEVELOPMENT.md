# GeoTwin Development Guide

## Quick Start

### Start Development Environment

```bash
# From repository root
pnpm dev
```

This command runs `tools/dev-up.sh` which:
1. Kills any processes on ports 3000 and 3001
2. Starts API server on port 3001
3. Starts Web server on port 3000
4. Performs health checks
5. Shows logs location and status

### Server URLs

- **API Server**: http://localhost:3001
- **Web Server**: http://localhost:3000

## Verification Commands

### 1. Check API Health

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-02-20T09:38:29.091Z"}
```

### 2. Check Web Server

```bash
# Open in browser
open http://localhost:3000

# Or test with curl
curl -s http://localhost:3000 | grep "GeoTwin"
```

### 3. Check Running Processes

```bash
ps aux | grep -E "(tsx.*server|next dev)" | grep -v grep
```

### 4. Check Ports

```bash
lsof -i :3001  # API
lsof -i :3000  # Web
```

## Development Logs

Logs are written to:
- **API**: `/tmp/geotwin-api.log`
- **Web**: `/tmp/geotwin-web.log`

View logs in real-time:
```bash
tail -f /tmp/geotwin-api.log
tail -f /tmp/geotwin-web.log
```

## Stop Servers

```bash
pkill -f 'pnpm dev'
```

## Port Configuration

### API Server (apps/api)

The API server is configured to **always use port 3001** in development.

**Configuration** (`apps/api/src/server.ts`):
```typescript
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
```

If port 3001 is already in use, the server will **fail** (not switch to another port). Use `pnpm dev` which automatically cleans up ports before starting.

### Web Server (apps/web)

Next.js development server uses port 3000 by default.

**Configuration** (`apps/web/package.json`):
```json
{
  "scripts": {
    "dev": "next dev -p 3000"
  }
}
```

## Troubleshooting

### Port Already in Use

If you see "address already in use" errors:

```bash
# Kill all development processes
pkill -9 -f "pnpm dev"
pkill -9 -f "tsx"
pkill -9 -f "next"

# Force-kill specific ports
fuser -k 3000/tcp
fuser -k 3001/tcp

# Restart
pnpm dev
```

### API Not Responding

1. Check if API is running:
   ```bash
   lsof -i :3001
   ```

2. Check API logs:
   ```bash
   tail -50 /tmp/geotwin-api.log
   ```

3. Test health endpoint:
   ```bash
   curl -v http://localhost:3001/health
   ```

### Web Not Loading

1. Check if Next.js is running:
   ```bash
   lsof -i :3000
   ```

2. Check compilation status:
   ```bash
   tail -50 /tmp/geotwin-web.log
   ```

3. Wait for compilation (Next.js may take 10-60 seconds on first start)

## API Endpoints

### Health Check
```bash
GET http://localhost:3001/health
```

### Import Cadastral File
```bash
POST http://localhost:3001/api/import
Content-Type: multipart/form-data

# Form data:
# - file: KML/GML/ZIP file
# - preset: 'mountain' | 'dehesa' | 'mediterranean'
```

### NDVI Data
```bash
GET http://localhost:3001/api/ndvi
```

### Geospatial Services
```bash
POST http://localhost:3001/api/geospatial/*
```

## Architecture Changes

### Fixed Port Configuration (v0.1.0)

**Problem**: API server was using `get-port` library to find available ports, causing it to switch to random ports (44059, 38417, etc.) when 3001 was in use.

**Solution**: 
1. Removed `get-port` dependency logic from `apps/api/src/server.ts`
2. Changed to fixed port: `const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;`
3. Created `tools/dev-up.sh` to clean ports before starting servers
4. Updated root `package.json` dev script to use the new startup script

**Benefits**:
- Predictable URLs in development
- No more "Port 3001 is in use, using XXXX instead" messages
- Robust startup with automatic cleanup
- Health checks and log monitoring built-in

## Additional Scripts

### Manual Server Start

If you need to start servers individually:

```bash
# API only
cd apps/api
pnpm dev

# Web only
cd apps/web
pnpm dev
```

### Build for Production

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```
