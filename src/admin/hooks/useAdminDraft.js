import { useState, useCallback } from 'react';
import { rewards as defaultRewards } from '../../data/rewards';
import { saveAppConfig } from '../../lib/api';

const DRAFT_KEY = 'pp_admin_draft';
const VERSIONS_KEY = 'pp_admin_versions';
const PUBLISHED_KEY = 'pp_admin_published';

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

function buildDefaultDraft() {
  return {
    rewards: defaultRewards.map((r, i) => ({
      ...r,
      status: 'live',
      featured: i === 0,
      order: i,
    })),
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

export function useAdminDraft() {
  const [draft, setDraft] = useState(() => loadFromStorage(DRAFT_KEY, buildDefaultDraft()));
  const [versions, setVersions] = useState(() => loadFromStorage(VERSIONS_KEY, []));
  const [published, setPublished] = useState(() => loadFromStorage(PUBLISHED_KEY, null));
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [publishNote, setPublishNote] = useState('');
  const [publishError, setPublishError] = useState(null);

  /* Auto-save: every call to updateDraft immediately persists to
   * localStorage. There's no more manual "Save" button — the workflow
   * is just edit → (autosaved) → Publish.
   *
   * `isDirty` no longer means "needs a click to save"; it means "has
   * un-published changes" (i.e. the local draft has moved ahead of the
   * last published snapshot). That's still useful for the Publish-pulse
   * indicator. */
  const updateDraft = useCallback((updater) => {
    setDraft(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const ts = Date.now();
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...next, _savedAt: ts }));
      } catch {
        /* quota / private-mode failure — fall through, state still updates */
      }
      setLastSaved(ts);
      return next;
    });
    setIsDirty(true);
  }, []);

  /* Kept for backwards compatibility (⌘S, legacy callers). Updates are
   * already persisted on every change, so this is effectively a no-op
   * touch of the timestamp. */
  const saveDraft = useCallback(() => {
    const ts = Date.now();
    const toSave = { ...draft, _savedAt: ts };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(toSave));
    setIsDirty(false);
    setLastSaved(ts);
  }, [draft]);

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

    localStorage.setItem(VERSIONS_KEY, JSON.stringify(newVersions));
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(newPublished));
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, _savedAt: ts }));

    // Push to Supabase so the user app picks it up on next load
    setPublishError(null);
    saveAppConfig({ rewards: draft.rewards, settings: draft.settings }).catch(err => {
      console.error('saveAppConfig failed:', err);
      setPublishError(err?.message || 'Could not save to Supabase. Check app_config table + RLS policies.');
    });
  }, [draft, versions, publishNote]);

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
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...next, _savedAt: Date.now() }));
      saveAppConfig({ rewards: next.rewards, settings: newSettings }).catch(err => {
        console.error('toggleFeature failed:', err);
        setPublishError(err?.message || 'Could not save feature toggle to Supabase.');
      });
      return next;
    });
  }, []);

  /* statusLabel is now informational only — there's no Save button to
   * mirror. "Unsaved changes" never appears since every edit auto-saves. */
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
  };
}
