#!/bin/bash
# hyperreal-local.sh — Inicia el servicio hyperreal localmente (GPU RTX 5080 Laptop)

set -e

echo "🚀 Iniciando GeoTwin Hyperreal (local GPU)..."
echo ""
echo "GPU detectada:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
echo ""

# Verificar que Docker está corriendo
if ! docker info &> /dev/null; then
  echo "❌ Error: Docker no está corriendo"
  exit 1
fi

# Verificar nvidia-docker runtime
if ! docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
  echo "❌ Error: nvidia-docker runtime no disponible"
  echo "Instala: sudo apt install nvidia-container-toolkit"
  exit 1
fi

echo "✅ Docker + nvidia runtime OK"
echo ""

# Levantar solo el servicio hyperreal
echo "🔧 Construyendo imagen hyperreal..."
docker compose build geotwin-hyperreal

echo ""
echo "🚀 Iniciando servicio hyperreal..."
docker compose --profile hyperreal up -d geotwin-hyperreal

echo ""
echo "⏳ Esperando que el servicio esté listo..."
sleep 5

# Verificar salud
if curl -s http://localhost:8003/health | grep -q "ok"; then
  echo "✅ Servicio hyperreal listo en http://localhost:8003"
  echo ""
  echo "📊 Logs en tiempo real:"
  echo "   docker compose logs -f geotwin-hyperreal"
  echo ""
  echo "🎨 ComfyUI dev UI:"
  echo "   http://localhost:8188"
  echo ""
  echo "⚠️  Primera ejecución descargará modelos (~15GB, puede tardar 10-15 min)"
else
  echo "⚠️  Servicio iniciado pero no responde aún"
  echo "   Verifica logs: docker compose logs geotwin-hyperreal"
fi
