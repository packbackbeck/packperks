import { CircleDollarSign, CupSoda, Gift, Pause, WalletCards } from 'lucide-react';
import FeatureSearch from './auth/FeatureSearch';
import WorkflowDock from './auth/WorkflowDock';
import { useOrg } from './context/OrgContext';
import { ORG_MODE_META, resolveEffectiveMode } from './lib/orgModes';
import { useAdminMoney } from './lib/adminMoney';
import { effectiveRates } from '../lib/rates';
import './AdminTopBar.css';

/* One glyph per programme model, on its own colour: a gift for Deposit
 * Rewards (cups turn into rewards), a cup for Bring Your Own, a wallet for
 * Deferred Tikkie (refunds collect in a wallet until paid out). */
const MODE_GLYPH = { standard: Gift, byo: CupSoda, tikkie_only: WalletCards };

function ModeChip({ mode }) {
  const meta = ORG_MODE_META[mode] || ORG_MODE_META.standard;
  const Glyph = MODE_GLYPH[mode] || Gift;
  return (
    <span className={`tb-mode tb-mode--${mode}`} title={meta.blurb}>
      <span className="tb-mode__glyph"><Glyph size={15} strokeWidth={2.2} aria-hidden="true" /></span>
      <span className="tb-mode__text">
        <span className="tb-mode__eyebrow">Programme</span>
        <span className="tb-mode__label">{meta.label}</span>
      </span>
    </span>
  );
}

/* What a cup pays at this venue, from the settings being edited — the same
 * resolution the server uses (lib/rates.js). Opens the payout settings. */
function RatesBadge({ settings, mode, onOpen }) {
  const { money } = useAdminMoney();
  const rates = effectiveRates(settings || {}, mode === 'tikkie_only' ? 'tikkie_only' : mode === 'byo' ? 'byo' : 'standard');
  const items = mode === 'tikkie_only'
    ? [{ label: 'Refund', value: rates.refund }]
    : [
      { label: 'Cashback', value: rates.cashback },
      ...((mode !== 'byo' || settings?.featureDirectRefunds) ? [{ label: 'Refund', value: rates.refund }] : []),
    ];
  return (
    <button type="button" className="tb-rates" onClick={onOpen} title="What a returned cup is worth here. Change it in Settings → Payouts.">
      <span className="tb-rates__icon"><CircleDollarSign size={16} aria-hidden="true" /></span>
      {items.map(it => (
        <span className="tb-rates__item" key={it.label}>
          <span className="tb-rates__label">{it.label}</span>
          <span className="tb-rates__value">{money(it.value)}<small>/cup</small></span>
        </span>
      ))}
    </button>
  );
}

export default function AdminTopBar({ draftState, onNavigate, onPreview, onOpenSupport, allowedPages, canSeeSettings, canPublish }) {
  const { publishError, clearPublishError } = draftState || {};
  const { activeOrgMode, activeGroupMode } = useOrg();
  const mode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const settings = draftState?.draft?.settings;
  const maintenance = !!settings?.maintenanceMode;

  return (
    <>
      {publishError && (
        <div className="admin-publish-error-bar" role="alert">
          <span><strong>Publish failed:</strong> {publishError}</span>
          <button type="button" className="admin-publish-error-bar__close" onClick={clearPublishError} aria-label="Dismiss">×</button>
        </div>
      )}

      <header className={`admin-topbar${maintenance ? ' admin-topbar--maintenance' : ''}`}>
        <div className="admin-topbar__left">
          <ModeChip mode={mode} />
          {maintenance && (
            <span
              className="tb-paused"
              title="Maintenance mode is on: customers see the maintenance page and can't scan or claim. Turn it off in Settings → Features."
            >
              <Pause size={12} fill="currentColor" aria-hidden="true" />
              Paused
            </span>
          )}
        </div>

        <div className="admin-topbar__center">
          <FeatureSearch onNavigate={onNavigate} allowedPages={allowedPages} />
        </div>

        <div className="admin-topbar__right">
          <RatesBadge
            settings={settings}
            mode={mode}
            onOpen={canSeeSettings ? () => onNavigate?.('settings', { section: 'payouts' }) : undefined}
          />
          <TimezoneHint />
          <WorkflowDock
            draftState={draftState}
            onPreview={onPreview}
            onOpenHistory={allowedPages?.has('history') ? () => onNavigate?.('history') : undefined}
            onOpenSupport={onOpenSupport}
            canPublish={canPublish}
          />
        </div>
      </header>
    </>
  );
}

/* The browser's time zone: every time in the dashboard is shown in it. */
function TimezoneHint() {
  let label = 'Local time';
  let long = '';
  let offsetLabel = '';
  try {
    long = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const offset = -new Date().getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '−';
    const h = Math.floor(Math.abs(offset) / 60);
    const m = Math.abs(offset) % 60;
    offsetLabel = `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
    label = long.split('/').slice(-1)[0]?.replace(/_/g, ' ') || label;
  } catch { /* keep the defaults */ }
  return (
    <span className="admin-topbar__tz" title={`Times are shown in your browser's time zone${long ? ` (${long})` : ''}.`}>
      {label}
      {offsetLabel && <span className="admin-topbar__tz-offset">{offsetLabel}</span>}
    </span>
  );
}
