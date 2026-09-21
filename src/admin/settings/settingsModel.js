import { useEffect, useState } from 'react';
import {
  Banknote, Construction, EyeOff, HeartHandshake, LayoutGrid, Link2Off, MailCheck, MapPin, Presentation,
  QrCode, ScrollText, Share2, SlidersHorizontal, Sparkles, ToggleRight, Wallet,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * Settings — what one organisation's programme does.
 *
 * Features come first: each is a tile with a switch. A feature that has a
 * dashboard tab (cup sharing, donations) takes the tab with it when it is
 * switched off. Everything else is grouped by what a person is deciding:
 * how customers are paid, the limits, the venue's locations, and the privacy
 * policy. App text lives in Design & copy; the organisation's profile, its
 * programme model, people and roles live in Master Settings.
 * ───────────────────────────────────────────────────────────────────── */

export const SETTINGS_TABS = [
  { id: 'features', label: 'Features', icon: ToggleRight },
  { id: 'payouts', label: 'Payouts', icon: Wallet },
  { id: 'rules', label: 'Rules & limits', icon: SlidersHorizontal, notFor: ['tikkie_only'] },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'legal', label: 'Legal', icon: ScrollText },
];

/* Old deep links into the settings page. */
export const SECTION_ALIASES = {
  rates: 'payouts', budget: 'payouts', limits: 'rules', flags: 'features',
  organisation: 'features', 'org-locations': 'locations',
};

const APP = ['standard', 'byo'];
const ALL = ['standard', 'byo', 'tikkie_only'];
const TIKKIE = ['tikkie_only'];

/* source: 'draft' (published with the rest of the settings) or 'group'
 * (written straight to the group's config). */
export const FEATURE_GROUPS = [
  { id: 'app', label: 'Customer app' },
  { id: 'group', label: 'Group' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'availability', label: 'Availability' },
];

export const FEATURES = [
  {
    key: 'featureCupSharing', group: 'app', icon: Share2, tone: 'violet', modes: APP, fallback: true,
    label: 'Cup sharing',
    summary: 'Customers send cups to a friend with a QR code.',
    detail: 'Switching it off removes the share buttons from the app and the Cup transfers tab from this dashboard.',
    tab: 'transactions',
  },
  {
    key: 'featureDonations', group: 'app', icon: HeartHandshake, tone: 'rose', modes: ALL, fallback: true,
    label: 'Donations',
    summary: 'Customers give their cups, or their wallet balance, to your charity partner.',
    detail: 'Switching it off removes the donate button from the app and the Donations tab from this dashboard. In Deferred Tikkie the customer picks how much of their balance to give. The charity’s name is set in Design & copy (Plastic Soup Foundation unless changed).',
    tab: 'donations',
  },
  {
    key: 'tikkieActionButtons', group: 'app', icon: LayoutGrid, tone: 'violet', modes: TIKKIE, fallback: true,
    label: 'Collect and Donate buttons',
    summary: 'Two big buttons under the wallet: collect via Tikkie, and donate.',
    detail: 'With nothing to collect, the first button becomes Scan a QR code. Donate shows only while Donations is on. Switched off, the wallet tile carries a single collect button instead, as before. Tapping the wallet always opens the collect instructions.',
  },
  {
    key: 'featureStaticQr', group: 'app', icon: QrCode, tone: 'teal', modes: ALL, fallback: false, fallbackByMode: { byo: true },
    label: 'Static QR code',
    summary: 'A QR code at the counter that gives each customer a cup, up to a daily limit.',
    detail: 'Print it once and leave it out: every scan adds one cup (in Deferred Tikkie, one cup’s refund to the wallet) until the person reaches the limit you set on the Static QR code page. On by default for Bring Your Own. Switching it off stops the code working and removes the Static QR code tab from this dashboard.',
    tab: 'byorequests',
  },
  {
    key: 'featureDirectRefunds', group: 'app', icon: Banknote, tone: 'emerald', modes: APP, fallback: true,
    label: 'Direct refunds',
    summary: 'Customers cash out their cups instead of choosing a reward.',
    detail: 'Paid at the refund rate in Payouts, which is lower than the cashback rate.',
  },
  {
    key: 'featureSmartSorting', group: 'app', icon: Sparkles, tone: 'amber', modes: APP, fallback: false,
    label: 'Smart sorting',
    summary: 'Each customer sees the reward they are closest to first.',
    detail: 'Instead of the same flagship reward for everyone, the app features the reward nearest the customer’s balance, ideally one cup away. A first-timer holding one cup sees a goal they can finish on their next visit. Customers who pick a reward themselves keep it.',
  },
  {
    key: 'requireEmailVerification', group: 'app', icon: MailCheck, tone: 'sky', modes: APP, fallback: true,
    label: 'Email verification',
    summary: 'A new or changed email is confirmed with a 6-digit code.',
    detail: 'Switched off, the address is saved straight away: one step less at the counter, but it is never proven to belong to the person typing it. An email that already belongs to another account here always goes through the code, so duplicates can’t be created.',
  },
  {
    key: 'hideStoresLink', group: 'group', icon: Link2Off, tone: 'teal', modes: APP, fallback: false, needsGroup: true,
    label: 'Hide “More stores”',
    summary: 'Remove the link to the rest of the group from this store’s home screen.',
    detail: 'For a venue presented on its own, such as a campus or a single partner. The header keeps its spacing, so nothing shifts.',
  },
  {
    key: 'hideLiveVendors', group: 'group', source: 'group', icon: EyeOff, tone: 'orange', modes: APP, fallback: false, needsGroup: true,
    label: 'Only “coming soon” on the market page',
    summary: 'The group’s market page hides the venues that are already live.',
    detail: 'Applies to every venue in the group and is saved straight away. Store pages are not affected.',
  },
  {
    key: 'vendorDemoNumbers', group: 'dashboard', icon: Presentation, tone: 'slate', modes: ALL, fallback: false,
    label: 'Demo numbers for vendors',
    summary: 'Vendor accounts see a complete example programme instead of real figures.',
    detail: 'For demos and pitches, where a store that went live last week would otherwise show an empty dashboard. Only vendor accounts see it; nothing about the real data changes.',
  },
  {
    key: 'maintenanceMode', group: 'availability', icon: Construction, tone: 'rose', modes: ALL, fallback: false, danger: true,
    label: 'Maintenance mode',
    summary: 'Pause scanning and claims, with a banner in the app.',
    detail: 'Customers can open the app but can’t scan, claim or refund until you switch it off and publish again.',
  },
];

export function featuresFor(mode, hasGroup) {
  return FEATURES.filter(f => f.modes.includes(mode) && (!f.needsGroup || hasGroup));
}

/* A feature's value, or its default when unset. Some defaults depend on the
 * programme (Static QR code is on for Bring Your Own only). */
export function featureValue(feature, settings, mode) {
  const v = settings?.[feature.key];
  if (v !== undefined && v !== null) return !!v;
  return feature.fallbackByMode?.[mode] ?? feature.fallback;
}

/* The draft, the published copy, and a toast after every change. */
export function useSettingsDraft(draftState) {
  const settings = draftState?.draft?.settings || {};
  const published = draftState?.published?.settings || null;
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function update(key, value, label) {
    draftState.updateDraft(prev => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
    setToast({ label: label || key, ts: Date.now() });
  }

  function changed(key, fallback) {
    if (!published) return false;
    const a = settings[key] ?? fallback;
    const b = published[key] ?? fallback;
    if (typeof a === 'number' || typeof b === 'number') return Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.0001;
    return (a ?? '') !== (b ?? '');
  }

  /* For changes that save straight away instead of going to the draft. */
  function notify(label) {
    setToast({ label, ts: Date.now(), direct: true });
  }

  return { settings, published, update, changed, toast, notify };
}
