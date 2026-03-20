'use client';
import { useEffect, useState, useRef } from 'react';
import type { TwinSnapshot } from '@/lib/twinStore';

interface SimulatorModeProps {
  viewerRef: any;  // Cesium.Viewer
  snapshot: TwinSnapshot;
  active: boolean;  // Si el tab del simulador está activo
}

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type WeatherType = 'clear' | 'rain' | 'snow';

interface CattleEntity {
  entity: any;
  targetPosition: any;  // Cesium.Cartesian3
  speed: number;
}

export default function SimulatorMode({ viewerRef, snapshot, active }: SimulatorModeProps) {
  // Estado del simulador
  const [helicopterActive, setHelicopterActive] = useState(false);
  const [season, setSeason] = useState<Season>('summer');
  const [weather, setWeather] = useState<WeatherType>('clear');
  const [timeSpeed, setTimeSpeed] = useState(1);
  const [showCattle, setShowCattle] = useState(false);

  // Referencias para animación
  const helicopterAngleRef = useRef(0);  // Ángulo actual de órbita
  const animationFrameRef = useRef<number | null>(null);
  const cattleEntitiesRef = useRef<CattleEntity[]>([]);
  const particleSystemRef = useRef<any>(null);

  // Configuración de estaciones (JulianDate)
  const seasonDates: Record<Season, { month: number; day: number; hour: number }> = {
    spring: { month: 4, day: 15, hour: 10 },   // 15 abril 10:00 - floración
    summer: { month: 7, day: 21, hour: 14 },   // 21 julio 14:00 - sol alto
    autumn: { month: 10, day: 15, hour: 17 },  // 15 octubre 17:00 - atardecer
    winter: { month: 1, day: 20, hour: 9 },    // 20 enero 09:00 - invierno
  };

  // ============================================
  // HELICÓPTERO: Órbita circular automática
  // ============================================
  const startHelicopterOrbit = () => {
    if (!viewerRef || !snapshot.parcel.geojson) return;
    const Cesium = window.Cesium;
    if (!Cesium) return;

    const viewer = viewerRef;
    const [lon, lat] = snapshot.parcel.centroid;
    const areaHa = snapshot.parcel.area_ha ?? 100;
    const distanceM = Math.max(700, Math.min(3000, Math.sqrt(areaHa) * 100));

    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    const animate = () => {
      if (!helicopterActive) return;

      helicopterAngleRef.current += 0.3;
      if (helicopterAngleRef.current >= 360) helicopterAngleRef.current -= 360;

      // lookAt+HeadingPitchRange: camera always at correct elevation above parcel
      viewer.camera.lookAt(
        center,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(helicopterAngleRef.current),
          Cesium.Math.toRadians(-25),
          distanceM,
        )
      );

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
  };

  const stopHelicopterOrbit = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // Release lookAt lock so the user can control the camera again
    const Cesium = window.Cesium;
    if (Cesium && viewerRef && !viewerRef.isDestroyed?.()) {
      viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  };

  // ============================================
  // ESTACIONES: Cambiar fecha y iluminación
  // ============================================
  const changeSeason = (newSeason: Season) => {
    if (!viewerRef) return;
    const Cesium = window.Cesium;
    if (!Cesium) return;

    const viewer = viewerRef;
    const config = seasonDates[newSeason];

    // Crear JulianDate para la estación
    const julianDate = Cesium.JulianDate.fromDate(
      new Date(2024, config.month - 1, config.day, config.hour, 0, 0)
    );

    // Actualizar reloj del viewer
    viewer.clock.currentTime = julianDate;
    viewer.clock.multiplier = timeSpeed;  // Mantener velocidad actual

    console.log(`[Simulator] 🌍 Estación cambiada a ${newSeason} (${config.day}/${config.month} ${config.hour}:00)`);
  };

  // ============================================
  // CLIMA: Partículas de lluvia/nieve
  // ============================================
  const updateWeather = (newWeather: WeatherType) => {
    if (!viewerRef || !snapshot.parcel.geojson) return;
    const Cesium = window.Cesium;
    if (!Cesium) return;

    const viewer = viewerRef;

    // Eliminar sistema de partículas anterior
    if (particleSystemRef.current) {
      viewer.scene.primitives.remove(particleSystemRef.current);
      particleSystemRef.current = null;
    }

    if (newWeather === 'clear') return;

    // Centro de la parcela
    const center = Cesium.Cartesian3.fromDegrees(
      snapshot.parcel.centroid[0],  // lon
      snapshot.parcel.centroid[1],  // lat
      500  // Altura de emisión
    );

    // Configuración según tipo de clima
    const config = newWeather === 'rain' 
      ? {
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAG0lEQVQYV2NkYGD4z8DAwMgABXAGNgGwSgwVAFbmAgXxzBXmAAAAAElFTkSuQmCC',
          startColor: Cesium.Color.WHITE.withAlpha(0.8),
          endColor: Cesium.Color.WHITE.withAlpha(0.3),
          speed: { min: 10, max: 15 },
          life: { min: 3, max: 5 },
          rate: 5000,
        }
      : {  // snow
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAANklEQVQoU2NkYGD4z4AEmpqa/jMxMTEiC+CSwCmBTRBZApcgTgV4JXEpwCuJj0tMCUw+DAUAwPYMCe9W2AkAAAAASUVORK5CYII=',
          startColor: Cesium.Color.WHITE,
          endColor: Cesium.Color.WHITE.withAlpha(0.5),
          speed: { min: 2, max: 4 },
          life: { min: 8, max: 12 },
          rate: 2000,
        };

    const particleSystem = new Cesium.ParticleSystem({
      image: config.image,
      startColor: config.startColor,
      endColor: config.endColor,
      startScale: newWeather === 'rain' ? 1.0 : 3.0,
      endScale: newWeather === 'rain' ? 0.5 : 2.0,
      minimumParticleLife: config.life.min,
      maximumParticleLife: config.life.max,
      minimumSpeed: config.speed.min,
      maximumSpeed: config.speed.max,
      imageSize: new Cesium.Cartesian2(newWeather === 'rain' ? 4 : 8, newWeather === 'rain' ? 4 : 8),
      emissionRate: config.rate,
      lifetime: 999999.0,
      emitter: new Cesium.BoxEmitter(new Cesium.Cartesian3(1000, 1000, 100)),
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(center),
    });

    viewer.scene.primitives.add(particleSystem);
    particleSystemRef.current = particleSystem;

    console.log(`[Simulator] 🌦️ Clima cambiado a ${newWeather}`);
  };

  // ============================================
  // GANADO: Entidades animadas con movimiento
  // ============================================
  const spawnCattle = () => {
    if (!viewerRef || !snapshot.parcel.geojson) return;
    const Cesium = window.Cesium;
    if (!Cesium) return;

    const viewer = viewerRef;

    // Extract geometry — handle both FeatureCollection and direct Polygon
    const geojson = snapshot.parcel.geojson;
    let geometry: any = null;
    if (geojson.type === 'FeatureCollection' && geojson.features?.[0]) {
      geometry = geojson.features[0].geometry;
    } else if (geojson.type === 'Feature') {
      geometry = geojson.geometry;
    } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
      geometry = geojson;
    }
    if (!geometry) return;

    const bounds = geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.coordinates[0][0];  // MultiPolygon

    // Calcular bounding box de la parcela
    const lons = bounds.map((p: number[]) => p[0]);
    const lats = bounds.map((p: number[]) => p[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // Crear 25 vacas/ovejas distribuidas aleatoriamente
    for (let i = 0; i < 25; i++) {
      const lon = minLon + Math.random() * (maxLon - minLon);
      const lat = minLat + Math.random() * (maxLat - minLat);

      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

      const entity = viewer.entities.add({
        position: position,
        point: {
          pixelSize: 12,
          color: i % 3 === 0
            ? Cesium.Color.BROWN      // Vacas marrones
            : Cesium.Color.WHITE,     // Ovejas blancas
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: i % 3 === 0 ? '🐄' : '🐑',
          font: '16px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });

      // Target inicial aleatorio
      const targetLon = minLon + Math.random() * (maxLon - minLon);
      const targetLat = minLat + Math.random() * (maxLat - minLat);
      const targetPosition = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0);

      cattleEntitiesRef.current.push({
        entity,
        targetPosition,
        speed: 0.00001 + Math.random() * 0.00002,  // Velocidad lenta en grados/frame
      });
    }

    console.log('[Simulator] 🐄 25 animales creados');
  };

  const animateCattle = () => {
    if (!showCattle || !viewerRef) return;
    const Cesium = window.Cesium;
    if (!Cesium) return;

    cattleEntitiesRef.current.forEach((cattle) => {
      const currentPos = cattle.entity.position.getValue(Cesium.JulianDate.now());
      if (!currentPos) return;

      const currentCarto = Cesium.Cartographic.fromCartesian(currentPos);
      const targetCarto = Cesium.Cartographic.fromCartesian(cattle.targetPosition);

      // Calcular distancia
      const distance = Cesium.Cartesian3.distance(currentPos, cattle.targetPosition);

      if (distance < 5) {
        // Llegó al target, elegir nuevo target aleatorio
        const geojson = snapshot.parcel.geojson;
        let geom: any = null;
        if (geojson.type === 'FeatureCollection' && geojson.features?.[0]) geom = geojson.features[0].geometry;
        else if (geojson.type === 'Feature') geom = geojson.geometry;
        else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') geom = geojson;
        if (!geom) return;
        const bounds = geom.type === 'Polygon'
          ? geom.coordinates[0]
          : geom.coordinates[0][0];
        const lons = bounds.map((p: number[]) => p[0]);
        const lats = bounds.map((p: number[]) => p[1]);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);

        const newLon = minLon + Math.random() * (maxLon - minLon);
        const newLat = minLat + Math.random() * (maxLat - minLat);
        cattle.targetPosition = Cesium.Cartesian3.fromDegrees(newLon, newLat, 0);
      } else {
        // Mover hacia el target
        const direction = Cesium.Cartesian3.subtract(cattle.targetPosition, currentPos, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(direction, direction);
        const movement = Cesium.Cartesian3.multiplyByScalar(direction, cattle.speed * 100, new Cesium.Cartesian3());
        const newPos = Cesium.Cartesian3.add(currentPos, movement, new Cesium.Cartesian3());

        cattle.entity.position = newPos;
      }
    });
  };

  const removeCattle = () => {
    if (!viewerRef) return;

    const viewer = viewerRef;
    cattleEntitiesRef.current.forEach((cattle) => {
      viewer.entities.remove(cattle.entity);
    });
    cattleEntitiesRef.current = [];

    console.log('[Simulator] 🐄 Animales eliminados');
  };

  // ============================================
  // VELOCIDAD DE TIEMPO
  // ============================================
  const changeTimeSpeed = (multiplier: number) => {
    if (!viewerRef) return;

    viewerRef.clock.multiplier = multiplier;
    setTimeSpeed(multiplier);

    console.log(`[Simulator] ⏱️ Velocidad de tiempo: ${multiplier}x`);
  };

  // ============================================
  // EFECTOS DE CAMBIOS DE ESTADO
  // ============================================
  useEffect(() => {
    if (!active) {
      // Limpiar todo cuando el tab no está activo
      stopHelicopterOrbit();
      return;
    }
  }, [active]);

  useEffect(() => {
    if (helicopterActive && active) {
      startHelicopterOrbit();
    } else {
      stopHelicopterOrbit();
    }

    return () => stopHelicopterOrbit();
  }, [helicopterActive, active]);

  useEffect(() => {
    if (active) {
      changeSeason(season);
    }
  }, [season, active]);

  useEffect(() => {
    if (active) {
      updateWeather(weather);
    }

    return () => {
      // Cleanup
      if (particleSystemRef.current && viewerRef) {
        viewerRef.scene.primitives.remove(particleSystemRef.current);
        particleSystemRef.current = null;
      }
    };
  }, [weather, active]);

  useEffect(() => {
    if (showCattle && active) {
      spawnCattle();

      // Animación continua del ganado
      const interval = setInterval(animateCattle, 100);  // 10fps para movimiento suave
      return () => clearInterval(interval);
    } else {
      removeCattle();
    }
  }, [showCattle, active]);

  // ============================================
  // INTERFAZ DE CONTROLES
  // ============================================
  if (!active) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        right: 16,
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(8px)',
        minWidth: 280,
        zIndex: 100,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#1a5e35' }}>
        🎮 Simulador de Finca
      </div>

      {/* HELICÓPTERO */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#666' }}>
          🚁 Vuelo Helicóptero
        </div>
        <button
          onClick={() => setHelicopterActive(!helicopterActive)}
          style={{
            width: '100%',
            padding: '10px 16px',
            background: helicopterActive ? '#dc2626' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {helicopterActive ? '⏸️ Detener Órbita' : '▶️ Iniciar Órbita'}
        </button>
        {helicopterActive && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' }}>
            Ángulo: {Math.round(helicopterAngleRef.current)}°
          </div>
        )}
      </div>

      {/* ESTACIONES */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#666' }}>
          🌍 Estación del Año
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['spring', 'summer', 'autumn', 'winter'] as Season[]).map((s) => (
            <button
              key={s}
              onClick={() => setSeason(s)}
              style={{
                padding: '8px 12px',
                background: season === s ? '#3b82f6' : '#f3f4f6',
                color: season === s ? 'white' : '#333',
                border: season === s ? '2px solid #2563eb' : '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: season === s ? 600 : 400,
              }}
            >
              {s === 'spring' && '🌸 Primavera'}
              {s === 'summer' && '☀️ Verano'}
              {s === 'autumn' && '🍂 Otoño'}
              {s === 'winter' && '❄️ Invierno'}
            </button>
          ))}
        </div>
      </div>

      {/* CLIMA */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#666' }}>
          🌦️ Clima
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['clear', 'rain', 'snow'] as WeatherType[]).map((w) => (
            <button
              key={w}
              onClick={() => setWeather(w)}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: weather === w ? '#8b5cf6' : '#f3f4f6',
                color: weather === w ? 'white' : '#333',
                border: weather === w ? '2px solid #7c3aed' : '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: weather === w ? 600 : 400,
              }}
            >
              {w === 'clear' && '☀️ Despejado'}
              {w === 'rain' && '🌧️ Lluvia'}
              {w === 'snow' && '❄️ Nieve'}
            </button>
          ))}
        </div>
      </div>

      {/* GANADO */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#666' }}>
          🐄 Ganado Animado
        </div>
        <button
          onClick={() => setShowCattle(!showCattle)}
          style={{
            width: '100%',
            padding: '10px 16px',
            background: showCattle ? '#dc2626' : '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {showCattle ? '🚫 Ocultar Animales (25)' : '🐑 Mostrar Animales (25)'}
        </button>
      </div>

      {/* VELOCIDAD DE TIEMPO */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#666' }}>
          ⏱️ Velocidad de Tiempo: {timeSpeed}x
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
          {[1, 5, 10, 50, 100].map((speed) => (
            <button
              key={speed}
              onClick={() => changeTimeSpeed(speed)}
              style={{
                padding: '6px 4px',
                background: timeSpeed === speed ? '#059669' : '#f3f4f6',
                color: timeSpeed === speed ? 'white' : '#333',
                border: timeSpeed === speed ? '2px solid #047857' : '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: timeSpeed === speed ? 600 : 400,
              }}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
