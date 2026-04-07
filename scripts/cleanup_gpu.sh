#!/bin/bash
# Limpia RAM y VRAM para máximo rendimiento
# Uso: ./scripts/cleanup_gpu.sh

echo "═══ LIMPIEZA DE SISTEMA ═══"

# 1. Limpiar caché de disco
sync
echo 3 | sudo tee /proc/sys/vm/drop_caches > /dev/null 2>&1
echo "✓ Caché de disco limpiada"

# 2. Matar navegadores que no se usen (liberan VRAM)
for proc in chrome chromium-browser electron; do
  if pgrep -x "$proc" > /dev/null 2>&1; then
    echo "⚠ $proc está corriendo — ¿cerrar? (s/n)"
    read -r resp
    if [ "$resp" = "s" ]; then
      killall "$proc" 2>/dev/null
      echo "✓ $proc cerrado"
    fi
  fi
done

# 3. Limpiar VRAM
python3 -c "
import torch, gc
if torch.cuda.is_available():
    torch.cuda.empty_cache()
    gc.collect()
    free, total = torch.cuda.mem_get_info()
    print(f'✓ VRAM: {free/1024**3:.1f}GB libre / {total/1024**3:.1f}GB total')
else:
    print('⚠ CUDA no disponible')
" 2>/dev/null || echo "⚠ PyTorch no instalado en este entorno"

# 4. Estado de RAM
python3 -c "
import psutil
ram = psutil.virtual_memory()
swap = psutil.swap_memory()
print(f'✓ RAM: {ram.available/1024**3:.1f}GB libre / {ram.total/1024**3:.1f}GB total ({ram.percent}% usado)')
if swap.total > 0:
    print(f'  Swap: {swap.used/1024**3:.1f}GB usado / {swap.total/1024**3:.1f}GB total')
" 2>/dev/null || free -h

# 5. Docker (solo si hay contenedores locales)
if command -v docker &> /dev/null && docker ps -q 2>/dev/null | head -1 > /dev/null; then
  echo ""
  echo "═══ DOCKER LOCAL ═══"
  docker system df
  echo ""
  echo "¿Limpiar caché de Docker? (s/n)"
  read -r resp
  if [ "$resp" = "s" ]; then
    docker builder prune -af
    docker image prune -f
    echo "✓ Docker limpiado"
  fi
fi

echo ""
echo "═══ GPU ═══"
nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader 2>/dev/null || echo "nvidia-smi no disponible"
echo ""
echo "✅ Limpieza completada"
