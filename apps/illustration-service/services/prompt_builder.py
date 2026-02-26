"""
prompt_builder.py — Construcción de prompts para img2img fiel a ortofoto.

FILOSOFÍA: La ortofoto real es la fuente de verdad.
El prompt NO debe describir vegetación, colores ni árboles específicos.
Solo debe instruir a Flux a MEJORAR lo que ya existe en la imagen base.
"""


def build_illustration_prompt(
    veg=None,          # IGNORADO — no usamos análisis de vegetación inventado
    terrain=None,      # IGNORADO — la ortofoto ya tiene el terreno real
    style: str = "natural",
    extra_elements: list | None = None,
    is_img2img: bool = True,
) -> dict[str, str]:
    """
    Construye prompt que RESPETA la ortofoto real.
    NO describe vegetación, colores ni geografía específica.
    """
    
    if is_img2img:
        # ── MODO img2img: MÍNIMA intervención ──────────────────────────
        # Prompt ULTRA MINIMALISTA - solo mejorar calidad y añadir contorno
        
        positive = (
            # Solo upscale, NO artistic interpretation
            "upscale and enhance this aerial photograph, "
            "preserve exact tree positions, "
            "preserve exact colors, "
            "preserve exact terrain shape, "
            "do not add any elements, "
            "do not remove any elements, "
            "sharp focus, high detail, "
            # Contorno catastral - ÚNICO elemento nuevo
            "add thin glowing gold line at parcel boundary, "
            "gold cadastral outline, "
        )
        
        # Efecto de luz MÍNIMO según estilo
        light_effects = {
            "natural":    "natural daylight, ",
            "topo":       "clear even lighting, ",
            "ndvi":       "preserve colors as-is, ",
            "night":      "low light, ",
            "minimal":    "soft light, ",
            "pendientes": "directional light, ",
        }
        positive += light_effects.get(style, light_effects["natural"])
        
        # Negative REFORZADO - absolutamente NO inventar
        negative = (
            # CRÍTICO: no inventar NADA
            "adding trees, adding buildings, adding roads, adding water, "
            "removing trees, removing elements, "
            "changing colors, changing tree colors, changing vegetation, "
            "changing shape, square shape, rectangular shape, "
            "autumn colors, yellow trees, seasonal changes, "
            "invented elements, artistic interpretation, "
            "isometric view, illustration style, rendered, "
            "cinematic, dramatic, artistic, stylized, "
            # Calidad
            "blurry, low quality, pixelated, "
            "cartoon, anime, painting, drawing, "
            "text, watermarks, logos, "
        )
        
        # Extra elements
        if extra_elements:
            if "iot" in extra_elements:
                positive += "add small IoT sensors, "
            if "cattle" in extra_elements:
                positive += "add cattle, "
        
        return {"positive": positive, "negative": negative}
    
    else:
        # ── MODO text2img fallback (cuando no hay ortofoto) ──────────
        # En este caso SÍ usamos descripción genérica de calidad
        positive = (
            "hyperrealistic aerial isometric illustration, "
            "real landscape aerial photography style, "
            "photorealistic vegetation, cinematic lighting, "
            "ultra detailed 8K, professional GIS visualization, "
            "gold cadastral boundary line, irregular parcel shape, "
        )
        negative = (
            "cartoon, anime, flat, blurry, low quality, "
            "square shape, rectangular borders, "
            "text, watermarks, urban elements, "
        )
        return {"positive": positive, "negative": negative}

    return {"positive": positive, "negative": negative}
