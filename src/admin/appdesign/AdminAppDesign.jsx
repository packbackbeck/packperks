import { useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Ellipsis, ExternalLink, Eye, LockOpen, Palette, RotateCcw, Send, TriangleAlert,
} from 'lucide-react';
import {
  Badge, Button, Card, CardBody, Menu, MenuItem, Modal, PageHeader, Segmented, Tabs, ToggleChip,
} from '../ui';
import { supabase } from '../../lib/supabase';
import { composeGroupCopy } from '../../lib/groups';
import { resolvePaymentMethod, voucherGuideSteps } from '../../lib/paymentMethods';
import { effectiveRates } from '../../lib/rates';
import { formatMoney, getRegion } from '../../lib/regions';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { logAction } from '../auth/actionLog';
import { useAdminMoney } from '../lib/adminMoney';
import { DEFAULT_DESIGN, mergeDesign } from './designDefaults';
import { BUILT_IN_GUIDE, COLOR_KEYS, SCREENS, TABS, featureOn, resolveGuideStep } from './designModel';
import { toHex } from './colorUtils';
import { Callout } from './DesignFields';
import ColoursPanel from './ColoursPanel';
import CopyPanel from './CopyPanel';
import SectionsPanel from './SectionsPanel';
import GuidePanel from './GuidePanel';
import PhonePreview from './PhonePreview';
import './AdminAppDesign.css';

/* ─────────────────────────────────────────────────────────────────────
 * Design & copy — how one organisation's customer app looks and reads.
 *
 *   ┌ header ─────────────────────── status · ⋯ · Revert · Publish ┐
 *   │ Colours │ Copy │ Sections │ Guide          ┌ preview ────────┐ │
 *   │ cards for the chosen tab                   │ Home/Account/…  │ │
 *   │                                            │  [ phone ]      │ │
 *   └────────────────────────────────────────────┴─────────────────┘
 *
 * Data: everything edits the org's draft through draftState.updateDraft
 * (org-keyed, autosaved locally): settings.design.{colors, copy, sections,
 * guide} plus the top-level heroHeadline, heroSubtext, donationRecipient
 * and donationDescription. Publish calls draftState.publishDraft, which
 * puts the WHOLE draft live (rewards and settings too), so the confirm
 * dialog says what else is waiting. Revert puts this page's settings back
 * to what is published and leaves the rest of the draft alone.
 * ───────────────────────────────────────────────────────────────────── */

const TAB_STORAGE_KEY = 'pp_admin_appdesign_tab';
/* The tabs that apply to a Deferred Tikkie venue. */
const TIKKIE_TABS = ['colors', 'sections'];
const COPY_KEYS = ['heroHeadline', 'heroSubtext', 'donationRecipient', 'donationDescription'];
const NO_SETTINGS = {};
const SAMPLE_REWARD = { id: 'sample', name: 'Your featured reward', cupsNeeded: 5, tags: [], image: '' };

function readStoredTab() {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    return TABS.some(t => t.id === stored) ? stored : 'colors';
  } catch { return 'colors'; }
}

/* The group's published config, for venues in a group (their home and
 * account copy, guide and payment method come from it). */
function useGroupConfig(groupId) {
  const [loaded, setLoaded] = useState({ id: null, config: null });
  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    supabase.from('app_config').select('value').eq('key', `published:group:${groupId}`).maybeSingle()
      .then(({ data }) => { if (alive) setLoaded({ id: groupId, config: data?.value || null }); })
      .catch(() => { if (alive) setLoaded({ id: groupId, config: null }); });
    return () => { alive = false; };
  }, [groupId]);
  return loaded.id === groupId ? loaded.config : null;
}

/* The logo width a venue set for the app header. OrgContext doesn't load
 * this column, so the preview reads it here. */
function useLogoWidth(orgId) {
  const [loaded, setLoaded] = useState({ id: null, width: null });
  useEffect(() => {
    if (!orgId) return undefined;
    let alive = true;
    supabase.from('organizations').select('logo_width').eq('id', orgId).maybeSingle()
      .then(({ data }) => { if (alive) setLoaded({ id: orgId, width: data?.logo_width ?? null }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [orgId]);
  return loaded.id === orgId ? loaded.width : null;
}

export default function AdminAppDesign({ draftState }) {
  const { activeOrg, activeGroupId, activeGroup, activeGroupMode, activeOrgMode } = useOrg();
  // Deferred Tikkie has no rewards, copy blocks or guide: only its colours
  // and the two logos in the header apply there.
  const tikkieMode = activeOrgMode === 'tikkie_only';
  const { access } = useViewRole();
  const readOnly = !!access && !access.canEdit('appdesign');
  const isMaster = !!access?.isMaster;
  const { region } = useAdminMoney();
  const money = useMemo(() => (n) => formatMoney(n, region), [region]);

  const [tab, setTabState] = useState(readStoredTab);
  const [screen, setScreen] = useState(() => (readStoredTab() === 'guide' ? 'guide' : 'home'));
  const [guideIndex, setGuideIndex] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [dialog, setDialog] = useState(null); // 'publish' | 'revert' | 'reset'
  const [justPublished, setJustPublished] = useState(false);

  function setTab(next) {
    setTabState(next);
    if (next === 'guide') setScreen('guide');
    else if (screen === 'guide') setScreen('home');
    try { localStorage.setItem(TAB_STORAGE_KEY, next); } catch { /* private mode */ }
  }

  const draft = draftState?.draft;
  const publishedDraft = draftState?.published;
  const settings = draft?.settings || NO_SETTINGS;
  const rewards = draft?.rewards;
  const published = publishedDraft?.settings || null;
  const design = useMemo(() => mergeDesign(settings.design), [settings.design]);

  const groupConfig = useGroupConfig(activeGroupId);
  const logoWidth = useLogoWidth(activeOrg?.id);
  const previewOrg = useMemo(
    () => (activeOrg && logoWidth ? { ...activeOrg, logo_width: logoWidth } : activeOrg),
    [activeOrg, logoWidth],
  );
  const groupCopy = useMemo(() => (activeGroupId
    ? composeGroupCopy({ mode: groupConfig?.settings?.mode ?? activeGroupMode, groupConfig })
    : null), [activeGroupId, activeGroupMode, groupConfig]);
  const isVoucher = resolvePaymentMethod(settings.paymentMethod, groupConfig?.settings?.paymentMethod) === 'voucher';
  const isTikkie = getRegion(region)?.payoutNoun === 'Tikkie link';

  const view = useMemo(() => buildPreviewView({
    design, settings, org: previewOrg, rewards, groupCopy, isVoucher, isTikkie, money, unlocked,
  }), [design, settings, previewOrg, rewards, groupCopy, isVoucher, isTikkie, money, unlocked]);
  const stepCount = view.guideSteps.length;
  const shownStep = Math.min(guideIndex, stepCount - 1);
  const customSteps = design.guide.steps;

  const changes = useMemo(() => countChanges(settings, published), [settings, published]);
  const otherChanges = useMemo(() => hasOtherChanges(draft, publishedDraft), [draft, publishedDraft]);

  /* ── Draft writers ───────────────────────────────────────────────── */
  function patchDesign(group, patch) {
    draftState.updateDraft(prev => {
      const merged = mergeDesign(prev.settings?.design);
      return {
        ...prev,
        settings: { ...prev.settings, design: { ...merged, [group]: { ...merged[group], ...patch } } },
      };
    });
    setJustPublished(false);
  }

  function patchSetting(key, value) {
    draftState.updateDraft(prev => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
    setJustPublished(false);
  }

  function replaceColors(nextColors) {
    patchDesign('colors', nextColors);
  }

  function reveal(next) {
    if (next) setScreen(next);
  }

  function showGuideStep(i) {
    setScreen('guide');
    setGuideIndex(Math.max(0, i));
  }

  /* ── Publish / revert / reset ────────────────────────────────────── */
  function handlePublish() {
    // publishDraft stores the snapshot locally and pushes the whole draft to
    // app_config `published:<orgId>`; the customer app reads it on next load.
    draftState.publishDraft('Design & copy update');
    logAction({
      action: 'design.publish',
      targetType: 'organization',
      targetId: activeOrg?.id,
      after: { design },
    });
    setDialog(null);
    setJustPublished(true);
    setTimeout(() => setJustPublished(false), 4000);
  }

  function handleRevert() {
    const base = published;
    draftState.updateDraft(prev => {
      if (!base) {
        // Nothing published yet: the design goes back to the defaults.
        return { ...prev, settings: { ...prev.settings, design: structuredClone(DEFAULT_DESIGN) } };
      }
      const restoredCopy = Object.fromEntries(COPY_KEYS.filter(k => k in base).map(k => [k, base[k]]));
      return {
        ...prev,
        settings: { ...prev.settings, ...restoredCopy, design: mergeDesign(base.design) },
      };
    });
    setDialog(null);
  }

  function handleResetAll() {
    draftState.updateDraft(prev => ({
      ...prev,
      settings: { ...prev.settings, design: structuredClone(DEFAULT_DESIGN) },
    }));
    setDialog(null);
  }

  const orgName = activeOrg?.name || 'this organisation';
  const status = !published
    ? { tone: 'warning', label: 'Not published yet' }
    : changes.total > 0
      ? { tone: 'warning', label: `${changes.total} unpublished change${changes.total !== 1 ? 's' : ''}` }
      : { tone: 'success', label: justPublished ? 'Published just now' : 'Published', icon: Check };
  const tabs = TABS
    .filter(t => !tikkieMode || TIKKIE_TABS.includes(t.id))
    .map(t => (t.id === 'guide' && customSteps.length ? { ...t, count: customSteps.length } : t));
  const shownTab = tikkieMode && !TIKKIE_TABS.includes(tab) ? 'colors' : tab;

  return (
    <div className="ui-page dz-page">
      <PageHeader
        title="Design & copy"
        subtitle={`How the customer app looks and reads for ${orgName}. Edits save to your draft as you make them; publishing puts them live.`}
      >
        {readOnly ? (
          <Badge tone="neutral" icon={Eye}>View only</Badge>
        ) : (
          <>
            <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
            <Menu
              trigger={({ toggle, open, id }) => (
                <Button variant="ghost" icon={Ellipsis} aria-label="More actions" aria-expanded={open} aria-controls={id} onClick={toggle} />
              )}
            >
              <MenuItem icon={RotateCcw} danger onClick={() => setDialog('reset')}>Reset design to defaults…</MenuItem>
            </Menu>
            <Button icon={RotateCcw} disabled={!published || changes.total === 0} onClick={() => setDialog('revert')}>
              Revert
            </Button>
            <Button variant="primary" icon={Send} onClick={() => setDialog('publish')} title="Puts your whole draft live, including changes made on other pages">
              Publish draft
            </Button>
          </>
        )}
      </PageHeader>

      {draftState?.publishError && !readOnly && (
        <Callout tone="danger" icon={TriangleAlert} title="Publishing didn’t go through">
          {draftState.publishError}
        </Callout>
      )}

      <div className="dz-layout">
        <div className="dz-controls">
          {readOnly && (
            <Callout tone="info" icon={Eye} title="You can look, but not change">
              Your role can see this organisation’s design but can’t edit it. Ask a manager or PackBack for edit access.
            </Callout>
          )}

          <div className="dz-tabs">
            <Tabs tabs={tabs} value={shownTab} onChange={setTab} ariaLabel="Design sections" />
          </div>

          <fieldset className="dz-pane" disabled={readOnly} key={shownTab}>
            <legend className="dz-sr">{TABS.find(t => t.id === shownTab)?.label}</legend>
            {shownTab === 'colors' && tikkieMode && (
              <Callout tone="info" icon={Palette} title="In the Deferred Tikkie app">
                Progress and add button colours the wallet tile; Reward card colours the Collect button; Buttons and
                header colours the add and account buttons. Page, text and success colours work as described below.
              </Callout>
            )}
            {shownTab === 'colors' && (
              <ColoursPanel
                colors={design.colors}
                org={activeOrg}
                readOnly={readOnly}
                onPatch={(p) => patchDesign('colors', p)}
                onReplace={replaceColors}
              />
            )}
            {shownTab === 'copy' && (
              <CopyPanel
                design={design}
                settings={settings}
                groupCopy={groupCopy}
                groupName={activeGroup?.name}
                isMaster={isMaster}
                readOnly={readOnly}
                onDesignCopy={(key, value) => patchDesign('copy', { [key]: value })}
                onSetting={patchSetting}
                onReveal={reveal}
              />
            )}
            {shownTab === 'sections' && (
              <SectionsPanel
                only={tikkieMode ? ['showPackbackLogo', 'showBrandLogo'] : null}
                sections={design.sections}
                settings={settings}
                readOnly={readOnly}
                onPatch={(p) => patchDesign('sections', p)}
                onReveal={reveal}
              />
            )}
            {shownTab === 'guide' && (
              <GuidePanel
                steps={customSteps}
                builtIn={view.builtInGuide}
                builtInFrom={view.guideFromGroup ? activeGroup?.name || 'venue’s' : null}
                isVoucher={isVoucher}
                activeIndex={shownStep}
                readOnly={readOnly}
                onChange={(steps) => patchDesign('guide', { steps })}
                onActivate={showGuideStep}
              />
            )}
          </fieldset>
        </div>

        {tikkieMode ? (
        <aside className="dz-preview" aria-label="Preview">
          <Card className="dz-preview__card">
            <CardBody>
              <div className="dz-tk-preview">
                <h3 className="dz-tk-preview__title">Deferred Tikkie app</h3>
                <p className="dz-tk-preview__text">
                  The preview here shows the rewards app, which this venue doesn’t run. Publish your colours and
                  logos, then open the app to see them on the wallet screen.
                </p>
                <div className="dz-tk-preview__swatches" aria-hidden="true">
                  {['accent', 'accentDeep', 'primary', 'background'].map(k => (
                    <span key={k} style={{ background: design.colors[k] }} />
                  ))}
                </div>
                {activeOrg?.slug && (
                  <a className="ui-btn ui-btn--outline" href={`/${activeOrg.slug}/`} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden="true" /> Open the app
                  </a>
                )}
              </div>
            </CardBody>
          </Card>
        </aside>
        ) : (
        <aside className="dz-preview" aria-label="Preview">
          <Card className="dz-preview__card">
            <div className="dz-preview__bar">
              <Segmented options={SCREENS} value={screen} onChange={setScreen} ariaLabel="Screen to preview" />
              {activeOrg?.slug && (
                <a
                  className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon"
                  href={`/${activeOrg.slug}/`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the live app in a new tab. It shows what is published, not your draft."
                  aria-label="Open the live app"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </div>
            <div className="dz-preview__stage">
              <PhonePreview screen={screen} view={view} guideIndex={shownStep} onGuideIndex={setGuideIndex} />
            </div>
            <div className="dz-preview__foot">
              {screen === 'home' && (
                <div className="dz-preview__row">
                  <span className="dz-preview__note">
                    Your draft, with a sample balance of {view.collected} of {view.reward.cupsNeeded} cups
                  </span>
                  <ToggleChip pressed={unlocked} icon={LockOpen} onClick={() => setUnlocked(u => !u)}>Unlocked</ToggleChip>
                </div>
              )}
              {screen === 'account' && (
                <span className="dz-preview__note">Your draft, with a sample customer and activity.</span>
              )}
              {screen === 'guide' && (
                <div className="dz-preview__row">
                  <Button variant="ghost" size="sm" icon={ChevronLeft} aria-label="Previous step" disabled={shownStep <= 0} onClick={() => setGuideIndex(shownStep - 1)} />
                  <span className="dz-preview__note dz-preview__note--center">
                    Step {shownStep + 1} of {stepCount}
                    <small>{customSteps.length ? 'Your guide (draft)' : view.guideFromGroup ? 'The group’s guide' : 'The built-in guide'}</small>
                  </span>
                  <Button variant="ghost" size="sm" icon={ChevronRight} aria-label="Next step" disabled={shownStep >= stepCount - 1} onClick={() => setGuideIndex(shownStep + 1)} />
                </div>
              )}
              {view.groupNote && screen !== 'guide' && <span className="dz-preview__note dz-preview__note--warn">{view.groupNote}</span>}
            </div>
          </Card>
        </aside>
        )}
      </div>

      <Modal
        open={dialog === 'publish'}
        onClose={() => setDialog(null)}
        icon={Send}
        title="Publish your draft?"
        subtitle={`${orgName} customers see it the next time they open the app.`}
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" icon={Send} onClick={handlePublish}>Publish now</Button>
          </>
        )}
      >
        <ul className="dz-publish-list">
          <li>
            <span className="dz-publish-list__label">Design & copy</span>
            <span>{describeChanges(changes, !!published)}</span>
          </li>
          <li>
            <span className="dz-publish-list__label">Rest of the draft</span>
            <span>{otherChanges ? 'Has changes too (rewards or settings). They go live with this.' : 'No other changes.'}</span>
          </li>
        </ul>
        {otherChanges && (
          <Callout tone="warning" icon={TriangleAlert}>
            Publishing always puts the whole draft live. Check the other pages first if someone else is mid-edit.
          </Callout>
        )}
      </Modal>

      <Modal
        open={dialog === 'revert'}
        onClose={() => setDialog(null)}
        icon={RotateCcw}
        iconTone="amber"
        title="Discard your design changes?"
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>Keep editing</Button>
            <Button variant="danger" onClick={handleRevert}>Discard changes</Button>
          </>
        )}
      >
        <p className="dz-modal-text">
          Colours, copy, sections and the guide go back to what customers see now ({describeChanges(changes, true).toLowerCase()}).
          Unpublished changes on other pages stay in your draft.
        </p>
      </Modal>

      <Modal
        open={dialog === 'reset'}
        onClose={() => setDialog(null)}
        icon={RotateCcw}
        iconTone="rose"
        title="Reset the whole design to defaults?"
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleResetAll}>Reset design</Button>
          </>
        )}
      >
        <p className="dz-modal-text">
          Colours, button labels, sections and the guide go back to the PackBack defaults. The headline and donation
          text stay as they are. Nothing changes for customers until you publish.
        </p>
      </Modal>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

/* Everything the phone shows, resolved the way App.jsx resolves it. */
function buildPreviewView({ design, settings, org, rewards, groupCopy, isVoucher, isTikkie, money, unlocked }) {
  const sections = design.sections;
  const cashbackRate = effectiveRates(settings).cashback;
  const asReward = (r) => ({
    ...r,
    cupsNeeded: Math.max(1, Number(r.cupsNeeded) || 1),
    value: r.euros ?? (Math.max(1, Number(r.cupsNeeded) || 1) * 1.25),
  });
  const live = (rewards || []).filter(r => r.status === 'live');
  const featured = live.find(r => r.featured) || live[0] || null;
  const reward = asReward(featured || { ...SAMPLE_REWARD, euros: SAMPLE_REWARD.cupsNeeded * cashbackRate });
  const need = reward.cupsNeeded;
  const collected = unlocked ? need : Math.min(need - 1, Math.max(1, Math.round(need * 0.6)));
  const others = live.filter(r => r !== featured).slice(0, 2).map(asReward);

  // Guide: the venue's own steps, else the group's, else the app's built-in.
  const ownSteps = design.guide.steps.length ? design.guide.steps : null;
  const groupSteps = groupCopy?.howItWorks?.steps?.length ? groupCopy.howItWorks.steps : null;
  const raw = ownSteps || groupSteps;
  const builtInGuide = groupSteps ? groupSteps.map(resolveGuideStep) : BUILT_IN_GUIDE;
  const guideSteps = raw
    ? (isVoucher ? voucherGuideSteps(raw) : raw).map(resolveGuideStep)
    : BUILT_IN_GUIDE;

  const headline = groupCopy ? groupCopy.heroHeadline : settings.heroHeadline;
  const subtext = groupCopy ? groupCopy.heroSubtext : settings.heroSubtext;

  return {
    colors: design.colors,
    org,
    money,
    isVoucher,
    isTikkie,
    cashbackRate,
    store: org?.partner_brand_name || org?.name || 'the store',
    headline: headline || '',
    subtext: subtext || '',
    showSubtext: groupCopy?.mode !== 'byo',
    copy: groupCopy ? { ...design.copy, ...groupCopy.designCopy } : design.copy,
    show: {
      storesLink: !!org?.group_id && !settings.hideStoresLink,
      packbackLogo: sections.showPackbackLogo !== false,
      brandLogo: sections.showBrandLogo !== false && !!org,
      directRefund: featureOn(settings, 'featureDirectRefunds') && sections.showDirectRefund !== false,
      share: featureOn(settings, 'featureCupSharing') && sections.showShareCup !== false,
      nextCupFree: featureOn(settings, 'featureCupSharing') && sections.showNextCupForFree !== false,
      donate: featureOn(settings, 'featureDonations') && sections.showDonate !== false,
      impact: sections.showImpact !== false,
      activity: sections.showActivity !== false,
    },
    reward,
    others,
    collected,
    guideSteps,
    builtInGuide,
    guideFromGroup: !ownSteps && !!groupSteps,
    groupNote: groupCopy ? 'Headline and account buttons come from the group.' : null,
  };
}

const str = (v) => (typeof v === 'string' ? v : '');

/* Unpublished changes on this page, counted per setting. */
function countChanges(settings, published) {
  const draft = mergeDesign(settings?.design);
  const base = mergeDesign(published?.design);
  const colors = COLOR_KEYS.filter(k => (toHex(draft.colors[k]) || str(draft.colors[k])) !== (toHex(base.colors[k]) || str(base.colors[k]))).length;
  const copy = Object.keys({ ...draft.copy, ...base.copy }).filter(k => str(draft.copy[k]) !== str(base.copy[k])).length
    + COPY_KEYS.filter(k => str(settings?.[k]) !== str(published?.[k])).length;
  const sections = Object.keys({ ...draft.sections, ...base.sections }).filter(k => (draft.sections[k] !== false) !== (base.sections[k] !== false)).length;
  const guide = JSON.stringify(draft.guide.steps) !== JSON.stringify(base.guide.steps) ? 1 : 0;
  return { colors, copy, sections, guide, total: colors + copy + sections + guide };
}

function describeChanges(c, hasPublished) {
  if (!hasPublished) return 'Everything on this page is new.';
  if (!c.total) return 'No changes';
  const parts = [];
  if (c.colors) parts.push(`${c.colors} colour${c.colors !== 1 ? 's' : ''}`);
  if (c.copy) parts.push(`${c.copy} text${c.copy !== 1 ? 's' : ''}`);
  if (c.sections) parts.push(`${c.sections} section${c.sections !== 1 ? 's' : ''}`);
  if (c.guide) parts.push('the guide');
  return parts.join(', ').replace(/^./, s => s.toUpperCase());
}

/* Does the draft differ from what is published anywhere this page doesn't
 * own? Compared as sorted JSON so key order can't cause a false alarm. */
function hasOtherChanges(draft, published) {
  if (!draft) return false;
  if (!published) return true;
  const strip = (s) => {
    const rest = { ...(s || {}) };
    delete rest.design;
    COPY_KEYS.forEach(k => { delete rest[k]; });
    return rest;
  };
  return stableJson(draft.rewards || []) !== stableJson(published.rewards || [])
    || stableJson(strip(draft.settings)) !== stableJson(strip(published.settings));
}

function stableJson(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v));
}
