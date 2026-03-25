# ==============================================================================
# Dockerfile for GeoTwin Illustration Service (Python/FastAPI)
# Build context: apps/illustration-service/
# ==============================================================================

FROM python:3.12-slim

# Install system dependencies for image processing
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Create directory for generated illustrations
RUN mkdir -p /app/generated

# Create non-root user
RUN useradd -m appuser && \
    chown -R appuser:appuser /app/generated

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8001

# Environment variable
ENV PORT=8001

# Start FastAPI server with Uvicorn
CMD ["python3", "main.py"]
