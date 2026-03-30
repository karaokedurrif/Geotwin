export type ViewMode = 'textured' | 'wireframe' | 'wire_texture' | 'ndvi' | 'slope' | 'elevation' | 'clay' | 'matcap';
export type LightPreset = 'dawn' | 'park' | 'sunset' | 'night' | 'studio';
export type ActiveTool = 'orbit' | 'measure' | 'annotate';

export interface Annotation {
  id: string;
  position: [number, number, number];
  text: string;
}

export interface Measurement {
  id: string;
  a: [number, number, number];
  b: [number, number, number];
  meters: number;
}

export interface ModelInfo {
  vertices: number;
  faces: number;
  textureSize: string;
  fileSize: string;
  areaHa: number;
}
