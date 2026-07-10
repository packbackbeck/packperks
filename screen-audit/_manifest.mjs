// Screen manifest for _capture.mjs — BYO group (byonl: la-place + chco).
// Numbered by FLOW STEP: step number + variation letter (3A/3B/3C…), so the
// filenames line up with the flow chart in index.html. name → PNG filename;
// shot → ?__shot= preset; path → venue home vs group hub; full → whole page;
// consent:false → keep the cookie banner up; clickText → advance the UI first.
const VENUE = '/byonl/la-place'  // a real BYO venue (mode: byo)
const HUB   = '/byonl'          // the group's Stores hub

export const MANIFEST = [
  // ── Step 1 · App opens ──
  { name: '01a-loading',           shot: 'loading',        path: VENUE },
  { name: '01b-cookie-consent',    shot: 'home-empty',     path: VENUE, consent: false },

  // ── Step 2 · Discover venues (Stores hub) ──
  { name: '02a-stores-list',       shot: 'stores-list',    path: HUB, full: true },
  { name: '02b-stores-map',        shot: 'stores-map',     path: HUB, clickText: 'Map', settle: 1600 },

  // ── Step 3 · Venue home, as cups grow ──
  { name: '03a-home-empty',        shot: 'home-empty',     path: VENUE, full: true },
  { name: '03b-home-partial',      shot: 'home-partial',   path: VENUE, full: true },
  { name: '03c-home-full',         shot: 'home-full',      path: VENUE, full: true },
  { name: '03d-home-member',       shot: 'home-member',    path: VENUE, full: true },

  // ── Step 4 · Explore a reward / info ──
  { name: '04a-reward-detail',     shot: 'reward-detail',  path: VENUE },
  { name: '04b-cashback-terms',    shot: 'terms',          path: VENUE },
  { name: '04c-how-it-works',      shot: 'how-it-works',   path: VENUE },
  // The story guide is a 5-step Stories-style walkthrough; 04c is step 1
  // ("Bring your own cup"). These advance it to capture steps 2–5.
  { name: '04c2-guide-add-cup',    shot: 'how-it-works',   path: VENUE, advance: 1 }, // Get +1 cup
  { name: '04c3-guide-venues',     shot: 'how-it-works',   path: VENUE, advance: 2 }, // Collect across venues
  { name: '04c4-guide-receipt',    shot: 'how-it-works',   path: VENUE, advance: 3 }, // Scan your receipt
  { name: '04c5-guide-cashback',   shot: 'how-it-works',   path: VENUE, advance: 4 }, // Receive your cashback

  // ── Step 5 · Collect cups (counter QR) ──
  { name: '05a-cup-scan',          shot: 'cup-scan',         path: VENUE },
  { name: '05b-cup-added',         shot: 'cup-scan-success', path: VENUE },
  { name: '05c-scan-error',        shot: 'cup-scan-error',   path: VENUE },
  { name: '05d-daily-limit',       shot: 'byo-popup',        path: VENUE },

  // ── Step 6 · Email gate / sign-in ──
  { name: '06a-email',             shot: 'signin-idle',     path: VENUE },
  { name: '06b-code-sent',         shot: 'signin-sent',     path: VENUE },
  { name: '06c-verified',          shot: 'signin-signedin', path: VENUE },
  { name: '06d-change-email',      shot: 'signin-change',   path: VENUE },
  { name: '06e-merge',             shot: 'signin-merge',    path: VENUE },

  // ── Step 7 · Submit receipt ──
  { name: '07a-receipt-rules',     shot: 'receipt-rules',   path: VENUE, full: true },
  { name: '07b-receipt-camera',    shot: 'receipt-camera',  path: VENUE, clickText: 'Understood', settle: 1600 },
  { name: '07c-verifying',         shot: 'verifying',       path: VENUE },

  // ── Step 8 · Verdict ──
  { name: '08a-approved',          shot: 'success',         path: VENUE, full: true },
  { name: '08b-approved-add-email',shot: 'success-noemail', path: VENUE, full: true },
  { name: '08c-rejected',          shot: 'rejected',        path: VENUE, full: true },

  // ── Step 9 · Account / collect ──
  { name: '09a-account-member',    shot: 'user-member',     path: VENUE, full: true },
  { name: '09b-account-visitor',   shot: 'user-visitor',    path: VENUE, full: true },
  { name: '09c-account-combined',  shot: 'user-combined',   path: VENUE, full: true },

  // ── Step 10 · Interrupts & system states ──
  { name: '10a-inapp-prompt',      shot: 'inapp-prompt',    path: VENUE },
  { name: '10b-budget-paused',     shot: 'budget-paused',   path: VENUE },
  { name: '10c-error',             shot: 'error',           path: VENUE },
  { name: '10d-maintenance',       shot: 'maintenance',     path: VENUE },
]
