/**
 * GeoTwin Studio — Unified viewer page
 * URL: /twin/{twinId}
 *
 * Combines Cesium (map) and Three.js (3D) views into a single tabbed interface.
 * Does NOT rewrite existing components — wraps them with a shared header + tab bar.
 */
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { twinStore } from '@/lib/twinStore';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';

const DEFAULT_VISUAL_STYLE: VisualStyle = {
  preset: 'default',
  fillColor: '#00d4ff',
  fillOpacity: 0.2,
  boundaryColor: '#FFD700',
  boundaryWidth: 4.0,
  terrainExaggeration: 1.0,
  enableLighting: true,
  timeOfDay: '2024-06-15T10:00:00Z',
  atmosphereDensity: 1.0,
};

const StudioViewer = dynamic(
  () => import('@/components/studio/StudioViewer'),
  { ssr: false, loading: () => <LoadingOverlay /> }
);

const TerrainStudio = dynamic(
  () => import('@/components/terrain-studio/TerrainStudio'),
  { ssr: false }
);

type Tab = 'map' | '3d';

function LoadingOverlay() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a14',
        gap: 14,
        fontFamily: 'system-ui, sans-serif',
        color: '#9ca3af',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#10B981"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ animation: 'spin 1s linear infinite' }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span style={{ fontSize: 13 }}>Cargando gemelo digital...</span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function TwinPage() {
  const router = useRouter();
  const { twinId, tab: tabQuery } = router.query;
  const tid = typeof twinId === 'string' ? twinId : '';

  const [tab, setTab] = useState<Tab>((tabQuery as Tab) || 'map');
  const [snapshot, setSnapshot] = useState<TwinSnapshot | null>(null);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
  const [layerState, setLayerState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewerRef, setViewerRef] = useState<any>(null);
  const [tilesAvailable, setTilesAvailable] = useState<boolean | null>(null); // null = checking

  // Sync tab with URL query param
  useEffect(() => {
    if (tabQuery && tabQuery !== tab) setTab(tabQuery as Tab);
  }, [tabQuery]);

  const changeTab = (t: Tab) => {
    setTab(t);
    router.replace(`/twin/${tid}?tab=${t}`, undefined, { shallow: true });
  };

  // Check if 3D tiles (GLB) exist when switching to 3D tab
  useEffect(() => {
    if (!tid || tab !== '3d') return;
    setTilesAvailable(null);
    const glbUrl = `${API_BASE}/api/tiles/${encodeURIComponent(tid)}/${encodeURIComponent(tid)}.glb`;
    fetch(glbUrl, { method: 'HEAD' })
      .then(r => setTilesAvailable(r.ok))
      .catch(() => setTilesAvailable(false));
  }, [tid, tab]);

  useEffect(() => {
    if (!tid) return;

    setLoading(true);

    // Load snapshot from localStorage, fallback to API
    const snap = twinStore.get(tid);
    if (snap) {
      applySnapshot(snap);
      return;
    }

    fetch(`${API_BASE}/api/twin/${encodeURIComponent(tid)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.recipe) {
          const recipe = data.recipe;
          const minSnap: TwinSnapshot = {
            version: '1.0',
            twinId: tid,
            timestamp: new Date().toISOString(),
            parcel: {
              sourceFile: recipe.parcel?.file || 'api',
              name: recipe.parcel?.name || tid,
              geojson: recipe.parcel?.geometry || recipe.geometry || null,
              area_ha: recipe.parcel?.area_ha || recipe.area_ha || 0,
              centroid: recipe.parcel?.centroid || recipe.centroid || [0, 0],
            },
            layers: {},
            camera: recipe.camera || { headingDeg: 315, pitchDeg: -45, range_m: 0, centerLon: 0, centerLat: 0 },
          } as TwinSnapshot;
          applySnapshot(minSnap);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [tid]);

  function applySnapshot(snap: TwinSnapshot) {
    setSnapshot(snap);
    setLayerState(snap.layers ?? {});
    const merged: VisualStyle = {
      ...DEFAULT_VISUAL_STYLE,
      ...(snap.visualStyle ?? {}),
      terrainExaggeration: snap.visualStyle?.terrainExaggeration ?? 1.0,
    };
    setVisualStyle(merged);
    setLoading(false);
  }

  if (!tid) return null;

  if (notFound) {
    return (
      <div style={S.shell}>
        <div style={S.center}>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>
            Twin <code>{tid}</code> no encontrado.{' '}
            <button onClick={() => router.push('/')} style={S.linkBtn}>
              ← Volver
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (loading || !snapshot) {
    return (
      <div style={S.shell}>
        <LoadingOverlay />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>GeoTwin Studio — {snapshot.parcel.name || tid}</title>
      </Head>

      <div style={S.shell}>
        {/* Unified header */}
        <header style={S.header}>
          <div style={S.hLeft}>
            <button onClick={() => router.push('/')} style={S.backBtn} title="Volver a captura">
              ← 
            </button>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
              <line x1="12" y1="22" x2="12" y2="15.5" />
              <polyline points="22 8.5 12 15.5 2 8.5" />
            </svg>
            <span style={S.appName}>GeoTwin Studio</span>
            <span style={S.sep}>—</span>
            <span style={S.parcelName}>{snapshot.parcel.name || tid}</span>
          </div>

          {/* Tab bar */}
          <div style={S.tabs}>
            {(['map', '3d'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => changeTab(t)}
                style={{
                  ...S.tabBtn,
                  ...(tab === t ? S.tabBtnActive : {}),
                }}
              >
                {t === 'map' ? '🗺 Mapa' : '🎲 3D'}
              </button>
            ))}
          </div>

          <div style={S.hRight}>
            <code style={S.twinId}>{tid}</code>
          </div>
        </header>

        {/* Content area */}
        <div style={S.body}>
          {tab === 'map' && (
            <StudioViewer
              snapshot={snapshot}
              visualStyle={visualStyle}
              layerState={layerState}
              activeMode="terrain"
              onViewerReady={setViewerRef}
            />
          )}
          {tab === '3d' && tilesAvailable === null && (
            <LoadingOverlay />
          )}
          {tab === '3d' && tilesAvailable === false && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: '#9ca3af', fontSize: 14, fontFamily: 'system-ui, sans-serif' }}>
              <span>El modelo 3D aún no ha sido generado.</span>
              <a href={`/studio/${tid}`} style={{ color: '#10B981', textDecoration: 'underline', cursor: 'pointer' }}>
                Abrir en Studio para generar el mallado 3D →
              </a>
            </div>
          )}
          {tab === '3d' && tilesAvailable === true && (
            <TerrainStudio
              twinId={tid}
              areaHa={snapshot.parcel.area_ha}
              geojson={snapshot.parcel.geojson as Record<string, unknown>}
              onClose={() => changeTab('map')}
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a14',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  header: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 8,
    background: '#111118',
    borderBottom: '1px solid #1e1e24',
    flexShrink: 0,
    zIndex: 10,
  },
  hLeft: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 },
  hRight: { display: 'flex', alignItems: 'center', gap: 6 },
  tabs: { display: 'flex', gap: 4 },
  tabBtn: {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    background: 'transparent',
    color: '#71717a',
    border: '1px solid transparent',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  tabBtnActive: {
    background: 'rgba(16,185,129,0.12)',
    color: '#10B981',
    border: '1px solid rgba(16,185,129,0.3)',
  },
  appName: { color: '#10B981', fontWeight: 700, fontSize: 13 },
  sep: { color: '#3a3a40', fontSize: 13 },
  parcelName: { color: '#a1a1aa', fontSize: 12 },
  twinId: {
    color: '#52525b',
    fontSize: 10,
    background: 'rgba(255,255,255,0.04)',
    padding: '2px 6px',
    borderRadius: 3,
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: '#71717a',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 4px',
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: '#10B981',
    cursor: 'pointer',
    fontSize: 14,
  },
  body: { flex: 1, position: 'relative', overflow: 'hidden' },
  center: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
