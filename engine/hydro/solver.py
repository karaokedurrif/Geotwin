"""
Solver 2D de flujo subterráneo en diferencias finitas (estilo MODFLOW).

Ecuación gobernante (flujo confinado/semi-confinado, capa 1):
    ∂/∂x(T ∂h/∂x) + ∂/∂y(T ∂h/∂y) = S ∂h/∂t + Q_well + Q_canal

Acoplamiento canal-acuífero mediante la Ley de Darcy:
    q_canal = C_bed · width · dx · (h_canal − h_acuífero)
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve

from .domain import AquiferDomain


class GroundwaterSolver:
    """Solver de diferencias finitas para el acuífero Sierra Espuña."""

    def __init__(self, domain: AquiferDomain) -> None:
        self.dom = domain
        self.nx = domain.nx
        self.ny = domain.ny
        self.dx = domain.dx
        self.dy = domain.dy
        self.ncells = self.nx * self.ny

        # Condición inicial: nivel freático ~5 m bajo superficie
        self.h0 = domain.topo - 5.0

        # Recarga natural: ~350 mm/año, ~10% infiltra
        self.recharge = 350 * 0.10 / 365.0 / 1000.0  # m/día

    def _cell_index(self, i: int, j: int) -> int:
        return i * self.nx + j

    def solve_steady_state(
        self,
        Q_pump: float,
        canal_flow_factor: float = 1.0,
        K_multiplier: float = 1.0,
    ) -> np.ndarray:
        """
        Resuelve el estado estacionario para una tasa de bombeo dada.

        Parámetros:
            Q_pump: caudal de bombeo (m³/día, negativo = extracción)
            canal_flow_factor: multiplicador del caudal del canal (0–2)
            K_multiplier: factor de escala de la conductividad (0.1–10)
        """
        N = self.ncells
        A = lil_matrix((N, N))
        rhs = np.zeros(N)

        K1 = self.dom.K[0] * K_multiplier
        T = K1 * 30.0  # m²/día (espesor saturado ~30 m)

        for i in range(self.ny):
            for j in range(self.nx):
                idx = self._cell_index(i, j)

                # Bordes Dirichlet: S y E (descarga al valle)
                is_fixed = (i == 0) or (j == self.nx - 1)
                if is_fixed:
                    A[idx, idx] = 1.0
                    rhs[idx] = self.h0[i, j]
                    continue

                T_ij = T[i, j]
                c_e = c_w = c_n = c_s = 0.0

                if j < self.nx - 1:
                    T_e = 2.0 * T_ij * T[i, j + 1] / (T_ij + T[i, j + 1] + 1e-10)
                    c_e = T_e * self.dy / self.dx
                    A[idx, self._cell_index(i, j + 1)] = c_e

                if j > 0:
                    T_w = 2.0 * T_ij * T[i, j - 1] / (T_ij + T[i, j - 1] + 1e-10)
                    c_w = T_w * self.dy / self.dx
                    A[idx, self._cell_index(i, j - 1)] = c_w

                if i < self.ny - 1:
                    T_n = 2.0 * T_ij * T[i + 1, j] / (T_ij + T[i + 1, j] + 1e-10)
                    c_n = T_n * self.dx / self.dy
                    A[idx, self._cell_index(i + 1, j)] = c_n

                if i > 0:
                    T_s = 2.0 * T_ij * T[i - 1, j] / (T_ij + T[i - 1, j] + 1e-10)
                    c_s = T_s * self.dx / self.dy
                    A[idx, self._cell_index(i - 1, j)] = c_s

                A[idx, idx] = -(c_e + c_w + c_n + c_s)
                rhs[idx] = -self.recharge * self.dx * self.dy

        # Pozo de extracción
        if 0 < self.dom.well_i < self.ny - 1 and 0 < self.dom.well_j < self.nx - 1:
            well_idx = self._cell_index(self.dom.well_i, self.dom.well_j)
            rhs[well_idx] += Q_pump

        # Infiltración canal → acuífero (Ley de Darcy)
        for cell in self.dom.canal:
            ci, cj = cell["i"], cell["j"]
            if 0 < ci < self.ny - 1 and 0 < cj < self.nx - 1:
                idx = self._cell_index(ci, cj)
                C = cell["C_bed"] * cell["width"] * self.dx * canal_flow_factor
                A[idx, idx] -= C
                rhs[idx] -= C * cell["h_canal"]

        h_flat = spsolve(A.tocsr(), rhs)
        h = h_flat.reshape(self.ny, self.nx)
        return gaussian_filter(h, sigma=0.5)

    def compute_drawdown(self, h: np.ndarray) -> np.ndarray:
        return self.h0 - h

    def compute_canal_infiltration(
        self, h: np.ndarray, canal_flow_factor: float = 1.0,
    ) -> np.ndarray:
        q_map = np.zeros((self.ny, self.nx))
        for cell in self.dom.canal:
            ci, cj = cell["i"], cell["j"]
            if 0 < ci < self.ny - 1 and 0 < cj < self.nx - 1:
                C = cell["C_bed"] * cell["width"] * self.dx * canal_flow_factor
                q_map[ci, cj] = C * (cell["h_canal"] - h[ci, cj])
        return q_map

    def run_temporal(
        self,
        n_steps: int = 12,
        Q_pump_base: float = -2500.0,
        canal_factor_base: float = 1.0,
        K_mult: float = 1.0,
    ) -> list[dict]:
        """Simula 12 meses de campaña Oct–Sep con variación estacional."""
        months = ["Oct", "Nov", "Dic", "Ene", "Feb", "Mar",
                  "Abr", "May", "Jun", "Jul", "Ago", "Sep"]
        pump_seasonal = [0.75, 0.65, 0.60, 0.58, 0.55, 0.65,
                         0.80, 1.00, 1.20, 1.40, 1.35, 1.10]
        canal_seasonal = [1.10, 1.15, 1.20, 1.15, 1.10, 1.00,
                          0.85, 0.70, 0.55, 0.45, 0.50, 0.70]

        results = []
        for step in range(min(n_steps, 12)):
            Q_t = Q_pump_base * pump_seasonal[step]
            cf_t = canal_factor_base * canal_seasonal[step]
            h = self.solve_steady_state(Q_t, cf_t, K_mult)
            dd = self.compute_drawdown(h)
            cq = self.compute_canal_infiltration(h, cf_t)

            results.append({
                "month": months[step],
                "step": step,
                "h": h,
                "drawdown": dd,
                "canal_q": cq,
                "Q_pump": Q_t,
                "canal_factor": cf_t,
            })

        return results
