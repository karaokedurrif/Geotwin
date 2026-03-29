"""
Geometría del dominio y propiedades hidrogeológicas del acuífero Sierra Espuña.

Dominio: 5×5 km, 120 m profundidad, 3 capas estratigráficas.
Masa de agua: Sierra Espuña (070.040).
Concesión: Aguas del Barbo — 4.447.872 m³/año.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter


class AquiferDomain:
    """
    Geometría y estratigrafía del acuífero Sierra Espuña / Barbo.

    Estructura vertical (3 capas + base):
      - Capa 1 (0–40 m): Arenas y gravas cuaternarias (acuífero libre)
        K = 15–50 m/día, Ss = 0.0005, Sy = 0.15
      - Capa 2 (40–80 m): Transición: conglomerados con intercalaciones margosas
        K = 1–8 m/día, Ss = 0.0003, Sy = 0.08
      - Capa 3 (80–120 m): Margas y arcillas con lentejones calcáreos
        K = 0.01–0.5 m/día, Ss = 0.0001, Sy = 0.03
    """

    def __init__(self, nx: int = 50, ny: int = 50, nlay: int = 3) -> None:
        self.Lx = 5000.0
        self.Ly = 5000.0
        self.Lz = 120.0
        self.nx = nx
        self.ny = ny
        self.nlay = nlay
        self.dx = self.Lx / nx
        self.dy = self.Ly / ny

        self.x = np.linspace(self.dx / 2, self.Lx - self.dx / 2, nx)
        self.y = np.linspace(self.dy / 2, self.Ly - self.dy / 2, ny)
        self.X, self.Y = np.meshgrid(self.x, self.y)

        # Topografía superficial (Sierra Espuña: ~350–500 m.s.n.m.)
        self.topo = self._generate_topography()

        # Espesores de capa
        self.layer_tops = np.zeros((nlay + 1, ny, nx))
        self.layer_tops[0] = self.topo
        self.layer_tops[1] = self.topo - 40.0
        self.layer_tops[2] = self.topo - 80.0
        self.layer_tops[3] = self.topo - 120.0

        # Propiedades hidráulicas por capa
        self.K = self._generate_hydraulic_conductivity()
        self.Ss = np.array([5e-4, 3e-4, 1e-4])
        self.Sy = np.array([0.15, 0.08, 0.03])

        # Pozo de extracción central
        self.well_i = ny // 2
        self.well_j = nx // 2
        self.well_x = float(self.x[self.well_j])
        self.well_y = float(self.y[self.well_i])
        self.Q_well = -4500.0  # m³/día (~52 l/s)

        # Canal de Barbo: traza NE → SW con bifurcación
        self.canal = self._define_canal()

        # Piezómetros de control
        self.piezometers = self._define_piezometers()

    # ──────────────────────────────────────────────────────────────────

    def _generate_topography(self) -> np.ndarray:
        base = 420.0
        gradient = (self.X / self.Lx) * (-30) + (self.Y / self.Ly) * (-20)
        rng = np.random.RandomState(42)
        noise = rng.randn(self.ny, self.nx) * 8
        return base + gradient + gaussian_filter(noise, sigma=5)

    def _generate_hydraulic_conductivity(self) -> list[np.ndarray]:
        rng = np.random.RandomState(123)
        params = [
            (3.0, 0.3),    # Capa 1: arenas/gravas
            (0.3, 0.4),    # Capa 2: transición
            (0.005, 0.5),  # Capa 3: margas
        ]
        layers: list[np.ndarray] = []
        for k_mean, k_std in params:
            log_k = np.log10(k_mean) + rng.randn(self.ny, self.nx) * k_std
            log_k = gaussian_filter(log_k, sigma=3)
            layers.append(10.0 ** log_k)
        return layers

    def _define_canal(self) -> list[dict]:
        cells: list[dict] = []

        # Tramo principal: NE → SW
        n_pts = 60
        t = np.linspace(0, 1, n_pts)
        cx = 0.8 * self.Lx - t * 0.6 * self.Lx + np.sin(t * 3 * np.pi) * 150
        cy = 0.9 * self.Ly - t * 0.8 * self.Ly + np.cos(t * 2 * np.pi) * 100

        for k in range(len(cx)):
            j = int(np.clip(cx[k] / self.dx, 0, self.nx - 1))
            i = int(np.clip(cy[k] / self.dy, 0, self.ny - 1))
            cells.append({
                "i": i, "j": j,
                "x": float(self.x[j]), "y": float(self.y[i]),
                "h_canal": float(self.topo[i, j] - 1.0),
                "C_bed": 0.8, "width": 1.5, "branch": "principal",
            })

        # Bifurcación Pliego
        bif_idx = int(n_pts * 0.6)
        bx, by = cx[bif_idx], cy[bif_idx]
        for k in range(15):
            t_b = k / 14.0
            px = bx - t_b * 0.15 * self.Lx
            py = by - t_b * 0.25 * self.Ly + np.sin(t_b * np.pi) * 80
            j = int(np.clip(px / self.dx, 0, self.nx - 1))
            i = int(np.clip(py / self.dy, 0, self.ny - 1))
            cells.append({
                "i": i, "j": j,
                "x": float(self.x[j]), "y": float(self.y[i]),
                "h_canal": float(self.topo[i, j] - 1.0),
                "C_bed": 0.5, "width": 1.0, "branch": "pliego",
            })

        # Bifurcación Librilla
        for k in range(15):
            t_b = k / 14.0
            lx = bx + t_b * 0.1 * self.Lx
            ly = by - t_b * 0.3 * self.Ly - np.sin(t_b * np.pi) * 60
            j = int(np.clip(lx / self.dx, 0, self.nx - 1))
            i = int(np.clip(ly / self.dy, 0, self.ny - 1))
            cells.append({
                "i": i, "j": j,
                "x": float(self.x[j]), "y": float(self.y[i]),
                "h_canal": float(self.topo[i, j] - 1.5),
                "C_bed": 0.5, "width": 1.0, "branch": "librilla",
            })

        return cells

    def _define_piezometers(self) -> list[dict]:
        piez = [
            {"name": "PZ-01 Cabecera",    "i": 42, "j": 38, "depth": 35},
            {"name": "PZ-02 Canal Norte",  "i": 35, "j": 30, "depth": 50},
            {"name": "PZ-03 Pozo control", "i": 26, "j": 27, "depth": 60},
            {"name": "PZ-04 Bifurcación",  "i": 20, "j": 22, "depth": 45},
            {"name": "PZ-05 Pliego",       "i": 12, "j": 15, "depth": 40},
            {"name": "PZ-06 Librilla",     "i": 8,  "j": 28, "depth": 55},
            {"name": "PZ-07 Sur profundo", "i": 5,  "j": 35, "depth": 80},
            {"name": "PZ-08 Sentinela NE", "i": 40, "j": 45, "depth": 30},
        ]
        for p in piez:
            p["x"] = float(self.x[p["j"]])
            p["y"] = float(self.y[p["i"]])
            p["z_top"] = float(self.topo[p["i"], p["j"]])
        return piez
