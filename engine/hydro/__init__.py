"""
HydroTwin Barbo — Motor de simulación hidrogeológica.

Módulos:
  domain     → Geometría, estratigrafía, propiedades hidráulicas
  solver     → Solver FD (diferencias finitas), acoplamiento Darcy canal-acuífero
  serializer → Convierte resultados de simulación a JSON para Plotly.js
"""

from .domain import AquiferDomain
from .solver import GroundwaterSolver
from .serializer import serialize_simulation

__all__ = ["AquiferDomain", "GroundwaterSolver", "serialize_simulation"]
