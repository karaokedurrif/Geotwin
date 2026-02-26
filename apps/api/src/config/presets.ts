import type {
  StylePreset,
  PresetConfig,
  ColorConfig,
} from '@geotwin/types';

/**
 * Get preset configuration for a given style
 */
export function getPresetConfig(preset: StylePreset): PresetConfig {
  const configs: Record<StylePreset, PresetConfig> = {
    mountain: {
      name: 'mountain',
      displayName: 'Mountain',
      description: 'Cool tones, strong relief, rocky terrain',
      terrain: {
        verticalExaggeration: 2.0,
        lightingIntensity: 1.2,
      },
      atmosphere: {
        brightness: 0.9,
        saturation: 0.85,
        hueShift: -10, // Cooler blues
        hazeIntensity: 0.15,
      },
      groundTint: rgba(180, 190, 200, 0.3), // Cool gray-blue
      skyboxColor: rgba(100, 120, 150, 0.6), // Blue-gray sky
      plinthColor: rgba(140, 150, 160, 0.9), // Rocky gray base
      markers: {
        type: 'rock',
        count: 15,
        icon: '🏔️',
        scale: 1.0,
      },
      ndviIntensity: 0.6, // Less saturated NDVI
      waterPointsScale: 1.0,
      labelStyle: {
        fillColor: rgba(200, 220, 255, 255), // Cool light blue
        outlineColor: rgba(0, 40, 80, 255),
      },
    },
    
    dehesa: {
      name: 'dehesa',
      displayName: 'Dehesa',
      description: 'Warm pasturelands with oak markers',
      terrain: {
        verticalExaggeration: 1.0,
        lightingIntensity: 1.0,
      },
      atmosphere: {
        brightness: 1.1,
        saturation: 1.05,
        hueShift: 15, // Warmer yellows
        hazeIntensity: 0.08,
      },
      groundTint: rgba(220, 200, 140, 0.25), // Warm pasture
      skyboxColor: rgba(255, 240, 200, 0.4), // Warm golden sky
      plinthColor: rgba(180, 160, 120, 0.85), // Earthy brown base
      markers: {
        type: 'oak',
        count: 120, // More oak trees for pastureland
        icon: '🌳',
        scale: 1.2,
      },
      ndviIntensity: 0.85, // Emphasized pasture heatmap
      waterPointsScale: 1.1,
      labelStyle: {
        fillColor: rgba(255, 230, 180, 255), // Warm cream
        outlineColor: rgba(80, 60, 20, 255),
      },
    },
    
    mediterranean: {
      name: 'mediterranean',
      displayName: 'Mediterranean',
      description: 'Bright sun, dry grass, dusty atmosphere',
      terrain: {
        verticalExaggeration: 1.2,
        lightingIntensity: 1.3,
      },
      atmosphere: {
        brightness: 1.2,
        saturation: 1.1,
        hueShift: 20, // Warm golden
        hazeIntensity: 0.25, // Dusty haze
      },
      groundTint: rgba(210, 190, 120, 0.3), // Dry grass
      skyboxColor: rgba(255, 245, 220, 0.5), // Bright warm sky
      plinthColor: rgba(200, 180, 140, 0.88), // Sandy base
      markers: {
        type: 'olive',
        count: 10,
        icon: '🫒',
        scale: 1.0,
      },
      ndviIntensity: 0.7, // Muted vegetation
      waterPointsScale: 1.4, // More prominent water
      labelStyle: {
        fillColor: rgba(255, 250, 230, 255), // Bright cream
        outlineColor: rgba(100, 80, 40, 255),
      },
    },
  };

  return configs[preset];
}

/**
 * Helper to create RGBA color
 */
function rgba(r: number, g: number, b: number, a: number): ColorConfig {
  return { r, g, b, a };
}
