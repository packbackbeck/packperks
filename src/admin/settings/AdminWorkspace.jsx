import { useEffect, useState } from 'react';
import AdminOrg from '../organization/AdminOrg';
import AdminSettings, { SECTIONS as SETTINGS_SECTIONS } from './AdminSettings';
import QuickLinks from '../shared/QuickLinks';
import './AdminWorkspace.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminWorkspace — the merged Settings + Organisation page.
 *
 * Hosts the organisation page (profile, locations, team, activity) and the
 * app settings (rates, copy, rules, flags, legal, budget) under one shared,
 * sticky horizontal table of contents. Each child renders in `embedded` mode
 * so it drops its own header / TOC / footer and just contributes its section
 * cards. Active-section highlighting is scroll-based so it stays correct even
 * though the org sections load asynchronously.
 * ───────────────────────────────────────────────────────────────────── */

const ORG_SECTIONS = [
  {
    id: 'org-profile', title: 'Profile', tone: 'orange',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
        <line x1="9" y1="9" x2="9" y2="9.01" /><line x1="9" y1="13" x2="9" y2="13.01" />
      </svg>
    ),
  },
  {
    id: 'org-locations', title: 'Locations', tone: 'slate',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    id: 'org-team', title: 'Team', tone: 'purple',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    id: 'org-activity', title: 'Activity', tone: 'cream',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

export default function AdminWorkspace({ draftState, onNavigate }) {
  const tocSections = [...ORG_SECTIONS, ...SETTINGS_SECTIONS];
  const [activeId, setActiveId] = useState('org-profile');

  // Tabs: show ONLY the active section. Both children render every section in
  // `embedded` mode (each wrapped in an element with id `s-<id>`), and they
  // mount asynchronously, so we drive visibility from the DOM and re-apply on
  // any content change via a MutationObserver. Setting inline display never
  // triggers childList mutations, so there is no feedback loop.
  useEffect(() => {
    const content = document.querySelector('.wkspace-content');
    if (!content) return;
    const apply = () => {
      for (const s of tocSections) {
        const el = document.getElementById(`s-${s.id}`);
        if (el) el.style.display = s.id === activeId ? '' : 'none';
      }
      // The in-content group headers are redundant when one section shows.
      content.querySelectorAll('.wkspace-group').forEach((g) => { g.style.display = 'none'; });
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(content, { childList: true, subtree: true });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  return (
    <div className="wkspace-page">
      <header className="wkspace-header">
        <h1 className="wkspace-header__title">Settings &amp; Organisation</h1>
      </header>

      <nav className="wkspace-toc wkspace-toc--tabs" role="tablist" aria-label="Settings and organisation sections">
        <div className="wkspace-toc__inner">
          {tocSections.map((s, i) => {
            const prev = tocSections[i - 1];
            const groupBreak = i > 0 && isOrg(prev.id) !== isOrg(s.id);
            return (
              <span key={s.id} className="wkspace-toc__cell">
                {groupBreak && <span className="wkspace-toc__divider" aria-hidden="true" />}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeId === s.id}
                  className={`wkspace-toc__item${activeId === s.id ? ' wkspace-toc__item--active' : ''}`}
                  onClick={() => setActiveId(s.id)}
                >
                  <span className={`wkspace-toc__icon wkspace-toc__icon--${s.tone || 'slate'}`}>{s.icon}</span>
                  <span className="wkspace-toc__label">{s.title}</span>
                </button>
              </span>
            );
          })}
        </div>
      </nav>

      <div className="wkspace-content">
        <div className="wkspace-group">
          <span className="wkspace-group__label">Organisation</span>
          <span className="wkspace-group__rule" aria-hidden="true" />
        </div>
        <AdminOrg embedded onNavigate={onNavigate} />

        <div className="wkspace-group">
          <span className="wkspace-group__label">App settings</span>
          <span className="wkspace-group__rule" aria-hidden="true" />
        </div>
        <AdminSettings embedded draftState={draftState} onNavigate={onNavigate} />
      </div>

      <QuickLinks currentPage="settings" onNavigate={onNavigate} />
    </div>
  );
}

function isOrg(id) {
  return id.startsWith('org-');
}
