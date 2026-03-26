# GeoTwin — Modelo de dominio

## Entidades principales
- **Twin**: parcela geográfica con geometría, capas, sensores y activos
- **Parcel**: polígono catastral (GeoJSON/KML), puede ser unión de N parcelas
- **TerrainMesh**: malla 3D generada desde DEM, con LODs y textura PNOA
- **Layer**: capa activable (NDVI, Sentinel RGB, IoT, ganado, etc.)
- **Sensor**: nodo IoT con lecturas temporales (TEMP, NH3, CO2, MOISTURE)
- **Mission**: vuelo de dron con plan, capturas y productos

## Flujo principal del usuario
1. Sube KML del catastro → se crea el Twin
2. Engine genera: DEM → mesh → LODs → 3D Tiles + ortofoto PNOA + NDVI Sentinel-2
3. Studio visualiza el twin con Cesium + capas activables
4. Descargas: cenital PNG, modelo GLB, USDZ para AR, KML

## Rangos de tamaño
| Tipo | Área | Camera range ideal | DEM resolución |
|------|------|-------------------|----------------|
| Jardín/casa | <0.5 ha | 80-200m | 2m (MDT02) |
| Parcela | 0.5-10 ha | 200-600m | 2m (MDT02) |
| Finca media | 10-100 ha | 600-2000m | 5m (MDT05) |
| Finca grande | 100-500 ha | 2000-5000m | 5m (MDT05) |
| Comarca | >500 ha | 5000-15000m | 10m |
