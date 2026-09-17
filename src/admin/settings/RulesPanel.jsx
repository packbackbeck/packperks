import { useEffect, useState } from 'react';
import { CalendarClock, Hourglass, Layers, ScanLine } from 'lucide-react';
import { Card, CardBody, CardHeader, Field } from '../ui';
import { getByoCap, saveByoCap } from '../lib/adminApi';

/* Rules & limits: how many cups a scan gives, and the caps that stop a
 * balance growing without limit. Each cap has the message it shows. */
export default function RulesPanel({ draft, canEdit, mode, org }) {
  const { settings } = draft;
  const isByo = mode === 'byo';
  const sharingOn = settings.featureCupSharing !== false;

  /* Bring Your Own: the daily auto-credit cap is its own config row, read
   * live by byo-mint, so it saves directly. */
  const [byoCap, setByoCap] = useState(2);
  const [byoState, setByoState] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!isByo || !org.activeOrgId) return undefined;
    getByoCap(org.activeOrgId).then(v => { if (alive) setByoCap(v ?? 2); }).catch(() => {});
    return () => { alive = false; };
  }, [isByo, org.activeOrgId]);

  async function changeByoCap(raw) {
    const v = Math.max(1, Math.min(50, parseInt(raw, 10) || 1));
    setByoCap(v);
    setByoState('saving');
    try {
      await saveByoCap(org.activeOrgId, v);
      setByoState('saved');
    } catch {
      setByoState('error');
    }
  }

  function setInt(key, raw, { min = 0, max = 9999 } = {}, label) {
    const n = parseInt(raw, 10);
    draft.update(key, Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min, label);
  }

  return (
    <div className="st-stack">
      <Card>
        <CardHeader title="Scans and sharing" icon={ScanLine} subtitle="What one scan gives, and how many cups can change hands at once." />
        <CardBody>
          <div className="st-fields">
            {isByo ? (
              <Field
                label="Cups credited automatically per day"
                hint={`Counter-QR scans credited per customer per rolling 24 hours. Scans above it wait for review on BYO QR codes. ${
                  byoState === 'saving' ? 'Saving…' : byoState === 'saved' ? 'Saved.' : byoState === 'error' ? 'Could not save.' : 'Saves straight away.'}`}
                htmlFor="set-byo-cap"
              >
                <input id="set-byo-cap" className="ui-input st-input-short" type="number" min="1" max="50"
                  disabled={!canEdit} value={byoCap} onChange={e => changeByoCap(e.target.value)} />
              </Field>
            ) : (
              <Field label="Cups per scan" hint="Most bins give one cup per scan." htmlFor="set-per-scan">
                <input id="set-per-scan" className="ui-input st-input-short" type="number" min="1" max="10"
                  disabled={!canEdit} value={settings.maxCupsPerScan ?? 1}
                  onChange={e => setInt('maxCupsPerScan', e.target.value, { min: 1, max: 10 }, 'Cups per scan')} />
              </Field>
            )}
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
      </Card>

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
    </div>
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
