import { useState } from 'react';
import {
  BarChart3, EyeOff, ExternalLink, Layers, Link2, MessageSquareText, MoreHorizontal, Pencil, Plus, RotateCcw,
  Send, Settings2, Store, TicketCheck, Trash2, Wallet, Zap,
} from 'lucide-react';
import {
  deleteOrgGroup, renameOrgGroup, resetGroupCopy, saveGroupCopy, setGroupPaymentMethod, setOrgGroupActive,
  setOrgGroupMembership, setOrgGroupMode,
} from '../lib/adminApi';
import { composeGroupCopy } from '../../lib/groups';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHODS, PAYMENT_METHOD_META } from '../../lib/paymentMethods';
import { formatMoney, regionForCountry } from '../../lib/regions';
import { OrgAvatar } from '../context/OrgSwitcher';
import { Badge, Button, Field, Menu, MenuItem, MenuSeparator, Modal, Switch } from '../ui';
import TypedConfirmModal from '../shared/TypedConfirmModal';
import Drawer from './Drawer';
import { Callout, ChoiceCard, DiscardModal, ModeChip, SaveFooter, Sec } from './OrgBits';
import { GROUP_MODES, GROUP_MODE_TO_ORG, MODE_GLYPH, groupModeLabel, plural, slugOk } from './orgShared';

const METHOD_ICON = { tikkie: Send, voucher: TicketCheck };

const GROUP_MODE_BLURB = {
  deposit: 'Customers return packaging at the SmartBin and scan the receipt. The app talks about deposits and returns.',
  byo: 'Customers bring their own cup and scan the counter QR code. Counter QR codes only give cups in a Bring Your Own group.',
};

/* The button labels a grouped venue shows instead of its own. Only the ones
 * the customer app reads are here (UserPage). */
const LABELS = [
  ['shareButtonLabel', 'Share button'],
  ['donateButtonLabel', 'Donate button'],
  ['nextCupFreeLabel', 'Next-cup button'],
  ['activityLabel', 'Activity heading'],
];

/* The copy exactly as the customer app composes it, as flat form fields. */
function copyForm(mode, config) {
  const c = composeGroupCopy({ mode, groupConfig: config });
  return {
    heroHeadline: c.heroHeadline || '',
    heroSubtext: c.heroSubtext || '',
    storesIntro: c.storesIntro || '',
    steps: (c.howItWorks?.steps || []).map(s => ({ title: s.title || '', body: s.body || '' })),
    termsTitle: c.terms?.title || '',
    termsIntro: c.terms?.intro || '',
    termsPoints: (c.terms?.points || []).join('\n'),
    capTitle: c.dailyCapReview?.title || '',
    capBody: c.dailyCapReview?.body || '',
    labels: Object.fromEntries(LABELS.map(([k]) => [k, c.designCopy?.[k] || ''])),
  };
}

/* Which form fields differ between two copy forms, by the name a person reads. */
function copyDiff(a, b) {
  const out = [];
  if (a.heroHeadline !== b.heroHeadline) out.push('Headline');
  if (a.heroSubtext !== b.heroSubtext) out.push('Subtext');
  if (a.storesIntro !== b.storesIntro) out.push('Market page intro');
  if (JSON.stringify(a.steps) !== JSON.stringify(b.steps)) out.push('How it works');
  if (a.termsTitle !== b.termsTitle || a.termsIntro !== b.termsIntro || lines(a.termsPoints).join('\n') !== lines(b.termsPoints).join('\n')) out.push('Terms');
  if (a.capTitle !== b.capTitle || a.capBody !== b.capBody) out.push('Daily limit message');
  LABELS.forEach(([k, l]) => { if (a.labels[k] !== b.labels[k]) out.push(l); });
  return out;
}

const lines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

/* Turn the form back into stored overrides. Only what differs from the
 * programme's default is stored, so a later change to the default reaches
 * every group that never changed that text. Keys this form doesn't show
 * are kept as they are. */
function buildOverrides(form, mode, config) {
  const preset = composeGroupCopy({ mode, groupConfig: null });
  const current = composeGroupCopy({ mode, groupConfig: config });
  const ov = JSON.parse(JSON.stringify(config?.settings?.copy || {}));
  const text = (key, value, def) => {
    const v = value.trim();
    if (!v || v === def) delete ov[key]; else ov[key] = v;
  };
  text('heroHeadline', form.heroHeadline, preset.heroHeadline);
  text('heroSubtext', form.heroSubtext, preset.heroSubtext);
  text('storesIntro', form.storesIntro, preset.storesIntro);

  // Steps keep their artwork; only the words are edited here.
  const steps = (current.howItWorks?.steps || []).map((s, i) => ({
    ...s,
    title: form.steps[i]?.title.trim() || s.title,
    body: form.steps[i]?.body.trim() || s.body,
  }));
  const sameSteps = steps.length === preset.howItWorks.steps.length
    && steps.every((s, i) => s.title === preset.howItWorks.steps[i].title && s.body === preset.howItWorks.steps[i].body);
  if (sameSteps) delete ov.howItWorks;
  else ov.howItWorks = { ...current.howItWorks, steps };

  const terms = {
    title: form.termsTitle.trim() || preset.terms.title,
    intro: form.termsIntro.trim() || preset.terms.intro,
    points: lines(form.termsPoints).length ? lines(form.termsPoints) : preset.terms.points,
  };
  if (JSON.stringify(terms) === JSON.stringify({ title: preset.terms.title, intro: preset.terms.intro, points: preset.terms.points })) delete ov.terms;
  else ov.terms = terms;

  const cap = {
    title: form.capTitle.trim() || preset.dailyCapReview.title,
    body: form.capBody.trim() || preset.dailyCapReview.body,
  };
  if (cap.title === preset.dailyCapReview.title && cap.body === preset.dailyCapReview.body) delete ov.dailyCapReview;
  else ov.dailyCapReview = cap;

  const design = { ...(ov.designCopy || {}) };
  LABELS.forEach(([k]) => {
    const v = form.labels[k].trim();
    if (!v || v === preset.designCopy[k]) delete design[k]; else design[k] = v;
  });
  if (Object.keys(design).length) ov.designCopy = design; else delete ov.designCopy;
  return ov;
}

export default function GroupEditor({ group, orgs, modes, stats, initialTab = 'settings', onClose, onChanged, onEditOrg }) {
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const basicsKey = `${group.name}|${group.slug}`;
  const copyKey = `${group.mode}|${JSON.stringify(group.config?.settings?.copy || {})}`;
  const [basics, setBasics] = useState({ name: group.name, slug: group.slug || '' });
  const [basicsSeen, setBasicsSeen] = useState(basicsKey);
  if (basicsKey !== basicsSeen) { setBasicsSeen(basicsKey); setBasics({ name: group.name, slug: group.slug || '' }); }
  const [copy, setCopy] = useState(() => copyForm(group.mode, group.config));
  const [copySeen, setCopySeen] = useState(copyKey);
  if (copyKey !== copySeen) { setCopySeen(copyKey); setCopy(copyForm(group.mode, group.config)); }

  const savedCopy = copyForm(group.mode, group.config);
  const presetCopy = copyForm(group.mode, null);
  const copyChanges = copyDiff(copy, savedCopy);
  const basicsChanges = [
    basics.name.trim() !== group.name && 'Name',
    basics.slug.trim() !== (group.slug || '') && 'Market page address',
  ].filter(Boolean);
  const changes = [...basicsChanges, ...copyChanges];

  const members = (group.members || []).slice().sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at) || a.name.localeCompare(b.name));
  const liveMembers = members.filter(m => !m.deleted_at);

  async function run(fn, message) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged(message);
      return true;
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (basicsChanges.length) {
      if (!basics.name.trim()) { setTab('settings'); setError('Give the group a name.'); return; }
      if (!slugOk(basics.slug)) { setTab('settings'); setError('Use lowercase letters, numbers and dashes. admin, mockup, staff and support are taken by the site.'); return; }
    }
    await run(async () => {
      if (basicsChanges.length) await renameOrgGroup(group.id, basics.name.trim(), basics.slug.trim());
      if (copyChanges.length) await saveGroupCopy(group.id, buildOverrides(copy, group.mode, group.config));
    }, `${basics.name.trim() || group.name} saved.`);
  }

  function requestClose() {
    if (changes.length) setAskDiscard(true);
    else onClose();
  }

  const tabs = [
    { id: 'settings', label: 'Settings', icon: Settings2, count: basicsChanges.length || undefined },
    { id: 'venues', label: 'Venues', icon: Store, count: liveMembers.length },
    { id: 'copy', label: 'Customer copy', icon: MessageSquareText, count: copyChanges.length || undefined },
    { id: 'numbers', label: 'Numbers', icon: BarChart3 },
  ];
  const payment = group.config?.settings?.paymentMethod;

  return (
    <>
      <Drawer
        open
        onClose={requestClose}
        label={`Edit ${group.name}`}
        lead={<span className="ms-drawer__icon"><Layers size={20} aria-hidden="true" /></span>}
        title={group.name}
        subtitle={<span className="ms-mono">/{group.slug}/</span>}
        badges={(
          <>
            <ModeChip mode={GROUP_MODE_TO_ORG[group.mode]} />
            <span className="ms-chip"><Wallet size={11} aria-hidden="true" />Rewards: {PAYMENT_METHOD_META[payment || DEFAULT_PAYMENT_METHOD].short.toLowerCase()}</span>
            <span className="ms-chip"><Store size={11} aria-hidden="true" />{plural(liveMembers.length, 'venue')}</span>
          </>
        )}
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        footer={(
          <SaveFooter
            changes={changes}
            saving={busy}
            error={error}
            onDiscard={() => { setBasics({ name: group.name, slug: group.slug || '' }); setCopy(savedCopy); setError(null); }}
            onSave={save}
            cleanText={tab === 'venues' ? 'Venue changes apply when you confirm them.' : 'Everything is saved.'}
          />
        )}
      >
        {tab === 'settings' && (
          <SettingsTab
            group={group}
            basics={basics}
            setBasics={setBasics}
            memberCount={liveMembers.length}
            copyChanged={copyDiff(savedCopy, presetCopy).length}
            unsavedCopy={copyChanges.length > 0}
            busy={busy}
            run={run}
            onClose={onClose}
          />
        )}
        {tab === 'venues' && (
          <VenuesTab group={group} members={members} orgs={orgs} modes={modes} busy={busy} run={run} onEditOrg={onEditOrg} />
        )}
        {tab === 'copy' && (
          <CopyTab group={group} copy={copy} setCopy={setCopy} preset={presetCopy} saved={savedCopy} busy={busy} run={run} />
        )}
        {tab === 'numbers' && <NumbersTab stats={stats} orgs={orgs} members={liveMembers} />}
      </Drawer>
      <DiscardModal open={askDiscard} onKeep={() => setAskDiscard(false)} onDiscard={() => { setAskDiscard(false); onClose(); }} />
    </>
  );
}

/* ── Settings: name, programme, payment method, delete ─────────────── */
function SettingsTab({ group, basics, setBasics, memberCount, copyChanged, unsavedCopy, busy, run, onClose }) {
  const [modeTarget, setModeTarget] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const payment = group.config?.settings?.paymentMethod || null;
  const current = payment || DEFAULT_PAYMENT_METHOD;
  const slugChanged = basics.slug.trim() !== (group.slug || '');
  const hasByoVenues = group.mode === 'byo' && memberCount > 0;

  return (
    <div className="ms-secs">
      <Sec title="Name and market page" icon={Link2} when="save" hint="The market page lists every venue in the group on one map.">
        <div className="ms-fields">
          <Field label="Group name" htmlFor={`g-name-${group.id}`} hint="Shown in the dashboard and on the market page.">
            <input id={`g-name-${group.id}`} className="ui-input" value={basics.name} onChange={e => setBasics(b => ({ ...b, name: e.target.value }))} />
          </Field>
          <Field label="Market page address" htmlFor={`g-slug-${group.id}`}>
            <div className="ms-prefix">
              <span className="ms-prefix__text">/</span>
              <input id={`g-slug-${group.id}`} className="ui-input" value={basics.slug} onChange={e => setBasics(b => ({ ...b, slug: e.target.value }))} />
            </div>
          </Field>
        </div>
        {slugChanged ? (
          <Callout tone="warn" title="Links to the old address stop working">
            Anything printed or shared with /{group.slug}/ breaks when you save. If the address is taken, a number is added.
          </Callout>
        ) : (
          <a className="ms-extlink" href={`/${group.slug}/`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden="true" />Open the market page
          </a>
        )}
      </Sec>

      <Sec title="Programme" icon={Zap} when="now" hint="Every venue in the group runs this programme. Deferred Tikkie is set per venue and never sits in a group.">
        <div className="ms-choices ms-choices--2" role="radiogroup" aria-label="Programme">
          {GROUP_MODES.map(m => (
            <ChoiceCard
              key={m}
              on={group.mode === m}
              tag="Now"
              disabled={busy}
              icon={MODE_GLYPH[GROUP_MODE_TO_ORG[m]]}
              tone={GROUP_MODE_TO_ORG[m]}
              label={groupModeLabel(m)}
              blurb={GROUP_MODE_BLURB[m]}
              onClick={() => { if (group.mode !== m) setModeTarget(m); }}
            />
          ))}
        </div>
      </Sec>

      <Sec title="How rewards are paid" icon={Wallet} when="now" hint="The default for every venue in the group. A venue that picked its own method in Settings → Payouts keeps it.">
        <div className="ms-choices ms-choices--2" role="radiogroup" aria-label="How rewards are paid">
          {PAYMENT_METHODS.map(m => (
            <ChoiceCard
              key={m.key}
              on={current === m.key}
              tag={payment ? 'In use' : 'Default'}
              disabled={busy}
              icon={METHOD_ICON[m.key] || Wallet}
              label={m.label}
              blurb={m.blurb}
              onClick={() => { if (current !== m.key) setPayTarget(m.key); }}
            >
              <span className="ms-choice__meta">{m.detail}</span>
            </ChoiceCard>
          ))}
        </div>
      </Sec>

      <Sec
        title="Delete group"
        icon={Trash2}
        danger
        hint="The venues leave the group and keep working on their own. No customers, cups or claims are deleted."
        action={<Button size="sm" variant="danger-ghost" icon={Trash2} disabled={busy} onClick={() => setDeleting(true)}>Delete group</Button>}
      />

      {modeTarget && (
        <TypedConfirmModal
          title={`Switch ${group.name} to ${groupModeLabel(modeTarget)}?`}
          intro="Every venue in the group changes as soon as you confirm. Nothing is deleted."
          word="switch"
          confirmLabel={`Switch to ${groupModeLabel(modeTarget)}`}
          busy={busy}
          onCancel={() => setModeTarget(null)}
          onConfirm={async () => {
            const ok = await run(async () => {
              await setOrgGroupMode(group.id, modeTarget);
              try { window.dispatchEvent(new Event('pp-org-mode-changed')); } catch { /* ignore */ }
            }, `${group.name} now runs ${groupModeLabel(modeTarget)}.`);
            if (ok) setModeTarget(null);
          }}
        >
          <ul className="tcm-list">
            <li className="tcm-bad">{memberCount ? <>All <strong>{plural(memberCount, 'venue')}</strong> in the group switch.</> : 'The group has no venues yet.'}</li>
            <li className={copyChanged || unsavedCopy ? 'tcm-bad' : undefined}>
              The group’s customer copy goes back to the {groupModeLabel(modeTarget)} default
              {copyChanged ? <>: <strong>{plural(copyChanged, 'changed text')}</strong> {copyChanged === 1 ? 'is' : 'are'} replaced</> : ''}
              {unsavedCopy ? ', and your unsaved copy edits are dropped' : ''}.
            </li>
            {group.mode === 'byo' && (
              <li className="tcm-bad">Counter QR codes stop giving cups: <strong>printed counter QR codes stop working</strong>.</li>
            )}
            {modeTarget === 'byo' && <li>Counter QR codes start giving cups at these venues.</li>}
            <li>Cups, balances, claims and payouts are <strong>kept</strong>. Features such as direct refunds stay as they are.</li>
          </ul>
        </TypedConfirmModal>
      )}

      <Modal
        open={!!payTarget}
        onClose={() => !busy && setPayTarget(null)}
        title={payTarget ? `Pay rewards by ${PAYMENT_METHOD_META[payTarget].label.toLowerCase()}?` : ''}
        subtitle={`For ${memberCount === 1 ? 'the venue' : `the ${plural(memberCount, 'venue')}`} in ${group.name} that follow the group.`}
        icon={Wallet}
        iconTone="amber"
        footer={(
          <>
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={async () => {
              const ok = await run(() => setGroupPaymentMethod(group.id, payTarget), `${group.name} now pays rewards by ${PAYMENT_METHOD_META[payTarget].label.toLowerCase()}.`);
              if (ok) setPayTarget(null);
            }}>
              {busy ? 'Switching…' : `Switch to ${payTarget ? PAYMENT_METHOD_META[payTarget].short.toLowerCase() : ''}`}
            </Button>
          </>
        )}
      >
        {payTarget && (
          <>
            <p className="ms-modal-text">
              Customers stop using <b>{PAYMENT_METHOD_META[current].label.toLowerCase()}</b> and start using{' '}
              <b>{PAYMENT_METHOD_META[payTarget].label.toLowerCase()}</b> the next time they open the app.
            </p>
            <p className="ms-modal-text ms-modal-text--muted">
              {payTarget === 'voucher'
                ? 'Rewards are handed over at the counter: no receipt, no check and no payout. Staff need to know to take the phone and slide.'
                : 'Rewards are paid after review: customers add an email address, photograph the receipt, and every claim comes to Claims for approval.'}
              {' '}Claims already made are not affected.
            </p>
          </>
        )}
      </Modal>

      {deleting && (
        <TypedConfirmModal
          title={`Delete ${group.name}?`}
          intro="The group goes away. Its venues keep running on their own."
          word="delete"
          confirmLabel="Delete group"
          tone="danger"
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            const ok = await run(() => deleteOrgGroup(group.id), `${group.name} is deleted. Its venues now stand alone.`);
            if (ok) { setDeleting(false); onClose(); }
          }}
        >
          <ul className="tcm-list">
            {memberCount > 0 && <li className="tcm-bad"><strong>{plural(memberCount, 'venue')}</strong> leave the group and run Deposit Rewards on their own.</li>}
            {hasByoVenues && <li className="tcm-bad">Counter QR codes stop giving cups: <strong>printed counter QR codes stop working</strong>.</li>}
            <li className="tcm-bad">The market page at /{group.slug}/ stops working, and customers no longer share one profile across these venues.</li>
            <li>The group’s customer copy and payment default are deleted.</li>
            <li><strong>No customers, cups, claims or payouts are deleted.</strong></li>
          </ul>
        </TypedConfirmModal>
      )}
    </div>
  );
}

/* ── Venues: who is in the group ──────────────────────────────────── */
function VenuesTab({ group, members, orgs, modes, busy, run, onEditOrg }) {
  const [adding, setAdding] = useState('');
  const [confirm, setConfirm] = useState(null); // { action: 'join'|'leave', org }
  const live = members.filter(m => !m.deleted_at);
  const countryOf = Object.fromEntries((orgs || []).map(o => [o.id, o.country]));
  const candidates = (orgs || [])
    .filter(o => !o.deleted_at && !o.group_id && modes[o.id] !== 'tikkie_only')
    .sort((a, b) => a.name.localeCompare(b.name));
  const regionKeys = [...new Set(live.map(m => regionForCountry(countryOf[m.id])?.key).filter(Boolean))];
  const hideLive = group.config?.settings?.hideLiveVendors === true;
  const others = Math.max(0, live.length - 1);

  return (
    <div className="ms-secs">
      <Sec
        title="Venues in this group"
        icon={Store}
        when="now"
        hint="Customers share one profile across these venues. Each venue keeps its own cup balance."
      >
        {hideLive && (
          <Callout tone="warn" title="The market page hides every live venue right now">
            Settings → Features → “Only ‘coming soon’ on the market page” is on for this group, so the switches below have no visible effect until it is off.
          </Callout>
        )}
        {regionKeys.length > 1 && (
          <Callout tone="info" title={`These venues are in ${regionKeys.join(' and ')}`}>
            Each venue shows money and pays out in its own region’s currency.
          </Callout>
        )}
        {members.length === 0 ? (
          <p className="ms-empty-line">No venues yet. Add the first one below.</p>
        ) : (
          <ul className="ms-venues">
            {members.map(m => {
              const region = regionForCountry(countryOf[m.id]);
              const archived = !!m.deleted_at;
              return (
                <li key={m.id} className={`ms-venue${archived ? ' ms-venue--archived' : ''}`}>
                  <OrgAvatar org={m} size={32} />
                  <span className="ms-venue__text">
                    <span className="ms-venue__name">
                      {m.name}
                      {archived && <Badge tone="neutral">Archived</Badge>}
                      {modes[m.id] === 'tikkie_only' && <ModeChip mode="tikkie_only" title="A Deferred Tikkie venue should not be in a group." />}
                    </span>
                    <span className="ms-venue__meta">
                      <span className="ms-mono">/{m.slug}/</span>
                      {region && <span>· {region.key} · {region.currency}</span>}
                    </span>
                  </span>
                  {!archived && (
                    <span className="ms-venue__switch">
                      <span>{m.group_active ? 'On the market page' : <><EyeOff size={12} aria-hidden="true" /> Hidden</>}</span>
                      <Switch
                        checked={!!m.group_active}
                        disabled={busy}
                        label={`Show ${m.name} on the market page`}
                        onChange={(on) => run(() => setOrgGroupActive(m.id, on), on ? `${m.name} is on the market page.` : `${m.name} is hidden from the market page.`)}
                      />
                    </span>
                  )}
                  <Menu
                    trigger={({ toggle, open, id }) => (
                      <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`More for ${m.name}`} aria-expanded={open} aria-controls={id} onClick={toggle} />
                    )}
                  >
                    {!archived && <MenuItem icon={Pencil} onClick={() => onEditOrg(m.id)}>Edit venue</MenuItem>}
                    <MenuItem icon={ExternalLink} onClick={() => window.open(`/${m.slug}/`, '_blank', 'noopener')}>Open the customer app</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={Trash2} danger disabled={busy} onClick={() => setConfirm({ action: 'leave', org: m })}>Take out of the group</MenuItem>
                  </Menu>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ms-addrow">
          <select className="ui-select" value={adding} onChange={e => setAdding(e.target.value)} disabled={busy || candidates.length === 0}
            aria-label="Venue to add">
            <option value="">{candidates.length ? 'Pick a venue to add…' : 'Every venue is already in a group'}</option>
            {candidates.map(o => <option key={o.id} value={o.id}>{o.name} (/{o.slug}/)</option>)}
          </select>
          <Button icon={Plus} disabled={busy || !adding}
            onClick={() => setConfirm({ action: 'join', org: candidates.find(o => o.id === adding) })}>
            Add to group
          </Button>
        </div>
        <p className="ms-note">Only venues without a group are listed. Deferred Tikkie venues can’t join a group.</p>
      </Sec>

      {confirm && (
        <TypedConfirmModal
          title={confirm.action === 'join' ? `Add ${confirm.org.name} to ${group.name}?` : `Take ${confirm.org.name} out of ${group.name}?`}
          intro={confirm.action === 'join'
            ? 'The venue takes on the group’s programme and copy as soon as you confirm.'
            : 'The venue keeps working on its own, without what it had from the group.'}
          word={confirm.action}
          confirmLabel={confirm.action === 'join' ? 'Add to group' : 'Take out of group'}
          tone={confirm.action === 'join' ? 'warn' : 'danger'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const joining = confirm.action === 'join';
            const ok = await run(
              () => setOrgGroupMembership(confirm.org.id, joining ? group.id : null),
              joining ? `${confirm.org.name} is in ${group.name}.` : `${confirm.org.name} left ${group.name}.`,
            );
            if (ok) { setConfirm(null); if (joining) setAdding(''); }
          }}
        >
          <ul className="tcm-list">
            {confirm.action === 'join' ? (
              <>
                <li><strong>It runs {groupModeLabel(group.mode)}</strong> and shows the group’s customer copy instead of its own.</li>
                <li>Customers get <strong>one profile</strong> across the group: a name and email set at one venue follow them to the others.</li>
                <li><strong>Cup balances stay per venue.</strong> Nothing is merged.</li>
                <li>It appears on the market page at /{group.slug}/.</li>
                {group.mode === 'byo'
                  ? <li>Counter QR codes start giving cups at this venue.</li>
                  : <li className="tcm-bad">This is not a Bring Your Own group, so counter QR codes will <strong>not</strong> give cups here.</li>}
              </>
            ) : (
              <>
                <li>It goes back to <strong>Deposit Rewards</strong> and its own copy. The group keeps running for {plural(others, 'other venue')}.</li>
                {group.mode === 'byo' && (
                  <li className="tcm-bad"><strong>Its counter QR codes stop giving cups at once</strong>, including every code already printed.</li>
                )}
                <li className="tcm-bad">Customers keep their cups here, but their name and email no longer follow them between this venue and the group.</li>
                <li>It leaves the market page. Its own /{confirm.org.slug}/ address keeps working.</li>
                <li><strong>No cups, claims or payouts are deleted.</strong></li>
              </>
            )}
          </ul>
        </TypedConfirmModal>
      )}
    </div>
  );
}

/* ── Customer copy: only what the customer app reads ───────────────── */
function CopyTab({ group, copy, setCopy, preset, saved, busy, run }) {
  const [resetting, setResetting] = useState(false);
  const changedFromDefault = copyDiff(saved, preset);
  const isByo = group.mode === 'byo';
  const id = (k) => `gc-${k}-${group.id}`;
  const set = (k) => (e) => setCopy(c => ({ ...c, [k]: e.target.value }));
  const setStep = (i, k) => (e) => setCopy(c => ({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)) }));
  const setLabel = (k) => (e) => setCopy(c => ({ ...c, labels: { ...c.labels, [k]: e.target.value } }));
  const reset = (patch) => () => setCopy(c => ({ ...c, ...patch }));

  return (
    <div className="ms-secs">
      <Callout
        tone="info"
        title={`What customers of every venue in ${group.name} read`}
        action={changedFromDefault.length > 0 && (
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => setResetting(true)}>Reset all</Button>
        )}
      >
        {changedFromDefault.length
          ? <>Changed from the {groupModeLabel(group.mode)} default: {changedFromDefault.join(', ')}.</>
          : <>This is the {groupModeLabel(group.mode)} default. Edit any text to change it for this group.</>}
        {' '}Changes here are saved with the button below.
      </Callout>

      <Sec title="Home screen">
        <Field label="Headline" htmlFor={id('hh')} hint={copy.heroHeadline !== preset.heroHeadline ? <UseDefault show onClick={reset({ heroHeadline: preset.heroHeadline })} /> : null}>
          <input id={id('hh')} className="ui-input" value={copy.heroHeadline} onChange={set('heroHeadline')} />
        </Field>
        {isByo ? (
          <p className="ms-note">Bring Your Own venues show no subtext under the headline.</p>
        ) : (
          <Field label="Subtext" htmlFor={id('hs')} hint={copy.heroSubtext !== preset.heroSubtext ? <UseDefault show onClick={reset({ heroSubtext: preset.heroSubtext })} /> : null}>
            <textarea id={id('hs')} className="ui-textarea" rows={2} value={copy.heroSubtext} onChange={set('heroSubtext')} />
          </Field>
        )}
      </Sec>

      <Sec title="Market page">
        <Field label="Intro under the logo" htmlFor={id('si')} hint={copy.storesIntro !== preset.storesIntro ? <UseDefault show onClick={reset({ storesIntro: preset.storesIntro })} /> : null}>
          <textarea id={id('si')} className="ui-textarea" rows={3} value={copy.storesIntro} onChange={set('storesIntro')} />
        </Field>
      </Sec>

      <Sec
        title="How it works"
        hint="A venue with its own guide in Design & copy shows that one instead. Venues that pay with the slider voucher show a counter step in place of the last one."
        action={<UseDefault show={JSON.stringify(copy.steps) !== JSON.stringify(preset.steps)} onClick={reset({ steps: preset.steps })} />}
      >
        <ol className="ms-steps">
          {copy.steps.map((s, i) => (
            <li key={i} className="ms-step">
              <span className="ms-step__num" aria-hidden="true">{i + 1}</span>
              <div className="ms-step__fields">
                <input className="ui-input" value={s.title} onChange={setStep(i, 'title')} aria-label={`Step ${i + 1} title`} />
                <textarea className="ui-textarea" rows={2} value={s.body} onChange={setStep(i, 'body')} aria-label={`Step ${i + 1} text`} />
              </div>
            </li>
          ))}
        </ol>
      </Sec>

      <Sec
        title="Terms"
        hint="Shown when a customer opens the cashback terms."
        action={<UseDefault
          show={copy.termsTitle !== preset.termsTitle || copy.termsIntro !== preset.termsIntro || lines(copy.termsPoints).join('\n') !== lines(preset.termsPoints).join('\n')}
          onClick={reset({ termsTitle: preset.termsTitle, termsIntro: preset.termsIntro, termsPoints: preset.termsPoints })}
        />}
      >
        <div className="ms-fields">
          <Field label="Title" htmlFor={id('tt')}><input id={id('tt')} className="ui-input" value={copy.termsTitle} onChange={set('termsTitle')} /></Field>
          <Field label="Intro" htmlFor={id('ti')}><input id={id('ti')} className="ui-input" value={copy.termsIntro} onChange={set('termsIntro')} /></Field>
        </div>
        <Field label="Rules, one per line" htmlFor={id('tp')}>
          <textarea id={id('tp')} className="ui-textarea ms-textarea--tall" rows={9} value={copy.termsPoints} onChange={set('termsPoints')} />
        </Field>
      </Sec>

      <Sec
        title="Daily limit message"
        hint="Shown when a counter QR scan goes over the day’s limit and is held for review."
        action={<UseDefault show={copy.capTitle !== preset.capTitle || copy.capBody !== preset.capBody} onClick={reset({ capTitle: preset.capTitle, capBody: preset.capBody })} />}
      >
        <Field label="Title" htmlFor={id('ct')}><input id={id('ct')} className="ui-input" value={copy.capTitle} onChange={set('capTitle')} /></Field>
        <Field label="Text" htmlFor={id('cb')}><textarea id={id('cb')} className="ui-textarea" rows={2} value={copy.capBody} onChange={set('capBody')} /></Field>
      </Sec>

      <Sec
        title="Button labels"
        hint="These replace the labels set in Design & copy for every venue in the group."
        action={<UseDefault show={LABELS.some(([k]) => copy.labels[k] !== preset.labels[k])} onClick={reset({ labels: preset.labels })} />}
      >
        <div className="ms-fields">
          {LABELS.map(([k, l]) => (
            <Field key={k} label={l} htmlFor={id(k)}>
              <input id={id(k)} className="ui-input" value={copy.labels[k]} onChange={setLabel(k)} placeholder={preset.labels[k]} />
            </Field>
          ))}
        </div>
      </Sec>

      <Modal
        open={resetting}
        onClose={() => !busy && setResetting(false)}
        title="Reset the customer copy?"
        icon={RotateCcw}
        iconTone="amber"
        footer={(
          <>
            <Button variant="outline" onClick={() => setResetting(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={async () => {
              const ok = await run(() => resetGroupCopy(group.id), `${group.name} uses the default copy again.`);
              if (ok) setResetting(false);
            }}>Reset to default</Button>
          </>
        )}
      >
        <p className="ms-modal-text">
          Every text goes back to the {groupModeLabel(group.mode)} default straight away. Changed now: {changedFromDefault.join(', ')}.
        </p>
      </Modal>
    </div>
  );
}

function UseDefault({ show, onClick }) {
  if (!show) return null;
  return (
    <button type="button" className="ms-link ms-link--reset" onClick={onClick}>
      <RotateCcw size={11} aria-hidden="true" />Use default
    </button>
  );
}

/* ── Numbers: the group at a glance ───────────────────────────────── */
function NumbersTab({ stats, orgs, members }) {
  if (stats === undefined) return <p className="ms-hint">Loading numbers…</p>;
  if (!stats) return <p className="ms-hint">The numbers could not be loaded.</p>;
  const countryOf = Object.fromEntries((orgs || []).map(o => [o.id, o.country]));
  const regionOf = (id) => regionForCountry(countryOf[id])?.key;
  const keys = [...new Set(members.map(m => regionOf(m.id)).filter(Boolean))];
  const t = stats.totals || {};
  const tiles = [
    ['Venues', t.stores ?? 0],
    ['Customers', t.users ?? 0, 'People, counted once across the group.'],
    ['Cups in balances', t.cups ?? 0],
    ['Cups collected', t.lifetime ?? 0, 'Since each venue started.'],
    ['Claims', t.claims ?? 0],
    ['Paid out', keys.length > 1 ? 'Mixed currencies' : formatMoney(t.payout || 0, keys[0]), 'Completed claims.'],
  ];
  return (
    <div className="ms-secs">
      <div className="ms-stats">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="ms-stat">
            <p className="ui-mini-stat__label">{label}</p>
            <p className={`ui-mini-stat__value${typeof value === 'string' && !/\d/.test(value) ? ' ms-stat__word' : ''}`}>{value}</p>
            {sub && <p className="ui-mini-stat__sub">{sub}</p>}
          </div>
        ))}
      </div>
      {(stats.perStore || []).length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr><th>Venue</th><th className="ui-num">Customers</th><th className="ui-num">Cups now</th><th className="ui-num">Collected</th><th className="ui-num">Claims</th><th className="ui-num">Paid out</th></tr>
            </thead>
            <tbody>
              {stats.perStore.map(s => (
                <tr key={s.orgId}>
                  <td>{s.name}</td>
                  <td className="ui-num">{s.users}</td>
                  <td className="ui-num">{s.cups}</td>
                  <td className="ui-num">{s.lifetime}</td>
                  <td className="ui-num">{s.claims}</td>
                  <td className="ui-num">{formatMoney(s.payout || 0, regionOf(s.orgId))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
