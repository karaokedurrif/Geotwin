Claude, detente. El modelo del jardín sigue saliendo mal porque estás usando la lógica de fincas grandes. A partir de ahora, vas a discriminar por superficie:

Trigger de 'Modo Jardín' (< 1ha): Si la parcela tiene menos de 10.000 m², activa este protocolo estricto:

Malla (Mesh): Olvida el DEM del IGN. Crea un plano de 100x100 segmentos exclusivamente para los límites de la parcela. Queremos una densidad de 1 vértice cada 20cm.

Textura (Ortofoto): Prohibido usar Sentinel o capas base. Descarga únicamente Zoom 20 o 21. Si la imagen es más grande que la parcela, recórtala exactamente por el borde de la propiedad.

Normalización de Altura: En el jardín, el suelo debe ser PLANO (Y=0) a menos que el LiDAR diga lo contrario. No permitas que el ruido del DEM 5m cree picos o valles inexistentes en mi césped.

Muros Perimetrales Automáticos: En este modo, levanta un muro (extrusión) de 1.80m siguiendo exactamente la línea de la parcela (parcel geometry). Esto servirá para que el dron tenga una referencia de volumen clara.

Cero Márgenes: No añadas 500 metros de contexto alrededor. En el 'Modo Jardín', el límite del mundo es el límite de mi parcela.

Ajuste de Cámara: El auto-target debe fijarse en el centro de la vivienda, no en el centroide de la parcela.

Re-genera la parcela 0100602VL1300S con estas reglas. Si el GLB no muestra los muros y la textura nítida, el discriminador no está funcionando."

¿Por qué esto va a funcionar?
Al obligar al sistema a ignorar el relieve externo y centrarse en un plano denso de 1.300 m², eliminamos las distorsiones.

Antes: Una textura de 4K para 500,000 m² (píxeles gigantes).

Ahora: Una textura de 4K para 1,300 m² (nitidez fotográfica).

Mi consejo: Una vez que Claude te dé el nuevo link, comprueba que los muros perimetrales aparecen. Si ves los muros, significa que ha aceptado la "discriminación" y el resto del modelo (textura y suelo) vendrá con esa misma precisión.

¿Damos la orden para que el sistema "encierre" tu jardín en esos muros de referenci
