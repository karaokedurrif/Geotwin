# GeoTwin Illustration Service

Python FastAPI service that generates hyperrealistic isometric illustrations from GeoTwin snapshots using AI (Flux/Replicate).

## Setup

```bash
# Install dependencies
pip install -r requirements.txt --break-system-packages

# Create .env file from template
cp .env.example .env

# Edit .env and add your Replicate API token
# Register at https://replicate.com (free tier available)
```

## Quick Test

Test the pipeline without running the full server:

```bash
python test_quick.py ../path/to/snapshot.json
```

## Run Server

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## API Endpoints

- `POST /generate-illustration` - Start illustration generation
- `GET /status/{job_id}` - Check generation status
- `GET /health` - Health check

## Architecture

- `services/ndvi_analyzer.py` - Analyzes vegetation from snapshot
- `services/terrain_analyzer.py` - Analyzes terrain characteristics
- `services/prompt_builder.py` - Builds AI prompt from context
- `services/image_generator.py` - Calls Replicate/fal.ai API
- `routes/generate.py` - Main API routes
