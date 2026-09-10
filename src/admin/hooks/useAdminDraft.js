import { useState, useCallback, useEffect, useRef } from 'react';
import { saveAppConfig, getAppConfig } from '../../lib/api';
import { useOrg } from '../context/OrgContext';
import { stripSettingsForMode } from '../lib/orgModes';

/* ─────────────────────────────────────────────────────────────────────
 * Multi-org note (Phase 2): the admin draft (working copy of rewards +
 * settings + dashboard blocks) is now scoped to the active organisation.
 * Each org gets its own slot in localStorage so switching between orgs
 * preserves each one's in-progress edits independently.
 *
 * Storage keys (suffix is the org id, or 'default' before context loads):
 *   pp_admin_draft:<orgId>
 *   pp_admin_versions:<orgId>
 *   pp_admin_published:<orgId>
 *
 * One-time migration: if an org has no draft stored under the new key
 * but the legacy `pp_admin_draft` (no-suffix) key exists, we copy it
 * across once so pre-multi-org users don't lose their working copy.
 * ───────────────────────────────────────────────────────────────────── */

const LEGACY_DRAFT_KEY     = 'pp_admin_draft';
const LEGACY_VERSIONS_KEY  = 'pp_admin_versions';
const LEGACY_PUBLISHED_KEY = 'pp_admin_published';

function draftKey(orgId)     { return `pp_admin_draft:${orgId || 'default'}`; }
function versionsKey(orgId)  { return `pp_admin_versions:${orgId || 'default'}`; }
function publishedKey(orgId) { return `pp_admin_published:${orgId || 'default'}`; }

export const DEFAULT_SETTINGS = {
  cashbackRatePerCup: 1.25,
  refundRatePerCup: 1.00,
  heroHeadline: 'Collect Cups & Get Rewards',
  heroSubtext: 'We pool your cup deposits into one cashback payout — worth more than a standard refund.',
  donationRecipient: 'Plastic Soup Foundation',
  donationDescription: 'Your return helps fund campaigns against plastic pollution in rivers and oceans.',
  maxCupsPerScan: 1,
  maxCupsToShare: 10,
  // Receipt is claimable for this many days after purchase (AI flags older ones).
  receiptMaxAgeDays: 14,
  featureCupSharing: true,
  // Opt-in: changes which reward each customer is shown, so an org turns it
  // on deliberately rather than inheriting it.
  featureSmartSorting: false,
  featureDonations: true,
  featureDirectRefunds: true,
  maintenanceMode: false,
  // Verification has been unconditional until now. Defaulting to true keeps
  // every existing org exactly as it is; turning it off is a deliberate act.
  requireEmailVerification: true,
  // Hides the "More stores" link on a venue's home screen — for a store
  // presented on its own rather than as one of a group.
  hideStoresLink: false,
  // Vendor accounts see an illustrative programme instead of this store's
  // real figures. All three are listed here so they survive a publish: a
  // setting absent from this object is absent from a fresh draft, and
  // publishing that draft drops it from the stored config.
  vendorDemoNumbers: false,
  privacyUrl: 'https://packperks.nl/privacy',
  termsUrl: 'https://packperks.nl/terms',
  cookieUrl: 'https://packperks.nl/cookies',
};

export const DEFAULT_DASHBOARD_BLOCKS = [
  { id: 'stat-total-users',     label: 'Total Users',          type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-active-users',    label: 'Active Users (30d)',   type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cups-collected',  label: 'Cups Collected',       type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cups-redeemed',   label: 'Cups Redeemed',        type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cashback',        label: 'Total Cashback',       type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-pending',         label: 'Pending Actions',      type: 'stat',  visible: true,  span: 1 },
  { id: 'chart-cups-per-day',   label: 'Cups Per Day',         type: 'chart', visible: true,  span: 2 },
  { id: 'chart-cup-dist',       label: 'Cup Distribution',     type: 'chart', visible: true,  span: 1 },
  { id: 'chart-claims-per-day', label: 'Claims Per Day',       type: 'chart', visible: true,  span: 2 },
  { id: 'chart-reward-pop',     label: 'Reward Popularity',    type: 'chart', visible: true,  span: 1 },
  { id: 'feed-activity',        label: 'Live Activity',        type: 'feed',  visible: true,  span: 1 },
  { id: 'quick-settings',       label: 'Quick Settings',       type: 'quick', visible: true,  span: 1 },
];

/* Empty starting state for an org whose published config hasn't been
 * fetched yet (or has nothing). We intentionally do NOT seed with
 * `defaultRewards` here — that was BK's hardcoded sample data which
 * was leaking into every newly-switched-to org. The useEffect below
 * hydrates real rewards from Supabase shortly after mount/switch. */
function buildEmptyDraft() {
  return {
    rewards: [],
    settings: { ...DEFAULT_SETTINGS },
    dashboardBlocks: DEFAULT_DASHBOARD_BLOCKS.map(b => ({ ...b })),
  };
}

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const LEGACY_MIGRATION_FLAG = 'pp_admin_legacy_cleanup_v2';

/* One-time legacy data cleanup. Runs once per browser, not per org.
 *
 * History: an earlier version of this hook copied the legacy (pre-multi-org)
 * `pp_admin_draft` key into `pp_admin_draft:<orgId>` the FIRST time each
 * org was visited. That meant every newly-created org silently inherited
 * the first/default org's draft data and never refetched from Supabase —
 * cross-tenant data leak.
 *
 * This rewrite drops the legacy-to-per-org copy entirely. Anyone using
 * multi-org for any time has already published their data to Supabase
 * (the source of truth); any unpublished draft sitting only in the
 * legacy key is acceptable collateral against the leak.
 *
 * On first run after the fix, also clean up the existing pollution by
 * deleting any per-org draft/versions/published key whose value is
 * byte-identical to the legacy key (those entries can only have been
 * produced by the buggy copy). The org will then re-fetch its real
 * published config from Supabase on next mount. */
function migrateLegacyKeysOnce(orgId) {
  if (!orgId) return;
  try {
    if (localStorage.getItem(LEGACY_MIGRATION_FLAG)) return;
  } catch {
    return;
  }

  for (const legacyKey of [LEGACY_DRAFT_KEY, LEGACY_VERSIONS_KEY, LEGACY_PUBLISHED_KEY]) {
    let legacyVal = null;
    try { legacyVal = localStorage.getItem(legacyKey); } catch { /* ignore */ }
    if (!legacyVal) continue;
    const prefix = legacyKey + ':';
    const toDelete = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix) && localStorage.getItem(k) === legacyVal) {
          toDelete.push(k);
        }
      }
      toDelete.forEach(k => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }

  try { localStorage.setItem(LEGACY_MIGRATION_FLAG, '1'); } catch { /* ignore */ }
}

export function useAdminDraft() {
  // The hook needs the active org to key its storage. We tolerate the
  // (very brief) bootstrap window where activeOrgId is null by using a
  // 'default' suffix until it resolves.
  const orgCtx = useOrg();
  const activeOrgId = orgCtx?.activeOrgId || null;

  const [draft, setDraft]     = useState(() => loadFromStorage(draftKey(activeOrgId), buildEmptyDraft()));
  const [versions, setVersions]   = useState(() => loadFromStorage(versionsKey(activeOrgId), []));
  const [published, setPublished] = useState(() => loadFromStorage(publishedKey(activeOrgId), null));
  const [isDirty, setIsDirty]   = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [publishNote, setPublishNote] = useState('');
  const [publishError, setPublishError] = useState(null);

  /* Tracks which org id this hook has successfully hydrated from storage
   * for. Auto-save paths (toggleFeature, publishDraft) MUST refuse to
   * write to Supabase unless this matches the current activeOrgId.
   *
   * Why: without this guard, a user opening admin and clicking a feature
   * toggle BEFORE the draft has finished loading from Supabase will push
   * stale React state (possibly inherited from another org via the old
   * localStorage migration bug) into the current org's published row.
   * That's how Titaan's row got overwritten with BK draft data. */
  const hydratedForOrgRef = useRef(null);

  /* Hydrate the draft whenever the active org changes (or on first
   * mount). Resolution order:
   *   1. Per-org localStorage `pp_admin_draft:<orgId>` — last working
   *      copy from this browser (preferred — preserves in-progress
   *      edits across reloads).
   *   2. Supabase `app_config` row `published:<orgId>` — the last
   *      published snapshot. This is what makes a brand-new org load
   *      its actual rewards (from the wizard) instead of accidentally
   *      inheriting BK's seeded sample data.
   *   3. Empty draft (no rewards yet) — the admin will add some.
   */
  useEffect(() => {
    let cancelled = false;
    // Reset hydration flag on every org change. Auto-save paths refuse
    // to write to Supabase until the flag matches the current org again.
    hydratedForOrgRef.current = null;
    migrateLegacyKeysOnce(activeOrgId);

    // SOURCE OF TRUTH = the org's published Supabase config. We hydrate from
    // it on every org load, NOT from the local draft. A stale or
    // cross-polluted local draft (e.g. a Burger King snapshot left in this
    // browser) used to override the correct published data and show the
    // wrong org's rewards — that's the class of bug this prevents. The local
    // draft is only a fallback for a brand-new org that has nothing
    // published yet (the onboarding wizard's in-progress copy).
    setPublished(null);
    getAppConfig(activeOrgId).then(config => {
      if (cancelled) return;
      const hasPublished = config && (Array.isArray(config.rewards) || config.settings);

      // The org's last working copy from THIS browser. We resume it only when
      // it carries genuinely unpublished edits (_dirty). That is what lets a
      // tab switch, reload, or org switch pick up in-progress work instead of
      // snapping back to the last published snapshot. It is keyed per org and
      // the legacy cross-tenant copy path is gone, so preferring it is safe.
      const local = loadFromStorage(draftKey(activeOrgId), null);
      const localHasUnpublishedEdits =
        !!local && local._dirty === true && Array.isArray(local.rewards);

      // Strip persistence-only keys (_savedAt/_dirty) and normalise shape.
      const cleanDraft = (src) => ({
        rewards: Array.isArray(src?.rewards)
          ? src.rewards.map((r, i) => ({ ...r, order: r.order ?? i }))
          : [],
        settings: { ...DEFAULT_SETTINGS, ...(src?.settings || {}) },
        dashboardBlocks: Array.isArray(src?.dashboardBlocks)
          ? src.dashboardBlocks.map(b => ({ ...b }))
          : DEFAULT_DASHBOARD_BLOCKS.map(b => ({ ...b })),
      });

      if (hasPublished) {
        const serverDraft = cleanDraft(config);
        // Server stays the source of truth for the PUBLISHED baseline...
        setPublished({ ...serverDraft, _publishedAt: Date.now() });
        if (localHasUnpublishedEdits) {
          // ...but the working draft resumes the in-progress local edits so
          // they survive remounts / reloads until published or discarded.
          setDraft(cleanDraft(local));
        } else {
          setDraft(serverDraft);
          // Overwrite the local working copy with the published truth so a
          // stale draft can never resurface, and mark it clean.
          try {
            localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...serverDraft, _savedAt: Date.now(), _dirty: false }));
          } catch { /* quota / private-mode — fine, state is already set */ }
        }
      } else {
        // Brand-new org with nothing published yet — use any local
        // in-progress draft (wizard), else an empty draft.
        setDraft(local ? cleanDraft(local) : buildEmptyDraft());
      }
      setVersions(loadFromStorage(versionsKey(activeOrgId), []));
      setIsDirty(localHasUnpublishedEdits);
      setLastSaved(localHasUnpublishedEdits && local?._savedAt ? local._savedAt : null);
      setPublishNote('');
      setPublishError(null);
      hydratedForOrgRef.current = activeOrgId;
    }).catch(err => {
      console.error('useAdminDraft: getAppConfig failed', err);
      // On fetch failure, fall back to a local draft so the admin isn't
      // stuck with a blank screen.
      if (cancelled) return;
      const local = loadFromStorage(draftKey(activeOrgId), null);
      setDraft(local || buildEmptyDraft());
      hydratedForOrgRef.current = activeOrgId;
    });

    return () => { cancelled = true; };
  }, [activeOrgId]);

  const updateDraft = useCallback((updater) => {
    setDraft(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const ts = Date.now();
      try {
        // _dirty marks the local copy as carrying unpublished edits so the
        // hydration effect resumes it (instead of the server snapshot) after
        // a reload / tab switch.
        localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...next, _savedAt: ts, _dirty: true }));
      } catch {
        /* quota / private-mode failure — fall through, state still updates */
      }
      setLastSaved(ts);
      return next;
    });
    setIsDirty(true);
  }, [activeOrgId]);

  const saveDraft = useCallback(() => {
    const ts = Date.now();
    // An explicit save of the working copy — still unpublished, so it stays
    // _dirty and will be resumed on the next load.
    const toSave = { ...draft, _savedAt: ts, _dirty: true };
    localStorage.setItem(draftKey(activeOrgId), JSON.stringify(toSave));
    setIsDirty(false);
    setLastSaved(ts);
  }, [draft, activeOrgId]);

  const publishDraft = useCallback((note) => {
    const ts = Date.now();
    const version = {
      id: `v${versions.length + 1}`,
      number: versions.length + 1,
      publishedAt: ts,
      note: note || publishNote || 'Published changes',
      snapshot: { ...draft },
    };

    const newVersions = [version, ...versions];
    const newPublished = { ...draft, _publishedAt: ts };

    setVersions(newVersions);
    setPublished(newPublished);
    setIsDirty(false);
    setLastSaved(ts);
    setPublishNote('');

    localStorage.setItem(versionsKey(activeOrgId), JSON.stringify(newVersions));
    localStorage.setItem(publishedKey(activeOrgId), JSON.stringify(newPublished));
    // Published == draft now, so the local copy is clean: a later reload
    // should hydrate from the server snapshot, not resume this as a draft.
    localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...draft, _savedAt: ts, _dirty: false }));

    // Push to Supabase — pass orgId so each org has its own
    // `published:<orgId>` row in app_config.
    setPublishError(null);
    if (hydratedForOrgRef.current !== activeOrgId) {
      console.warn('publishDraft: blocked — draft not yet hydrated for org', activeOrgId);
      setPublishError('Draft is still loading. Wait a moment and try publishing again.');
      return;
    }
    // Tikkie-only orgs publish a lean config: the reward/app keys the draft
    // still carries (they're in DEFAULT_SETTINGS for every org) describe
    // machinery this mode doesn't run, and rewards are never shown.
    const isTikkieOnly = draft.settings?.mode === 'tikkie_only';
    const outSettings = stripSettingsForMode(draft.settings);
    const outRewards = isTikkieOnly ? [] : draft.rewards;
    saveAppConfig({ rewards: outRewards, settings: outSettings }, activeOrgId).catch(err => {
      console.error('saveAppConfig failed:', err);
      setPublishError(err?.message || 'Could not save to Supabase. Check app_config table + RLS policies.');
    });
  }, [draft, versions, publishNote, activeOrgId]);

  const restoreVersion = useCallback((versionId) => {
    const version = versions.find(v => v.id === versionId);
    if (!version) return;
    setDraft({ ...version.snapshot });
    setIsDirty(true);
  }, [versions]);

  const toggleFeature = useCallback((key) => {
    // Refuse to auto-save if the draft hasn't been hydrated for this org
    // yet. This blocks the cross-tenant corruption path where a polluted
    // initial state would otherwise get pushed straight into the wrong
    // org's published row in Supabase.
    if (hydratedForOrgRef.current !== activeOrgId) {
      console.warn('toggleFeature: blocked — draft not yet hydrated for org', activeOrgId);
      setPublishError('Settings are still loading. Refresh and try again.');
      return;
    }
    setDraft(prev => {
      const newSettings = { ...prev.settings, [key]: !prev.settings[key] };
      const next = { ...prev, settings: newSettings };
      // Toggling a feature pushes the whole current draft to the server below,
      // so the local copy matches the server afterwards → clean.
      localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...next, _savedAt: Date.now(), _dirty: false }));
      saveAppConfig({ rewards: next.rewards, settings: newSettings }, activeOrgId).catch(err => {
        console.error('toggleFeature failed:', err);
        setPublishError(err?.message || 'Could not save feature toggle to Supabase.');
      });
      return next;
    });
  }, [activeOrgId]);

  const statusLabel = (() => {
    if (isDirty) return 'Auto-saved';
    if (lastSaved && !published) return 'Draft saved';
    if (published) return 'Published';
    return 'Up to date';
  })();

  return {
    draft,
    updateDraft,
    saveDraft,
    publishDraft,
    versions,
    restoreVersion,
    isDirty,
    lastSaved,
    published,
    publishNote,
    setPublishNote,
    statusLabel,
    publishError,
    clearPublishError: () => setPublishError(null),
    toggleFeature,
    activeOrgId,
  };
}
