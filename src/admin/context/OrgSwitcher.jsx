import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronsUpDown, LayoutGrid, Plus, Search, Settings } from 'lucide-react';
import { useOrg } from './OrgContext';
import './OrgSwitcher.css';

export function OrgAvatar({ org, size = 32 }) {
  if (!org) return null;
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (org.logo_url) {
    return (
      <span className="osw__avatar osw__avatar--img" style={style}>
        <img src={org.logo_url} alt="" />
      </span>
    );
  }
  return (
    <span className="osw__avatar" style={{ ...style, background: org.brand_color || '#5B3FD6', fontSize: Math.round(size * 0.42) }}>
      {(org.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Organisation switcher, top of the sidebar. Lists the organisations this
 * account may open (OrgContext already narrows the list), grouped by
 * programme group. Masters also get "Add organisation" and a way into
 * Master Settings → Organisations.
 * ───────────────────────────────────────────────────────────────────── */
export default function OrgSwitcher({ onNavigate, onAddOrg, compact = false, canManageOrgs = false }) {
  const { activeOrg, availableOrgs, switchOrg, groups, activeGroup } = useOrg();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!activeOrg) {
    return compact ? null : (
      <div className="osw osw--empty">
        <span className="osw__avatar osw__avatar--blank"><Building2 size={16} aria-hidden="true" /></span>
        <span className="osw__meta">
          <span className="osw__name">No organisation</span>
          <span className="osw__sub">Ask a master for access</span>
        </span>
      </div>
    );
  }

  const orgs = availableOrgs || [];
  const canSwitch = orgs.length > 1;
  const interactive = canSwitch || canManageOrgs;
  const q = query.trim().toLowerCase();
  const matches = (o) => !q || `${o.name} ${o.slug}`.toLowerCase().includes(q);
  const ungrouped = orgs.filter(o => !o.group_id && matches(o));
  const byGroup = {};
  orgs.forEach(o => {
    if (o.group_id && matches(o)) (byGroup[o.group_id] = byGroup[o.group_id] || []).push(o);
  });
  const groupRows = (groups || []).filter(g => (byGroup[g.id] || []).length);

  const sub = activeGroup
    ? `${activeGroup.name} group`
    : `${orgs.length} organisation${orgs.length === 1 ? '' : 's'}`;

  const pick = (id) => { setOpen(false); setQuery(''); if (id !== activeOrg.id) switchOrg(id); };

  const row = (o, nested) => (
    <button
      key={o.id}
      type="button"
      role="menuitemradio"
      aria-checked={o.id === activeOrg.id}
      className={`osw__opt${nested ? ' osw__opt--nested' : ''}${o.id === activeOrg.id ? ' osw__opt--active' : ''}`}
      onClick={() => pick(o.id)}
    >
      <OrgAvatar org={o} size={24} />
      <span className="osw__opt-name">{o.name}</span>
      {o.id === activeOrg.id && <Check size={15} className="osw__check" aria-hidden="true" />}
    </button>
  );

  return (
    <div className={`osw${compact ? ' osw--compact' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="osw__trigger"
        onClick={() => interactive && setOpen(o => !o)}
        aria-haspopup={interactive ? 'menu' : undefined}
        aria-expanded={interactive ? open : undefined}
        disabled={!interactive}
        title={compact ? `${activeOrg.name} · ${sub}` : undefined}
      >
        <OrgAvatar org={activeOrg} size={compact ? 34 : 34} />
        {!compact && (
          <>
            <span className="osw__meta">
              <span className="osw__name">{activeOrg.name}</span>
              <span className="osw__sub">{sub}</span>
            </span>
            {interactive && <ChevronsUpDown size={15} className="osw__caret" aria-hidden="true" />}
          </>
        )}
      </button>

      {open && (
        <div className="osw__menu" role="menu">
          {orgs.length > 6 && (
            <label className="osw__search">
              <Search size={14} aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find an organisation"
                aria-label="Find an organisation"
              />
            </label>
          )}
          <div className="osw__list">
            {ungrouped.length > 0 && <p className="osw__label">Organisations</p>}
            {ungrouped.map(o => row(o, false))}
            {groupRows.map(g => (
              <div key={g.id} className="osw__group">
                <p className="osw__label osw__label--group">
                  <LayoutGrid size={11} aria-hidden="true" />
                  {g.name}
                </p>
                {(byGroup[g.id] || []).map(o => row(o, true))}
              </div>
            ))}
            {!ungrouped.length && !groupRows.length && <p className="osw__none">Nothing matches “{query}”.</p>}
          </div>
          <div className="osw__sep" />
          <button type="button" className="osw__action" onClick={() => { setOpen(false); onNavigate?.('settings'); }}>
            <Settings size={15} aria-hidden="true" />
            Settings for {activeOrg.name}
          </button>
          {canManageOrgs && (
            <>
              <button type="button" className="osw__action" onClick={() => { setOpen(false); onNavigate?.('master', { section: 'organisations' }); }}>
                <Building2 size={15} aria-hidden="true" />
                Manage organisations
              </button>
              <button type="button" className="osw__action osw__action--primary" onClick={() => { setOpen(false); onAddOrg?.(); }}>
                <Plus size={15} aria-hidden="true" />
                Add organisation
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
