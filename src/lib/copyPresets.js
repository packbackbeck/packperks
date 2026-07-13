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
    storesIntro:  'Return your packaging, scan, and earn cashback. Your cups are saved separately at each participating store.',
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
        { title: 'Earn cashback',         body: 'Every returned cup counts toward real cashback, sent to you via a Tikkie link.' },
      ],
    },
    terms: {
      title: 'The fine print',
      intro: 'By collecting cups you agree to a few simple rules:',
      points: [
        'Cups are added when you return your packaging and scan the receipt or QR you receive, one cup per returned item.',
        'To keep things fair, extra scans beyond the daily limit are held for a quick review before they’re credited.',
        'Each store keeps its own cup balance. Cups you collect at one venue stay with that venue, and you can switch your reward goal any time before you claim.',
        'To claim a reward you first add and verify your email (we send you a 6-digit code), then upload a clear photo of the printed store receipt for the reward item.',
        'We accept genuine printed store/till receipts that clearly show the reward item and are dated within the last 30 days.',
        'We can’t accept screenshots, photos of a screen, edited or AI-generated images, blurry or unreadable photos, receipts that don’t show the reward item, or receipts dated before you collected your cups.',
        'Each receipt can be used once. A receipt already used for a claim can’t be submitted again.',
        'An automated check pre-screens your photo, but a PackPerks team member makes the final decision. Approval usually takes a few days, and no later than 7.',
        'Once approved, your cups convert to cashback in euros: we send a secure Tikkie link for you to collect it yourself (we never ask for your bank details). Collect it promptly, as Tikkie links expire.',
        'Please play fair. Abuse, automated scanning, or duplicate/altered receipts may lead to a review and the removal of cups.',
      ],
    },
    crossOrgNotice: {
      title: 'A separate balance here',
      body:  'Each store keeps its own cup balance. This cup is added at this store. Your cups at other stores stay where they are.',
    },
    dailyCapReview: {
      title: 'This one’s being checked',
      body:  'You’ve reached today’s automatic limit. This extra cup has been sent for a quick review and will appear once it’s approved.',
    },
    scanSuccess: {
      title: 'Cup added',
      body:  'Nice, that’s another cup toward your cashback.',
    },
  },

  byo: {
    heroHeadline: 'Bring your cup, earn cashback',
    heroSubtext:  'Use your own reusable cup and collect rewards every time you refill.',
    // Intro line under the logo on the multi-venue Stores page.
    storesIntro:  'PackPerks pays you back for reusing your cup. Collect cups at the cafés below and turn them into real cashback, no deposit, no catch.',
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
        { title: 'Bring your reusable cup', body: 'Bring your reusable cup and scan the QR code.', image: '/how-it-works/byo-1.png', bg: 'linear-gradient(165deg, #FBEDE4 0%, #F6D8C6 100%)', accent: '#E88E63', icon: 'cup' },
        { title: 'Collect enough cups',     body: 'Collect enough cups to unlock a reward.', image: '/how-it-works/byo-2.png', bg: 'linear-gradient(165deg, #EAF6EC 0%, #D6ECD9 100%)', accent: '#5FA96E', icon: 'cup' },
        { title: 'Buy it and get cashback', body: 'Buy the rewarded item and get full cashback.', image: '/how-it-works/byo-5.png', bg: 'linear-gradient(165deg, #EAF7EF 0%, #D8F0E4 100%)', accent: '#57C08D', icon: 'cash' },
      ],
    },
    terms: {
      title: 'The fine print',
      intro: 'By collecting cups, you agree to a few simple rules:',
      points: [
        'Scan the counter QR once per drink served in your own reusable cup.',
        'To keep things fair, up to 2 cups can be added per 24 hours. Anything beyond that may be held for a quick review before it is credited.',
        'Each store keeps its own cup balance. Cups you collect at one venue stay with that venue, and you can switch your reward goal any time before you claim.',
        'To claim a reward, first add and verify your email. Then scan the printed store receipt for the reward item in the PackPerks flow.',
        'We accept genuine printed store or till receipts that clearly show the reward item and are dated within the last 30 days.',
        'We can’t accept screenshots, photos of a screen, edited or AI-generated images, blurry or unreadable scans, receipts that don’t show the reward item, or receipts dated before you collected enough cups for that reward.',
        'Each receipt can be used once. A receipt already used for a claim can’t be submitted again.',
        'An automated check pre-screens your receipt scan, but an admin makes the final decision. Approval usually takes a few days, and no later than 7 days.',
        'Once approved, your cups convert to cashback in euros. We send you a secure Tikkie Cashback link so you can collect the payout yourself through Tikkie. We never ask for your bank details.',
        'Your Tikkie Cashback link expires after 2 weeks. Please collect your cashback before the link expires. If it expires, the claim may need to be reviewed again before a new link can be issued.',
        'Please play fair. Abuse, automated scanning, repeated fake claims, or duplicate or altered receipts may lead to a review and the removal of cups.',
      ],
    },
    crossOrgNotice: {
      title: 'A new store, a fresh balance',
      body:  'You’re collecting at a different store in this group. This cup is added here. Each store keeps its own balance, so your cups at other venues stay exactly where they are.',
    },
    dailyCapReview: {
      title: 'You’ve reached today’s cup limit',
      body:  'There’s a limit on how many cups you can collect per day at this store, and you’ve hit it for today. We’ll review this scan and, if it’s valid, add the cup to your balance.',
    },
    scanSuccess: {
      title: 'Cup added',
      body:  'Nice one, that’s another cup toward your cashback.',
    },
  },
};

/* Resolve a preset. D.6: default to BYO — that's the product now; `deposit`
 * stays reachable but only when a group/org explicitly chooses it, so an
 * unspecified mode no longer greets customers with SmartBin wording. */
export function getCopyPreset(mode) {
  return COPY_PRESETS[mode] || COPY_PRESETS.byo;
}

/* Normalise an arbitrary value to a valid mode (D.6: unknown → byo). */
export function normalizeMode(mode) {
  return COPY_MODES.includes(mode) ? mode : 'byo';
}
