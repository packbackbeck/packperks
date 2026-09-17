import { useEffect, useState } from 'react';
import { ArrowRight, CupSoda, Gift, PanelsTopLeft, Power, WalletCards } from 'lucide-react';
import { Badge, Button, InfoTip, Modal, Switch } from '../ui';
import { ORG_MODE_META } from '../lib/orgModes';
import { TAB_BY_ID } from '../lib/access';
import { getGroupHideLiveVendors, setGroupHideLiveVendors } from '../lib/adminApi';
import { FEATURE_GROUPS, featuresFor, featureValue } from './settingsModel';

const MODE_GLYPH = { standard: Gift, byo: CupSoda, tikkie_only: WalletCards };

/* Features: one tile per switch, grouped by where the switch acts. */
export default function FeaturesPanel({ draft, canEdit, mode, org, isMaster, onNavigate }) {
  const { activeGroupId, activeGroup } = org;
  const hasGroup = !!activeGroupId;
  const features = featuresFor(mode, hasGroup);

  /* The market-page switch belongs to the group's config and saves at once. */
  const [groupFlags, setGroupFlags] = useState({ hideLiveVendors: false });
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!activeGroupId) return undefined;
    getGroupHideLiveVendors(activeGroupId)
      .then(v => { if (alive) setGroupFlags({ hideLiveVendors: !!v }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeGroupId]);

  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  function valueOf(f) {
    if (f.source === 'group') return !!groupFlags[f.key];
    return featureValue(f, draft.settings);
  }

  async function toggle(f, next) {
    if (!canEdit) return;
    if (f.source === 'group') {
      setGroupFlags(g => ({ ...g, [f.key]: next }));
      setGroupBusy(true);
      setGroupError(null);
      try {
        await setGroupHideLiveVendors(activeGroupId, next);
        draft.notify(`${f.label}, for the whole group`);
      } catch (e) {
        setGroupFlags(g => ({ ...g, [f.key]: !next }));
        setGroupError(e?.message || 'Could not save the group setting.');
      } finally {
        setGroupBusy(false);
      }
      return;
    }
    if (f.key === 'maintenanceMode' && next) {
      setConfirmMaintenance(true);
      return;
    }
    draft.update(f.key, next, f.label);
  }

  const onCount = features.filter(valueOf).length;
  const unpublished = features.filter(f => f.source !== 'group' && draft.changed(f.key, f.fallback)).length;
  const meta = ORG_MODE_META[mode] || ORG_MODE_META.standard;
  const ModeGlyph = MODE_GLYPH[mode] || Gift;

  return (
    <div className="st-stack">
      <section className="st-programme">
        <span className={`st-programme__glyph st-programme__glyph--${mode}`} aria-hidden="true">
          <ModeGlyph size={22} strokeWidth={2} />
        </span>
        <div className="st-programme__text">
          <p className="st-programme__eyebrow">Programme</p>
          <h2 className="st-programme__title">{meta.label}</h2>
          <p className="st-programme__blurb">{shortBlurb(mode)}</p>
        </div>
        <div className="st-programme__side">
          <div className="st-programme__stats">
            <span><b>{onCount}</b> of {features.length} features on</span>
            {unpublished > 0 && (
              <Badge tone="warning">{unpublished} not published</Badge>
            )}
          </div>
          {isMaster ? (
            <Button size="sm" iconRight={ArrowRight} onClick={() => onNavigate?.('master', { section: 'organisations' })}>
              Change programme
            </Button>
          ) : (
            <span className="st-programme__note">A master can change the programme.</span>
          )}
        </div>
      </section>

      {groupError && <p className="st-error" role="alert">{groupError}</p>}

      {FEATURE_GROUPS.map(g => {
        const items = features.filter(f => f.group === g.id);
        if (!items.length) return null;
        return (
          <section key={g.id} className="st-group" aria-labelledby={`st-group-${g.id}`}>
            <div className="st-group__head">
              <h3 id={`st-group-${g.id}`} className="st-group__label">
                {g.id === 'group' && activeGroup?.name ? `${activeGroup.name} group` : g.label}
              </h3>
              <span className="st-group__rule" aria-hidden="true" />
            </div>
            <div className="st-tiles">
              {items.map((f, i) => {
                const on = valueOf(f);
                const tab = f.tab ? TAB_BY_ID[f.tab] : null;
                const pending = f.source !== 'group' && draft.changed(f.key, f.fallback);
                const Icon = f.icon;
                const switchId = `feature-${f.key}`;
                return (
                  <article
                    key={f.key}
                    className={`st-tile${on ? ' st-tile--on' : ''}${f.danger && on ? ' st-tile--alert' : ''}`}
                    style={{ '--i': i }}
                  >
                    <div className="st-tile__top">
                      <span className={`st-tile__icon ui-tone--${f.tone}`} aria-hidden="true">
                        <Icon size={19} />
                      </span>
                      <Switch
                        id={switchId}
                        checked={on}
                        disabled={!canEdit || (f.source === 'group' && groupBusy)}
                        tone={f.danger ? 'danger' : undefined}
                        label={f.label}
                        onChange={next => toggle(f, next)}
                      />
                    </div>
                    <div className="st-tile__title-row">
                      <label className="st-tile__title" htmlFor={switchId}>{f.label}</label>
                      <InfoTip label={f.label}>{f.detail}</InfoTip>
                    </div>
                    <p className="st-tile__summary">{f.summary}</p>
                    <div className="st-tile__foot">
                      <span className={`st-tile__state${on ? ' st-tile__state--on' : ''}`}>
                        <span className="st-tile__dot" aria-hidden="true" />
                        {on ? (f.danger ? 'On — customers are paused' : 'On') : 'Off'}
                      </span>
                      {tab && (
                        <span className="st-tile__chip" title={`Switching this off hides the ${tab.label} tab`}>
                          <PanelsTopLeft size={12} aria-hidden="true" />
                          {tab.label} tab
                        </span>
                      )}
                      {f.source === 'group' && <span className="st-tile__chip">Whole group · saves at once</span>}
                      {pending && <Badge tone="warning">Not published</Badge>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <Modal
        open={confirmMaintenance}
        onClose={() => setConfirmMaintenance(false)}
        title="Pause the app for customers?"
        subtitle="Maintenance mode takes effect when you publish."
        icon={Power}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirmMaintenance(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                draft.update('maintenanceMode', true, 'Maintenance mode');
                setConfirmMaintenance(false);
              }}
            >
              Turn on maintenance mode
            </Button>
          </>
        )}
      >
        <ul className="st-list">
          <li>Customers see a banner and can’t scan cups, claim rewards or cash out.</li>
          <li>Balances, claims and payouts already in progress are kept.</li>
          <li>Switch it off and publish again to reopen.</li>
        </ul>
      </Modal>
    </div>
  );
}

function shortBlurb(mode) {
  if (mode === 'tikkie_only') return 'Bin receipts add a refund to the customer’s wallet, collected later as one Tikkie link. No rewards.';
  if (mode === 'byo') return 'Customers bring their own cup and scan the counter QR toward a reward.';
  return 'The full customer app: a cup balance, rewards, direct refunds and receipt claims.';
}
