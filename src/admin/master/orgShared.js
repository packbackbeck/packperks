import { CupSoda, Gift, WalletCards } from 'lucide-react';
import { PAYMENT_PROVIDERS } from '../../lib/payments';
import { ORG_MODE_META } from '../lib/orgModes';

/* Shared by the Organisations, Groups and Regions views in Master settings. */

export const MODE_GLYPH = { standard: Gift, byo: CupSoda, tikkie_only: WalletCards };

/* A group stores 'deposit' | 'byo'; a venue's effective mode uses 'standard'. */
export const GROUP_MODE_TO_ORG = { deposit: 'standard', byo: 'byo' };
export const GROUP_MODES = ['deposit', 'byo'];

export const MODE_BLURB = {
  standard: 'Cups build up toward a reward: Reward Cashback or Reward Slider Voucher.',
  byo: 'Rewards for customers who bring their own cup, through a BYO way in.',
  tikkie_only: 'Each return adds money to a wallet, collected later as one Tikkie link. No rewards.',
};

export function modeLabel(mode) {
  return ORG_MODE_META[mode]?.label || 'Rewards';
}

/* A group is a SmartBin group or a BYO group: it sets the customer copy of
 * every venue in it, and whether the Static QR tent is on by default. */
export function groupModeLabel(mode) {
  return mode === 'deposit' ? 'SmartBin group' : 'BYO group';
}

/* A provider is live only when payments.js says so. An edge function on its
 * own is not enough: the UAE adapter has one but is switched off. */
export function providerInfo(key) {
  const p = PAYMENT_PROVIDERS[key];
  if (!p) return { key, label: key ? `${key} (unknown)` : 'None', live: false };
  return { key, label: p.label, live: !!p.live };
}

/* What the customer app promises, mirroring payoutCopy() in lib/regions.js
 * but for a region draft that is not in the registry yet. */
export function payoutPromise(style, noun) {
  return style === 'link'
    ? `we'll send you a ${noun || 'payment link'} to collect it`
    : "we'll send your cashback to you";
}

/* Paths the site already uses (src/main.jsx); a venue can't take them. */
export const RESERVED_SLUGS = new Set(['admin', 'mockup', 'staff', 'support', 'vendor-support', 'packpulse-embed', 'demo']);

export function slugOk(slug) {
  const s = String(slug || '').trim();
  return /^[a-z0-9][a-z0-9-]*$/.test(s) && !RESERVED_SLUGS.has(s) && !s.startsWith('support') && !s.startsWith('packpulse-embed');
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const REOPEN_KEY = 'pp-master:reopen-org';

/* The dashboard remounts when you open another organisation, so an editor
 * that asked for that switch leaves a note to reopen itself. */
export function rememberReopen(id, tab) {
  try { sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ id, tab })); } catch { /* ignore */ }
}

export function peekReopen() {
  try {
    const raw = sessionStorage.getItem(REOPEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearReopen() {
  try { sessionStorage.removeItem(REOPEN_KEY); } catch { /* ignore */ }
}
