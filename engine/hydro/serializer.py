"""
Serializa resultados de simulación hidrogeológica a JSON para Plotly.js.

Genera todas las trazas 3D (superficies, canal, piezómetros, pozo),
frames de animación temporal, datos de corte transversal y KPIs.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .domain import AquiferDomain
from .solver import GroundwaterSolver

# ── Escalas de color profesionales para hidrogeología ──

COLORSCALE_K = [
    [0.0, "#1a0533"], [0.15, "#3b0f70"], [0.30, "#641a80"],
    [0.45, "#8c2981"], [0.55, "#b73779"], [0.65, "#de4968"],
    [0.75, "#f7705c"], [0.85, "#feb078"], [0.95, "#fcfdbf"],
    [1.0, "#fcffa4"],
]

COLORSCALE_DRAWDOWN = [
    [0.0, "#f7fbff"], [0.2, "#c6dbef"], [0.4, "#6baed6"],
    [0.6, "#2171b5"], [0.8, "#08519c"], [1.0, "#08306b"],
]

VIS_EXAG = 5.0  # exageración visual del descenso en Z


def _ds(arr: np.ndarray, factor: int = 2) -> np.ndarray:
    return arr[::factor, ::factor]


def _to_list(arr: np.ndarray) -> list:
    return np.round(arr, 3).tolist()


def serialize_simulation(
    domain: AquiferDomain,
    solver: GroundwaterSolver,
    sim_results: list[dict],
) -> dict[str, Any]:
    """
    Convierte simulación completa a JSON-serializable dict listo para Plotly.js.

    Retorna: { traces, layout, frames, crossSections, temporalData, piezData, kpis, meta }
    """
    ds = 2
    X_km = _ds(domain.X / 1000.0, ds)
    Y_km = _ds(domain.Y / 1000.0, ds)

    traces = _build_traces(domain, solver, sim_results, X_km, Y_km, ds)
    frames, slider_steps = _build_frames(solver, sim_results, X_km, Y_km, ds)
    layout = _build_layout(slider_steps)
    cross = _build_cross_sections(domain, sim_results)
    temporal = _build_temporal_data(sim_results)
    piez = _build_piez_data(domain, sim_results)
    kpis = _build_kpis(domain, sim_results)
    meta = {
        "nx": domain.nx, "ny": domain.ny, "nlay": domain.nlay,
        "Lx": domain.Lx, "Ly": domain.Ly, "Lz": domain.Lz,
        "well_x_km": domain.well_x / 1000.0,
        "well_y_km": domain.well_y / 1000.0,
    }

    return {
        "traces": traces,
        "layout": layout,
        "frames": frames,
        "crossSections": cross,
        "temporalData": temporal,
        "piezData": piez,
        "kpis": kpis,
        "meta": meta,
    }


# ═══════════════════════════════════════════════════════════════════
# Trazas 3D
# ═══════════════════════════════════════════════════════════════════

def _build_traces(
    dom: AquiferDomain,
    solver: GroundwaterSolver,
    sim: list[dict],
    X_km: np.ndarray,
    Y_km: np.ndarray,
    ds: int,
) -> list[dict]:
    traces: list[dict] = []
    x_list = _to_list(X_km)
    y_list = _to_list(Y_km)

    # ── Trace 0: Capa 1 — Arenas/Gravas ──
    traces.append({
        "type": "surface",
        "x": x_list, "y": y_list,
        "z": _to_list(_ds(dom.layer_tops[0], ds)),
        "surfacecolor": _to_list(np.log10(_ds(dom.K[0], ds))),
        "colorscale": COLORSCALE_K,
        "cmin": -1.5, "cmax": 2.0,
        "opacity": 0.35,
        "name": "Capa 1 · Arenas/Gravas",
        "showscale": False,
        "hovertemplate": (
            "X: %{x:.1f} km<br>Y: %{y:.1f} km<br>"
            "Cota: %{z:.0f} m<br>log₁₀K: %{surfacecolor:.2f} m/día"
            "<extra>Capa 1 · Arenas/Gravas</extra>"
        ),
    })

    # ── Trace 1: Capa 2 — Transición ──
    traces.append({
        "type": "surface",
        "x": x_list, "y": y_list,
        "z": _to_list(_ds(dom.layer_tops[1], ds)),
        "surfacecolor": _to_list(np.log10(_ds(dom.K[1], ds))),
        "colorscale": COLORSCALE_K,
        "cmin": -1.5, "cmax": 2.0,
        "opacity": 0.30,
        "name": "Capa 2 · Transición",
        "showscale": False,
        "hovertemplate": (
            "X: %{x:.1f} km<br>Y: %{y:.1f} km<br>"
            "Cota: %{z:.0f} m<br>log₁₀K: %{surfacecolor:.2f} m/día"
            "<extra>Capa 2 · Transición</extra>"
        ),
    })

    # ── Trace 2: Capa 3 — Margas/Arcillas ──
    traces.append({
        "type": "surface",
        "x": x_list, "y": y_list,
        "z": _to_list(_ds(dom.layer_tops[2], ds)),
        "surfacecolor": _to_list(np.log10(_ds(dom.K[2], ds))),
        "colorscale": COLORSCALE_K,
        "cmin": -1.5, "cmax": 2.0,
        "opacity": 0.25,
        "name": "Capa 3 · Margas/Arcillas",
        "showscale": False,
        "hovertemplate": (
            "X: %{x:.1f} km<br>Y: %{y:.1f} km<br>"
            "Cota: %{z:.0f} m<br>log₁₀K: %{surfacecolor:.2f} m/día"
            "<extra>Capa 3 · Margas</extra>"
        ),
    })

    # ── Trace 3: Base rocosa ──
    traces.append({
        "type": "surface",
        "x": x_list, "y": y_list,
        "z": _to_list(_ds(dom.layer_tops[3], ds)),
        "colorscale": [[0, "#2d1b0e"], [1, "#5c3d2e"]],
        "opacity": 0.40,
        "name": "Base rocosa carbonatada",
        "showscale": False,
        "hovertemplate": (
            "X: %{x:.1f} km<br>Y: %{y:.1f} km<br>"
            "Base: %{z:.0f} m<extra>Roca base</extra>"
        ),
    })

    # ── Trace 4: Superficie piezométrica (t=0) con exageración visual ──
    h0_real = _ds(sim[0]["h"], ds)
    dd0 = _ds(sim[0]["drawdown"], ds)
    h_ref = _ds(solver.h0, ds)
    h0_vis = h_ref - np.clip(dd0, 0, None) * VIS_EXAG

    traces.append({
        "type": "surface",
        "x": x_list, "y": y_list,
        "z": _to_list(h0_vis),
        "surfacecolor": _to_list(dd0),
        "customdata": _to_list(h0_real),
        "colorscale": COLORSCALE_DRAWDOWN,
        "cmin": 0, "cmax": float(np.max(dd0) * 1.2 + 1),
        "opacity": 0.75,
        "name": "Nivel piezométrico",
        "colorbar": {
            "title": {"text": "Descenso (m)", "side": "right"},
            "len": 0.4, "y": 0.7, "thickness": 15,
            "tickfont": {"size": 10, "color": "#aaa"},
            "titlefont": {"size": 11, "color": "#ccc"},
        },
        "hovertemplate": (
            "X: %{x:.1f} km<br>Y: %{y:.1f} km<br>"
            "Nivel real: %{customdata:.1f} m.s.n.m.<br>"
            "Descenso: %{surfacecolor:.1f} m<br>"
            "<i>(Exag. visual ×5)</i>"
            "<extra>Nivel piezométrico</extra>"
        ),
    })

    # ── Trace 5: Canal de Barbo ──
    canal_x: list[float | None] = []
    canal_y: list[float | None] = []
    canal_z: list[float | None] = []
    for branch_name in ["principal", "pliego", "librilla"]:
        cells = [c for c in dom.canal if c["branch"] == branch_name]
        if branch_name != "principal":
            canal_x.append(None)
            canal_y.append(None)
            canal_z.append(None)
        for c in cells:
            canal_x.append(c["x"] / 1000.0)
            canal_y.append(c["y"] / 1000.0)
            canal_z.append(c["h_canal"])

    traces.append({
        "type": "scatter3d",
        "x": canal_x, "y": canal_y, "z": canal_z,
        "mode": "lines",
        "line": {"color": "#06b6d4", "width": 6},
        "name": "Canal de Barbo",
        "hovertemplate": (
            "Canal: X=%{x:.2f} km, Y=%{y:.2f} km<br>"
            "Cota: %{z:.0f} m<extra>Canal de Barbo</extra>"
        ),
    })

    # ── Trace 6: Piezómetros (marcadores) ──
    piez_x = [p["x"] / 1000 for p in dom.piezometers]
    piez_y = [p["y"] / 1000 for p in dom.piezometers]
    piez_z_top = [p["z_top"] for p in dom.piezometers]
    piez_z_bot = [p["z_top"] - p["depth"] for p in dom.piezometers]

    h_at_piez = [float(sim[0]["h"][p["i"], p["j"]]) for p in dom.piezometers]
    piez_texts = []
    for k, p in enumerate(dom.piezometers):
        dd_val = piez_z_top[k] - h_at_piez[k]
        piez_texts.append(
            f"<b>{p['name']}</b><br>"
            f"Cota: {piez_z_top[k]:.0f} m<br>"
            f"Prof.: {p['depth']} m<br>"
            f"Nivel: {h_at_piez[k]:.1f} m<br>"
            f"Descenso: {dd_val:.1f} m"
        )

    traces.append({
        "type": "scatter3d",
        "x": piez_x, "y": piez_y, "z": piez_z_top,
        "mode": "markers+text",
        "marker": {
            "size": 6, "color": "#f59e0b", "symbol": "diamond",
            "line": {"width": 1, "color": "#fff"},
        },
        "text": [f"{p['name'].split(' ')[0]} {p['name'].split(' ')[1]}"
                 for p in dom.piezometers],
        "textposition": "top center",
        "textfont": {"size": 9, "color": "#f59e0b"},
        "hovertext": piez_texts,
        "hoverinfo": "text",
        "name": "Piezómetros",
    })

    # Tubos verticales de piezómetros
    for k, p in enumerate(dom.piezometers):
        traces.append({
            "type": "scatter3d",
            "x": [piez_x[k], piez_x[k]],
            "y": [piez_y[k], piez_y[k]],
            "z": [piez_z_top[k], piez_z_bot[k]],
            "mode": "lines",
            "line": {"color": "#f59e0b", "width": 3, "dash": "dot"},
            "showlegend": False, "hoverinfo": "skip",
        })

    # ── Pozo de extracción ──
    wx = dom.well_x / 1000.0
    wy = dom.well_y / 1000.0
    wz_top = float(dom.topo[dom.well_i, dom.well_j])
    wz_bot = wz_top - 100.0

    traces.append({
        "type": "scatter3d",
        "x": [wx, wx], "y": [wy, wy], "z": [wz_top, wz_bot],
        "mode": "lines",
        "line": {"color": "#ef4444", "width": 6},
        "name": "Pozo extracción",
        "hoverinfo": "skip",
    })
    traces.append({
        "type": "scatter3d",
        "x": [wx], "y": [wy], "z": [wz_top + 8],
        "mode": "markers+text",
        "marker": {"size": 10, "color": "#ef4444", "symbol": "circle",
                   "line": {"width": 2, "color": "#fff"}},
        "text": ["POZO"],
        "textposition": "top center",
        "textfont": {"size": 11, "color": "#ef4444", "family": "monospace"},
        "hovertext": [
            f"<b>Pozo de extracción</b><br>"
            f"Q = {abs(sim[0]['Q_pump']):.0f} m³/día<br>"
            f"≈ {abs(sim[0]['Q_pump']) / 86.4:.1f} l/s<br>"
            f"Prof.: 100 m<br>"
            f"Cota boca: {wz_top:.0f} m"
        ],
        "hoverinfo": "text",
        "name": "Pozo extracción (marcador)",
        "showlegend": False,
    })

    return traces


# ═══════════════════════════════════════════════════════════════════
# Frames de animación temporal
# ═══════════════════════════════════════════════════════════════════

def _build_frames(
    solver: GroundwaterSolver,
    sim: list[dict],
    X_km: np.ndarray,
    Y_km: np.ndarray,
    ds: int,
) -> tuple[list[dict], list[dict]]:
    frames = []
    slider_steps = []
    h_ref = _ds(solver.h0, ds)

    for result in sim:
        h_real = _ds(result["h"], ds)
        dd = _ds(result["drawdown"], ds)
        h_vis = h_ref - np.clip(dd, 0, None) * VIS_EXAG

        frames.append({
            "name": result["month"],
            "data": [{
                "type": "surface",
                "z": _to_list(h_vis),
                "surfacecolor": _to_list(dd),
                "customdata": _to_list(h_real),
            }],
            "traces": [4],
        })

        slider_steps.append({
            "args": [[result["month"]], {
                "frame": {"duration": 500, "redraw": True},
                "mode": "immediate",
                "transition": {"duration": 300},
            }],
            "label": result["month"],
            "method": "animate",
        })

    return frames, slider_steps


# ═══════════════════════════════════════════════════════════════════
# Layout Plotly
# ═══════════════════════════════════════════════════════════════════

def _build_layout(slider_steps: list[dict]) -> dict:
    return {
        "scene": {
            "xaxis": {
                "title": {"text": "Eje X (km)", "font": {"size": 11, "color": "#888"}},
                "gridcolor": "rgba(255,255,255,0.05)",
                "backgroundcolor": "rgba(0,0,0,0)",
                "color": "#666", "range": [0, 5],
            },
            "yaxis": {
                "title": {"text": "Eje Y (km)", "font": {"size": 11, "color": "#888"}},
                "gridcolor": "rgba(255,255,255,0.05)",
                "backgroundcolor": "rgba(0,0,0,0)",
                "color": "#666", "range": [0, 5],
            },
            "zaxis": {
                "title": {"text": "Cota (m.s.n.m.)", "font": {"size": 11, "color": "#888"}},
                "gridcolor": "rgba(255,255,255,0.06)",
                "backgroundcolor": "rgba(0,0,0,0)",
                "color": "#666",
            },
            "aspectratio": {"x": 1.2, "y": 1.2, "z": 0.35},
            "camera": {
                "eye": {"x": 1.8, "y": -1.6, "z": 0.8},
                "center": {"x": 0, "y": 0, "z": -0.1},
            },
            "bgcolor": "rgba(0,0,0,0)",
        },
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {"family": "system-ui, sans-serif", "color": "#ccc", "size": 11},
        "legend": {
            "x": 0.01, "y": 0.99,
            "bgcolor": "rgba(15,15,25,0.85)",
            "bordercolor": "rgba(255,255,255,0.08)",
            "borderwidth": 1,
            "font": {"size": 10, "color": "#aaa"},
        },
        "margin": {"l": 0, "r": 0, "t": 0, "b": 0},
        "sliders": [{
            "active": 0,
            "currentvalue": {
                "prefix": "Mes: ",
                "font": {"size": 13, "color": "#06b6d4"},
                "xanchor": "center",
            },
            "pad": {"b": 10, "t": 30},
            "len": 0.75, "x": 0.125, "xanchor": "left",
            "y": 0, "yanchor": "top",
            "steps": slider_steps,
            "bgcolor": "#1a1a2e",
            "activebgcolor": "#06b6d4",
            "bordercolor": "rgba(255,255,255,0.1)",
            "font": {"color": "#888", "size": 10},
            "tickcolor": "#444",
        }],
        "updatemenus": [{
            "type": "buttons",
            "showactive": False,
            "x": 0.02, "y": 0.02,
            "xanchor": "left", "yanchor": "bottom",
            "buttons": [
                {
                    "label": "▶ Animar",
                    "method": "animate",
                    "args": [None, {
                        "frame": {"duration": 700, "redraw": True},
                        "fromcurrent": True,
                        "transition": {"duration": 400},
                    }],
                },
                {
                    "label": "⏸ Pausar",
                    "method": "animate",
                    "args": [[None], {
                        "frame": {"duration": 0, "redraw": False},
                        "mode": "immediate",
                    }],
                },
            ],
            "bgcolor": "rgba(15,15,30,0.9)",
            "bordercolor": "rgba(6,182,212,0.3)",
            "font": {"color": "#06b6d4", "size": 11},
        }],
    }


# ═══════════════════════════════════════════════════════════════════
# Datos auxiliares
# ═══════════════════════════════════════════════════════════════════

def _build_cross_sections(dom: AquiferDomain, sim: list[dict]) -> dict:
    j_cut = dom.well_j
    y_km = (dom.y / 1000.0).tolist()
    sections: dict[str, dict] = {}
    for r in sim:
        sections[r["month"]] = {
            "y": y_km,
            "topo": np.round(dom.topo[:, j_cut], 3).tolist(),
            "h": np.round(r["h"][:, j_cut], 3).tolist(),
            "layer1_bot": np.round(dom.layer_tops[1][:, j_cut], 3).tolist(),
            "layer2_bot": np.round(dom.layer_tops[2][:, j_cut], 3).tolist(),
            "base": np.round(dom.layer_tops[3][:, j_cut], 3).tolist(),
        }
    return sections


def _build_temporal_data(sim: list[dict]) -> dict:
    return {
        "months": [r["month"] for r in sim],
        "Q_pump": [abs(r["Q_pump"]) for r in sim],
        "max_dd": [float(np.max(r["drawdown"])) for r in sim],
        "infiltration": [float(np.sum(r["canal_q"])) for r in sim],
        "canal_factor": [r["canal_factor"] for r in sim],
    }


def _build_piez_data(dom: AquiferDomain, sim: list[dict]) -> list[dict]:
    piez_out = []
    for p in dom.piezometers:
        h_val = float(sim[0]["h"][p["i"], p["j"]])
        dd_val = p["z_top"] - h_val
        piez_out.append({
            "name": p["name"],
            "h": round(h_val, 1),
            "dd": round(dd_val, 1),
            "depth": p["depth"],
        })
    return piez_out


def _build_kpis(dom: AquiferDomain, sim: list[dict]) -> dict:
    r0 = sim[0]
    return {
        "maxDrawdown": round(float(np.max(r0["drawdown"])), 1),
        "wellQ_ls": round(abs(r0["Q_pump"]) / 86.4, 1),
        "wellQ_m3d": round(abs(r0["Q_pump"]), 0),
        "infiltration": round(float(np.sum(r0["canal_q"])), 0),
        "concesionAnual": 4_447_872,
        "eficiencia2025": 95.8,
    }
