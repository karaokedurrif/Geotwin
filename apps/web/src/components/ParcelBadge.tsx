/**
 * ParcelBadge - Compact floating parcel info card (top-left)
 * Shows twin ID, area, and coordinate info
 */

interface ParcelBadgeProps {
  twinId?: string;
  centroid?: [number, number];
  radiusMeters?: number;
  areaHa?: number;
  wasReprojected?: boolean;
  sourceEPSG?: string;
}

export default function ParcelBadge({
  twinId,
  centroid,
  radiusMeters,
  areaHa,
  wasReprojected,
  sourceEPSG,
}: ParcelBadgeProps) {
  // Don't render if no twin loaded
  if (!twinId) {
    return null;
  }

  // Use real area from engine/recipe (UTM-projected), NOT π*r² approximation
  const areaHectares = areaHa ? areaHa.toFixed(1) : null;

  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      left: '336px', // 320px panel + 16px margin
      background: 'rgba(24, 29, 36, 0.92)', // Dark background with transparency
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      padding: '12px 14px',
      minWidth: '220px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      zIndex: 1000,
      pointerEvents: 'auto',
    }}>
      {/* Twin ID Header */}
      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        color: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '8px',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
      }}>
        Digital Twin
      </div>

      {/* Twin ID */}
      <div style={{
        fontSize: '14px',
        fontWeight: 700,
        color: '#3bf28c',
        marginBottom: '10px',
        fontFamily: 'monospace',
        letterSpacing: '-0.01em',
      }}>
        {twinId.slice(0, 10)}
      </div>

      {/* Metrics Row */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '8px',
      }}>
        {/* Area */}
        {areaHectares && (
          <div>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.55)',
              fontWeight: 600,
              marginBottom: '2px',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}>
              Area
            </div>
            <div style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.95)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {areaHectares}<span style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.6)',
                marginLeft: '2px',
              }}>ha</span>
            </div>
          </div>
        )}

        {/* Radius */}
        {radiusMeters && (
          <div>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.55)',
              fontWeight: 600,
              marginBottom: '2px',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}>
              Radius
            </div>
            <div style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.95)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {radiusMeters.toFixed(0)}<span style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.6)',
                marginLeft: '2px',
              }}>m</span>
            </div>
          </div>
        )}
      </div>

      {/* Coordinates */}
      {centroid && (
        <div style={{
          fontSize: '10px',
          color: 'rgba(255, 255, 255, 0.5)',
          fontFamily: 'monospace',
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        }}>
          <div>{centroid[1].toFixed(5)}°N</div>
          <div>{centroid[0].toFixed(5)}°E</div>
        </div>
      )}

      {/* Reprojection Badge */}
      {wasReprojected && sourceEPSG && (
        <div style={{
          marginTop: '8px',
          padding: '4px 8px',
          background: 'rgba(0, 212, 255, 0.15)',
          borderRadius: '4px',
          fontSize: '10px',
          color: '#00d4ff',
          fontWeight: 600,
          textAlign: 'center',
        }}>
          Reprojected from {sourceEPSG}
        </div>
      )}
    </div>
  );
}
