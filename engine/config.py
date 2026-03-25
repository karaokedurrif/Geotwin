"""Configuración centralizada del engine."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings


class EngineSettings(BaseSettings):
    """Configuración del motor de procesamiento GeoTwin."""

    # Rutas
    data_dir: Path = Field(default=Path("data"), description="Directorio base de datos")
    tiles_dir: Path = Field(default=Path("data/tiles"), description="Directorio de 3D Tiles generados")
    dem_dir: Path = Field(default=Path("data/dem"), description="Cache de DEMs descargados")
    ortho_dir: Path = Field(default=Path("data/ortho"), description="Cache de ortofotos")

    # DEM
    dem_default_resolution: float = Field(default=5.0, description="Resolución DEM por defecto (metros)")
    dem_source: str = Field(default="ign_mdt05", description="Fuente DEM: ign_mdt05, ign_mdt02, copernicus")

    # Mesh
    mesh_lod_levels: list[float] = Field(
        default=[1.0, 0.25, 0.06, 0.015],
        description="Factores de decimación por LOD",
    )

    # LOD adaptativo por tamaño de finca
    # < 100 ha: DEM 2m, mesh ~50K tris
    # 100-500 ha: DEM 5m, mesh ~200K tris
    # 500-2000 ha: DEM 5m, mesh ~500K tris
    # > 2000 ha: DEM 10m, mesh ~1M tris

    # CRS
    target_crs: str = Field(default="EPSG:4326", description="CRS de salida")

    model_config = {"env_prefix": "GEOTWIN_ENGINE_"}


settings = EngineSettings()
