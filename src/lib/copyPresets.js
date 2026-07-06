/* ─────────────────────────────────────────────────────────────────────
 * copyPresets — mode-sensitive default copy for a store (or store group).
 *
 * Phase 3 introduces a second operating "mode" alongside the original
 * deposit/return model:
 *
 *   • 'deposit' — the original PackPerks model. Customers return their
 *     packaging (e.g. at a SmartBin), scan, and earn cashback. This is
 *     the default for every existing org so nothing changes for them.
 *
 *   • 'byo' — "Bring Your Own cup". No deposit, no bin: the customer
 *     brings a reusable cup, the barista fills it, and they scan a
 *     stationary QR on the counter to add the cup to their balance. The
 *     reward model is UNCHANGED (real cashback) — only the language
 *     drops all deposit / refund / SmartBin framing and speaks about
 *     bringing your own cup.
 *
 * A group picks a mode when it's created (admin › Organisations ›
 * Store groups). The strings below are the *default* copy for that mode.
 * Per-string editing for every user-facing label (the full "everything
 * is editable" system) is a later phase — until then these presets are
 * what a BYO group shows, which is why the BYO bundle already reads as a
 * genuine bring-your-own programme (terms, how-it-works, and the
 * per-store / fair-use messages included).
 *
 * Consumers should read a preset via getCopyPreset(mode) and treat any
 * value stored on the group/org config as an override on top of it.
 * ───────────────────────────────────────────────────────────────────── */

export const COPY_MODES = ['deposit', 'byo'];

/* Short admin-facing description of each mode (shown when creating or
 * editing a group). Kept separate from the customer copy below. */
export const MODE_META = {
  deposit: {
    key:   'deposit',
    label: 'Deposit & return',
    blurb: 'The original model — customers return packaging and earn cashback. Deposit/return language.',
  },
  byo: {
    key:   'byo',
    label: 'Bring your own cup',
    blurb: 'No deposit, no bin — customers bring a reusable cup and scan a counter QR. Bring-your-own language.',
  },
};

/* ── The customer-facing copy bundles ─────────────────────────────────
 * Shape is shared by both modes so a consumer can switch on `mode`
 * without special-casing which keys exist.
 *
 *   heroHeadline / heroSubtext — top of the customer app
 *   designCopy                 — overrides merged into settings.design.copy
 *   howItWorks                 — the "How does it work?" explainer
 *   terms                      — the plain-language terms block
 *   crossOrgNotice             — shown when a cup is added at a different
 *                                store in the same group (A8: balances are
 *                                per-store)
 *   dailyCapReview             — shown when today's auto-credit cap is hit
 *                                and the extra cup is held for review (A4)
 *   scanSuccess                — the +1 confirmation
 */
export const COPY_PRESETS = {
  deposit: {
    heroHeadline: 'Collect & Get Rewards',
    heroSubtext:  'Return your packaging and earn cashback.',
    // Intro line under the logo on the multi-venue Stores page.
    storesIntro:  'Return your packaging, scan, and earn cashback — your cups are saved separately at each participating store.',
    designCopy: {
      badgeText:         'My Cups',
      shareButtonLabel:  'Share a cup',
      donateButtonLabel: 'Donate cups',
      nextCupFreeLabel:  'Next cup for free',
      activityLabel:     'Activity',
      refundButtonLabel: 'Get direct refund',
    },
    howItWorks: {
      title: 'How does it work?',
      steps: [
        { title: 'Return your packaging', body: 'Drop your cup or packaging into the SmartBin at the counter.' },
        { title: 'Scan to collect',       body: 'Scan the receipt or QR you get so the cup lands in your balance.' },
        { title: 'Earn cashback',         body: 'Every returned cup counts toward real cashback, paid to your bank.' },
      ],
    },
    terms: {
      title: 'The fine print',
      intro: 'By collecting cups you agree to a few simple rules:',
      points: [
        'Cups are added when you return your packaging and scan the receipt or QR you receive.',
        'Cups convert to cashback in euros, paid to the bank account (IBAN) you provide.',
        'One cup is credited per returned item; abuse or automated scanning may be reviewed.',
      ],
    },
    crossOrgNotice: {
      title: 'A separate balance here',
      body:  'Each store keeps its own cup balance. This cup is added at this store — your cups at other stores stay where they are.',
    },
    dailyCapReview: {
      title: 'This one’s being checked',
      body:  'You’ve reached today’s automatic limit. This extra cup has been sent for a quick review and will appear once it’s approved.',
    },
    scanSuccess: {
      title: 'Cup added',
      body:  'Nice — that’s another cup toward your cashback.',
    },
  },

  byo: {
    heroHeadline: 'Bring your cup, earn cashback',
    heroSubtext:  'Use your own reusable cup and collect rewards every time you refill.',
    // Intro line under the logo on the multi-venue Stores page.
    storesIntro:  'Bring your own cup to any café below and scan the QR to collect cups — then turn them into real cashback. New here? Just pick a store to start.',
    designCopy: {
      badgeText:         'My Cups',
      shareButtonLabel:  'Share a cup',
      donateButtonLabel: 'Donate cups',
      nextCupFreeLabel:  'Next refill reward',
      activityLabel:     'Activity',
      refundButtonLabel: 'Get my cashback',
    },
    howItWorks: {
      title: 'How does it work?',
      // Each step carries its own illustration + palette (public/how-it-works/
      // byo-N.png), so the BYO guide is fully self-contained rather than reusing
      // the deposit-model artwork.
      steps: [
        { title: 'Bring your own cup',    body: 'Visit a participating café with your reusable cup — no deposit, no single-use packaging.', image: '/how-it-works/byo-1.png', bg: 'linear-gradient(165deg, #FBEDE4 0%, #F6D8C6 100%)', accent: '#E88E63', icon: 'cup' },
        { title: 'Get +1 cup',            body: 'Scan the QR at the counter and one cup is added to your balance at that venue.', image: '/how-it-works/byo-2.png', bg: 'linear-gradient(165deg, #EAF6EC 0%, #D6ECD9 100%)', accent: '#5FA96E', icon: 'cup' },
        { title: 'Collect across venues', body: 'Track your progress here and at every other participating store — each keeps its own balance.', image: '/how-it-works/byo-3.png', bg: 'linear-gradient(165deg, #ECEDFB 0%, #DCE0F8 100%)', accent: '#7C86D6', icon: 'store' },
        { title: 'Scan your receipt',     body: 'Once you’ve collected enough cups, buy your reward and scan the store receipt so we can verify your purchase.', image: '/how-it-works/byo-4.png', bg: 'linear-gradient(165deg, #FCF3D2 0%, #F8E7B0 100%)', accent: '#E5B23A', icon: 'receipt' },
        { title: 'Receive your cashback', body: 'After your receipt is approved, your cashback lands in the bank account (IBAN) you provided.', image: '/how-it-works/byo-5.png', bg: 'linear-gradient(165deg, #EAF7EF 0%, #D8F0E4 100%)', accent: '#57C08D', icon: 'cash' },
      ],
    },
    terms: {
      title: 'The fine print',
      intro: 'By collecting cups you agree to a few simple rules:',
      points: [
        'This is a bring-your-own-cup programme — there is no deposit to pay and nothing to return to a machine.',
        'Scan the counter QR once per drink served in your own reusable cup.',
        'To keep things fair, up to 2 cups are added automatically per 24 hours; anything beyond that is held for a quick review before it’s credited.',
        'Cups convert to cashback in euros, paid to the bank account (IBAN) you provide.',
        'Each store keeps its own cup balance — cups you collect at one venue stay with that venue.',
      ],
    },
    crossOrgNotice: {
      title: 'A new store, a fresh balance',
      body:  'You’re collecting at a different store in this group. This cup is added here — each store keeps its own balance, so your cups at other venues stay exactly where they are.',
    },
    dailyCapReview: {
      title: 'You’ve reached today’s cup limit',
      body:  'There’s a limit on how many cups you can collect per day at this store, and you’ve hit it for today. We’ll review this scan and, if it’s valid, add the cup to your balance.',
    },
    scanSuccess: {
      title: 'Cup added',
      body:  'Nice one — that’s another cup toward your cashback.',
    },
  },
};

/* Resolve a preset, defaulting to the deposit model for unknown/legacy
 * modes so nothing ever renders empty. */
export function getCopyPreset(mode) {
  return COPY_PRESETS[mode] || COPY_PRESETS.deposit;
}

/* Normalise an arbitrary value to a valid mode. */
export function normalizeMode(mode) {
  return COPY_MODES.includes(mode) ? mode : 'deposit';
}
