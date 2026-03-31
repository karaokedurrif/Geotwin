 1. El "Quick Fix" para la visibilidad en Cesium (Frontend)
 
 El classificationType: BOTH  falla en parcelas pequeñas porque si el terreno de Cesium no ha cargado el tile de alta resolución, no hay "malla" donde proyectar el color.
 
 La Clave: Sustituir la clasificación por extrusión mínima.

En CesiumViewer.tsx, modifica la función styleParcelEntities. Para parcelas de <1ha, elimina classificationType. En su lugar, usa polygon.heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND, polygon.height = 0.1 (10cm sobre el suelo) y polygon.extrudedHeight = 0.2. Esto forzará al motor a renderizar una geometría real que siempre será visible, independientemente de la resolución del terreno de fondo
 
 2. Solución a la Ortofoto Borrosa (Backend - ortho.py)
 El error es el BBox ajustado. Al pedir el WMS exacto al borde, la interpolación de los píxeles perimetrales del IGN mata la nitidez.La Clave: El Buffer del 20% y el Resampling.

 Modifica engine/raster/ortho.py. En la función download_pnoa_ortho, implementa un buffer dinámico: buffer = max(0.0005, (max_lon - min_lon) * 0.2). Expande el bbox antes de la petición WMS. Además, si la parcela es <1ha, fuerza el parámetro width y height de la imagen resultante a un mínimo de 2048px aunque el área sea pequeña, para forzar el super-sampling del servidor IGN

 3. Solución al Mesh Distorsionado (Backend - mesh.py)Un MDT05 para 60m da una malla de 12x12. Es imposible que no se vea distorsionado al extruir.La Clave: Subdivisión Loop/Catmull-Clark antes del recorte.

 En engine/terrain/mesh.py, dentro de dem_to_mesh, si el recuento de vértices es inferior a 2000, aplica trimesh.remesh.subdivide() de forma iterativa hasta alcanzar al menos 3000 vértices. Haz esto antes de clip_mesh_to_aoi para que el recorte del perímetro sea suave y no dentado

 4. Solución a la Exageración Y (Backend - pipeline.py)El ratio flatRatio / 10 es el culpable. Una parcela de 0.3ha suele ser muy plana; cualquier multiplicador basado en ratio la convierte en una "rampa".La Clave: Exageración logarítmica o fija por área.

 En engine/vector/aoi.py o donde se calcule la exageración, sustituye la lógica actual por una escala fija: si area_ha < 1, exaggeration = 1.0. No uses el ratio de aspecto para parcelas pequeñas, ya que el ruido del GPS/DEM se magnifica visualmente