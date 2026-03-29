import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard,
  Waves,
  GitFork,
  Zap,
  MapPin,
  Thermometer,
  Bell,
  FileText,
  Box,
} from 'lucide-react';

interface HtSidebarProps {
  collapsed: boolean;
}

const NAV_ITEMS = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard, href: '/hydrotwin/barbo/dashboard' },
  { id: '3d', label: 'Modelo 3D', icon: Box, href: '/hydrotwin/barbo/3d' },
  { id: 'balance', label: 'Balance hídrico', icon: Waves, href: '/hydrotwin/barbo/dashboard#balance' },
  { id: 'reparto', label: 'Reparto', icon: GitFork, href: '/hydrotwin/barbo/dashboard#reparto' },
  { id: 'energia', label: 'Energía', icon: Zap, href: '/hydrotwin/barbo/dashboard#energia' },
  { id: 'perdidas', label: 'Pérdidas', icon: MapPin, href: '/hydrotwin/barbo/dashboard#perdidas' },
  { id: 'acuifero', label: 'Acuífero', icon: Thermometer, href: '/hydrotwin/barbo/dashboard#acuifero' },
  { id: 'alertas', label: 'Alertas', icon: Bell, href: '/hydrotwin/barbo/dashboard#alertas', badge: true },
  { id: 'informes', label: 'Informes', icon: FileText, href: '/hydrotwin/barbo/dashboard#informes' },
] as const;

export function HtSidebar({ collapsed }: HtSidebarProps) {
  const router = useRouter();
  const currentPath = router.asPath;

  return (
    <aside
      className={`fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] flex-col border-r border-white/[0.06] bg-[#111118] transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-4">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = currentPath.startsWith(item.href.split('#')[0]);

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <span className="truncate">{item.label}</span>
              )}
              {!collapsed && 'badge' in item && item.badge && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-400">
                  3
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-white/[0.06] p-3 ${collapsed ? 'text-center' : ''}`}>
        <Link
          href="/hydrotwin/barbo"
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {collapsed ? '←' : '← Volver a landing'}
        </Link>
      </div>
    </aside>
  );
}
