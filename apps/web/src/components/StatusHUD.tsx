/**
 * StatusHUD - Compact floating status card (top-right)
 * Shows terrain, imagery, and NDVI service status
 */

interface ServiceStatusInfo {
  status: 'idle' | 'loading' | 'success' | 'error' | 'fallback';
  message?: string;
}

interface StatusHUDProps {
  terrainStatus?: ServiceStatusInfo;
  imageryStatus?: ServiceStatusInfo;
  ndviStatus?: ServiceStatusInfo;
  isOffline?: boolean;
}

export default function StatusHUD({
  terrainStatus,
  imageryStatus,
  ndviStatus,
  isOffline,
}: StatusHUDProps) {
  // Don't render if no status data
  if (!terrainStatus && !imageryStatus && !ndviStatus && !isOffline) {
    return null;
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success':
        return '#3bf28c';
      case 'loading':
        return '#00d4ff';
      case 'error':
        return '#dc2626';
      case 'fallback':
        return '#f0c040';
      default:
        return 'rgba(255, 255, 255, 0.5)';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success':
        return '●';
      case 'loading':
        return '◐';
      case 'error':
        return '✕';
      case 'fallback':
        return '◐';
      default:
        return '○';
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      right: '16px',
      background: 'rgba(24, 29, 36, 0.92)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      padding: '12px 14px',
      minWidth: '200px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      zIndex: 1000,
      pointerEvents: 'auto',
    }}>
      {/* Header */}
      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        color: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '8px',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
      }}>
        System Status
      </div>

      {/* Offline Warning */}
      {isOffline && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 8px',
          background: '#fef2f2',
          borderRadius: '6px',
          marginBottom: '8px',
        }}>
          <span style={{ color: '#dc2626', fontSize: '12px' }}>⚠</span>
          <span style={{ fontSize: '11px', color: '#991b1b', fontWeight: 600 }}>
            Offline Mode
          </span>
        </div>
      )}

      {/* Status Items */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        {/* Terrain Status */}
        {terrainStatus && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
          }}>
            <span style={{
              color: getStatusColor(terrainStatus.status),
              fontSize: '14px',
              lineHeight: 1,
            }}>
              {getStatusIcon(terrainStatus.status)}
            </span>
            <span style={{
              flex: 1,
              color: 'rgba(255, 255, 255, 0.95)',
              fontWeight: 500,
            }}>
              Terrain
            </span>
            {terrainStatus.message && (
              <span style={{
                fontSize: '10px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 500,
              }}>
                {terrainStatus.message}
              </span>
            )}
          </div>
        )}

        {/* Imagery Status */}
        {imageryStatus && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
          }}>
            <span style={{
              color: getStatusColor(imageryStatus.status),
              fontSize: '14px',
              lineHeight: 1,
            }}>
              {getStatusIcon(imageryStatus.status)}
            </span>
            <span style={{
              flex: 1,
              color: 'rgba(255, 255, 255, 0.95)',
              fontWeight: 500,
            }}>
              Imagery
            </span>
            {imageryStatus.message && (
              <span style={{
                fontSize: '10px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 500,
              }}>
                {imageryStatus.message}
              </span>
            )}
          </div>
        )}

        {/* NDVI Status */}
        {ndviStatus && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
          }}>
            <span style={{
              color: getStatusColor(ndviStatus.status),
              fontSize: '14px',
              lineHeight: 1,
            }}>
              {getStatusIcon(ndviStatus.status)}
            </span>
            <span style={{
              flex: 1,
              color: 'rgba(255, 255, 255, 0.95)',
              fontWeight: 500,
            }}>
              NDVI
            </span>
            {ndviStatus.message && (
              <span style={{
                fontSize: '10px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 500,
              }}>
                {ndviStatus.message}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
