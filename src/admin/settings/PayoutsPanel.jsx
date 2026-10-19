import { useEffect, useState } from 'react';
import { Coins, Save, TriangleAlert, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Card, CardBody, CardHeader, Field, Switch } from '../ui';
import { effectiveRates } from '../../lib/rates';
import { DEFAULT_PAYMENT_METHOD } from '../../lib/paymentMethods';
import { getGroupPaymentMethod, getRewardBudget, saveRewardBudget } from '../lib/adminApi';
import { useAdminMoney } from '../lib/adminMoney';
import RewardBudgetMonitor from '../shared/RewardBudgetMonitor';

/* Payouts: what a cup is worth and the budget. How a reward is settled
 * (Reward Cashback or Reward Slider Voucher) is a way out, in Features. */
export default function PayoutsPanel({ draft, canEdit, mode, org, onNavigate }) {
  const { money, symbol } = useAdminMoney();
  const { settings, published } = draft;
  const { activeGroupId, activeOrgId } = org;
  const isTikkie = mode === 'tikkie_only';
  const isByo = mode === 'byo';

  const [groupMethod, setGroupMethod] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!activeGroupId) return undefined;
    getGroupPaymentMethod(activeGroupId).then(v => { if (alive) setGroupMethod(v); }).catch(() => {});
    return () => { alive = false; };
  }, [activeGroupId]);

  /* Claims still waiting are paid at the rate live when they are approved. */
  const pubRates = effectiveRates(published || settings);
  const cashbackChanged = Math.abs((settings.cashbackRatePerCup ?? 0) - pubRates.cashback) > 0.001;
  const refundChanged = Math.abs((settings.refundRatePerCup ?? 0) - pubRates.refund) > 0.001;
  const [pending, setPending] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!activeOrgId) return undefined;
    const count = (type) => supabase.from('claims').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').eq('type', type).eq('org_id', activeOrgId);
    Promise.all([count('cashback'), count('direct_refund')])
      .then(([cb, rf]) => { if (alive) setPending({ cashback: cb.count ?? 0, refund: rf.count ?? 0 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeOrgId]);

  function setNumber(key, raw, { min = 0, max = Infinity, int = false } = {}, label) {
    const n = int ? parseInt(raw, 10) : parseFloat(raw);
    const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    draft.update(key, v, label);
  }

  const showRefund = !isByo || settings.featureDirectRefunds !== false;
  const inherited = groupMethod || DEFAULT_PAYMENT_METHOD;
  const current = settings.paymentMethod || null;

  return (
    <div className="st-stack">
      {!isTikkie && (
        <Card>
          <CardHeader
            title="How rewards are paid"
            icon={Wallet}
            subtitle={`${current === 'voucher' || (!current && inherited === 'voucher') ? 'Reward Slider Voucher' : 'Reward Cashback'}${current ? '' : activeGroupId ? ', from the group' : ', the default'}. It is a way out: change it in Ways & features.`}
            actions={onNavigate ? <Button size="sm" variant="outline" onClick={() => onNavigate('settings', { section: 'features' })}>Ways & features</Button> : null}
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title={isTikkie ? 'Refund per cup' : 'What a cup is worth'}
          icon={Coins}
          subtitle={isTikkie
            ? 'Every bin receipt pays out the cups on it times this rate.'
            : 'Changes apply when you publish.'}
        />
        <CardBody>
          {(cashbackChanged || refundChanged) && !isTikkie && (
            <div className="st-callout st-callout--warn" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <div>
                <p className="st-callout__title">Waiting claims will be paid at the new rate</p>
                <p className="st-callout__text">
                  {cashbackChanged && <>Cashback {money(pubRates.cashback)} → <b>{money(settings.cashbackRatePerCup)}</b> per cup. </>}
                  {refundChanged && <>Refund {money(pubRates.refund)} → <b>{money(settings.refundRatePerCup)}</b> per cup. </>}
                  A claim is paid at the rate live when it is approved, not when it was sent.
                  {pending && (pending.cashback + pending.refund > 0) && (
                    <> {pending.cashback} cashback and {pending.refund} refund claims are waiting now.</>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="st-fields">
            {!isTikkie && (
              <Field label="Cashback rate" hint="Paid when a customer redeems cups for a reward." htmlFor="set-cashback">
                <MoneyInput id="set-cashback" symbol={symbol} suffix="per cup" disabled={!canEdit}
                  value={settings.cashbackRatePerCup ?? ''} step="0.05" max="5"
                  onChange={v => setNumber('cashbackRatePerCup', v, { max: 5 }, 'Cashback rate')} />
              </Field>
            )}
            {showRefund && (
              <Field
                label={isTikkie ? 'Refund rate' : 'Direct refund rate'}
                hint={isTikkie ? 'Cups on the receipt × this amount.' : 'Paid when a customer cashes out instead of choosing a reward.'}
                htmlFor="set-refund"
              >
                <MoneyInput id="set-refund" symbol={symbol} suffix="per cup" disabled={!canEdit}
                  value={settings.refundRatePerCup ?? ''} step="0.05" max="5"
                  onChange={v => setNumber('refundRatePerCup', v, { max: 5 }, 'Refund rate')} />
              </Field>
            )}
            {isTikkie && (
              <Field
                label="Most one receipt can pay"
                hint={`A ceiling per bin receipt, whatever the cup count. The server never pays more than ${money(25)}.`}
                htmlFor="set-receipt-cap"
              >
                <MoneyInput id="set-receipt-cap" symbol={symbol} suffix="per receipt" disabled={!canEdit}
                  value={settings.tikkieMaxPerReceipt ?? 25} step="0.5" min="1" max="25"
                  onChange={v => setNumber('tikkieMaxPerReceipt', v, { min: 1, max: 25 }, 'Most per receipt')} />
              </Field>
            )}
            {!isTikkie && (
              <Field label="Receipt window" hint="How long after the purchase a receipt can be claimed. Older ones are flagged for review." htmlFor="set-receipt-age">
                <div className="ui-input-affix">
                  <input id="set-receipt-age" className="ui-input" type="number" min="1" max="365" step="1"
                    disabled={!canEdit} value={settings.receiptMaxAgeDays ?? 14}
                    onChange={e => setNumber('receiptMaxAgeDays', e.target.value, { min: 1, max: 365, int: true }, 'Receipt window')} />
                  <span className="ui-input-affix__suffix">days</span>
                </div>
              </Field>
            )}
          </div>

          <div className="st-preview" aria-label="What customers see">
            <p className="st-preview__label">What customers see</p>
            <div className="st-preview__grid">
              {isTikkie ? [1, 3, 6, 10].map(n => (
                <PreviewCell key={n} label={`${n} cup${n === 1 ? '' : 's'} returned`} value={money(Math.min(settings.tikkieMaxPerReceipt ?? 25, (settings.refundRatePerCup ?? 0) * n))} />
              )) : (
                <>
                  <PreviewCell label="3 cups · cashback" value={money((settings.cashbackRatePerCup ?? 0) * 3)} />
                  <PreviewCell label="6 cups · cashback" value={money((settings.cashbackRatePerCup ?? 0) * 6)} />
                  {showRefund && <PreviewCell label="3 cups · refund" value={money((settings.refundRatePerCup ?? 0) * 3)} muted />}
                  {showRefund && (
                    <PreviewCell
                      label="Extra for choosing a reward"
                      value={`+${money((settings.cashbackRatePerCup ?? 0) - (settings.refundRatePerCup ?? 0))}/cup`}
                      accent
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {!isTikkie && <BudgetCard draft={draft} canEdit={canEdit} orgId={activeOrgId} />}

    </div>
  );
}

function MoneyInput({ id, symbol, suffix, onChange, ...rest }) {
  return (
    <div className="st-money">
      <span className="st-money__prefix">{symbol}</span>
      <input id={id} className="ui-input" type="number" min={rest.min ?? '0'} onChange={e => onChange(e.target.value)} {...rest} />
      <span className="ui-input-affix__suffix">{suffix}</span>
    </div>
  );
}

function PreviewCell({ label, value, muted, accent }) {
  return (
    <div className={`st-preview__cell${muted ? ' st-preview__cell--muted' : ''}${accent ? ' st-preview__cell--accent' : ''}`}>
      <span className="st-preview__cell-label">{label}</span>
      <span className="st-preview__cell-value">{value}</span>
    </div>
  );
}

/* The reward budget lives in its own admin-only table, so it saves directly
 * and the amount never reaches the customer app. The paused message is
 * customer copy and follows the draft. */
function BudgetCard({ draft, canEdit, orgId }) {
  const { symbol } = useAdminMoney();
  const { settings } = draft;
  const [state, setState] = useState({ loading: true, enabled: true, cap: '200', spent: 0 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!orgId) return undefined;
    getRewardBudget(orgId)
      .then(b => { if (alive) setState({ loading: false, enabled: b.enabled, cap: String(b.cap), spent: b.spent }); })
      .catch(() => { if (alive) setState(s => ({ ...s, loading: false })); });
    return () => { alive = false; };
  }, [orgId]);

  const capNum = Math.max(0, parseFloat(state.cap) || 0);

  async function save() {
    if (!orgId) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveRewardBudget(orgId, { cap: capNum, enabled: state.enabled });
      const fresh = await getRewardBudget(orgId);
      setState(s => ({ ...s, spent: fresh.spent }));
      setMessage({ ok: true, text: 'Budget saved.' });
    } catch (e) {
      setMessage({ ok: false, text: e?.message || 'Could not save the budget.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Reward budget"
        icon={Coins}
        subtitle="A ceiling on cashback. When it is reached, customers see a neutral “paused” message and never a figure."
        actions={(
          <Switch
            checked={state.enabled}
            disabled={!canEdit || state.loading}
            label="Cap reward spending"
            onChange={v => setState(s => ({ ...s, enabled: v }))}
          />
        )}
      />
      <CardBody>
        <div className="st-budget">
          <div className="st-budget__controls">
            <Field label={`Budget (${symbol})`} hint="Total cashback this venue pays before claiming pauses." htmlFor="set-budget-cap">
              <input id="set-budget-cap" className="ui-input" type="number" min="0" step="10"
                value={state.cap} disabled={!canEdit || !state.enabled}
                onChange={e => setState(s => ({ ...s, cap: e.target.value }))} />
            </Field>
            <div className="st-budget__save">
              <Button variant="primary" icon={Save} disabled={!canEdit || saving || !orgId || state.loading} onClick={save}>
                {saving ? 'Saving…' : 'Save budget'}
              </Button>
              {message && <span className={message.ok ? 'st-ok' : 'st-error'} role="status">{message.text}</span>}
            </div>
            <p className="st-hint">Saves straight away. It doesn’t wait for Publish.</p>
          </div>
          <RewardBudgetMonitor cap={capNum} enabled={state.enabled} spent={state.spent} loading={state.loading} title="Committed so far" />
        </div>

        <div className="st-subsection">
          <p className="st-subsection__title">Message when claiming is paused</p>
          <p className="st-hint">Shown to customers while the cap is reached. Published with the rest of your settings.</p>
          <div className="st-fields st-fields--one">
            <Field label="Title" htmlFor="set-paused-title">
              <input id="set-paused-title" className="ui-input" disabled={!canEdit}
                value={settings.budgetPausedTitle || ''}
                placeholder="Rewards are paused for a moment"
                onChange={e => draft.update('budgetPausedTitle', e.target.value, 'Paused message title')} />
            </Field>
            <Field label="Message" htmlFor="set-paused-body">
              <textarea id="set-paused-body" className="ui-textarea" rows={3} disabled={!canEdit}
                value={settings.budgetPausedBody || ''}
                placeholder="We’re handling a lot of reward claims right now, so claiming is briefly unavailable. Please try again a little later."
                onChange={e => draft.update('budgetPausedBody', e.target.value, 'Paused message')} />
            </Field>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
