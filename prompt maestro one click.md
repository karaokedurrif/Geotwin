Prompt Maestro: "The GeoTwin One-Click Engine"
Contexto: Estoy desarrollando el backend de 'Neofarm GeoTwin'. El objetivo es que el usuario solo introduzca una Referencia Catastral y el sistema genere automáticamente el gemelo digital 3D completo. Tengo una RTX 5080 y 64GB de RAM para el procesamiento.

Tarea: Escribe un script en Python llamado autotwin_engine.py que implemente el siguiente flujo de trabajo:

1. Integración con WFS de Catastro (España):

El script recibe una Referencia Catastral de 14 o 20 caracteres.

Debe realizar una petición al WFS de la Sede Electrónica del Catastro para obtener la geometría del recinto (Parcela) y la geometría de los edificios (Edificios/Construcciones).

Extrae del GML resultante: los límites del polígono (coordenadas lat/lon), la altura del edificio o número de plantas (numberOfFloorsAboveGround) y el área en m2.

2. Fetcher de LiDAR PNOA Automático:

Calcula el centroid de la parcela obtenida.

Conecta con el Servicio Atom del IGN para buscar, descargar y descomprimir el archivo .LAZ de la 2ª Cobertura LiDAR que cubra esas coordenadas.

3. Procesamiento de Geometría Híbrida (PDAL):

Recorte: Usa PDAL para recortar la nube de puntos usando el polígono de Catastro como máscara.

Limpieza: Separa la Clase 6 (Edificios) de las Clases 3-5 (Vegetación).

Extrusión de Fallback: Si la Clase 6 tiene pocos puntos, usa la huella del GML de Catastro para crear una extrusión 3D perfecta (mallas de paredes rectas) a la altura indicada en los datos catastrales.

4. Optimización de Visualización (Tiling & Offset):

Implementa un Offset Local: Resta el centroid a todas las coordenadas para que la finca se renderice en el origen (0,0,0) del Studio, evitando errores de precisión flotante.

Divide la finca en bloques de 50m×50m (Tiling) para que el frontend cargue los datos de forma fluida.

Exporta el resultado final a un bucket S3 organizado por twinId.

5. Generación de Metadatos:

Crea un archivo geotwin_geometry_snapshot.json actualizado que incluya el twinId, el centroid, el área calculada y los sensores virtuales posicionados automáticamente en el nuevo mallado.

Tecnologías: requests, PDAL, py3dtiles, shapely, trimesh y multiprocessing para usar todos los núcleos de mi CPU.