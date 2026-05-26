import { useState, useCallback, useEffect } from 'react';
import { saveAppConfig, getAppConfig } from '../../lib/api';
import { useOrg } from '../context/OrgContext';

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
  minIbanLength: 15,
  maxCupsPerScan: 1,
  maxCupsToShare: 10,
  featureCupSharing: true,
  featureDonations: true,
  featureDirectRefunds: true,
  maintenanceMode: false,
  privacyUrl: 'https://packperks.nl/privacy',
  termsUrl: 'https://packperks.nl/terms',
  cookieUrl: 'https://packperks.nl/cookies',
};

export const DEFAULT_DASHBOARD_BLOCKS = [
  { id: 'stat-total-users',     label: 'Total Users',          type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-active-users',    label: 'Active Users (30d)',   type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cups-collected',  label: 'Cups Collected',       type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cups-redeemed',   label: 'Cups Redeemed',        type: 'stat',  visible: true,  span: 1 },
  { id: 'stat-cashback',        label: 'Total Cashback (€)',   type: 'stat',  visible: true,  span: 1 },
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

/* One-time migration from the legacy (no-suffix) keys to the per-org
 * keys. Runs once per orgId — if the per-org key already has data we
 * skip, so a re-publish doesn't get clobbered by old legacy data.
 *
 * The legacy keys themselves are NOT deleted — multiple orgs may want
 * to bootstrap from the same legacy draft, and we'd rather leak a few
 * KB of localStorage than risk data loss. */
function migrateLegacyKeysOnce(orgId) {
  if (!orgId) return;
  const pairs = [
    [LEGACY_DRAFT_KEY,     draftKey(orgId)],
    [LEGACY_VERSIONS_KEY,  versionsKey(orgId)],
    [LEGACY_PUBLISHED_KEY, publishedKey(orgId)],
  ];
  for (const [oldK, newK] of pairs) {
    try {
      const existing = localStorage.getItem(newK);
      if (existing) continue; // already migrated for this org
      const legacy = localStorage.getItem(oldK);
      if (legacy) localStorage.setItem(newK, legacy);
    } catch {
      /* ignore */
    }
  }
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
    migrateLegacyKeysOnce(activeOrgId);

    const local = loadFromStorage(draftKey(activeOrgId), null);
    if (local) {
      setDraft(local);
      setVersions(loadFromStorage(versionsKey(activeOrgId), []));
      setPublished(loadFromStorage(publishedKey(activeOrgId), null));
      setIsDirty(false);
      setLastSaved(null);
      setPublishNote('');
      setPublishError(null);
      return;
    }

    // No local working copy yet — fall back to the published snapshot
    // for this org from Supabase. getAppConfig accepts an explicit org
    // id and reads the `published:<orgId>` row, falling back to the
    // legacy unsuffixed `published` row for backwards compat.
    setDraft(buildEmptyDraft());
    setPublished(null);
    getAppConfig(activeOrgId).then(config => {
      if (cancelled) return;
      if (config && (Array.isArray(config.rewards) || config.settings)) {
        const next = {
          rewards: Array.isArray(config.rewards)
            ? config.rewards.map((r, i) => ({ ...r, order: r.order ?? i }))
            : [],
          settings: { ...DEFAULT_SETTINGS, ...(config.settings || {}) },
          dashboardBlocks: DEFAULT_DASHBOARD_BLOCKS.map(b => ({ ...b })),
        };
        setDraft(next);
        setPublished({ ...next, _publishedAt: Date.now() });
      }
      setVersions(loadFromStorage(versionsKey(activeOrgId), []));
      setIsDirty(false);
      setLastSaved(null);
      setPublishNote('');
      setPublishError(null);
    }).catch(err => {
      console.error('useAdminDraft: getAppConfig failed', err);
    });

    return () => { cancelled = true; };
  }, [activeOrgId]);

  const updateDraft = useCallback((updater) => {
    setDraft(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const ts = Date.now();
      try {
        localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...next, _savedAt: ts }));
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
    const toSave = { ...draft, _savedAt: ts };
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
    localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...draft, _savedAt: ts }));

    // Push to Supabase — pass orgId so each org has its own
    // `published:<orgId>` row in app_config.
    setPublishError(null);
    saveAppConfig({ rewards: draft.rewards, settings: draft.settings }, activeOrgId).catch(err => {
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
    setDraft(prev => {
      const newSettings = { ...prev.settings, [key]: !prev.settings[key] };
      const next = { ...prev, settings: newSettings };
      localStorage.setItem(draftKey(activeOrgId), JSON.stringify({ ...next, _savedAt: Date.now() }));
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
