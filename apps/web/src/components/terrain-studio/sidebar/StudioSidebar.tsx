import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MaterialSection from './MaterialSection';
import LightingSection from './LightingSection';
import LayersSection from './LayersSection';
import PostFXSection from './PostFXSection';
import InfoSection from './InfoSection';

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid #2e2e34' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '8px 12px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#a1a1aa', fontSize: 11, fontWeight: 700,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span>{title}</span>
        <ChevronDown
          size={14}
          style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s',
          }}
        />
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function StudioSidebar() {
  return (
    <div style={{
      width: 260,
      background: '#1a1a1e',
      borderRight: '1px solid #2e2e34',
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      <Section title="Material">
        <MaterialSection />
      </Section>
      <Section title="Lighting">
        <LightingSection />
      </Section>
      <Section title="Layers">
        <LayersSection />
      </Section>
      <Section title="Post FX" defaultOpen={false}>
        <PostFXSection />
      </Section>
      <Section title="Info">
        <InfoSection />
      </Section>
    </div>
  );
}
