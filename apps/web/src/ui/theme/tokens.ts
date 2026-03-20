// Design tokens — inspirado en Blender 4.x + Architectural dark UI
// GeoTwin Engine v2.0

export const tokens = {
  // Fondo principal: gris muy oscuro, NO negro puro (fatiga visual)
  bg: {
    primary: '#1a1a1e',     // Fondo del viewer
    secondary: '#222226',   // Panels
    tertiary: '#2a2a2e',    // Cards dentro de panels
    hover: '#333338',       // Hover states
    active: '#3a3a40',      // Active/selected
  },
  // Acentos: verde esmeralda (agro) + ámbar (alertas) + azul (info)
  accent: {
    primary: '#10B981',      // Esmeralda — acción principal
    primaryDim: '#10B98140', // Para fondos sutiles
    secondary: '#3B82F6',    // Azul — info/selección
    warning: '#F59E0B',      // Ámbar — alertas
    danger: '#EF4444',       // Rojo — errores/fuego
    gold: '#D4A843',         // Oro — exports premium
  },
  // Texto: 4 niveles de jerarquía
  text: {
    primary: '#E8E8EC',     // Títulos
    secondary: '#A0A0A8',   // Cuerpo
    tertiary: '#6B6B73',    // Labels secundarios
    disabled: '#45454D',    // Deshabilitado
  },
  // Bordes ultrasutiles
  border: {
    subtle: '#2e2e34',
    normal: '#3a3a42',
    focus: '#10B98180',
  },
  // Tipografía
  font: {
    mono: "'JetBrains Mono', 'Fira Code', monospace",
    sans: "'DM Sans', 'Inter', system-ui, sans-serif",
    display: "'Space Grotesk', 'DM Sans', sans-serif",
  },
  // Tamaños compactos (Blender-density)
  size: {
    panelHeader: '11px',
    label: '11px',
    body: '12px',
    title: '13px',
    sectionTitle: '14px',
  },
  // Radios
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
  },
  // Sombras sutiles
  shadow: {
    panel: '0 2px 8px rgba(0,0,0,0.3)',
    dropdown: '0 4px 16px rgba(0,0,0,0.4)',
    glow: (color: string) => `0 0 12px ${color}40`,
  },
} as const;

export type Tokens = typeof tokens;
