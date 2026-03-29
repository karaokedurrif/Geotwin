'use client';

import { useState, type ReactNode } from 'react';
import { HtSidebar } from './HtSidebar';
import { HtHeader } from './HtHeader';

interface HtLayoutProps {
  children: ReactNode;
  showSidebar?: boolean;
  estadoConexion?: 'online' | 'offline' | 'degradado';
}

export function HtLayout({ children, showSidebar = true, estadoConexion = 'online' }: HtLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <HtHeader
        estadoConexion={estadoConexion}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
      />
      <div className="flex">
        {showSidebar && (
          <HtSidebar collapsed={sidebarCollapsed} />
        )}
        <main className={`flex-1 min-h-[calc(100vh-3.5rem)] transition-all duration-200 ${showSidebar ? (sidebarCollapsed ? 'ml-16' : 'ml-56') : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
