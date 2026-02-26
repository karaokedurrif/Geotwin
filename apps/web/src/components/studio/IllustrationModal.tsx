import type { TwinSnapshot } from '@/lib/twinStore';

interface IllustrationModalProps {
  imageUrl: string;
  imageBlob?: Blob | null;
  snapshot: TwinSnapshot;
  onClose: () => void;
  onDownload?: () => void;  // Callback opcional para descarga personalizada
}

export default function IllustrationModal({
  imageUrl,
  imageBlob,
  snapshot,
  onClose,
  onDownload,
}: IllustrationModalProps) {
  const handleDownload = () => {
    // Si hay callback de descarga, usarlo (preferido para blobs HQ)
    if (onDownload) {
      onDownload();
      return;
    }
    
    // Fallback: descarga tradicional con URL
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `geotwin_illustration_${snapshot.twinId}.png`;
    a.target = '_blank';
    a.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#f7f6f3',
          borderRadius: 16,
          overflow: 'hidden',
          maxWidth: 900,
          width: '100%',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #ddd',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Ilustración Isométrica
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: '#999',
                marginTop: 2,
              }}
            >
              {snapshot.parcel.area_ha.toFixed(1)} ha · {snapshot.twinId}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDownload}
              style={{
                padding: '8px 16px',
                background: '#1a5e35',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ↓ Descargar PNG
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 12px',
                background: '#f8f8f8',
                border: '1px solid #ddd',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Imagen */}
        <div
          style={{
            background: '#000',
            display: 'flex',
            justifyContent: 'center',
            maxHeight: '70vh',
            overflow: 'hidden',
          }}
        >
          <img
            src={imageUrl}
            alt="Ilustración isométrica de la dehesa"
            style={{
              maxWidth: '100%',
              maxHeight: '70vh',
              objectFit: 'contain',
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #ddd',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 11, color: '#999', flex: 1 }}>
            Generada con Flux · Contexto: vegetación real + orografía del
            snapshot
          </span>
          <button
            onClick={() => {
              alert(
                'Función "Usar como fondo" en desarrollo — descarga la imagen por ahora'
              );
            }}
            style={{
              padding: '7px 14px',
              background: 'transparent',
              border: '1px solid #ddd',
              borderRadius: 7,
              cursor: 'pointer',
              fontSize: 11,
              color: '#666',
            }}
          >
            Usar como fondo en Studio
          </button>
        </div>
      </div>
    </div>
  );
}
