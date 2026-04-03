"""
GeoTwin Hyperreal — Style presets for ControlNet-guided rendering.

Each preset defines the prompt, negative prompt, and recommended ComfyUI
parameters for a specific type of rural estate / land use.
"""

STYLE_PRESETS: dict[str, dict] = {
    "bodega": {
        "prompt": (
            "Aerial photography of a Spanish winery estate, aged limestone walls, "
            "dark clay tile roof, oak barrel storage building, manicured vineyard rows, "
            "gravel paths between buildings, cinematic golden hour lighting, "
            "long dramatic shadows, 8k resolution, photorealistic, "
            "architectural photography style, rural Spain landscape"
        ),
        "negative": (
            "blurry, distorted geometry, cartoon, low resolution, plastic texture, "
            "urban, modern glass, skyscrapers, snow, tropical, neon"
        ),
        "controlnet_strength": 0.85,
        "denoise": 0.70,
        "description": "Bodega con piedra, teja y viñedo — estilo fotografía arquitectónica",
    },
    "granja": {
        "prompt": (
            "Realistic aerial photograph of a Spanish farm compound, "
            "corrugated metal roofing on livestock buildings, weathered stone walls, "
            "dusty farmyard with patches of dry grass, concrete feeding troughs, "
            "wire mesh fencing, natural harsh midday sunlight, sharp shadows, "
            "rural agricultural aesthetic, drone photography, ultra detailed"
        ),
        "negative": (
            "blurry, bright saturated colors, clean modern, urban, futuristic, "
            "snow, lush green tropical, abstract art, painting style"
        ),
        "controlnet_strength": 0.90,
        "denoise": 0.65,
        "description": "Granja con chapa, piedra y tierra — estilo foto de dron realista",
    },
    "extensivo": {
        "prompt": (
            "Aerial drone photograph of a vast Mediterranean rural estate, "
            "dry golden grassland with scattered holm oak trees (encinas), "
            "ancient stone boundary walls, unpaved dirt tracks, "
            "rocky outcrops, wild thyme and lavender patches, "
            "clear blue sky, golden hour warm light, long natural shadows, "
            "satellite imagery clarity with ground-level texture detail, "
            "dehesa landscape, ultra sharp 16k textures, photorealistic"
        ),
        "negative": (
            "tropical forest, dense jungle, foggy, rainy, snow, urban, "
            "buildings, roads, asphalt, blurry, low quality, painting, cartoon"
        ),
        "controlnet_strength": 0.80,
        "denoise": 0.75,
        "description": "Finca de dehesa con encinas y pastos — estilo foto aérea dorada",
    },
    "vinedo": {
        "prompt": (
            "Professional aerial photograph of a Spanish vineyard, "
            "perfectly aligned vine rows with green canopy, "
            "red-brown earth between rows, stone bodega building in background, "
            "gentle rolling hills, morning dew on leaves, "
            "Ribera del Duero landscape, warm autumn light, "
            "wine country photography, ultra detailed vegetation"
        ),
        "negative": (
            "flat terrain, urban, concrete, snow, tropical, blurry, cartoon, "
            "oversaturated, artificial lighting"
        ),
        "controlnet_strength": 0.85,
        "denoise": 0.70,
        "description": "Viñedo con hileras y bodega — estilo foto de vendimia",
    },
    "gallinero": {
        "prompt": (
            "Realistic aerial view of a small Spanish poultry farm, "
            "galvanized metal chicken coop with wire mesh runs, "
            "packed earth ground, scattered feed, wooden perches, "
            "Mediterranean garden with fruit trees and vegetable patches, "
            "stone perimeter wall, afternoon sun, rural domestic setting, "
            "warm natural colors, farm life photography"
        ),
        "negative": (
            "industrial factory, urban, clean sterile, snow, foggy, "
            "blurry, cartoon, abstract"
        ),
        "controlnet_strength": 0.90,
        "denoise": 0.60,
        "description": "Gallinero y huerta — estilo foto doméstica rural",
    },
}
