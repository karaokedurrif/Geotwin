#!/usr/bin/env python3
"""memory_guardian.py — Daemon que monitoriza RAM y VRAM cada 20 min.

Limpia caches, mata procesos huérfanos, y previene que el portátil se bloquee.
Diseñado para convivir con:
  - Seedy (YOLO + Docker containers) → NUNCA se toca
  - GeoTwin engine/web/api → se respeta
  - VSCode → se respeta
  - ComfyUI local → se respeta (pero limpia su VRAM cache)

Uso:
  python scripts/memory_guardian.py              # foreground (con logs)
  python scripts/memory_guardian.py --once       # ejecutar una vez y salir
  python scripts/memory_guardian.py --daemon     # background (para systemd)
  python scripts/memory_guardian.py --interval 600  # cada 10 min

Requiere: psutil (pip install psutil)
Opcional: torch (para limpieza VRAM)
"""

import argparse
import gc
import json
import logging
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import psutil
except ImportError:
    print("ERROR: psutil requerido. Instalar con: pip install psutil", file=sys.stderr)
    sys.exit(1)

# ─── Configuración ───────────────────────────────────────────────────────────

# Umbrales (porcentaje)
RAM_WARNING_PCT = 70       # Aviso: empezar limpieza suave
RAM_CRITICAL_PCT = 85      # Crítico: limpieza agresiva + matar procesos
VRAM_WARNING_PCT = 80      # Aviso VRAM
VRAM_CRITICAL_PCT = 92     # Crítico VRAM

# Limpieza proactiva: se ejecuta SIEMPRE en cada ciclo (sin umbral)
# Esto es lo que evita que el portátil se bloquee sin reiniciar
PROACTIVE_CLEAN = True

# Procesos PROTEGIDOS — NUNCA matar (substrings del cmdline o nombre)
PROTECTED_PROCESSES = {
    # Seedy
    "seedy", "yolo", "ultralytics",
    # Docker (contiene Seedy y servicios)
    "dockerd", "containerd", "docker-proxy", "docker-compose",
    "runc", "containerd-shim",
    # Sistema
    "systemd", "dbus", "gdm", "gnome-shell", "Xorg", "xdg",
    "pulseaudio", "pipewire", "wireplumber",
    "NetworkManager", "snapd", "polkitd",
    "sshd", "ssh-agent", "gpg-agent",
    # GeoTwin
    "geotwin", "uvicorn engine",
    # VSCode
    "code", "vscode",
    # Editores / herramientas dev
    "vim", "nvim", "nano",
    # Init / kernel
    "init", "kthreadd",
    # Postgres / DB (Seedy lo usa)
    "postgres", "timescaledb",
    # ComfyUI (se limpia VRAM, no se mata)
    "comfyui",
}

# Procesos candidatos a matar si consumen demasiada RAM
KILLABLE_PATTERNS = {
    # Navegadores — son los peores devoradores de RAM/VRAM
    "chromium": {"ram_threshold_mb": 4000, "signal": signal.SIGTERM},
    "chrome": {"ram_threshold_mb": 4000, "signal": signal.SIGTERM},
    "firefox": {"ram_threshold_mb": 5000, "signal": signal.SIGTERM},
    # Electron apps sueltas (no VSCode)
    "electron": {"ram_threshold_mb": 3000, "signal": signal.SIGTERM},
    # Procesos Python huérfanos (no protegidos)
    "python": {"ram_threshold_mb": 4000, "signal": signal.SIGTERM},
}

# Intervalo por defecto (segundos)
DEFAULT_INTERVAL = 1200  # 20 minutos

LOG_DIR = Path.home() / ".local" / "share" / "memory-guardian"
LOG_FILE = LOG_DIR / "guardian.log"

# ─── Logger ──────────────────────────────────────────────────────────────────

def setup_logging(daemon_mode: bool = False) -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("memory_guardian")
    logger.setLevel(logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Archivo siempre (rotar a 5MB)
    from logging.handlers import RotatingFileHandler
    fh = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    # Console solo si no es daemon
    if not daemon_mode:
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(fmt)
        logger.addHandler(ch)

    return logger


# ─── Utilidades ──────────────────────────────────────────────────────────────

def get_ram_info() -> dict:
    """Retorna info de RAM en formato legible."""
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    return {
        "total_gb": mem.total / (1024 ** 3),
        "used_gb": mem.used / (1024 ** 3),
        "available_gb": mem.available / (1024 ** 3),
        "percent": mem.percent,
        "swap_used_gb": swap.used / (1024 ** 3),
        "swap_total_gb": swap.total / (1024 ** 3),
    }


def get_vram_info() -> dict | None:
    """Retorna info de VRAM via nvidia-smi (no necesita torch)."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,memory.free,temperature.gpu,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None
        parts = result.stdout.strip().split(", ")
        if len(parts) < 5:
            return None
        used, total, free = int(parts[0]), int(parts[1]), int(parts[2])
        return {
            "used_mb": used,
            "total_mb": total,
            "free_mb": free,
            "percent": (used / total * 100) if total > 0 else 0,
            "temp_c": int(parts[3]),
            "util_pct": int(parts[4]),
        }
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        return None


def is_protected(proc: psutil.Process) -> bool:
    """Verifica si un proceso está protegido."""
    try:
        name = proc.name().lower()
        cmdline = " ".join(proc.cmdline()).lower()

        # Nunca matar procesos del sistema (PID bajo)
        if proc.pid <= 100:
            return True

        # Nunca matar procesos root de Docker (contenedores Seedy)
        if proc.username() == "root":
            return True

        # Verificar contra patrones protegidos
        for pattern in PROTECTED_PROCESSES:
            if pattern in name or pattern in cmdline:
                return True

        # Nunca matar el proceso padre de este script
        if proc.pid == os.getpid() or proc.pid == os.getppid():
            return True

        return False
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return True  # Si no podemos leer, no matar


def get_process_memory_mb(proc: psutil.Process) -> float:
    """RSS en MB."""
    try:
        return proc.memory_info().rss / (1024 ** 2)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return 0


# ─── Acciones de limpieza ────────────────────────────────────────────────────

def clean_page_cache(logger: logging.Logger) -> bool:
    """Limpia el page cache del kernel (requiere sudo sin password o ser root)."""
    try:
        # sync primero para no perder datos
        subprocess.run(["sync"], timeout=30)
        result = subprocess.run(
            ["sudo", "-n", "tee", "/proc/sys/vm/drop_caches"],
            input="3", capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            logger.info("  ✓ Page cache limpiado (drop_caches=3)")
            return True
        else:
            logger.debug("  ⚠ No se pudo limpiar page cache (sudo sin password requerido)")
            return False
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def clean_vram_cache(logger: logging.Logger) -> bool:
    """Limpia VRAM cache via PyTorch si está disponible."""
    try:
        import torch
        if torch.cuda.is_available():
            before = torch.cuda.memory_allocated() / (1024 ** 2)
            torch.cuda.empty_cache()
            gc.collect()
            after = torch.cuda.memory_allocated() / (1024 ** 2)
            freed = before - after
            if freed > 1:
                logger.info("  ✓ VRAM cache: liberados %.0f MB (torch)", freed)
            else:
                logger.info("  ✓ VRAM cache: torch.cuda.empty_cache() ejecutado (sin cambio significativo)")
            return True
    except ImportError:
        logger.debug("  ⚠ PyTorch no disponible — VRAM cache no limpiada vía torch")
    except Exception as e:
        logger.warning("  ⚠ Error limpiando VRAM cache: %s", e)
    return False


def clean_python_gc(logger: logging.Logger) -> int:
    """Fuerza garbage collection de Python."""
    collected = gc.collect()
    if collected > 0:
        logger.info("  ✓ Python GC: %d objetos recolectados", collected)
    return collected


def find_zombie_processes(logger: logging.Logger) -> int:
    """Encuentra y reporta procesos zombie."""
    zombies = []
    for proc in psutil.process_iter(["pid", "name", "status"]):
        try:
            if proc.info["status"] == psutil.STATUS_ZOMBIE:
                zombies.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    if zombies:
        logger.warning("  ⚠ %d procesos zombie detectados:", len(zombies))
        for z in zombies[:10]:
            logger.warning("    PID %d: %s", z.pid, z.info.get("name", "?"))
    return len(zombies)


# ─── Limpieza proactiva (se ejecuta SIEMPRE, cada ciclo) ─────────────────────

def clean_tmpfiles(logger: logging.Logger) -> float:
    """Limpia archivos temporales viejos (>1 día) del usuario."""
    freed_mb = 0.0
    tmp_dirs = [
        Path("/tmp"),
        Path.home() / ".cache" / "thumbnails",
        Path.home() / ".cache" / "mesa_shader_cache",
        Path.home() / ".cache" / "nvidia" / "GLCache",
        Path.home() / ".cache" / "fontconfig",
        Path.home() / ".cache" / "pip",
        Path.home() / ".cache" / "huggingface" / "hub" / ".locks",
    ]
    now = time.time()
    one_day_ago = now - 86400
    uid = os.getuid()

    for tmp_dir in tmp_dirs:
        if not tmp_dir.exists():
            continue
        try:
            for item in tmp_dir.iterdir():
                try:
                    # Solo borrar archivos nuestros, mayores de 1 día
                    stat = item.stat()
                    if stat.st_uid != uid:
                        continue
                    if stat.st_mtime > one_day_ago:
                        continue
                    if item.is_file():
                        size = stat.st_size / (1024 ** 2)
                        item.unlink()
                        freed_mb += size
                    elif item.is_dir() and tmp_dir == Path("/tmp"):
                        # En /tmp, borrar dirs vacíos viejos
                        if not any(item.iterdir()):
                            item.rmdir()
                except (PermissionError, OSError):
                    continue
        except PermissionError:
            continue

    if freed_mb > 1:
        logger.info("  ✓ Tmpfiles: liberados %.0f MB de archivos temporales viejos", freed_mb)
    return freed_mb


def clean_journal(logger: logging.Logger) -> bool:
    """Recorta el journal de systemd a 200MB (crece sin límite en uptimes largos)."""
    try:
        result = subprocess.run(
            ["journalctl", "--disk-usage"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            # Parse "Archived and active journals take up 1.2G"
            line = result.stdout.strip()
            logger.debug("  Journal: %s", line)

        result = subprocess.run(
            ["journalctl", "--user", "--vacuum-size=200M"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and "Freed" in result.stdout:
            logger.info("  ✓ Journal recortado: %s", result.stdout.strip().split('\n')[-1])
            return True
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return False


def clean_snap_cache(logger: logging.Logger) -> float:
    """Limpia revisiones antiguas de snaps (VSCode, Chromium dejan versiones viejas)."""
    freed_mb = 0.0
    snap_cache = Path.home() / "snap"
    if not snap_cache.exists():
        return 0
    # Limpiar .cache dentro de cada snap (safe, no borra datos del usuario)
    for snap_dir in snap_cache.iterdir():
        cache_dir = snap_dir / ".cache"
        if not cache_dir.exists():
            continue
        try:
            for item in cache_dir.rglob("*"):
                if item.is_file():
                    try:
                        age = time.time() - item.stat().st_mtime
                        if age > 86400 * 2:  # >2 días
                            size = item.stat().st_size / (1024 ** 2)
                            item.unlink()
                            freed_mb += size
                    except (PermissionError, OSError):
                        continue
        except PermissionError:
            continue

    if freed_mb > 1:
        logger.info("  ✓ Snap cache: liberados %.0f MB", freed_mb)
    return freed_mb


def clean_docker_builder(logger: logging.Logger) -> bool:
    """Limpia Docker builder cache (crece mucho con builds frecuentes)."""
    try:
        # Solo ver cuánto ocupa
        result = subprocess.run(
            ["docker", "system", "df", "--format", "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return False

        # Limpiar build cache > 7 días y dangling images
        result = subprocess.run(
            ["docker", "builder", "prune", "-f", "--filter", "until=168h"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode == 0 and result.stdout.strip():
            logger.info("  ✓ Docker builder: %s", result.stdout.strip().split('\n')[-1])

        # Dangling images
        result = subprocess.run(
            ["docker", "image", "prune", "-f"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and "reclaimed" in result.stdout.lower():
            logger.info("  ✓ Docker images: %s", result.stdout.strip().split('\n')[-1])
            return True
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return False


def clean_core_dumps(logger: logging.Logger) -> float:
    """Elimina core dumps que se acumulan en uptimes largos."""
    freed_mb = 0.0
    core_locations = [
        Path.home(),
        Path("/var/crash"),
        Path("/tmp"),
    ]
    for loc in core_locations:
        if not loc.exists():
            continue
        try:
            for item in loc.iterdir():
                if item.is_file() and (
                    item.name.startswith("core.") or
                    item.name.endswith(".crash") or
                    item.name.endswith(".core")
                ):
                    try:
                        size = item.stat().st_size / (1024 ** 2)
                        item.unlink()
                        freed_mb += size
                        logger.info("  ✓ Core dump eliminado: %s (%.0f MB)", item.name, size)
                    except (PermissionError, OSError):
                        continue
        except PermissionError:
            continue
    return freed_mb


def detect_memory_leaks(logger: logging.Logger) -> list[dict]:
    """Detecta procesos cuyo RSS creció > 500MB desde el último check."""
    state_file = LOG_DIR / "proc_rss_state.json"
    current = {}
    leaks = []

    for proc in psutil.process_iter(["pid", "name", "memory_info", "create_time"]):
        try:
            rss_mb = proc.info["memory_info"].rss / (1024 ** 2)
            if rss_mb > 100:  # Solo trackear procesos > 100MB
                key = f"{proc.info['pid']}_{proc.info['name']}"
                current[key] = {
                    "pid": proc.info["pid"],
                    "name": proc.info["name"],
                    "rss_mb": round(rss_mb),
                    "create_time": proc.info["create_time"],
                }
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Comparar con estado anterior
    if state_file.exists():
        try:
            prev = json.loads(state_file.read_text())
            for key, cur in current.items():
                if key in prev:
                    growth = cur["rss_mb"] - prev[key]["rss_mb"]
                    if growth > 500:  # Creció más de 500MB
                        leaks.append({
                            "pid": cur["pid"],
                            "name": cur["name"],
                            "rss_mb": cur["rss_mb"],
                            "growth_mb": round(growth),
                        })
                        logger.warning(
                            "  ⚠ POSIBLE LEAK: %s (PID %d) creció %+dMB → %dMB",
                            cur["name"], cur["pid"], round(growth), cur["rss_mb"],
                        )
        except (json.JSONDecodeError, KeyError):
            pass

    # Guardar estado actual
    try:
        with open(state_file, "w") as f:
            json.dump(current, f)
    except OSError:
        pass

    return leaks


def proactive_clean(logger: logging.Logger) -> dict:
    """Limpieza proactiva que se ejecuta SIEMPRE (cada ciclo, sin umbral).

    Esto es lo que mantiene el sistema estable en uptimes largos sin reiniciar.
    """
    result = {
        "page_cache": clean_page_cache(logger),
        "python_gc": clean_python_gc(logger),
        "tmpfiles_mb": clean_tmpfiles(logger),
        "journal": clean_journal(logger),
        "snap_cache_mb": clean_snap_cache(logger),
        "core_dumps_mb": clean_core_dumps(logger),
        "leaks": detect_memory_leaks(logger),
    }

    # Docker builder: solo cada 6 horas (no abusemos)
    docker_state = LOG_DIR / "last_docker_clean.txt"
    try:
        last_clean = float(docker_state.read_text()) if docker_state.exists() else 0
    except (ValueError, OSError):
        last_clean = 0
    if time.time() - last_clean > 21600:  # 6 horas
        result["docker"] = clean_docker_builder(logger)
        try:
            docker_state.write_text(str(time.time()))
        except OSError:
            pass

    return result


def kill_memory_hogs(logger: logging.Logger, critical: bool = False) -> list[dict]:
    """Mata procesos que consumen demasiada RAM (solo los killable y no protegidos)."""
    killed = []

    for proc in psutil.process_iter(["pid", "name", "cmdline", "memory_info"]):
        try:
            if is_protected(proc):
                continue

            name = proc.info["name"].lower() if proc.info["name"] else ""
            cmdline = " ".join(proc.info["cmdline"]).lower() if proc.info["cmdline"] else ""
            rss_mb = get_process_memory_mb(proc)

            for pattern, config in KILLABLE_PATTERNS.items():
                if pattern not in name and pattern not in cmdline:
                    continue

                # En modo crítico, bajar el umbral un 50%
                threshold = config["ram_threshold_mb"]
                if critical:
                    threshold = threshold * 0.5

                if rss_mb > threshold:
                    # Doble verificación: no matar procesos VSCode electron
                    if "code" in cmdline or "vscode" in cmdline:
                        continue

                    logger.warning(
                        "  🔪 Matando %s (PID %d): %.0f MB RAM (umbral: %.0f MB)",
                        name, proc.pid, rss_mb, threshold,
                    )
                    try:
                        proc.send_signal(config["signal"])
                        killed.append({
                            "pid": proc.pid,
                            "name": name,
                            "rss_mb": round(rss_mb),
                            "time": datetime.now().isoformat(),
                        })
                    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                        logger.warning("  ⚠ No se pudo matar PID %d: %s", proc.pid, e)

        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return killed


def get_top_consumers(n: int = 10) -> list[dict]:
    """Top N procesos por uso de RAM."""
    procs = []
    for proc in psutil.process_iter(["pid", "name", "memory_percent"]):
        try:
            procs.append({
                "pid": proc.info["pid"],
                "name": proc.info["name"],
                "mem_pct": round(proc.info["memory_percent"], 1),
                "rss_mb": round(get_process_memory_mb(proc)),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    procs.sort(key=lambda x: x["rss_mb"], reverse=True)
    return procs[:n]


# ─── Ciclo principal ─────────────────────────────────────────────────────────

def run_check(logger: logging.Logger, force_clean: bool = False) -> dict:
    """Ejecuta un ciclo completo de monitorización y limpieza."""
    timestamp = datetime.now().isoformat()
    report = {"timestamp": timestamp, "actions": []}

    # 1. Estado actual
    ram = get_ram_info()
    vram = get_vram_info()

    logger.info("═══ Memory Guardian — %s ═══", datetime.now().strftime("%H:%M:%S"))
    logger.info("  RAM: %.1f/%.1fGB (%.0f%%) — disponible: %.1fGB",
                ram["used_gb"], ram["total_gb"], ram["percent"], ram["available_gb"])
    if vram:
        logger.info("  VRAM: %dMB/%dMB (%.0f%%) — libre: %dMB — GPU: %d°C, %d%% util",
                     vram["used_mb"], vram["total_mb"], vram["percent"],
                     vram["free_mb"], vram["temp_c"], vram["util_pct"])

    report["ram"] = ram
    report["vram"] = vram

    # 2. Top consumidores (siempre reportar)
    top = get_top_consumers(8)
    for p in top[:5]:
        logger.info("  Top: %s (PID %d) — %d MB (%.1f%%)", p["name"], p["pid"], p["rss_mb"], p["mem_pct"])
    report["top_consumers"] = top

    # 3. Zombies
    zombie_count = find_zombie_processes(logger)
    report["zombies"] = zombie_count

    # 4. Limpieza proactiva — SIEMPRE, cada ciclo (esto previene bloqueos sin reiniciar)
    if PROACTIVE_CLEAN or force_clean:
        logger.info("  🧹 Limpieza proactiva...")
        proactive = proactive_clean(logger)
        report["proactive"] = proactive
        report["actions"].append("proactive_clean")

    # También limpiar VRAM cada ciclo (ComfyUI/YOLO dejan basura)
    clean_vram_cache(logger)
    report["actions"].append("vram_cache_cleaned")

    # 5. Determinar nivel de alerta (tras limpieza proactiva)
    ram_after_proactive = get_ram_info()
    vram_after_proactive = get_vram_info()

    ram_level = "ok"
    if ram_after_proactive["percent"] >= RAM_CRITICAL_PCT:
        ram_level = "critical"
    elif ram_after_proactive["percent"] >= RAM_WARNING_PCT:
        ram_level = "warning"

    vram_level = "ok"
    if vram_after_proactive and vram_after_proactive["percent"] >= VRAM_CRITICAL_PCT:
        vram_level = "critical"
    elif vram_after_proactive and vram_after_proactive["percent"] >= VRAM_WARNING_PCT:
        vram_level = "warning"

    report["ram_level"] = ram_level
    report["vram_level"] = vram_level

    # 6. Acciones reactivas adicionales si aún estamos alto tras la proactiva
    if ram_level == "warning":
        logger.warning("  ⚡ RAM WARNING (%.0f%%) tras limpieza proactiva", ram_after_proactive["percent"])

    if ram_level == "critical" or force_clean:
        logger.warning("  🚨 RAM CRITICAL (%.0f%%) — matando procesos pesados...",
                       ram_after_proactive["percent"])
        killed = kill_memory_hogs(logger, critical=True)
        if killed:
            report["actions"].append(f"killed_{len(killed)}_processes")
            report["killed"] = killed

    # Re-check final
    ram_final = get_ram_info()
    vram_final = get_vram_info()
    freed_ram = ram_final["available_gb"] - ram["available_gb"]
    if freed_ram > 0.1:
        logger.info("  ✅ RAM liberada: +%.1fGB (%.1fGB → %.1fGB disponible)",
                    freed_ram, ram["available_gb"], ram_final["available_gb"])
    report["ram_after"] = ram_final

    if vram_final and vram:
        freed_vram = vram_final["free_mb"] - vram["free_mb"]
        if freed_vram > 10:
            logger.info("  ✅ VRAM liberada: +%dMB (%dMB → %dMB libre)",
                        freed_vram, vram["free_mb"], vram_final["free_mb"])
    report["vram_after"] = vram_final

    if ram_level == "ok" and vram_level == "ok":
        logger.info("  ✅ Sistema estable tras limpieza")

    # 6. Guardar reporte
    report_file = LOG_DIR / "last_report.json"
    try:
        with open(report_file, "w") as f:
            json.dump(report, f, indent=2, default=str)
    except OSError:
        pass

    return report


def setup_sudoers_hint(logger: logging.Logger):
    """Muestra cómo configurar sudo sin password para drop_caches."""
    logger.info("💡 Para limpieza automática de page cache, ejecutar UNA VEZ:")
    logger.info('   echo "%s ALL=(ALL) NOPASSWD: /usr/bin/tee /proc/sys/vm/drop_caches" '
                "| sudo tee /etc/sudoers.d/memory-guardian", os.getenv("USER", "davidia"))
    logger.info("   sudo chmod 440 /etc/sudoers.d/memory-guardian")


def main():
    parser = argparse.ArgumentParser(description="Memory Guardian — monitoriza RAM/VRAM cada 20 min")
    parser.add_argument("--once", action="store_true", help="Ejecutar una vez y salir")
    parser.add_argument("--daemon", action="store_true", help="Modo daemon (sin output a consola)")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL,
                        help=f"Intervalo en segundos (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--force", action="store_true", help="Forzar limpieza aunque todo esté OK")
    parser.add_argument("--status", action="store_true", help="Mostrar estado actual y salir")
    args = parser.parse_args()

    logger = setup_logging(daemon_mode=args.daemon)

    if args.status:
        ram = get_ram_info()
        vram = get_vram_info()
        print(f"RAM: {ram['used_gb']:.1f}/{ram['total_gb']:.1f}GB ({ram['percent']:.0f}%) "
              f"— disponible: {ram['available_gb']:.1f}GB")
        if vram:
            print(f"VRAM: {vram['used_mb']}MB/{vram['total_mb']}MB ({vram['percent']:.0f}%) "
                  f"— libre: {vram['free_mb']}MB — {vram['temp_c']}°C")
        top = get_top_consumers(5)
        print("\nTop consumidores:")
        for p in top:
            print(f"  {p['name']:30s} PID {p['pid']:>7d}  {p['rss_mb']:>6d} MB ({p['mem_pct']}%)")

        report_file = LOG_DIR / "last_report.json"
        if report_file.exists():
            report = json.loads(report_file.read_text())
            print(f"\nÚltimo check: {report.get('timestamp', '?')}")
            print(f"Acciones: {report.get('actions', 'ninguna')}")
        return

    logger.info("🛡️ Memory Guardian iniciado — intervalo: %ds (%d min)",
                args.interval, args.interval // 60)
    logger.info("  RAM umbral: warning=%d%%, critical=%d%%", RAM_WARNING_PCT, RAM_CRITICAL_PCT)
    logger.info("  VRAM umbral: warning=%d%%, critical=%d%%", VRAM_WARNING_PCT, VRAM_CRITICAL_PCT)
    logger.info("  Protegidos: Seedy, Docker, VSCode, GeoTwin, ComfyUI, sistema")
    logger.info("  Log: %s", LOG_FILE)

    # Verificar que sudoers está configurado
    test = subprocess.run(
        ["sudo", "-n", "tee", "/proc/sys/vm/drop_caches"],
        input="1", capture_output=True, text=True, timeout=5,
    )
    if test.returncode == 0:
        logger.info("  ✓ Sudoers OK — page cache cleaning habilitado")
    else:
        logger.warning("  ⚠ Sudoers NO configurado — ejecutar:")
        logger.warning('    echo "%s ALL=(ALL) NOPASSWD: /usr/bin/tee /proc/sys/vm/drop_caches" '
                       "| sudo tee /etc/sudoers.d/memory-guardian", os.getenv("USER", "davidia"))

    # Manejar señales para shutdown limpio
    running = True

    def handle_signal(signum, frame):
        nonlocal running
        logger.info("Señal %s recibida — parando...", signal.Signals(signum).name)
        running = False

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    # Primera ejecución inmediata
    run_check(logger, force_clean=args.force)

    if args.once:
        logger.info("Modo --once: saliendo.")
        return

    # Loop
    while running:
        try:
            # Dormir en intervalos cortos para responder a señales
            for _ in range(args.interval):
                if not running:
                    break
                time.sleep(1)

            if running:
                run_check(logger, force_clean=False)
        except Exception as e:
            logger.error("Error en ciclo: %s", e, exc_info=True)
            time.sleep(60)  # Esperar 1 min antes de reintentar

    logger.info("🛡️ Memory Guardian parado.")


if __name__ == "__main__":
    main()
