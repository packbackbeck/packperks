// DEV-ONLY screen-audit harness. Maps a ?__shot=<name> preset to customer-app
// state so the audit script (screen-audit/_capture.mjs) can force every screen
// + variation deterministically. Rendered INSIDE the real BYO group (/byo):
// the App shot block resolves the real org/group/config (authentic BYO copy,
// venues, rewards, Stores hub) and then applies these overrides on top.
// Reward-linked fields (featured reward, claims) are resolved against the
// venue's REAL rewards in App.jsx. DEV-only; removed after the audit.
//
// la-place featured reward = its first live reward (Verse sinaasappelsap, 12
// cups, €4.80). Donations + direct refunds are disabled for this venue, so
// those screens are intentionally absent.

const memberProfile = { displayName: 'Sanne de Vries', animalIndex: 4, email: 'sanne@example.com', marketingConsent: true };
const visitorProfile = { displayName: 'Sanne de Vries', animalIndex: 4, email: '', marketingConsent: false };

export const SHOT_PRESETS = {
  // ── Venue home (BYO), across cup states (featured reward needs 12 cups) ──
  'home-empty':     { page: 'home', cupCount: 0,  profile: visitorProfile, lifetimeCups: 0 },
  'home-partial':   { page: 'home', cupCount: 6,  profile: visitorProfile, lifetimeCups: 6 },
  'home-full':      { page: 'home', cupCount: 12, profile: memberProfile, authEmail: memberProfile.email, lifetimeCups: 12 },
  'home-member':    { page: 'home', cupCount: 7,  profile: memberProfile, authEmail: memberProfile.email, lifetimeCups: 26, claims: 'pending' },

  // Smart sorting (la-place rewards: 1, 1, 5, 8, 9, 9, 10 cups).
  // Off, 6 cups → the admin's featured 5-cup reward. On, 6 cups → nothing
  // at 7, nothing at 6, so the nearest goal ahead: the 8-cup one.
  'smart-off':      { page: 'home', cupCount: 6, profile: visitorProfile, lifetimeCups: 6, settings: { featureSmartSorting: false } },
  'smart-on':       { page: 'home', cupCount: 6, profile: visitorProfile, lifetimeCups: 6, settings: { featureSmartSorting: true } },
  // First-scan case the feature exists for: 1 cup in hand, so the goal
  // becomes a 1-cup reward they've already reached rather than a distant one.
  'smart-first':    { page: 'home', cupCount: 1, profile: visitorProfile, lifetimeCups: 1, settings: { featureSmartSorting: true } },

  // ── Reward exploration + info overlays (over home) ──
  'reward-detail':  { page: 'home', cupCount: 6,  profile: memberProfile, detailIdx: 3 },
  'terms':          { page: 'home', cupCount: 12, profile: memberProfile, termsOpen: true },
  'how-it-works':   { page: 'home', cupCount: 0,  profile: visitorProfile, howItWorksOpen: true },
  'byo-popup':      { page: 'home', cupCount: 2,  profile: memberProfile, byoResult: { title: 'You’ve reached today’s cup limit', body: 'You’ve hit today’s cup limit at this venue. We’ll review this scan and, if it’s valid, add the cup to your balance.' } },
  'budget-paused':  { page: 'home', cupCount: 12, profile: memberProfile, budgetPausedOpen: true, settings: { budgetPausedTitle: 'Rewards are paused', budgetPausedBody: 'This month’s reward budget is fully committed. Your cups are safe, check back soon.' } },
  'inapp-prompt':   { page: 'home', cupCount: 0,  profile: visitorProfile, inAppClaim: { platform: 'instagram', parsed: {} } },
  'cup-scan-success': { page: 'cup-scan-success', cupCount: 6, lastCupsScanned: 1, profile: memberProfile },

  // ── Email / sign-in sheet states ──
  'signin-idle':     { page: 'home', cupCount: 0,  profile: visitorProfile, showSignIn: true, signInStatus: 'idle' },
  'signin-sent':     { page: 'home', cupCount: 0,  profile: visitorProfile, showSignIn: true, signInStatus: 'sent', signInEmail: 'sanne@example.com' },
  'signin-signedin': { page: 'home', cupCount: 12, profile: memberProfile, authEmail: memberProfile.email, showSignIn: true, signInStatus: 'signedIn', signInEmail: memberProfile.email },
  'signin-change':   { page: 'home', cupCount: 12, profile: memberProfile, authEmail: memberProfile.email, showSignIn: true, signInStatus: 'change_email', signInEmail: memberProfile.email },
  'signin-merge':    { page: 'home', cupCount: 0,  profile: visitorProfile, showSignIn: true, signInStatus: 'merge_offer', signInEmail: 'sanne@example.com' },

  // ── Claim → receipt → verdict flow ──
  'receipt-rules':   { page: 'receipt', cupCount: 12, profile: memberProfile },
  'receipt-camera':  { page: 'receipt', cupCount: 12, profile: memberProfile },
  'verifying':       { page: 'verifying', cupCount: 12, profile: memberProfile },
  'success':         { page: 'success', cupCount: 0, profile: memberProfile, authEmail: memberProfile.email, lastClaimId: 'demo-pending' },
  'success-noemail': { page: 'success', cupCount: 0, profile: visitorProfile, lastClaimId: 'demo-pending' },
  'rejected':        { page: 'rejected', cupCount: 12, profile: memberProfile, aiVerdict: { failureChecks: ['is_receipt', 'contains_required_item'], skippedChecks: [], isSystemError: false, summary: 'This looks like a screenshot rather than a printed store receipt. Please upload a clear photo of the paper receipt.' }, aiRequiredItem: 'Verse sinaasappelsap', lastClaimId: 'demo-rejected' },

  // ── Cup scanner (BYO counter QR) ──
  'cup-scan':        { page: 'cup-scan', profile: memberProfile },
  'cup-scan-error':  { page: 'cup-scan-error', cupScanError: { code: 'already_claimed', reason: 'These cups were already added to your balance.', alreadyClaimed: true }, profile: memberProfile },

  // ── Account / profile page ──
  'user-visitor':    { page: 'user', cupCount: 0,  profile: visitorProfile, lifetimeCups: 0 },
  'user-member':     { page: 'user', cupCount: 7,  profile: memberProfile, authEmail: memberProfile.email, lifetimeCups: 26, claims: 'mix' },
  'user-rejected':   { page: 'user', cupCount: 7,  profile: memberProfile, authEmail: memberProfile.email, lifetimeCups: 26, claims: 'rejected' },
  'user-combined':   { page: 'user', accountCombined: true, profile: memberProfile, authEmail: memberProfile.email, lifetimeCups: 26, claims: 'mix', memberBalances: [7, 4] },

  // ── Stores hub (the BYO multi-venue screen) ──
  'stores-list':     { page: 'stores', profile: memberProfile, memberBalances: [7, 4] },
  'stores-map':      { page: 'stores', profile: memberProfile, memberBalances: [7, 4] }, // script toggles to Map
  'stores-claim':    { page: 'stores', profile: memberProfile, authEmail: memberProfile.email, memberBalances: [7, 4], claims: 'pending' }, // hub + pending-claim box

  // ── App-level states ──
  'loading':         { hold: true },
  'error':           { initError: 'duplicate key value violates unique constraint "users_device_org_key"' },
  'maintenance':     { settings: { maintenanceMode: true } },
};

export function getShotPreset(name) {
  return SHOT_PRESETS[name] || null;
}
