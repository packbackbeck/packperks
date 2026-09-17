import { useRef, useState } from 'react';
import {
  Archive, Building2, Copy, ExternalLink, Gift, Globe2, ImageUp, Landmark, Layers, Link2, Palette,
  Power, Settings, Store,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { OrgAvatar } from '../context/OrgSwitcher';
import {
  createOrgGroup, setOrgGroupMembership, setOrgGroupMode, setOrgMode, updateOrg, uploadRewardImage,
} from '../lib/adminApi';
import { formatMoney, getAllRegions, regionForCountry } from '../../lib/regions';
import { logAction } from '../auth/actionLog';
import { Badge, Button, Field } from '../ui';
import TypedConfirmModal from '../shared/TypedConfirmModal';
import Drawer from './Drawer';
import { Callout, ChoiceCard, DiscardModal, ModeChip, SaveFooter, Sec } from './OrgBits';
import {
  MODE_BLURB, MODE_GLYPH, modeLabel, payoutPromise, plural, providerInfo, rememberReopen, slugOk,
} from './orgShared';

/* Every column this editor saves, with the name a person reads. The team
 * email domain is not here: nothing reads organizations.email_domain_hint,
 * so it is left as it is. */
const PROFILE_FIELDS = [
  ['name', 'Name'],
  ['slug', 'Customer app address'],
  ['partner_brand_name', 'Brand shown to customers'],
  ['logo_url', 'Logo'],
  ['logo_width', 'Logo width'],
  ['brand_color', 'Brand colour'],
  ['country', 'Region'],
];
const COMPANY_FIELDS = [
  ['legal_name', 'Legal name'],
  ['kvk_number', 'KvK number'],
  ['btw_number', 'BTW number'],
  ['address', 'Street and number'],
  ['postal_code', 'Postal code'],
  ['city', 'City'],
  ['contact_email', 'Contact email'],
  ['contact_phone', 'Contact phone'],
  ['website', 'Website'],
];
const ALL_FIELDS = [...PROFILE_FIELDS, ...COMPANY_FIELDS];
const DEFAULT_COLOR = '#5B3FD6';

const text = (v) => (v == null ? '' : String(v));
const fromSource = (o) => Object.fromEntries(ALL_FIELDS.map(([k]) => [k, o[k] ?? '']));
const changedIn = (fields, draft, source) => fields.filter(([k]) => text(draft[k]) !== text(source[k])).map(([, l]) => l);

export default function OrgEditor({
  org: source, mode, group, isActive, liveCount, initialTab = 'profile', busy,
  onClose, onSaved, onDuplicate, onArchive, onNavigate, pinSection, draftState,
}) {
  const ctx = useOrg();
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState(() => fromSource(source));
  const [stamp, setStamp] = useState(source.updated_at || '');
  if ((source.updated_at || '') !== stamp) {
    setStamp(source.updated_at || '');
    setDraft(fromSource(source));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const profileChanges = changedIn(PROFILE_FIELDS, draft, source);
  const companyChanges = changedIn(COMPANY_FIELDS, draft, source);
  const changes = [...profileChanges, ...companyChanges];

  const set = (k) => (e) => { setDraft(d => ({ ...d, [k]: e.target.value })); setSavedNote(null); };
  const put = (patch) => { setDraft(d => ({ ...d, ...patch })); setSavedNote(null); };

  function requestClose() {
    if (changes.length) setAskDiscard(true);
    else onClose();
  }

  async function save() {
    if (!draft.name.trim()) { setTab('profile'); setError('Give the organisation a name.'); return; }
    if (!slugOk(draft.slug)) { setTab('profile'); setError('The address can use lowercase letters, numbers and dashes.'); return; }
    setSaving(true);
    setError(null);
    try {
      const clean = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);
      const patch = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        partner_brand_name: clean(draft.partner_brand_name),
        logo_url: clean(draft.logo_url),
        logo_width: draft.logo_width === '' || draft.logo_width == null ? null : Number(draft.logo_width),
        brand_color: draft.brand_color || DEFAULT_COLOR,
        country: clean(draft.country),
        legal_name: clean(draft.legal_name),
        kvk_number: clean(draft.kvk_number),
        btw_number: clean(draft.btw_number),
        address: clean(draft.address),
        postal_code: clean(draft.postal_code),
        city: clean(draft.city),
        contact_email: clean(draft.contact_email),
        contact_phone: clean(draft.contact_phone),
        website: clean(draft.website),
      };
      const updated = await updateOrg(source.id, patch);
      logAction({ action: 'org.update', targetType: 'organization', targetId: source.id, before: source, after: updated });
      setSavedNote(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      await onSaved(`${updated.name} saved.`);
    } catch (e) {
      setError(/duplicate key|unique/i.test(e?.message || '') ? 'Another organisation already uses that address.' : (e?.message || 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: Palette, count: profileChanges.length || undefined },
    { id: 'company', label: 'Company', icon: Landmark, count: companyChanges.length || undefined },
    { id: 'programme', label: 'Programme', icon: Gift },
    { id: 'status', label: 'Status', icon: Power },
  ];
  const region = regionForCountry(source.country);
  const immediate = tab === 'programme' || tab === 'status';

  return (
    <>
      <Drawer
        open
        onClose={requestClose}
        label={`Edit ${source.name}`}
        lead={<OrgAvatar org={{ ...source, logo_url: draft.logo_url, brand_color: draft.brand_color, name: draft.name || source.name }} size={44} />}
        title={source.name}
        subtitle={<span className="ms-mono">/{source.slug}/</span>}
        badges={(
          <>
            <ModeChip mode={mode} />
            {group && <span className="ms-chip" title="The group this venue is in"><Layers size={11} aria-hidden="true" />Group: {group.name}</span>}
            <span className="ms-chip"><Globe2 size={11} aria-hidden="true" />{region ? `${region.label} · ${region.currency}` : 'No region'}</span>
            {isActive && <Badge tone="primary">Open now</Badge>}
          </>
        )}
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        footer={(
          <SaveFooter
            changes={changes}
            saving={saving}
            error={error}
            onDiscard={() => { setDraft(fromSource(source)); setError(null); }}
            onSave={save}
            cleanText={savedNote || (immediate
              ? 'Changes on this tab apply when you confirm them.'
              : 'Everything is saved.')}
          />
        )}
      >
        {tab === 'profile' && <ProfileTab source={source} draft={draft} set={set} put={put} onError={setError} />}
        {tab === 'company' && <CompanyTab source={source} draft={draft} set={set} />}
        {tab === 'programme' && (
          <ProgrammeTab
            source={source}
            mode={mode}
            group={group}
            isActive={isActive}
            dirty={changes.length > 0}
            ctx={ctx}
            draftState={draftState}
            onSaved={onSaved}
            onOpenOrg={() => { rememberReopen(source.id, 'programme'); pinSection?.(); ctx.switchOrg(source.id); }}
          />
        )}
        {tab === 'status' && (
          <StatusTab
            source={source}
            isActive={isActive}
            dirty={changes.length > 0}
            liveCount={liveCount}
            busy={busy}
            onOpenOrg={() => { pinSection?.(); ctx.switchOrg(source.id); }}
            onSettings={() => { if (!isActive) ctx.switchOrg(source.id); onNavigate?.('settings'); }}
            onDuplicate={onDuplicate}
            onArchive={onArchive}
          />
        )}
      </Drawer>
      <DiscardModal open={askDiscard} onKeep={() => setAskDiscard(false)} onDiscard={() => { setAskDiscard(false); onClose(); }} />
    </>
  );
}

/* ── Profile: branding, address, region ───────────────────────────── */
function ProfileTab({ source, draft, set, put, onError }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const id = (k) => `org-${k}-${source.id}`;

  async function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      const url = await uploadRewardImage(file);
      if (!url) throw new Error('The logo could not be uploaded.');
      put({ logo_url: url });
    } catch (ex) {
      onError(ex?.message || 'The logo could not be uploaded.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const regions = getAllRegions();
  const picked = regionForCountry(draft.country);
  const current = regionForCountry(source.country);
  const moved = (picked?.key || null) !== (current?.key || null);
  const provider = picked ? providerInfo(picked.provider) : null;
  const slugChanged = text(draft.slug).trim() !== text(source.slug);

  return (
    <div className="ms-secs">
      <Sec title="Branding" icon={Palette} when="save" hint="How the venue looks in the customer app and in this dashboard.">
        <div className="ms-logo">
          <OrgAvatar org={{ ...source, logo_url: draft.logo_url, brand_color: draft.brand_color, name: draft.name || source.name }} size={64} />
          <div className="ms-logo__controls">
            <div className="ms-logo__buttons">
              <Button size="sm" icon={ImageUp} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : draft.logo_url ? 'Replace logo' : 'Upload logo'}
              </Button>
              {draft.logo_url && <Button size="sm" variant="ghost" onClick={() => put({ logo_url: '' })}>Remove logo</Button>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
            <div className={`ms-logo__width${draft.logo_width ? '' : ' ms-logo__width--auto'}`}>
              <label htmlFor={id('logow')}>Width in the app header</label>
              <input id={id('logow')} type="range" min="40" max="200" step="2" value={draft.logo_width || 88}
                onChange={e => put({ logo_width: Number(e.target.value) })} />
              <span className="ms-mono">{draft.logo_width ? `${draft.logo_width}px` : 'Auto'}</span>
              {draft.logo_width !== '' && draft.logo_width != null && (
                <button type="button" className="ms-link" onClick={() => put({ logo_width: '' })}>Use auto</button>
              )}
            </div>
          </div>
        </div>
        <div className="ms-fields">
          <Field label="Name" htmlFor={id('name')} hint="How the venue is listed in the dashboard and on the market page.">
            <input id={id('name')} className="ui-input" value={draft.name} onChange={set('name')} />
          </Field>
          <Field label="Brand shown to customers" htmlFor={id('partner')} hint="Used in customer copy and emails. Empty uses the name.">
            <input id={id('partner')} className="ui-input" value={draft.partner_brand_name} onChange={set('partner_brand_name')} placeholder={draft.name} />
          </Field>
          <Field label="Brand colour" htmlFor={id('color')} hint="Used when there is no logo.">
            <div className="ms-color">
              <input id={id('color')} type="color" value={draft.brand_color || DEFAULT_COLOR} onChange={set('brand_color')} aria-label="Pick a brand colour" />
              <input className="ui-input ms-color__hex" value={draft.brand_color} onChange={set('brand_color')} placeholder={DEFAULT_COLOR} aria-label="Brand colour hex code" />
            </div>
          </Field>
        </div>
      </Sec>

      <Sec title="Customer app address" icon={Link2} when="save">
        <Field label="Address" htmlFor={id('slug')}>
          <div className="ms-prefix">
            <span className="ms-prefix__text">perks.packback.network/</span>
            <input id={id('slug')} className="ui-input" value={draft.slug} onChange={set('slug')} />
          </div>
        </Field>
        {slugChanged ? (
          <Callout tone="warn" title="Printed QR codes and saved links use the old address">
            They stop working when you save. Only change it before anything is printed.
          </Callout>
        ) : (
          <a className="ms-extlink" href={`/${source.slug}/`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden="true" />Open the customer app
          </a>
        )}
      </Sec>

      <Sec title="Region" icon={Globe2} when="save" hint="The region sets the currency, the payout provider and what customers are promised when they claim.">
        <Field label="Region" htmlFor={id('region')}>
          <select id={id('region')} className="ui-select" value={picked?.key || ''}
            onChange={e => { const r = regions.find(x => x.key === e.target.value); if (r) put({ country: r.label }); }}>
            {!picked && <option value="" disabled>{draft.country ? `Not recognised: ${draft.country}` : 'Pick a region'}</option>}
            {regions.map(r => (
              <option key={r.key} value={r.key}>{r.flag ? `${r.flag} ` : ''}{r.label} · {r.currency}</option>
            ))}
          </select>
        </Field>
        {picked && (
          <dl className="ms-facts">
            <div><dt>Money shows as</dt><dd>{formatMoney(4.8, picked.key)}</dd></div>
            <div>
              <dt>Payouts</dt>
              <dd>{provider.label} <Badge tone={provider.live ? 'success' : 'warning'}>{provider.live ? 'Live' : 'Not live'}</Badge></dd>
            </div>
            <div><dt>Customers are told</dt><dd>“Once your receipt is approved, {payoutPromise(picked.payoutStyle, picked.payoutNoun)}.”</dd></div>
          </dl>
        )}
        {moved && picked && (
          <Callout tone="warn" title={`Saving moves ${source.name} to ${picked.label}`}>
            From then on its customer app and this dashboard show money in {picked.currency}
            {provider.live ? `, and payouts go through ${provider.label}.` : '. This region has no live payout provider, so approved claims can’t be paid out automatically.'}
          </Callout>
        )}
      </Sec>
    </div>
  );
}

/* ── Company: legal and contact details ───────────────────────────── */
function CompanyTab({ source, draft, set }) {
  const id = (k) => `org-${k}-${source.id}`;
  const input = (k, props = {}) => <input id={id(k)} className="ui-input" value={draft[k]} onChange={set(k)} {...props} />;
  return (
    <div className="ms-secs">
      <Sec title="Company" icon={Building2} when="save" hint="For PackBack’s records and invoices. Customers don’t see these.">
        <div className="ms-fields">
          <div className="ms-span-2">
            <Field label="Legal name" htmlFor={id('legal_name')}>{input('legal_name')}</Field>
          </div>
          <Field label="KvK number" htmlFor={id('kvk_number')}>{input('kvk_number')}</Field>
          <Field label="BTW number" htmlFor={id('btw_number')}>{input('btw_number', { placeholder: 'NL000000000B01' })}</Field>
          <div className="ms-span-2">
            <Field label="Street and number" htmlFor={id('address')}>{input('address')}</Field>
          </div>
          <Field label="Postal code" htmlFor={id('postal_code')}>{input('postal_code')}</Field>
          <Field label="City" htmlFor={id('city')}>{input('city')}</Field>
        </div>
      </Sec>
      <Sec title="Contact" icon={Store} when="save" hint="Who PackBack talks to at this venue.">
        <div className="ms-fields">
          <Field label="Email" htmlFor={id('contact_email')}>{input('contact_email', { type: 'email' })}</Field>
          <Field label="Phone" htmlFor={id('contact_phone')}>{input('contact_phone', { type: 'tel' })}</Field>
          <div className="ms-span-2">
            <Field label="Website" htmlFor={id('website')}>{input('website', { type: 'url', placeholder: 'https://' })}</Field>
          </div>
        </div>
      </Sec>
    </div>
  );
}

/* ── Programme: which app the venue runs ──────────────────────────── */
function ProgrammeTab({ source, mode, group, isActive, dirty, ctx, draftState, onSaved, onOpenOrg }) {
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const members = group?.members?.filter(m => !m.deleted_at) || [];
  const others = Math.max(0, members.length - 1);

  /* deposit and byo belong to the group; tikkie_only to the venue itself. */
  async function changeMode(next) {
    if (!isActive || busy) return;
    setBusy(true);
    setError(null);
    try {
      const orgId = source.id;
      const groupId = source.group_id || null;
      if (next === 'byo') {
        await setOrgMode(orgId, null);
        if (groupId) await setOrgGroupMode(groupId, 'byo');
        else {
          const grp = await createOrgGroup({ name: source.name || 'New group', mode: 'byo' });
          await setOrgGroupMembership(orgId, grp.id);
        }
      } else if (next === 'tikkie_only') {
        if (groupId) await setOrgGroupMembership(orgId, null);
        await setOrgMode(orgId, 'tikkie_only');
      } else {
        await setOrgMode(orgId, null);
        if (groupId) await setOrgGroupMode(groupId, 'deposit');
      }
      // Publishing sends the whole draft, so the draft must know the mode too.
      draftState?.updateDraft?.(d => {
        const settings = { ...d.settings };
        if (next === 'tikkie_only') settings.mode = 'tikkie_only'; else delete settings.mode;
        return { ...d, settings };
      });
      logAction({ action: 'org.mode', targetType: 'organization', targetId: orgId, before: { mode }, after: { mode: next } });
      try { window.dispatchEvent(new Event('pp-org-mode-changed')); } catch { /* ignore */ }
      await ctx.refresh?.(orgId);
      await onSaved(`${source.name} now runs ${modeLabel(next)}.`);
    } catch (e) {
      setError(e?.message || 'Could not change the programme.');
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  return (
    <div className="ms-secs">
      <Sec
        title="Programme"
        icon={Gift}
        when="now"
        hint="Decides which customer app the venue runs and which dashboard tabs it has."
      >
        {!isActive && (
          <Callout
            tone="info"
            title={`Open ${source.name} to change its programme`}
            action={<Button size="sm" onClick={onOpenOrg} disabled={dirty}>Open {source.name}</Button>}
          >
            Its settings draft changes with the programme, and only the open organisation’s draft is loaded.
            {dirty && ' Save or discard your changes first.'}
          </Callout>
        )}
        {error && <p className="ms-error" role="alert">{error}</p>}
        <div className="ms-choices" role="radiogroup" aria-label="Programme">
          {['standard', 'byo', 'tikkie_only'].map(m => (
            <ChoiceCard
              key={m}
              on={mode === m}
              tag="Now"
              disabled={!isActive || busy}
              icon={MODE_GLYPH[m]}
              tone={m}
              label={modeLabel(m)}
              blurb={MODE_BLURB[m]}
              onClick={() => { if (mode !== m) setTarget(m); }}
            >
              <span className="ms-choice__meta">
                {m === 'standard' && 'Can stand alone or be in a group.'}
                {m === 'byo' && (group ? 'Set on the group.' : 'Needs a group: one is created for this venue.')}
                {m === 'tikkie_only' && (group ? 'Takes the venue out of its group.' : 'Never in a group.')}
              </span>
            </ChoiceCard>
          ))}
        </div>
        {group && (
          <p className="ms-note">
            In the <b>{group.name}</b> group{others ? ` with ${plural(others, 'other venue')}` : ''}.
            Deposit Rewards and Bring Your Own are set on the group, so switching between them changes
            every venue in it.
          </p>
        )}
      </Sec>

      {target && (
        <TypedConfirmModal
          title={`Switch ${source.name} to ${modeLabel(target)}?`}
          intro="The customer app changes as soon as you confirm. Nothing is deleted."
          word="switch"
          confirmLabel={`Switch to ${modeLabel(target)}`}
          busy={busy}
          onCancel={() => setTarget(null)}
          onConfirm={() => changeMode(target)}
        >
          <ul className="tcm-list">
            <li>Cups, balances, claims and payouts are <strong>kept</strong>.</li>
            {group && target !== 'tikkie_only' && (
              <li className="tcm-bad">
                This changes the whole <strong>{group.name}</strong> group{members.length > 1 ? `: ${plural(members.length, 'venue')}` : ''}.
                Its customer copy goes back to the {modeLabel(target)} default.
              </li>
            )}
            {target === 'byo' && !group && (
              <li className="tcm-bad">Bring Your Own needs a group, so the venue is <strong>put in a new group of its own</strong>.</li>
            )}
            {target === 'tikkie_only' && (
              <li className="tcm-bad">The customer app stops showing rewards: bin receipts fill the Tikkie wallet instead.{group ? ' The venue leaves its group.' : ''}</li>
            )}
            {mode === 'tikkie_only' && (
              <li className="tcm-bad">Bin receipts stop paying out through Tikkie, <strong>including receipts already printed</strong>.</li>
            )}
            {mode === 'byo' && (
              <li className="tcm-bad">Counter QR codes stop giving cups: <strong>printed counter QR codes stop working</strong>.</li>
            )}
            <li>Features such as direct refunds stay as they are. Check them in Settings afterwards.</li>
          </ul>
        </TypedConfirmModal>
      )}
    </div>
  );
}

/* ── Status: where it runs, copy it, archive it ───────────────────── */
function StatusTab({ source, isActive, dirty, liveCount, busy, onOpenOrg, onSettings, onDuplicate, onArchive }) {
  return (
    <div className="ms-secs">
      <Sec title="Live" icon={Power} hint="The venue is in the organisation switcher and its customer app is open.">
        <ul className="ms-linkrows">
          <li>
            <span><b>Customer app</b><span className="ms-mono">/{source.slug}/</span></span>
            <Button size="sm" icon={ExternalLink} onClick={() => window.open(`/${source.slug}/`, '_blank', 'noopener')}>Open</Button>
          </li>
          <li>
            <span><b>Dashboard</b>{isActive ? 'You are working in this organisation.' : 'Switch the dashboard to this organisation.'}</span>
            {isActive
              ? <Badge tone="primary">Open now</Badge>
              : <Button size="sm" onClick={onOpenOrg} disabled={dirty} title={dirty ? 'Save or discard your changes first.' : undefined}>Open</Button>}
          </li>
          <li>
            <span><b>Settings</b>Rates, features, payouts and locations.</span>
            <Button size="sm" icon={Settings} onClick={onSettings} disabled={dirty} title={dirty ? 'Save or discard your changes first.' : undefined}>Open settings</Button>
          </li>
        </ul>
      </Sec>
      <Sec
        title="Duplicate"
        icon={Copy}
        when="now"
        hint="Makes a new organisation with this one’s profile, settings, rewards and locations. Customers, scans and claims start empty."
        action={<Button size="sm" icon={Copy} disabled={busy} onClick={onDuplicate}>Duplicate</Button>}
      />
      <Sec
        title="Archive"
        icon={Archive}
        danger
        hint={liveCount <= 1
          ? 'The last live organisation can’t be archived.'
          : 'Hides the venue from the switcher and closes its customer app. Customers, claims and history are kept, and you can restore it.'}
        action={<Button size="sm" variant="danger-ghost" icon={Archive} disabled={liveCount <= 1 || busy} onClick={onArchive}>Archive</Button>}
      />
    </div>
  );
}
