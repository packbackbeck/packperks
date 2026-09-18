import { CircleDollarSign, Clock, CupSoda, Gift, Pause, WalletCards } from 'lucide-react';
import FeatureSearch from './auth/FeatureSearch';
import WorkflowDock from './auth/WorkflowDock';
import { useOrg } from './context/OrgContext';
import { ORG_MODE_META, resolveEffectiveMode } from './lib/orgModes';
import { useAdminMoney } from './lib/adminMoney';
import { topbarShows } from './lib/access';
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

export default function AdminTopBar({ draftState, onNavigate, onPreview, allowedPages, canSeeSettings, canPublish, topbar = {} }) {
  const shows = (id) => topbarShows(topbar, id);
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
          {shows('programme') && <ModeChip mode={mode} />}
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
          {shows('search') && <FeatureSearch onNavigate={onNavigate} allowedPages={allowedPages} />}
        </div>

        <div className="admin-topbar__right">
          {shows('rates') && (
            <RatesBadge
              settings={settings}
              mode={mode}
              onOpen={canSeeSettings ? () => onNavigate?.('settings', { section: 'payouts' }) : undefined}
            />
          )}
          {shows('timezone') && <TimezoneHint />}
          <WorkflowDock
            draftState={draftState}
            onPreview={shows('preview') ? onPreview : undefined}
            canPublish={canPublish}
          />
        </div>
      </header>
    </>
  );
}

/* Short codes for the cities a time zone is named after. */
const CITY_CODES = {
  Amsterdam: 'AMS', Dubai: 'DXB', London: 'LON', Paris: 'PAR', Berlin: 'BER', Brussels: 'BRU',
  Madrid: 'MAD', Lisbon: 'LIS', Rome: 'ROM', Zurich: 'ZRH', Vienna: 'VIE', Stockholm: 'STO',
  Copenhagen: 'CPH', Oslo: 'OSL', Dublin: 'DUB', New_York: 'NYC', Los_Angeles: 'LAX',
  Chicago: 'CHI', Toronto: 'YTO', Singapore: 'SIN', Tokyo: 'TYO', Sydney: 'SYD',
};

/* The browser's time zone, short ("AMS · UTC+2"): every time in the
 * dashboard is shown in it. */
function TimezoneHint() {
  let code = '';
  let long = '';
  let offsetLabel = 'Local time';
  try {
    long = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = long.split('/').slice(-1)[0] || '';
    code = CITY_CODES[city] || city.replace(/_/g, '').slice(0, 3).toUpperCase();
    const offset = -new Date().getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '−';
    const h = Math.floor(Math.abs(offset) / 60);
    const m = Math.abs(offset) % 60;
    offsetLabel = `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
  } catch { /* keep the defaults */ }
  return (
    <span className="admin-topbar__tz" title={`Times are shown in your browser's time zone${long ? ` (${long.replace(/_/g, ' ')})` : ''}.`}>
      <Clock size={13} aria-hidden="true" />
      {code && <span className="admin-topbar__tz-code">{code}</span>}
      <span className="admin-topbar__tz-offset">{offsetLabel}</span>
    </span>
  );
}
