import React, { useEffect, useState } from 'react';
import { Activity, BarChart3, Bell, BriefcaseBusiness, Gauge, Home, LogOut, MessageSquareQuote, Search, Settings2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { SCREENING_CONFIG_CHANGED_EVENT, SYSTEM_CONFIG_CHANGED_EVENT, screeningApi } from '../../api/screening';
import { useAuth } from '../../contexts/AuthContext';
import { useAgentChatStore } from '../../stores/agentChatStore';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { StatusDot } from '../common/StatusDot';
import { UiLanguageToggle } from '../i18n/UiLanguageToggle';
import { ThemeToggle } from '../theme/ThemeToggle';

type SidebarNavProps = { collapsed?: boolean; onNavigate?: () => void };
type NavItem = { key: string; labelKey: UiTextKey; to: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean; badge?: 'completion' };

const NAVIGATION_ITEMS: NavItem[] = [{ key: 'home', labelKey: 'layout.nav.home', to: '/', icon: Home, exact: true }];
const APP_ITEMS: NavItem[] = [
  { key: 'chat', labelKey: 'layout.nav.chat', to: '/chat', icon: MessageSquareQuote, badge: 'completion' },
  { key: 'screening', labelKey: 'layout.nav.screening', to: '/screening', icon: Search },
  { key: 'portfolio', labelKey: 'layout.nav.portfolio', to: '/portfolio', icon: BriefcaseBusiness },
  { key: 'decision-signals', labelKey: 'layout.nav.decisionSignals', to: '/decision-signals', icon: Activity },
  { key: 'backtest', labelKey: 'layout.nav.backtest', to: '/backtest', icon: BarChart3 },
  { key: 'alerts', labelKey: 'layout.nav.alerts', to: '/alerts', icon: Bell },
];
const SYSTEM_ITEMS: NavItem[] = [
  { key: 'usage', labelKey: 'layout.nav.usage', to: '/usage', icon: Gauge },
  { key: 'settings', labelKey: 'layout.nav.settings', to: '/settings', icon: Settings2 },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({ collapsed = false, onNavigate }) => {
  const { authEnabled, logout } = useAuth();
  const { t } = useUiLanguage();
  const completionBadge = useAgentChatStore((state) => state.completionBadge);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showScreeningNav, setShowScreeningNav] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshScreeningStatus = async () => {
      try { const status = await screeningApi.getStatus(); if (active) setShowScreeningNav(status.enabled); }
      catch { if (active) setShowScreeningNav(false); }
    };
    void refreshScreeningStatus();
    window.addEventListener(SCREENING_CONFIG_CHANGED_EVENT, refreshScreeningStatus);
    window.addEventListener(SYSTEM_CONFIG_CHANGED_EVENT, refreshScreeningStatus);
    return () => { active = false; window.removeEventListener(SCREENING_CONFIG_CHANGED_EVENT, refreshScreeningStatus); window.removeEventListener(SYSTEM_CONFIG_CHANGED_EVENT, refreshScreeningStatus); };
  }, []);

  const groups: Array<{ labelKey: UiTextKey; items: NavItem[] }> = [
    { labelKey: 'layout.group.navigation', items: NAVIGATION_ITEMS },
    { labelKey: 'layout.group.apps', items: APP_ITEMS.filter((item) => item.key !== 'screening' || showScreeningNav) },
    { labelKey: 'layout.group.system', items: SYSTEM_ITEMS },
  ];
  const itemClass = 'group relative flex min-h-11 w-full items-center rounded-lg border border-transparent text-sm text-secondary-text transition-colors hover:bg-hover hover:text-foreground';
  const activeClass = 'border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] font-medium text-[hsl(var(--primary))]';
  const layoutClass = collapsed ? 'justify-center px-2' : 'gap-3 px-3';

  const renderItem = ({ key, labelKey, to, icon: Icon, exact, badge }: NavItem) => {
    const label = t(labelKey);
    return <NavLink key={key} to={to} end={exact} onClick={onNavigate} aria-label={label} title={collapsed ? label : undefined} className={({ isActive }) => cn(itemClass, layoutClass, isActive ? activeClass : '')}>
      {({ isActive }) => <><Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-[var(--nav-icon-active)]' : 'text-current')} />{!collapsed ? <span className="min-w-0 truncate">{label}</span> : null}{badge === 'completion' && completionBadge ? <StatusDot tone="info" data-testid="chat-completion-badge" className={cn('absolute border-2 border-background shadow-[0_0_10px_var(--nav-indicator-shadow)]', collapsed ? 'right-1.5 top-1.5' : 'right-3')} aria-label={t('layout.newChatMessage')} /> : null}</>}
    </NavLink>;
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className={cn('flex h-12 items-center gap-3 border-b border-border/60 pb-3', collapsed ? 'justify-center' : 'px-2')}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-gradient text-[hsl(var(--primary-foreground))] shadow-[0_12px_28px_var(--nav-brand-shadow)]"><BarChart3 className="h-5 w-5" /></div>
      {!collapsed ? <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">DSA</p><p className="truncate text-xs text-secondary-text">Daily Stock Analysis</p></div> : null}
    </div>
    <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5" aria-label={t('layout.mainNav')}>
      {groups.map((group) => <section key={group.labelKey} className="space-y-1.5">{!collapsed ? <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-secondary-text/70">{t(group.labelKey)}</h2> : null}<div className="space-y-1">{group.items.map(renderItem)}</div></section>)}
    </nav>
    <div className="shrink-0 space-y-1 border-t border-border/60 pt-4">
      <ThemeToggle variant="nav" collapsed={collapsed} wrapperClassName="w-full" triggerClassName={cn(itemClass, layoutClass)} triggerActiveClassName={activeClass} iconClassName="h-5 w-5 shrink-0" labelClassName="min-w-0 truncate" />
      <UiLanguageToggle variant="nav" collapsed={collapsed} wrapperClassName="w-full" triggerClassName={cn(itemClass, layoutClass)} triggerActiveClassName={activeClass} iconClassName="h-5 w-5 shrink-0" labelClassName="min-w-0 truncate" />
      {authEnabled ? <button type="button" onClick={() => setShowLogoutConfirm(true)} className={cn(itemClass, layoutClass)} title={collapsed ? t('layout.logout') : undefined}><LogOut className="h-5 w-5 shrink-0" />{!collapsed ? <span className="min-w-0 truncate">{t('layout.logout')}</span> : null}</button> : null}
    </div>
    <ConfirmDialog isOpen={showLogoutConfirm} title={t('layout.logoutTitle')} message={t('layout.logoutMessage')} confirmText={t('layout.logoutConfirm')} cancelText={t('common.cancel')} isDanger onConfirm={() => { setShowLogoutConfirm(false); onNavigate?.(); void logout(); }} onCancel={() => setShowLogoutConfirm(false)} />
  </div>;
};
