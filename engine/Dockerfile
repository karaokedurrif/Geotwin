# ==============================================================================
# Dockerfile — GeoTwin Engine (Python processing)
# ==============================================================================
# Builds: terrain mesh pipeline, NDVI, 3D Tiles export
# Runtime: FastAPI + uvicorn
# Size: ~1.5 GB (GDAL + Open3D + scientific stack)
# ==============================================================================

FROM python:3.12-slim AS base

# GDAL and spatial libraries (required by rasterio, fiona, pyproj)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.110" \
    "uvicorn[standard]>=0.29" \
    && pip install --no-cache-dir -e ".[dev]"

# Copy engine source
COPY engine/ ./engine/

# Data directories (volumes in production)
RUN mkdir -p /app/data/tiles /app/data/dem

ENV GEOTWIN_ENGINE_DATA_DIR=/app/data \
    GEOTWIN_ENGINE_TILES_DIR=/app/data/tiles \
    GEOTWIN_ENGINE_DEM_DIR=/app/data/dem

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/health')"

CMD ["uvicorn", "engine.api:app", "--host", "0.0.0.0", "--port", "8002"]
