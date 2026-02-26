# GeoTwin Illustration Generator - Usage Guide

## 🚀 Quick Start

### 1. Setup (One Time)

```bash
cd apps/illustration-service
./setup.sh
```

This will:
- Install Python dependencies
- Create `.env` file from template
- Check your Python version

### 2. Configure API Token

**Option A: Replicate (Recommended)**

1. Go to https://replicate.com and create a free account
2. Navigate to Settings → API Tokens
3. Copy your token (starts with `r8_`)
4. Edit `.env` and add:
   ```bash
   REPLICATE_API_TOKEN=r8_your_token_here
   ```

**Option B: fal.ai (Alternative)**

1. Go to https://fal.ai and create an account
2. Get your API key
3. Edit `.env` and add:
   ```bash
   FAL_KEY=your_fal_key_here
   ```

### 3. Test the Pipeline

Before starting the server, test with a real snapshot:

```bash
# Using a snapshot JSON file
python test_quick.py ../api/data/some_twin_id/snapshot.json

# Or from the web app exports
python test_quick.py ~/Downloads/geotwin_XXXXXXXX_export.json
```

**Expected output:**
```
📦 Snapshot: a1b2c3d4
📐 Área: 134.8 ha
📍 Centroide: [-5.1234, 40.5678]

🔍 Analizando vegetación...
   Tipo: dehesa mediterránea
   Densidad: abierta con sotobosque de jara y retama
   Estación: verano, pasto seco dorado

⛰ Analizando terreno...
   Tamaño: gran finca extensiva de 135 hectáreas
   Forma: forma irregular con leves entrantes

✍️ Construyendo prompt...

📝 PROMPT POSITIVO:
hyperrealistic isometric illustration, aerial oblique view at 45 degrees...

🎨 Generando ilustración con Flux... (20-30 segundos)

✅ Imagen generada: https://replicate.delivery/...
```

The URL will open a hyperrealistic isometric illustration of your parcel!

### 4. Start the Service

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 5. Use from Studio UI

1. Open GeoTwin web app: `http://localhost:3000`
2. Export a parcel to create a Digital Twin
3. Click "Open in Studio →"
4. In Studio, click **🎨 Ilustración** button in top bar
5. Wait 20-30 seconds while the AI generates the illustration
6. View, download, or use the generated image

## 🎨 Style Variants

The illustration adapts to your current Studio preset:

| Preset | Visual Style |
|--------|-------------|
| **Natural** | Golden hour lighting, warm tones, cyan boundary |
| **Topográfico** | Contour lines visible, amber/red overlay, dramatic relief |
| **NDVI** | False color vegetation analysis, greens and ambers |
| **Nocturno** | Moonlit scene, blue-purple tones, glowing IoT nodes |
| **Minimal** | Clean architectural rendering, muted palette |

## 🔍 API Endpoints

### POST /generate-illustration

Start a new illustration job.

**Request:**
```json
{
  "snapshot": { /* full TwinSnapshot object */ },
  "style": "natural",
  "extra_elements": ["iot", "cattle"],
  "width": 1024,
  "height": 1024,
  "provider": "replicate"
}
```

**Response:**
```json
{
  "job_id": "a1b2c3d4",
  "status": "pending",
  "message": "Generación iniciada. Consulta /status/{job_id} cada 5s"
}
```

### GET /status/{job_id}

Check generation progress.

**Response (pending):**
```json
{
  "job_id": "a1b2c3d4",
  "status": "analyzing",
  "image_url": null,
  "error": null
}
```

**Response (completed):**
```json
{
  "job_id": "a1b2c3d4",
  "status": "completed",
  "image_url": "https://replicate.delivery/...",
  "prompt": "hyperrealistic isometric illustration...",
  "error": null
}
```

**Status values:**
- `pending` - Job queued
- `analyzing` - Analyzing vegetation and terrain
- `building_prompt` - Constructing AI prompt
- `generating` - Calling Flux API (20-30s)
- `completed` - Image ready
- `error` - Generation failed

## 🐛 Troubleshooting

### Problem: "REPLICATE_API_TOKEN not set"

**Solution:**
- Edit `.env` file and add your Replicate token
- Make sure there are no quotes around the token
- Restart the server after editing .env

### Problem: "Connection refused to localhost:8001"

**Solution:**
- Make sure the Python service is running: `uvicorn main:app --port 8001`
- Check the terminal for error messages
- Verify port 8001 is not in use: `lsof -i :8001`

### Problem: Image generation is very slow

**Causes:**
- Replicate API might be under load
- Network connection slow

**Solutions:**
- Try fal.ai provider instead (faster): `"provider": "fal"` in request
- Use flux-schnell model for 5s generation (lower quality)
- Check Replicate status: https://status.replicate.com

### Problem: Generated image doesn't match parcel

**Solution:**
- Verify snapshot.json has correct GeoJSON coordinates
- Check that `area_ha` and `perimeter_m` are realistic
- Try different style presets for better results
- Adjust `extra_elements` to add/remove features

### Problem: Server crashes with import errors

**Solution:**
```bash
# Reinstall dependencies
pip install -r requirements.txt --break-system-packages --force-reinstall

# Check Python version (need 3.11+)
python3 --version
```

## 💡 Tips for Best Results

### 1. Use Accurate Snapshots
- Export from a real parcel with proper geometry
- Ensure camera position is saved (isometric view works best)
- Include ESG data if available for better vegetation analysis

### 2. Choose the Right Style
- **Natural**: Best for presentations and pitches
- **Topográfico**: Shows terrain features clearly
- **NDVI**: Scientific/agricultural reports
- **Night**: Dramatic IoT sensor visualizations

### 3. Customize with Extra Elements
```json
{
  "extra_elements": ["cattle", "buildings", "water"]
}
```
- `cattle` - Adds Avileña cattle grazing
- `iot` - IoT sensor stations with LED lights
- `water` - Natural streams and water points
- `buildings` - Traditional stone farm buildings

### 4. Optimize Generation Time
- Start with 512x512 for testing, then 1024x1024 for final
- Use `flux-schnell` model for fast previews (edit `image_generator.py`)
- Cache results - don't regenerate the same snapshot multiple times

## 📊 Cost Estimation

| Provider | Model | Speed | Quality | Cost/Image |
|----------|-------|-------|---------|------------|
| Replicate | flux-dev | 20s | High | Free (initial credits) |
| Replicate | flux-pro | 30s | Highest | ~$0.055 |
| Replicate | flux-schnell | 5s | Medium | Free |
| fal.ai | flux-dev | 15s | High | ~$0.025 |

**Demo budget:** < €1 for 10-20 high-quality illustrations

## 🔗 Resources

- **Replicate Docs**: https://replicate.com/docs
- **Flux Model**: https://replicate.com/black-forest-labs/flux-dev
- **fal.ai Docs**: https://fal.ai/docs
- **GeoTwin Project**: See main README.md

## 📝 Example Workflow

```bash
# 1. Terminal 1: Start illustration service
cd apps/illustration-service
uvicorn main:app --port 8001 --reload

# 2. Terminal 2: Start web app
cd apps/web
pnpm dev

# 3. Browser:
# - Open http://localhost:3000
# - Load parcel
# - Export to Studio
# - Click "🎨 Ilustración"
# - Wait ~25 seconds
# - Download PNG

# 4. Use illustration:
# - Pitch decks
# - Technical documentation
# - Marketing materials
# - Client presentations
```

---

**Questions?** Check the main project documentation or review the code comments in `services/` for implementation details.
