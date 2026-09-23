import { useEffect, useState } from 'react';
import { CalendarClock, Hourglass, Layers, QrCode, ScanLine, TimerOff } from 'lucide-react';
import { Card, CardBody, CardFoot, CardHeader, Field } from '../ui';
import { getByoCap, getTikkieCampaignEnd } from '../lib/adminApi';

/* Rules & limits: how many cups a scan gives, the caps that stop a balance
 * growing without limit, and how long unclaimed money stays claimable.
 * Each cap has the message it shows.
 *
 * A Deferred Tikkie venue has no cup balance, no sharing and no rewards, so
 * it sees only the expiry card. */
export default function RulesPanel({ draft, canEdit, mode, org }) {
  const { settings } = draft;
  const isByo = mode === 'byo';
  const tikkie = mode === 'tikkie_only';
  const sharingOn = settings.featureCupSharing !== false;

  /* The Static QR code limit is its own config row, read live by byo-mint
   * and bin-tikkie, and it carries a window as well as a number. The one
   * page that edits it is Generate → Static QR code; showing just the
   * number here used to save it back without the window, quietly resetting
   * a venue's period, so this is now a read-only summary. */
  const [staticLimit, setStaticLimit] = useState(null);
  useEffect(() => {
    let alive = true;
    if (tikkie || !org.activeOrgId) return undefined;
    getByoCap(org.activeOrgId).then(v => { if (alive) setStaticLimit(v); }).catch(() => {});
    return () => { alive = false; };
  }, [tikkie, org.activeOrgId]);

  function setInt(key, raw, { min = 0, max = 9999 } = {}, label) {
    const n = parseInt(raw, 10);
    draft.update(key, Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min, label);
  }

  return (
    <div className="st-stack">
      {!tikkie && (
        <Card>
          <CardHeader title="Scans and sharing" icon={ScanLine} subtitle="What one scan gives, and how many cups can change hands at once." />
          <CardBody>
            <div className="st-fields">
              <Field label="Cups per scan" hint="Most bins give one cup per scan." htmlFor="set-per-scan">
                <input id="set-per-scan" className="ui-input st-input-short" type="number" min="1" max="10"
                  disabled={!canEdit} value={settings.maxCupsPerScan ?? 1}
                  onChange={e => setInt('maxCupsPerScan', e.target.value, { min: 1, max: 10 }, 'Cups per scan')} />
              </Field>
              <Field
                label="Most cups in one share"
                hint={sharingOn ? 'The upper limit on a transfer between two customers.' : 'Cup sharing is off in Features, so this has no effect.'}
                htmlFor="set-share-max"
              >
                <input id="set-share-max" className="ui-input st-input-short" type="number" min="1" max="50"
                  disabled={!canEdit || !sharingOn} value={settings.maxCupsToShare ?? 10}
                  onChange={e => setInt('maxCupsToShare', e.target.value, { min: 1, max: 50 }, 'Most cups in one share')} />
              </Field>
            </div>
          </CardBody>
          {staticLimit && (
            <CardFoot>
              <span className="st-pointer">
                <QrCode size={15} aria-hidden="true" />
                The counter code gives {staticLimit.cap} cup{staticLimit.cap === 1 ? '' : 's'} per person
                per {windowWords(staticLimit.windowMinutes)}
                {isByo ? '' : ', when Static QR code is on'}. Change it on Generate → Static QR code.
              </span>
            </CardFoot>
          )}
        </Card>
      )}

      {/* ── The deadline on money nobody collected ── */}
      <ExpiryCard settings={settings} canEdit={canEdit} tikkie={tikkie} setInt={setInt} />

      {!tikkie && (
        <Card>
          <CardHeader title="Limits" icon={Layers} subtitle="0 means no limit. Each message is what a customer reads when they hit it." />
          <CardBody>
            <div className="st-limits">
              <LimitRow
                icon={Layers}
                id="set-hold"
                label="Most cups a customer can hold"
                hint="At the limit they spend cups before earning more."
                value={settings.maxHoldBalance ?? 0}
                onValue={v => setInt('maxHoldBalance', v, {}, 'Hold limit')}
                message={settings.holdCapMessage || ''}
                onMessage={v => draft.update('holdCapMessage', v, 'Hold limit message')}
                placeholder="You’ve reached the most cups you can hold. Redeem a reward first, then keep collecting."
                canEdit={canEdit}
              />
              <LimitRow
                icon={CalendarClock}
                id="set-daily"
                label="Most cups per day"
                hint="Cups one customer can earn in a calendar day."
                value={settings.maxCupsPerDay ?? 0}
                onValue={v => setInt('maxCupsPerDay', v, {}, 'Daily limit')}
                message={settings.dailyCapMessage || ''}
                onMessage={v => draft.update('dailyCapMessage', v, 'Daily limit message')}
                placeholder="You’ve reached today’s cup limit. Come back tomorrow to keep collecting."
                canEdit={canEdit}
              />
              <LimitRow
                icon={Hourglass}
                id="set-reset"
                label="Reset balances every"
                suffix="days"
                hint="Unspent cups expire on this cycle."
                value={settings.balanceResetDays ?? 0}
                onValue={v => setInt('balanceResetDays', v, { max: 3650 }, 'Balance reset')}
                messageLabel="Warning a week before the reset"
                message={settings.resetWarningMessage || ''}
                onMessage={v => draft.update('resetWarningMessage', v, 'Reset warning')}
                placeholder="Heads up: unspent cups reset soon. Redeem yours before they expire."
                messageHint="Leave empty to skip the warning."
                canEdit={canEdit}
              />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* "day", "2 days", "30 minutes" — the Static QR window, for the summary. */
function windowWords(minutes) {
  const total = Math.max(1, Math.floor(Number(minutes) || 0));
  const units = [
    { one: 'week', many: 'weeks', m: 60 * 24 * 7 },
    { one: 'day', many: 'days', m: 60 * 24 },
    { one: 'hour', many: 'hours', m: 60 },
    { one: 'minute', many: 'minutes', m: 1 },
  ];
  for (const u of units) {
    if (total % u.m === 0) {
      const n = total / u.m;
      return n === 1 ? u.one : `${n} ${u.many}`;
    }
  }
  return `${total} minutes`;
}

const DEADLINE_DEFAULT_MONTHS = 3;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* How long an uncollected refund or reward stays claimable. The deadline is
 * stamped on each claim as it is created (migration 063), so the books have
 * a definitive answer to "this will never be collected now". */
function ExpiryCard({ settings, canEdit, tikkie, setInt }) {
  /* The campaign's end date, and how many months of it are left. Both are
   * read once: `now` belongs in the effect, not in the render. */
  const [campaign, setCampaign] = useState({ end: null, months: null });
  useEffect(() => {
    let alive = true;
    getTikkieCampaignEnd().then(end => {
      if (!alive) return;
      const left = end ? Math.max(0, Math.round((Date.parse(end) - Date.now()) / (30 * 864e5))) : null;
      setCampaign({ end: end || null, months: left });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const payoutMonths = settings.payoutExpiryMonths ?? DEADLINE_DEFAULT_MONTHS;
  const rewardMonths = settings.rewardExpiryMonths ?? DEADLINE_DEFAULT_MONTHS;
  // A window longer than the campaign's own end date can never bite.
  const { end: campaignEnd, months: campaignMonths } = campaign;
  const overshoot = campaignMonths != null && payoutMonths > campaignMonths;

  return (
    <Card>
      <CardHeader
        title="When unclaimed money expires"
        icon={TimerOff}
        subtitle="A deadline on money and rewards nobody collected, so there is a point from which the books can treat them as settled."
      />
      <CardBody>
        <div className="st-fields">
          <Field
            label="Cashback, refunds and payout links"
            hint="Counted from the moment the claim is made. The app stops offering the link after this."
            htmlFor="set-payout-expiry"
          >
            <div className="ui-input-affix st-input-mid">
              <input id="set-payout-expiry" className="ui-input" type="number" min="0" max="60" step="1"
                disabled={!canEdit} value={payoutMonths}
                onChange={e => setInt('payoutExpiryMonths', e.target.value, { min: 0, max: 60 }, 'Payout expiry')} />
              <span className="ui-input-affix__suffix">{payoutMonths ? 'months' : 'never'}</span>
            </div>
          </Field>
          {!tikkie && (
            <Field
              label="Rewards"
              hint="A reward a customer claimed but never collected."
              htmlFor="set-reward-expiry"
            >
              <div className="ui-input-affix st-input-mid">
                <input id="set-reward-expiry" className="ui-input" type="number" min="0" max="60" step="1"
                  disabled={!canEdit} value={rewardMonths}
                  onChange={e => setInt('rewardExpiryMonths', e.target.value, { min: 0, max: 60 }, 'Reward expiry')} />
                <span className="ui-input-affix__suffix">{rewardMonths ? 'months' : 'never'}</span>
              </div>
            </Field>
          )}
        </div>
      </CardBody>
      <CardFoot>
        <span className="st-pointer">
          <TimerOff size={15} aria-hidden="true" />
          <span>
            0 means it never expires. This is our own deadline: the app stops offering the payout and the
            reporting counts the money as never claimed.
            {campaignEnd && (
              <>
                {' '}A Tikkie link cannot be cancelled and carries the campaign’s own end date
                — <b>{fmtDate(campaignEnd)}</b>, the same for every link — so someone still holding the
                URL could collect until then.
                {overshoot && <> A window longer than {campaignMonths} month{campaignMonths === 1 ? '' : 's'} changes nothing.</>}
              </>
            )}
          </span>
        </span>
      </CardFoot>
    </Card>
  );
}

function LimitRow({ icon: Icon, id, label, hint, suffix = 'cups', value, onValue, messageLabel = 'Message', message, onMessage, placeholder, messageHint, canEdit }) {
  const off = !value;
  return (
    <div className="st-limit">
      <span className="st-limit__icon ui-tone--violet" aria-hidden="true"><Icon size={16} /></span>
      <div className="st-limit__main">
        <Field label={label} hint={hint} htmlFor={id}>
          <div className="ui-input-affix st-input-mid">
            <input id={id} className="ui-input" type="number" min="0" disabled={!canEdit}
              value={value} onChange={e => onValue(e.target.value)} />
            <span className="ui-input-affix__suffix">{off ? 'no limit' : suffix}</span>
          </div>
        </Field>
        <Field label={messageLabel} hint={messageHint} htmlFor={`${id}-msg`}>
          <textarea id={`${id}-msg`} className="ui-textarea" rows={2} disabled={!canEdit || off}
            value={message} placeholder={placeholder} onChange={e => onMessage(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
