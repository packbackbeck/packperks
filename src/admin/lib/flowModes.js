import {
  Banknote, HandCoins, HeartHandshake, MonitorSmartphone, Nfc, QrCode, ReceiptText,
  TabletSmartphone, TicketCheck, WalletCards,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * Ways in and ways out: how a venue's programme is described.
 *
 * A venue is no longer "a mode". It has one or more WAYS IN (how a
 * returned cup reaches the customer's phone) and one or more WAYS OUT
 * (what the customer gets for it). These are the only names they go by
 * in anything a person reads.
 *
 *   Ways in                      Ways out
 *   SmartBin NFC tag             Reward Slider Voucher      main
 *   SmartBin Display QR          Reward Cashback            main
 *   SmartBin Receipt QR          Deferred Refund            main
 *   Staff App          BYO       Donation                   support
 *   Static QR tent     BYO       Direct Refund              support
 *
 * The rules (the team's compatibility charts, Oct 2026):
 *   • Static QR tent can't be combined with any other way in. The other
 *     four ways in combine freely.
 *   • Reward Slider Voucher and Reward Cashback can't be on together.
 *   • A support way out never stands alone: it needs a main one.
 *   • A venue counts as BYO when it has no SmartBin way in. There is no
 *     deposit to refund there, so Deferred Refund and Direct Refund
 *     need a SmartBin way in.
 *   • Deferred Refund next to a Reward, or next to Direct Refund, is
 *     allowed by the rules but NOT BUILT: the customer app runs the
 *     wallet and the rewards as two separate apps. Shown, locked.
 *
 * Storage did not change. Each way maps onto the switch the customer app
 * and the edge functions already read:
 *   SmartBin ways in   settings.binWaysIn (a list; only the dashboard reads it)
 *   Staff App          organizations.staff_app_enabled
 *   Static QR tent     settings.featureStaticQr
 *   Voucher / Cashback settings.paymentMethod ('voucher' | 'tikkie')
 *   Deferred Refund    settings.mode = 'tikkie_only' (the wallet app)
 *   Donation           settings.featureDonations
 *   Direct Refund      settings.featureDirectRefunds
 * so deriveFlow() can describe every venue, including ones set up before
 * ways existed, and a venue that breaks a rule is shown with the reason.
 * ───────────────────────────────────────────────────────────────────── */

export const WAYS_IN = [
  { key: 'bin_nfc', label: 'SmartBin NFC tag', short: 'NFC tag', family: 'smartbin', icon: Nfc,
    blurb: 'The customer taps their phone on the bin’s NFC tag after returning a cup.' },
  { key: 'bin_display_qr', label: 'SmartBin Display QR', short: 'Display QR', family: 'smartbin', icon: MonitorSmartphone,
    blurb: 'The bin’s screen shows a QR code to scan after the return.' },
  { key: 'bin_receipt_qr', label: 'SmartBin Receipt QR', short: 'Receipt QR', family: 'smartbin', icon: ReceiptText,
    blurb: 'The bin prints a receipt with a QR code on it.' },
  { key: 'staff_app', label: 'Staff App', short: 'Staff App', family: 'byo', byo: true, icon: TabletSmartphone,
    blurb: 'Staff show a cup QR code on their phone at the counter.' },
  { key: 'static_qr', label: 'Static QR tent', short: 'Static QR tent', family: 'byo', byo: true, alone: true, icon: QrCode,
    blurb: 'A QR tent on the counter gives a cup per scan, up to a limit.' },
];

export const WAYS_OUT = [
  { key: 'reward_voucher', label: 'Reward Slider Voucher', short: 'Voucher', kind: 'main', icon: TicketCheck,
    blurb: 'Cups unlock a reward the customer collects at the counter by sliding a voucher.' },
  { key: 'reward_cashback', label: 'Reward Cashback', short: 'Cashback', kind: 'main', icon: HandCoins,
    blurb: 'Cups unlock a reward. The customer buys it, sends the receipt and gets the money back by Tikkie.' },
  { key: 'deferred_refund', label: 'Deferred Refund', short: 'Deferred Refund', kind: 'main', needsBin: true, icon: WalletCards,
    blurb: 'Each return adds its refund to a wallet, collected later as one Tikkie link.' },
  { key: 'donation', label: 'Donation', short: 'Donation', kind: 'support', icon: HeartHandshake,
    blurb: 'Customers give their cups or balance to your charity partner.' },
  { key: 'direct_refund', label: 'Direct Refund', short: 'Direct Refund', kind: 'support', needsBin: true, icon: Banknote,
    blurb: 'Customers cash their cups out straight away instead of saving for a reward.' },
];

export const WAY_BY_KEY = Object.fromEntries(
  [...WAYS_IN.map(w => [w.key, { ...w, side: 'in' }]), ...WAYS_OUT.map(w => [w.key, { ...w, side: 'out' }])],
);

const BIN_KEYS = WAYS_IN.filter(w => w.family === 'smartbin').map(w => w.key);
const REWARDS = ['reward_voucher', 'reward_cashback'];
const NOT_BUILT = [
  ['deferred_refund', 'reward_voucher'],
  ['deferred_refund', 'reward_cashback'],
  ['deferred_refund', 'direct_refund'],
];

const label = (k) => WAY_BY_KEY[k]?.label || k;
const list = (keys) => keys.map(label).join(' and ');

export function hasBinWayIn(ins) {
  return [...ins].some(k => BIN_KEYS.includes(k));
}

/* BYO: no SmartBin way in, so no deposit behind the cup. */
export function isByo(flow) {
  return flow.ins.size > 0 && !hasBinWayIn(flow.ins);
}

function notBuiltPartner(key, outs) {
  for (const [a, b] of NOT_BUILT) {
    if (a === key && outs.has(b)) return b;
    if (b === key && outs.has(a)) return a;
  }
  return null;
}

/* What happens if `key` is switched ON with the rest of `flow` as it is:
 *   { ok: true }
 *   { ok: true, replaces }            on, but takes the place of `replaces`
 *   { ok: false, reason, notBuilt? }  can't, and why (notBuilt: the rules
 *                                     allow it; the app doesn't run it yet) */
export function turnOnCheck(key, flow) {
  const way = WAY_BY_KEY[key];
  if (!way) return { ok: false, reason: 'Unknown way.' };
  if (way.side === 'in') {
    const others = [...flow.ins].filter(k => k !== key);
    if (way.alone && others.length) {
      return { ok: false, reason: `Can’t be combined with another way in. Switch off ${list(others)} first.` };
    }
    const alone = others.find(k => WAY_BY_KEY[k]?.alone);
    if (alone) return { ok: false, reason: `${label(alone)} can’t be combined with another way in.` };
    return { ok: true };
  }
  const outs = flow.outs;
  if (way.needsBin && !hasBinWayIn(flow.ins)) {
    return { ok: false, reason: 'Needs a SmartBin way in. A BYO venue has no deposit to refund.' };
  }
  if (way.kind === 'support' && ![...outs].some(k => WAY_BY_KEY[k]?.kind === 'main')) {
    return { ok: false, reason: 'A support way out can’t stand alone. Switch on a main way out first.' };
  }
  const partner = notBuiltPartner(key, outs);
  if (partner) {
    return { ok: false, notBuilt: true, reason: `Not built yet next to ${label(partner)}: the customer app runs the wallet and the rewards as separate apps.` };
  }
  if (REWARDS.includes(key)) {
    const other = REWARDS.find(k => k !== key && outs.has(k));
    if (other) return { ok: true, replaces: other };
  }
  return { ok: true };
}

/* Whether `key` can be switched OFF without leaving the venue broken. */
export function turnOffCheck(key, flow) {
  const way = WAY_BY_KEY[key];
  if (!way) return { ok: false, reason: 'Unknown way.' };
  if (way.side === 'in') {
    const rest = new Set([...flow.ins].filter(k => k !== key));
    if (!rest.size) return { ok: false, reason: 'A venue needs at least one way in.' };
    if (BIN_KEYS.includes(key) && !hasBinWayIn(rest)) {
      const needs = [...flow.outs].filter(k => WAY_BY_KEY[k]?.needsBin);
      if (needs.length) return { ok: false, reason: `${list(needs)} needs a SmartBin way in. Switch ${needs.length > 1 ? 'them' : 'it'} off first.` };
    }
    return { ok: true };
  }
  if (way.kind === 'main') {
    const mains = [...flow.outs].filter(k => k !== key && WAY_BY_KEY[k]?.kind === 'main');
    if (!mains.length) {
      return { ok: false, reason: 'A venue needs a main way out. Switch on another one first, or pick one to replace it.' };
    }
  }
  return { ok: true };
}

/* Every rule the venue's CURRENT setup breaks. Venues set up before ways
 * existed can be in a state the rules now forbid; they keep running, and
 * the dashboard says what to change. */
export function flowIssues(flow) {
  const issues = [];
  const ins = [...flow.ins];
  const outs = [...flow.outs];
  const mains = outs.filter(k => WAY_BY_KEY[k]?.kind === 'main');
  if (!ins.length) issues.push('There is no way in.');
  if (!mains.length) issues.push('There is no main way out.');
  const alone = ins.find(k => WAY_BY_KEY[k]?.alone);
  if (alone && ins.length > 1) issues.push(`${label(alone)} can’t be combined with ${list(ins.filter(k => k !== alone))}.`);
  if (outs.includes('reward_voucher') && outs.includes('reward_cashback')) {
    issues.push('Reward Slider Voucher and Reward Cashback can’t be on together.');
  }
  if (!hasBinWayIn(flow.ins)) {
    const needs = outs.filter(k => WAY_BY_KEY[k]?.needsBin);
    if (needs.length) issues.push(`${list(needs)} needs a SmartBin way in: a BYO venue has no deposit to refund.`);
  }
  return issues;
}

/* ── Reading a venue ────────────────────────────────────────────────── */

/* The venue's ways, from the switches the app already reads.
 *   settings        the draft (or published) settings
 *   appMode         'tikkie_only' | 'byo' | 'standard' (resolveEffectiveMode)
 *   staffAppEnabled organizations.staff_app_enabled
 *   groupPayment    the group's paymentMethod, when the venue has none */
export function deriveFlow({ settings, appMode, staffAppEnabled, groupPayment }) {
  const s = settings || {};
  const ins = new Set();
  const bin = Array.isArray(s.binWaysIn)
    ? s.binWaysIn.filter(k => BIN_KEYS.includes(k))
    : (appMode === 'byo' ? [] : ['bin_receipt_qr']);
  bin.forEach(k => ins.add(k));
  const staticQr = s.featureStaticQr === undefined || s.featureStaticQr === null
    ? appMode === 'byo'
    : s.featureStaticQr === true;
  if (staticQr) ins.add('static_qr');
  if (staffAppEnabled) ins.add('staff_app');

  const outs = new Set();
  if (appMode === 'tikkie_only') {
    outs.add('deferred_refund');
  } else {
    const method = s.paymentMethod || groupPayment || 'tikkie';
    outs.add(method === 'voucher' ? 'reward_voucher' : 'reward_cashback');
    if (s.featureDirectRefunds !== false) outs.add('direct_refund');
  }
  if (s.featureDonations !== false) outs.add('donation');
  return { ins, outs };
}

/* The ways that lead a summary: a SmartBin way in before a BYO one, a main
 * way out before a support one. */
export function leadWays(flow) {
  const ins = WAYS_IN.map(w => w.key).filter(k => flow.ins.has(k));
  const outs = WAYS_OUT.map(w => w.key).filter(k => flow.outs.has(k));
  const binFirst = [...ins.filter(k => BIN_KEYS.includes(k)).reverse(), ...ins.filter(k => !BIN_KEYS.includes(k))];
  return { ins: binFirst, outs };
}

/* One line, for a list row or a tooltip: "Receipt QR → Cashback, Donation". */
export function flowSummary(flow, { short = true } = {}) {
  const { ins, outs } = leadWays(flow);
  const name = (k) => (short ? WAY_BY_KEY[k].short : WAY_BY_KEY[k].label);
  return `${ins.map(name).join(', ') || 'No way in'} → ${outs.map(name).join(', ') || 'no way out'}`;
}
