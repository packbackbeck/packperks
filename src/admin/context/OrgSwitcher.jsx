import { useEffect, useRef, useState } from 'react';
import { useOrg } from './OrgContext';
import './OrgSwitcher.css';

/* Small leading mark used on every dropdown row. Prefers the org's
 * uploaded logo; falls back to a colour swatch with the first letter
 * of the org name. Keeps the rows visually scannable when an admin
 * is juggling several brands. */
function OrgMark({ org }) {
  if (!org) return null;
  if (org.logo_url) {
    return (
      <img
        src={org.logo_url}
        alt=""
        className="orgsw__chip orgsw__chip--sm orgsw__chip--img"
      />
    );
  }
  return (
    <span
      className="orgsw__chip orgsw__chip--sm"
      style={{ background: org.brand_color || '#FD6F46' }}
    >
      <span className="orgsw__chip-letter">
        {(org.name || '?').charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * OrgSwitcher — sidebar-footer dropdown that lets PackPerks staff
 * switch the active organisation, add a new one, or open the manage
 * page.
 *
 * Visual layout:
 *
 *   ┌──────────────────────────────┐
 *   │ 🟧 Burger King NL    ▼      │   ← trigger button (always shown)
 *   └──────────────────────────────┘
 *      ↓ when open ↓
 *   ┌──────────────────────────────┐
 *   │ ACTIVE                       │
 *   │   ● 🟧 Burger King NL  ✓     │
 *   │                              │
 *   │ SWITCH TO                    │
 *   │     🟤 Coffee Shop           │
 *   │     🟢 Test Bakery           │
 *   │ ─────────────────────────── │
 *   │   + Add organisation         │
 *   │   ⚙ Manage organisations    │
 *   └──────────────────────────────┘
 *
 * Closing behaviour: clicking outside, pressing Esc, or selecting an
 * option closes the menu.
 *
 * Props:
 *   • onNavigate(page)  — called to navigate to a known admin tab
 *                         (e.g. 'org' for "Manage organisations").
 *   • onAddOrg()        — opens the create-org wizard (state lives in
 *                         AdminShell, not in the switcher).
 * ───────────────────────────────────────────────────────────────────── */

export default function OrgSwitcher({ onNavigate, onAddOrg }) {
  const { activeOrg, availableOrgs, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Click-outside + Esc to close.
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!activeOrg) return null;

  const others = (availableOrgs || []).filter(o => o.id !== activeOrg.id);

  function handleSwitch(orgId) {
    setOpen(false);
    switchOrg(orgId);
  }

  return (
    <div className="orgsw" ref={wrapRef}>
      <button
        type="button"
        className="orgsw__trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Active: ${activeOrg.name}`}
      >
        {activeOrg.logo_url ? (
          <img
            src={activeOrg.logo_url}
            alt=""
            className="orgsw__chip orgsw__chip--img"
          />
        ) : (
          <span
            className="orgsw__chip"
            style={{ background: activeOrg.brand_color || '#FD6F46' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01"/>
            </svg>
          </span>
        )}
        <span className="orgsw__name">{activeOrg.name}</span>
        <svg className="orgsw__caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="orgsw__dropdown" role="menu">
          {/* Active org row — hovering reveals a gear icon that jumps
              straight to that org's settings page. The row itself isn't
              clickable since you're already on this org. */}
          <div
            className="orgsw__item orgsw__item--active"
            role="menuitemradio"
            aria-checked="true"
          >
            <OrgMark org={activeOrg} />
            <span className="orgsw__item-name">{activeOrg.name}</span>
            <button
              type="button"
              className="orgsw__gear"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onNavigate?.('org');
              }}
              aria-label={`Open ${activeOrg.name} settings`}
              title="Open settings"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>

          {others.map(o => (
            <button
              key={o.id}
              type="button"
              className="orgsw__item"
              onClick={() => handleSwitch(o.id)}
              role="menuitem"
            >
              <OrgMark org={o} />
              <span className="orgsw__item-name">{o.name}</span>
            </button>
          ))}

          <div className="orgsw__divider" />

          <button
            type="button"
            className="orgsw__action"
            onClick={() => { setOpen(false); onAddOrg?.(); }}
            role="menuitem"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add organisation
          </button>
          <button
            type="button"
            className="orgsw__action"
            onClick={() => { setOpen(false); onNavigate?.('organizations'); }}
            role="menuitem"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Manage organisations
          </button>
        </div>
      )}
    </div>
  );
}
