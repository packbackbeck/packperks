import FeatureSearch from './auth/FeatureSearch';
import WorkflowDock from './auth/WorkflowDock';
import packperksLogoDark from '../assets/images/packperks-logo-dark.svg';
import burgerKingLogo from '../assets/images/burger-king-logo.png';
import './AdminTopBar.css';

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

      <header className="admin-topbar">
        <div className="admin-topbar__left">
          <div className="admin-topbar__brand">
            <img src={packperksLogoDark} alt="PackPerks" className="admin-topbar__brand-pp" />
            <span className="admin-topbar__brand-x">×</span>
            <img src={burgerKingLogo} alt="Burger King" className="admin-topbar__brand-bk" />
          </div>
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
