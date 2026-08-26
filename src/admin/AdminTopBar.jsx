import FeatureSearch from './auth/FeatureSearch';
import WorkflowDock from './auth/WorkflowDock';
import packperksLogoDark from '../assets/images/packperks-logo-dark.svg';
import burgerKingLogo from '../assets/images/burger-king-logo.png';
import { useOrg } from './context/OrgContext';
import { ORG_MODE_META, resolveEffectiveMode } from './lib/orgModes';
import './AdminTopBar.css';

/* Resolve the brand-mark for the right side of the "PackPerks × ___"
 * lockup. Resolution order:
 *   1. activeOrg.logo_url — uploaded / pasted in the wizard
 *   2. Bundled BK logo for the seed BK org (slug 'burger-king')
 *   3. Coloured initial chip using org.brand_color + first letter
 */
function OrgMark({ org }) {
  if (org?.logo_url) {
    return <img src={org.logo_url} alt={org.name || 'Organisation'} className="admin-topbar__brand-bk" />;
  }
  if (org?.slug === 'burger-king' || org?.slug === 'burgerking') {
    return <img src={burgerKingLogo} alt={org.name || 'Burger King'} className="admin-topbar__brand-bk" />;
  }
  const letter = (org?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="admin-topbar__brand-chip"
      style={{ background: org?.brand_color || '#FD6F46' }}
      aria-label={org?.name || 'Organisation'}
    >
      {letter}
    </span>
  );
}

/* One glyph per programme model, so the chip is scannable before the
 * initials are even read: a bin for deposit, a cup for bring-your-own, an
 * arrow into a coin for the Tikkie redirect. */
function MODE_ICONS({ effMode }) {
  const common = {
    width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2.4,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  };
  if (effMode === 'byo') {
    return (
      <svg {...common}>
        <path d="M6 3h12l-1.2 15.3A2 2 0 0 1 14.8 20H9.2a2 2 0 0 1-2-1.7L6 3z" />
        <path d="M5 3h14" />
      </svg>
    );
  }
  if (effMode === 'tikkie_only') {
    return (
      <svg {...common}>
        <line x1="4" y1="12" x2="16" y2="12" />
        <polyline points="12 7 17 12 12 17" />
        <circle cx="20" cy="12" r="1.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <polyline points="4 7 5.5 20.5 18.5 20.5 20 7" />
      <line x1="3" y1="7" x2="21" y2="7" />
      <path d="M9 4h6" />
    </svg>
  );
}

/* Stripped-down admin top bar.
 *
 * The Preview / Save / Publish / Version History controls and the
 * publish-status pill all used to live up here. They're now in the
 * floating WorkflowDock (bottom-right) which feels less crowded and
 * keeps the most-pressing action visible without occupying chrome
 * the user has to scan past every time.
 *
 * The org badge + profile menu also moved out — to the sidebar footer
 * (bottom-left), the canonical place for "me + my workspace" in modern
 * dashboards (Linear, Vercel, Notion all do this).
 *
 * What's left in the top bar:
 *   • brand block on the left (PackPerks × Burger King)
 *   • free-text feature search in the middle
 *   • publish-error bar at the very top when a publish fails (rare) */
export default function AdminTopBar({ draftState, onNavigate, onPreview, onOpenSupport }) {
  const { publishError, clearPublishError } = draftState || {};
  const { activeOrg, activeOrgMode, activeGroupMode } = useOrg();
  // Which programme model this org runs — always visible so an admin
  // switching between orgs never has to guess which dashboard shape
  // they're looking at.
  const effMode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const modeMeta = ORG_MODE_META[effMode] || ORG_MODE_META.standard;
  // Maintenance mode = the customer app is offline. That state must be
  // impossible to miss, so the whole bar goes orange with a pause mark.
  const maintenance = !!draftState?.draft?.settings?.maintenanceMode;

  return (
    <>
      {publishError && (
        <div className="admin-publish-error-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span><strong>Publish failed:</strong> {publishError}</span>
          <span className="admin-publish-error-bar__sql" onClick={() => {
            navigator.clipboard?.writeText(`-- Run this in Supabase SQL Editor:\ncreate table if not exists app_config (\n  key text primary key,\n  value jsonb not null,\n  updated_at timestamptz default now()\n);\nalter table app_config enable row level security;\ncreate policy "public_read"   on app_config for select using (true);\ncreate policy "public_insert" on app_config for insert with check (true);\ncreate policy "public_update" on app_config for update using (true);\n\n-- Allow claim status updates:\ncreate policy "admin_update_claims" on claims for update using (true);\n\n-- Fix claims status constraint (allows completed + failed):\nalter table claims drop constraint if exists claims_status_check;\nalter table claims add constraint claims_status_check\n  check (status in ('pending', 'completed', 'failed'));\n`);
          }}>📋 Copy fix SQL</span>
          <button className="admin-publish-error-bar__close" onClick={clearPublishError}>×</button>
        </div>
      )}

      <header className={`admin-topbar${maintenance ? ' admin-topbar--maintenance' : ''}`}>
        <div className="admin-topbar__left">
          <div className="admin-topbar__brand">
            <img src={packperksLogoDark} alt="PackPerks" className="admin-topbar__brand-pp" />
            <span className="admin-topbar__brand-x">×</span>
            <OrgMark org={activeOrg} />
          </div>
          <span
            className={`admin-topbar__mode admin-topbar__mode--${effMode}`}
            title={`${modeMeta.label} — ${modeMeta.blurb}`}
          >
            <MODE_ICONS effMode={effMode} />
            {modeMeta.short}
          </span>
          {maintenance && (
            <span
              className="admin-topbar__maint"
              title="Maintenance mode is ON — the customer app is showing the maintenance banner and blocking new scans and claims. Turn it off in Settings → Feature flags."
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Paused
            </span>
          )}
        </div>

        <div className="admin-topbar__center">
          <FeatureSearch onNavigate={onNavigate} />
        </div>

        {/* Top-right hosts the WorkflowDock — Framer-style contextual
         *  Save/Publish/Preview/History cluster. Compact in the default
         *  state, expands on hover. */}
        <div className="admin-topbar__right">
          <TimezoneHint />
          <WorkflowDock
            draftState={draftState}
            onPreview={onPreview}
            onOpenHistory={() => onNavigate?.('history')}
            onOpenSettings={() => onNavigate?.('settings')}
            onOpenSupport={onOpenSupport}
          />
        </div>
      </header>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * TimezoneHint — small pill in the top-bar right slot showing the
 * browser's current timezone abbreviation.
 *
 * P-37: the dashboard renders 55+ timestamps across pages with no
 * indication of which timezone "14:32" refers to. Renaming each
 * formatter call site to append the tz would be invasive; this pill
 * surfaces the global answer in one persistent place. Tooltip on
 * hover spells out the long IANA name + UTC offset for unambiguous
 * reading.
 *
 * Localised once on mount. Doesn't react to OS-level tz changes mid-
 * session — that's vanishingly rare and a page reload covers it. */
function TimezoneHint() {
  const tz = (() => {
    try {
      const long = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offset = -new Date().getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const h = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
      const m = String(Math.abs(offset) % 60).padStart(2, '0');
      // Cheap abbreviation: use the last segment of the IANA name
      // (Europe/Amsterdam → Amsterdam) so it fits in the chip.
      const shortName = (long || '').split('/').slice(-1)[0]?.replace(/_/g, ' ') || 'local';
      return { shortName, long, offsetLabel: `UTC${sign}${h}:${m}` };
    } catch {
      return { shortName: 'local', long: 'local', offsetLabel: '' };
    }
  })();
  return (
    <span
      className="admin-topbar__tz"
      title={`All timestamps in the dashboard are displayed in your browser's local timezone (${tz.long || tz.shortName}, ${tz.offsetLabel}). Hover any time cell to see the underlying UTC value where available.`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span className="admin-topbar__tz-label">{tz.shortName}</span>
      {tz.offsetLabel && <span className="admin-topbar__tz-offset">· {tz.offsetLabel}</span>}
    </span>
  );
}
