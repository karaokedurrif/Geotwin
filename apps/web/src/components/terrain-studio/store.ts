import { create } from 'zustand';
import type { ViewMode, LightPreset, ActiveTool, Annotation, Measurement, ModelInfo } from './types';

/** Origin metadata produced by the engine's _degrees_to_local_meters. */
export interface LocalOrigin {
  centroid_lon: number;
  centroid_lat: number;
  min_elev: number;
  m_per_deg_lon: number;
  m_per_deg_lat: number;
  z_sign?: number;  // -1 (default) = -Z is North (glTF forward)
}

interface StudioStore {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  setMaterialParam: (key: string, value: number) => void;
  lightPreset: LightPreset;
  lightIntensity: number;
  lightRotation: number;
  setLightPreset: (p: LightPreset) => void;
  setLightIntensity: (v: number) => void;
  setLightRotation: (v: number) => void;
  ssaoEnabled: boolean;
  bloomEnabled: boolean;
  vignetteEnabled: boolean;
  toggleFX: (fx: string) => void;
  layers: Record<string, boolean>;
  toggleLayer: (key: string) => void;
  activeTool: ActiveTool;
  setActiveTool: (t: ActiveTool) => void;
  annotations: Annotation[];
  addAnnotation: (a: Annotation) => void;
  measurements: Measurement[];
  addMeasurement: (m: Measurement) => void;
  pendingMeasurePoint: [number, number, number] | null;
  setPendingMeasurePoint: (p: [number, number, number] | null) => void;
  modelInfo: ModelInfo;
  setModelInfo: (i: Partial<ModelInfo>) => void;
  showGrid: boolean;
  toggleGrid: () => void;
  glbOverrideUrl: string | null;
  setGlbOverrideUrl: (url: string | null) => void;
  /** Local-coordinate origin from the engine (shared between GLB and parcel outline). */
  localOrigin: LocalOrigin | null;
  setLocalOrigin: (o: LocalOrigin | null) => void;
}

export const useStudioStore = create<StudioStore>((set) => ({
  viewMode: 'textured',
  setViewMode: (m) => set({ viewMode: m }),
  roughness: 0.85,
  metalness: 0.0,
  envMapIntensity: 0.8,
  setMaterialParam: (key, value) => set((s) => ({ ...s, [key]: value })),
  lightPreset: 'park',
  lightIntensity: 1.0,
  lightRotation: 0,
  setLightPreset: (p) => set({ lightPreset: p }),
  setLightIntensity: (v) => set({ lightIntensity: v }),
  setLightRotation: (v) => set({ lightRotation: v }),
  ssaoEnabled: false,  // Disabled by default - causes WebGL depth buffer conflicts
  bloomEnabled: false,
  vignetteEnabled: true,
  toggleFX: (fx) => set((s) => ({ ...s, [fx]: !s[fx as keyof StudioStore] })),
  layers: { ndvi: false, slope: false, elevation: false, sentinel: false, parcel: true },
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  activeTool: 'orbit',
  setActiveTool: (t) => set({ activeTool: t }),
  annotations: [],
  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  measurements: [],
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m] })),
  pendingMeasurePoint: null,
  setPendingMeasurePoint: (p) => set({ pendingMeasurePoint: p }),
  modelInfo: { vertices: 0, faces: 0, textureSize: '-', fileSize: '-', areaHa: 0, fps: 0 },
  setModelInfo: (i) => set((s) => ({ modelInfo: { ...s.modelInfo, ...i } })),
  showGrid: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  glbOverrideUrl: null,
  setGlbOverrideUrl: (url) => set({ glbOverrideUrl: url }),
  localOrigin: null,
  setLocalOrigin: (o) => set({ localOrigin: o }),
}));
