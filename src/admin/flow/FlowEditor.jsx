import { useState } from 'react';
import { ArrowRight, Lock, TriangleAlert, Zap } from 'lucide-react';
import { Badge, Button, Switch } from '../ui';
import TypedConfirmModal from '../shared/TypedConfirmModal';
import { PROGRAMMES, WAY_BY_KEY, flowSummary, inProgramme, turnOffCheck, turnOnCheck } from '../lib/flowModes';
import '../settings/SettingsPage.css';
import './FlowEditor.css';

/* ─────────────────────────────────────────────────────────────────────
 * Ways in and out: the switches for one venue, laid out like the team's
 * chart. Ways in on top (SmartBin, then the BYO ones), ways out below
 * (main, then support). A switch that would break a rule is locked and
 * says why; one that takes another's place says which. A BYO venue sees
 * only what the BYO programme has: no SmartBin, no refunds.
 * ───────────────────────────────────────────────────────────────────── */

const SIDES = [
  {
    side: 'in',
    title: 'Way in',
    hint: 'How a returned cup reaches the customer’s phone. Several can be on.',
    clusters: [
      { id: 'smartbin', label: 'SmartBin', keys: ['bin_nfc', 'bin_display_qr', 'bin_receipt_qr'] },
      { id: 'byo', label: 'BYO', tag: 'BYO', tinted: true, keys: ['staff_app', 'static_qr'],
        note: 'The BYO ways in. A Deposit venue can use them too; a BYO venue has only these.' },
    ],
  },
  {
    side: 'out',
    title: 'Way out',
    hint: 'What the customer gets for the cup. Several can be on.',
    clusters: [
      { id: 'main', label: 'Main', keys: ['reward_voucher', 'reward_cashback', 'deferred_refund'] },
      { id: 'support', label: 'Support', tag: 'Support', tinted: true, keys: ['donation', 'direct_refund'],
        note: 'Never on their own: each needs a main way out.' },
    ],
  },
];

const TONE = {
  bin_nfc: 'orange', bin_display_qr: 'amber', bin_receipt_qr: 'amber', staff_app: 'rose', static_qr: 'orange',
  reward_voucher: 'violet', reward_cashback: 'sky', deferred_refund: 'teal', donation: 'rose', direct_refund: 'sky',
};

/* Deferred Refund and the Rewards are different customer apps: moving
 * between them is a switch of app, not a second way out. */
function isAppSwitch(key, flow, check) {
  if (!check.notBuilt || WAY_BY_KEY[key]?.kind !== 'main') return false;
  const wallet = flow.outs.has('deferred_refund');
  return key === 'deferred_refund' ? !wallet : wallet;
}

export default function FlowEditor({ flow, issues, byo, appMode, canEdit, canSwitchApp, actions, venueName, inGroup }) {
  const [confirm, setConfirm] = useState(null);
  const busy = actions.busy;

  return (
    <div className="wio">
      <section className="wio-head">
        <div className="wio-head__text">
          <p className="wio-head__eyebrow">Ways in and out</p>
          <h2 className="wio-head__title">{flowSummary(flow, { short: false })}</h2>
          <p className="wio-head__blurb">
            {appMode === 'tikkie_only'
              ? 'Customer app: the wallet. Each return adds money, collected later as one Tikkie link.'
              : 'Customer app: rewards. Cups build up toward a reward.'}
          </p>
        </div>
        <div className="wio-head__tags">
          <Badge
            tone={byo ? 'warning' : 'neutral'}
            title={byo
              ? 'Chosen when the venue was created. A BYO venue can’t become a Deposit venue.'
              : 'Chosen when the venue was created.'}
          >
            {PROGRAMMES[flow.programme]?.label || 'Deposit'} programme
          </Badge>
        </div>
      </section>

      {issues.length > 0 && (
        <div className="st-callout st-callout--warn" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <p className="st-callout__title">This venue’s setup breaks {issues.length === 1 ? 'a rule' : `${issues.length} rules`}</p>
            <ul className="wio-issues">{issues.map(i => <li key={i}>{i}</li>)}</ul>
            <p className="st-callout__text">It keeps running as it is. Change the switches below to fix it.</p>
          </div>
        </div>
      )}
      {actions.error && <p className="st-error" role="alert">{actions.error}</p>}

      {byo && (
        <p className="wio-programme-note">
          BYO programme: customers bring their own cup, so there are no SmartBin ways in and no
          Deferred Refund or Direct Refund. It stays BYO: a BYO venue can’t become a Deposit venue.
        </p>
      )}

      {SIDES.map(s => (
        <section key={s.side} className="wio-side" aria-labelledby={`wio-${s.side}`}>
          <div className="wio-side__head">
            <h3 id={`wio-${s.side}`} className="wio-side__title">{s.title}</h3>
            <p className="wio-side__hint">{s.hint}</p>
          </div>
          <div className={`wio-clusters${byo ? ' wio-clusters--single' : ''}`}>
            {s.clusters.map(c => ({ ...c, keys: c.keys.filter(k => inProgramme(k, flow.programme)) })).filter(c => c.keys.length).map(c => (
              <div key={c.id} className={`wio-cluster${c.tinted ? ' wio-cluster--tinted' : ''}`}>
                <div className="wio-cluster__head">
                  <span className="wio-cluster__label">{c.label}</span>
                  {c.note && <span className="wio-cluster__note">{c.note}</span>}
                </div>
                <div className="wio-cluster__tiles">
                  {c.keys.map((k, i) => (
                    <WayTile
                      key={k}
                      wayKey={k}
                      index={i}
                      flow={flow}
                      tag={c.tag}
                      canEdit={canEdit}
                      canSwitchApp={canSwitchApp}
                      busy={busy}
                      onToggle={actions.toggle}
                      onSwitchApp={setConfirm}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {confirm && (
        <TypedConfirmModal
          title={`Switch ${venueName || 'this venue'} to ${WAY_BY_KEY[confirm].label}?`}
          intro="The customer app changes as soon as you confirm. Nothing is deleted."
          word="switch"
          confirmLabel={`Switch to ${WAY_BY_KEY[confirm].label}`}
          busy={busy === confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await actions.switchApp(confirm); setConfirm(null); }}
        >
          <ul className="tcm-list">
            <li>Cups, balances, claims and payouts are <strong>kept</strong>.</li>
            {confirm === 'deferred_refund' ? (
              <>
                <li className="tcm-bad">The customer app stops showing rewards. Each return fills the wallet, collected as one Tikkie link.</li>
                {inGroup && <li className="tcm-bad">The venue <strong>leaves its group</strong>: the wallet app has no group.</li>}
              </>
            ) : (
              <li className="tcm-bad">Returns stop filling the wallet, <strong>including receipts already printed</strong>. Cups build up toward a reward instead.</li>
            )}
            <li>Ways in stay as they are. Publish afterwards to put the rest of the draft live.</li>
          </ul>
        </TypedConfirmModal>
      )}
    </div>
  );
}

function WayTile({ wayKey, index, flow, tag, canEdit, canSwitchApp, busy, onToggle, onSwitchApp }) {
  const way = WAY_BY_KEY[wayKey];
  const on = flow.ins.has(wayKey) || flow.outs.has(wayKey);
  const check = on ? turnOffCheck(wayKey, flow) : turnOnCheck(wayKey, flow);
  const appSwitch = !on && isAppSwitch(wayKey, flow, check);
  const Icon = way.icon;
  const id = `way-${wayKey}`;
  const locked = !check.ok;

  return (
    <article className={`st-tile wio-tile${on ? ' st-tile--on' : ''}${locked && !on ? ' wio-tile--locked' : ''}`} style={{ '--i': index }}>
      <div className="st-tile__top">
        <span className={`st-tile__icon ui-tone--${TONE[wayKey]}`} aria-hidden="true"><Icon size={19} /></span>
        <Switch
          id={id}
          checked={on}
          label={way.label}
          disabled={!canEdit || !!busy || locked}
          onChange={next => onToggle(wayKey, next)}
        />
      </div>
      <div className="st-tile__title-row wio-tile__title-row">
        <label className="st-tile__title" htmlFor={id}>{way.label}</label>
        {tag && <span className={`wio-tag wio-tag--${tag.toLowerCase()}`}>{tag}</span>}
        {check.notBuilt && <span className="wio-tag wio-tag--soon">Not built yet</span>}
      </div>
      <p className="st-tile__summary">{way.blurb}</p>
      <div className="st-tile__foot">
        {on && (
          <span className="st-tile__state st-tile__state--on"><span className="st-tile__dot" aria-hidden="true" />On</span>
        )}
        {!on && check.ok && !check.replaces && (
          <span className="st-tile__state"><span className="st-tile__dot" aria-hidden="true" />Off</span>
        )}
        {!on && check.ok && check.replaces && (
          <span className="wio-note">Replaces {WAY_BY_KEY[check.replaces].label}</span>
        )}
        {locked && (
          <span className="wio-reason"><Lock size={12} aria-hidden="true" />{on ? `Stays on: ${check.reason}` : check.reason}</span>
        )}
        {appSwitch && canSwitchApp && (
          <Button size="sm" variant="outline" iconRight={ArrowRight} disabled={!!busy} onClick={() => onSwitchApp(wayKey)}>
            Use instead
          </Button>
        )}
        {appSwitch && !canSwitchApp && <span className="wio-note">A master can switch the venue to this.</span>}
        {wayKey === 'staff_app' && <span className="st-tile__chip"><Zap size={12} aria-hidden="true" />Saves at once</span>}
      </div>
    </article>
  );
}
