import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { Drawer } from '../common/Drawer';
import { SidebarNav } from './SidebarNav';
import { cn } from '../../utils/cn';
import { ThemeToggle } from '../theme/ThemeToggle';
import { UiLanguageToggle } from '../i18n/UiLanguageToggle';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey } from '../../i18n/uiText';

type ShellProps = { children?: React.ReactNode };
const SIDEBAR_COLLAPSED_KEY = 'dsa_sidebar_collapsed';

const PAGE_TITLES: Record<string, UiTextKey> = {
  '/': 'layout.route.home.title', '/chat': 'layout.route.chat.title', '/portfolio': 'layout.route.portfolio.title',
  '/decision-signals': 'layout.route.decisionSignals.title', '/screening': 'layout.route.screening.title',
  '/backtest': 'layout.route.backtest.title', '/alerts': 'layout.route.alerts.title', '/usage': 'layout.route.usage.title', '/settings': 'layout.route.settings.title',
};

export const Shell: React.FC<ShellProps> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  const { t } = useUiLanguage();
  const location = useLocation();
  const title = useMemo(() => t(PAGE_TITLES[location.pathname] ?? 'layout.appFallbackTitle'), [location.pathname, t]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const handleResize = () => { if (window.innerWidth >= 1024) setMobileOpen(false); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileOpen]);

  const toggleSidebar = () => setCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    return next;
  });

  return <div className="min-h-[100dvh] bg-background text-foreground">
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border/70 bg-card/90 px-3 backdrop-blur-xl lg:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary-text transition-colors hover:bg-hover hover:text-foreground" aria-label={t('layout.openNav')}><Menu className="h-5 w-5" /></button>
      <p className="min-w-0 flex-1 truncate px-3 text-center text-sm font-semibold text-foreground">{title}</p>
      <div className="flex items-center gap-1"><UiLanguageToggle /><ThemeToggle /></div>
    </header>

    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1680px] px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
      <aside className={cn('sticky top-3 z-30 hidden h-[calc(100dvh-2rem)] shrink-0 self-start overflow-visible rounded-2xl border border-[var(--shell-sidebar-border)] bg-card/82 p-3 shadow-soft-card backdrop-blur-sm transition-[width] duration-200 lg:flex', collapsed ? 'w-16' : 'w-64')} aria-label={t('layout.desktopSidebar')}>
        <SidebarNav collapsed={collapsed} />
        <button type="button" onClick={toggleSidebar} className="absolute -right-4 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-card text-secondary-text shadow-soft-card hover:bg-hover hover:text-foreground lg:inline-flex" aria-label={collapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 pt-[calc(3.5rem+env(safe-area-inset-top))] lg:pl-4 lg:pt-0 touch-pan-y">{children ?? <Outlet />}</main>
    </div>

    <Drawer isOpen={mobileOpen} onClose={() => setMobileOpen(false)} title={t('layout.navMenu')} width="max-w-none" zIndex={90} side="left">
      <SidebarNav onNavigate={() => setMobileOpen(false)} />
    </Drawer>
  </div>;
};
