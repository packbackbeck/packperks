import { useEffect, useState } from 'react';
import { ArrowUpRight, PanelLeft, PanelLeftClose } from 'lucide-react';
import OrgSwitcher from './context/OrgSwitcher';
import ProfileMenu from './auth/ProfileMenu';
import { getPendingCounts } from './lib/adminApi';
import { TAB_GROUPS } from './lib/access';
import { useOrg } from './context/OrgContext';
import packperksLogo from '../assets/images/packperks-logo.svg';
import './AdminSidebar.css';

// Files in public/ are served from the site root, not imported.
const packperksMark = '/favicon.svg';

/* Tabs whose page covers the whole group (one customer base across every
 * store), marked so nobody mistakes them for this store alone. */
const GROUP_SCOPED = new Set(['users', 'futurevendors']);

/* ─────────────────────────────────────────────────────────────────────
 * Sidebar: brand, organisation switcher, the tabs this account may open
 * (grouped and labelled), and the account menu. What is listed comes from
 * lib/access.js via the shell; this component only lays it out.
 * ───────────────────────────────────────────────────────────────────── */
export default function AdminSidebar({ tabs, activePage, onNavigate, onAddOrg, collapsed, onToggleCollapsed, canManageOrgs, roleLabel }) {
  const { activeOrgId, activeGroup } = useOrg();

  // Work waiting in a queue: claims to review, scans on hold, merges to
  // approve. Refreshed on org switch and when the page changes.
  const [pending, setPending] = useState({ claims: 0, scans: 0, merges: 0 });
  useEffect(() => {
    let alive = true;
    getPendingCounts().then(c => { if (alive) setPending(c); }).catch(() => {});
    return () => { alive = false; };
  }, [activeOrgId, activePage]);

  const groups = TAB_GROUPS
    .map(g => ({ ...g, items: tabs.filter(t => t.group === g.id) }))
    .filter(g => g.items.length);

  return (
    <aside className={`sb${collapsed ? ' sb--collapsed' : ''}`} aria-label="Dashboard navigation">
      <div className="sb__brand">
        <button type="button" className="sb__logo" onClick={() => onNavigate(tabs[0]?.id || 'overview')} aria-label="PackPerks home">
          <img src={collapsed ? packperksMark : packperksLogo} alt="" className={collapsed ? 'sb__mark' : 'sb__wordmark'} />
        </button>
        <button
          type="button"
          className="sb__collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="sb__org">
        <OrgSwitcher onNavigate={onNavigate} onAddOrg={onAddOrg} compact={collapsed} canManageOrgs={canManageOrgs} />
      </div>

      <nav className="sb__nav">
        {groups.map(g => (
          <div className="sb__group" key={g.id}>
            {!collapsed && <p className="sb__group-label">{g.label}</p>}
            {g.items.map(item => {
              const Icon = item.icon;
              if (item.href) {
                return (
                  <a
                    key={item.id}
                    className="sb__item sb__item--link"
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={collapsed ? `${item.label} (opens in a new tab)` : item.description}
                  >
                    <span className="sb__item-icon"><Icon size={17} aria-hidden="true" /></span>
                    {!collapsed && <span className="sb__item-label">{item.label}</span>}
                    {!collapsed && <ArrowUpRight size={14} className="sb__item-out" aria-label="Opens in a new tab" />}
                  </a>
                );
              }
              const active = activePage === item.id;
              const count = item.badge ? pending[item.badge] || 0 : 0;
              const groupScoped = !!activeGroup && GROUP_SCOPED.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sb__item${active ? ' sb__item--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : groupScoped ? `Shared across every store in ${activeGroup.name}` : undefined}
                >
                  <span className="sb__item-icon">
                    <Icon size={17} aria-hidden="true" />
                    {collapsed && count > 0 && <span className="sb__dot" aria-hidden="true" />}
                  </span>
                  {!collapsed && <span className="sb__item-label">{item.label}</span>}
                  {!collapsed && groupScoped && <span className="sb__scope">Group</span>}
                  {!collapsed && count > 0 && (
                    <span className="sb__badge" aria-label={`${count} waiting`}>{count > 99 ? '99+' : count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sb__foot">
        <ProfileMenu compact={collapsed} roleLabel={roleLabel} />
      </div>
    </aside>
  );
}
