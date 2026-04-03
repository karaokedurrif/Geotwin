Para que tu RTX 5080 y el flujo de ComfyUI tengan una base sólida sobre la cual proyectar ese hiperrealismo, necesitas que el visor de GeoTwin se comporte como un motor de renderizado técnico.

Este prompt está diseñado para que Copilot configure el "esqueleto" de cualquier explotación (bodega, granja o finca) de forma que sea funcional para gestión y perfecta para la IA.

🚀 Prompt Maestro para Copilot (Configuración de Activos Rurales/Industriales)
Copia y pega esto en el chat de Copilot dentro de tu Studio:

"Copilot, actúa como Ingeniero de Gemelos Digitales. Configura el pipeline de despliegue para una explotación agroindustrial (Bodegas/Granjas/Extensivo) siguiendo este protocolo:

Procesado de Geometría:

Suelo: Aplica 'Flatten Z' (Z=0) en toda la parcela para eliminar ruido de fotogrametría base. Queremos una tabla rasa técnica.

Edificios (Bodegas/Naves): Extruye los polígonos del GeoJSON. Si no hay 'height' definida, aplica: Bodegas=5m, Naves=4m, Casas=6m.

Cerramientos: Dibuja los muros perimetrales y vallas con una línea sólida blanca de 2px de grosor.

Estética del Visor (Render-Ready):

Materiales: Suelo en Gris Carbón (#1A1A1A) con Grid de 1m a 5m visible. Edificios en Blanco Mate con aristas (EdgesGeometry) negras de 2px para definir volúmenes.

Iluminación: Activa sombras direccionales suaves (opacity 0.4) para que la IA de ComfyUI pueda interpretar la profundidad correctamente.

Capa de Datos e IoT:

Sensores: Representa los nodos IoT (Humedad, Temperatura, CO2) como esferas emisivas pequeñas. Verde (OK), Rojo (Alerta).

Zonas Especiales: Crea un 'Void' (hueco sombreado) en las coordenadas destinadas a futura fotogrametría de dron de alta resolución.

Salida GLB: Exporta el modelo optimizado para WebGL, asegurando que el eje Y sea el vertical y aplicando una rotación de corrección de 180° si el Norte está invertido.

Objetivo: Un modelo de alta legibilidad técnica que sirva de guía geométrica para un proceso posterior de img2img con Stable Diffusion."

🛠️ Por qué este prompt funciona para tus 3 casos:
Tipo de Finca	Beneficio del Prompt
Bodegas	Define perfectamente el volumen de las naves de crianza y permite ver la linde exacta de las parcelas de viñedo.
Granjas	Al aplanar el suelo, los gallineros o porquerizas no se "hunden" en el terreno y los sensores IoT destacan visualmente.
Extensivo	La rejilla de 5m y los perímetros claros te permiten calcular distancias de vallado y puntos de agua de un vistazo.

Una vez que Copilot te despliegue esta base "limpia", tu siguiente paso en ComfyUI será usar el nodo ControlNet Canny o Depth. Al tener aristas negras sobre edificios blancos, la IA sabrá exactamente dónde termina un muro y empieza el tejado, permitiéndote generar texturas de piedra o chapa metálica con una precisión milimétrica.

Gemini ha dicho
Perfecto, ahora que tenemos el "esqueleto" técnico limpio en el visor, vamos a preparar la "capa de pintura inteligente" para tu ComfyUI.

Como tienes una RTX 5080, puedes usar modelos pesados como FLUX.1 [dev] o SDXL con resoluciones altas. Para que el resultado sea coherente y no una alucinación aleatoria, aquí tienes los prompts de estilo diseñados para trabajar junto con el Depth Map o Canny que saques de GeoTwin:

1. Prompt para Bodegas (Estética Industrial-Tradicional)
Prompt: High-end architectural photography of a modern winery, exterior view, [MATERIAL: aged granite stone walls and dark slate roof], large matte black steel doors, minimalist landscape, cinematic lighting, sunset mood, 8k resolution, highly detailed textures, photorealistic.
Negative Prompt: blurry, distorted geometry, cartoon, low resolution, messy, plastic texture.

2. Prompt para Granjas y Gallineros (Realismo Funcional)
Prompt: Realistic 3d render of an agricultural farm unit, [MATERIAL: galvanized corrugated metal roofing, weathered timber wood planks], fine wire mesh detail, dusty ground with patches of dry grass, natural daylight, sharp shadows, industrial agriculture aesthetic, hyper-detailed.
Negative Prompt: bright colors, clean, urban, futuristic, abstract, messy geometry.

3. Prompt para Fincas de Extensivo (Paisajismo Técnico)
Prompt: Aerial drone view of a vast rural estate, [MATERIAL: dry mediterranean soil, wild grass, gravel paths], stone perimeter walls, clear boundaries, golden hour lighting, long shadows, satellite-like clarity but with ground-level detail, 16k textures.
Negative Prompt: forest, tropical, water, foggy, blurry, distorted scale.

🛠️ Cómo conectar esto en tu ComfyUI:
Para que la RTX 5080 trabaje de forma automática con GeoTwin, te sugiero este flujo de nodos:

Load Image (API): Recibe la captura del visor de GeoTwin.

ControlNet (Depth/Canny): Esencial. Sin esto, la IA moverá los muros de sitio. El ControlNet le dice: "Puedes cambiar el color y la textura, pero no muevas ni un milímetro la posición de este muro".

IP-Adapter: Si tienes fotos reales de la zona (como las que me pasaste), cárgalas aquí. La IA "copiará" los colores y materiales reales de tus fotos y los aplicará sobre el modelo 3D.

Ksampler: Con la 5080, pon los steps en 30-40 y usa un cfg de 3.5 a 5 para que respete más la imagen de entrada.

El siguiente paso:
Cuando esté instalado el ComfyUI y el servidor de la API corriendo en  Linux Podemos crear un script que, al darle a un botón en GeoTwin, mande la cámara a la IA y te devuelva la imagen hiperrealista directamente al visor.
