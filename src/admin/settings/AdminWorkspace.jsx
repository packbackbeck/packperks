import { useEffect, useRef, useState } from 'react';
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
  const rafRef = useRef(0);

  // Scroll-based active detection. Robust to async-loaded sections because it
  // re-queries the DOM on every scroll instead of pre-binding observers.
  useEffect(() => {
    const scroller = document.querySelector('.admin-app__main') || window;
    function onScroll() {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const probe = 150; // px below the viewport top (under topbar + TOC bar)
        let best = null, bestTop = -Infinity, firstPresent = null;
        for (const s of tocSections) {
          const el = document.getElementById(`s-${s.id}`);
          if (!el) continue;
          if (!firstPresent) firstPresent = s.id;
          const top = el.getBoundingClientRect().top;
          if (top - probe <= 0 && top > bestTop) { bestTop = top; best = s.id; }
        }
        setActiveId(best || firstPresent || 'org-profile');
      });
    }
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function jumpTo(id) {
    const el = document.getElementById(`s-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  }

  return (
    <div className="ws-page">
      <header className="ws-header">
        <span className="ws-header__eyebrow">Configuration</span>
        <h1 className="ws-header__title">Settings &amp; Organisation</h1>
        <p className="ws-header__sub">
          Everything for this organisation in one place: profile, locations, team, payout rates,
          app copy, and policies. App settings auto-save to your draft — hit <strong>Publish</strong>{' '}
          in the top bar to push them live.
        </p>
      </header>

      <nav className="ws-toc" aria-label="Settings and organisation sections">
        <div className="ws-toc__inner">
          {tocSections.map((s, i) => {
            const prev = tocSections[i - 1];
            const groupBreak = i > 0 && isOrg(prev.id) !== isOrg(s.id);
            return (
              <span key={s.id} className="ws-toc__cell">
                {groupBreak && <span className="ws-toc__divider" aria-hidden="true" />}
                <button
                  type="button"
                  className={`ws-toc__item${activeId === s.id ? ' ws-toc__item--active' : ''}`}
                  onClick={() => jumpTo(s.id)}
                >
                  <span className={`ws-toc__icon ws-toc__icon--${s.tone || 'slate'}`}>{s.icon}</span>
                  <span className="ws-toc__label">{s.title}</span>
                </button>
              </span>
            );
          })}
        </div>
      </nav>

      <div className="ws-content">
        <AdminOrg embedded onNavigate={onNavigate} />
        <AdminSettings embedded draftState={draftState} onNavigate={onNavigate} />
      </div>

      <QuickLinks currentPage="settings" onNavigate={onNavigate} />
    </div>
  );
}

function isOrg(id) {
  return id.startsWith('org-');
}
