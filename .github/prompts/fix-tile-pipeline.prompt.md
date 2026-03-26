---
agent: 'agent'
description: 'Debug the DEM→mesh→tiles pipeline in the Python engine'
---
The user reports an issue with the terrain meshing pipeline.

Key rules:
- Engine runs as FastAPI container (geotwin-engine, port 8002)
- Pipeline: KML/GeoJSON → AOI → DEM download (IGN WCS) → Delaunay mesh → LOD decimation → GLB export → 3D Tiles
- UV coordinates MUST be in [0,1] range (normalized from bbox)
- GLB must use PBR material with baseColorTexture for Cesium compatibility
- B3DM wraps GLB for 3D Tiles format
- Test locally: python -m engine --input FILE --twin-id TEST --output /tmp/test
- Verify GLB: trimesh.load('terrain_lod0.glb').visual.uv should be in [0,1]
