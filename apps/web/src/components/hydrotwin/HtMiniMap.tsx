'use client';

import { useEffect, useRef } from 'react';
import type { TramoCanal } from '@/lib/hydrotwin/barbo-types';
import { BARBO, HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtMiniMapProps {
  tramos: TramoCanal[];
}

const ESTADO_COLORS_MAP = {
  ok: HT_COLORS.ok,
  aviso: HT_COLORS.aviso,
  alarma: HT_COLORS.alarma,
} as const;

// Canal route coordinates (approximate path from Pozo to destinations)
const CANAL_ROUTE: [number, number][] = [
  [37.850, -1.480],  // Pozo
  [37.855, -1.475],  // Nodo A
  [37.860, -1.468],  // Nodo B
  [37.870, -1.460],  // Bifurcación
];

const DESTINATIONS = {
  pliego: [37.875, -1.455] as [number, number],
  librilla: [37.865, -1.452] as [number, number],
};

const NODES = [
  { pos: BARBO.infraestructura.pozo, label: 'Pozo', icon: '💧' },
  { pos: { lat: 37.855, lng: -1.475 }, label: 'Nodo A', icon: 'A' },
  { pos: { lat: 37.860, lng: -1.468 }, label: 'Nodo B', icon: 'B' },
  { pos: BARBO.infraestructura.bifurcacion, label: 'Bifurcación', icon: '⑂' },
  { pos: { lat: 37.875, lng: -1.455 }, label: 'Pliego', icon: 'P' },
  { pos: { lat: 37.865, lng: -1.452 }, label: 'Librilla', icon: 'L' },
];

export function HtMiniMap({ tramos }: HtMiniMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    // Dynamic import of Leaflet (avoid SSR issues)
    let cancelled = false;

    async function initMap() {
      const L = (await import('leaflet')).default;

      if (cancelled || !mapRef.current || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        center: [37.860, -1.467],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
      });

      // CartoDB Dark Matter tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // Canal route segments with color by tramo estado
      const segmentCoords = [...CANAL_ROUTE];
      for (let i = 0; i < Math.min(tramos.length, segmentCoords.length - 1); i++) {
        const color = ESTADO_COLORS_MAP[tramos[i].estado];
        L.polyline(
          [segmentCoords[i], segmentCoords[i + 1]],
          { color, weight: 4, opacity: 0.8, dashArray: tramos[i].tipo === 'entubado' ? undefined : '8 6' }
        ).addTo(map);
      }

      // Branch to Pliego
      if (tramos[3]) {
        L.polyline(
          [CANAL_ROUTE[3], DESTINATIONS.pliego],
          { color: ESTADO_COLORS_MAP[tramos[3].estado], weight: 3, opacity: 0.7, dashArray: '8 6' }
        ).addTo(map);
      }

      // Branch to Librilla
      if (tramos[4]) {
        L.polyline(
          [CANAL_ROUTE[3], DESTINATIONS.librilla],
          { color: ESTADO_COLORS_MAP[tramos[4].estado], weight: 3, opacity: 0.8 }
        ).addTo(map);
      }

      // Markers
      for (const node of NODES) {
        const marker = L.circleMarker([node.pos.lat, node.pos.lng], {
          radius: 6,
          fillColor: '#06b6d4',
          color: '#0a0a0f',
          weight: 2,
          fillOpacity: 0.9,
        }).addTo(map);

        marker.bindPopup(
          `<div style="font-family: 'DM Sans', sans-serif; font-size: 12px;">
            <strong>${node.label}</strong>
          </div>`,
          { className: 'ht-popup' }
        );
      }

      mapInstance.current = map;
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [tramos]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Mapa de infraestructura</h3>
        <p className="text-[11px] text-slate-500">Trazado del canal y estado por tramo</p>
      </div>
      <div
        ref={mapRef}
        className="h-[250px] w-full rounded-lg overflow-hidden"
        style={{ background: '#0a0a0f' }}
      />
    </div>
  );
}
