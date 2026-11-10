import { useEffect, useState } from 'react';
import { CalendarClock, Gift } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge, Card, CardBody, CardHeader, Field, InfoTip, Switch } from '../ui';
import { useAdminMoney } from '../lib/adminMoney';
import {
  AUTO_TIERS, DEFAULT_BONUS_PCT, MAX_BONUS_PCT, autoCashoutConfig, bonusOn, clampBonusPct,
} from '../../lib/autoCashout';

/* ─────────────────────────────────────────────────────────────────────
 * Automatic cashout — an extra on the Deferred Refund way out.
 *
 * Customers pick on their wallet how often the balance is sent to them:
 * every week, month or 3 months (lib/autoCashout.js). On the day the
 * auto-cashout function mints one Tikkie link and emails it. Bonus deposit
 * adds a percentage per tier on top, paid from the same Tikkie campaign.
 * All three settings go to the draft and take effect when published; the
 * server reads the published copy when it pays, never the app.
 * ───────────────────────────────────────────────────────────────────── */
const EXAMPLE = 10;

export default function AutoCashoutCard({ draft, canEdit, orgId }) {
  const { money } = useAdminMoney();
  const { settings, published } = draft;
  const on = settings.autoCashout === true;
  const bonusSwitch = settings.autoCashoutBonus === true;
  const pcts = { ...DEFAULT_BONUS_PCT, ...(settings.autoCashoutBonusPct || {}) };
  const { bonus } = autoCashoutConfig(settings);

  const pctPending = !!published && JSON.stringify({ ...DEFAULT_BONUS_PCT, ...(published.autoCashoutBonusPct || {}) })
    !== JSON.stringify(pcts);

  /* Who has chosen what, at this venue (dashboard accounts may read it). */
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!orgId) return undefined;
    supabase.from('auto_cashouts').select('tier').eq('org_id', orgId)
      .then(({ data, error }) => {
        if (!alive || error) return;
        const counts = Object.fromEntries(AUTO_TIERS.map(t => [t.key, 0]));
        for (const r of data || []) if (r.tier in counts) counts[r.tier] += 1;
        setUsage(counts);
      });
    return () => { alive = false; };
  }, [orgId]);
  const users = usage ? Object.values(usage).reduce((a, b) => a + b, 0) : 0;

  function setPct(key, raw) {
    const v = raw === '' ? 0 : clampBonusPct(raw);
    draft.update('autoCashoutBonusPct', { ...pcts, [key]: v }, `Bonus for ${AUTO_TIERS.find(t => t.key === key).every}`);
  }

  return (
    <Card>
      <CardHeader
        title="Automatic cashout"
        icon={CalendarClock}
        subtitle="Customers choose how often their deposit is sent to them: every week, month or 3 months. The Tikkie link arrives by email, so nobody has to ask for one."
        actions={(
          <Switch
            id="set-auto-cashout"
            checked={on}
            disabled={!canEdit}
            label="Automatic cashout"
            onChange={v => draft.update('autoCashout', v, 'Automatic cashout')}
          />
        )}
      />
      <CardBody>
        <div className="st-auto__status">
          <span className={`st-tile__state${on ? ' st-tile__state--on' : ''}`}>
            <span className="st-tile__dot" aria-hidden="true" />
            {on ? 'On: the slider is on the wallet' : 'Off: customers claim their deposit themselves'}
          </span>
          {draft.changed('autoCashout', false) && <Badge tone="warning">Not published</Badge>}
          {usage && (
            <span className="st-auto__usage">
              {users
                ? AUTO_TIERS.map(t => `${usage[t.key]} ${t.adverb}`).join(' · ')
                : 'Nobody has chosen a schedule yet'}
            </span>
          )}
        </div>

        <div className={`st-subsection st-auto__bonus${on ? '' : ' st-auto__bonus--off'}`}>
          <div className="st-auto__bonus-head">
            <span className="st-tile__icon ui-tone--amber" aria-hidden="true"><Gift size={18} /></span>
            <div className="st-auto__bonus-text">
              <div className="st-tile__title-row">
                <label className="st-tile__title" htmlFor="set-auto-bonus">Bonus deposit</label>
                <InfoTip label="Bonus deposit">
                  Each automatic payout gets this percentage on top of the deposit, paid from the same Tikkie
                  campaign as every payout. A customer who claims the deposit themselves gets no bonus. The server
                  never pays more than {MAX_BONUS_PCT}%, whatever is set here.
                </InfoTip>
              </div>
              <p className="st-tile__summary">The longer a customer waits, the more they get. A reason to keep the deposit with you.</p>
            </div>
            <Switch
              id="set-auto-bonus"
              checked={bonusSwitch}
              disabled={!canEdit || !on}
              label="Bonus deposit"
              onChange={v => draft.update('autoCashoutBonus', v, 'Bonus deposit')}
            />
          </div>

          <div className="st-fields st-auto__pcts">
            {AUTO_TIERS.map(t => (
              <Field key={t.key} label={`Every ${t.label.replace(/^1 /, '')}`} htmlFor={`set-auto-pct-${t.key}`}>
                <div className="ui-input-affix">
                  <input
                    id={`set-auto-pct-${t.key}`}
                    className="ui-input"
                    type="number" min="0" max={MAX_BONUS_PCT} step="0.5"
                    disabled={!canEdit || !on || !bonusSwitch}
                    value={pcts[t.key]}
                    onChange={e => setPct(t.key, e.target.value)}
                  />
                  <span className="ui-input-affix__suffix">% bonus</span>
                </div>
              </Field>
            ))}
          </div>
          {(draft.changed('autoCashoutBonus', false) || pctPending) && <Badge tone="warning">Not published</Badge>}
        </div>

        <div className="st-preview" aria-label="What customers get">
          <p className="st-preview__label">What a {money(EXAMPLE)} deposit becomes</p>
          <div className="st-preview__grid">
            <div className="st-preview__cell st-preview__cell--muted">
              <span className="st-preview__cell-label">Claimed by hand</span>
              <span className="st-preview__cell-value">{money(EXAMPLE)}</span>
            </div>
            {AUTO_TIERS.map(t => (
              <div key={t.key} className={`st-preview__cell${bonus[t.key] > 0 ? ' st-preview__cell--accent' : ''}`}>
                <span className="st-preview__cell-label">Every {t.label.replace(/^1 /, '')}{bonus[t.key] > 0 ? ` · +${bonus[t.key]}%` : ''}</span>
                <span className="st-preview__cell-value">{money(EXAMPLE + bonusOn(EXAMPLE, bonus[t.key]))}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="st-hint">
          A customer needs an email to choose a schedule; the wallet asks for one when they do.
          The link is in their email and in the wallet’s activity. Payouts run within the hour of the day they are due.
        </p>
      </CardBody>
    </Card>
  );
}
