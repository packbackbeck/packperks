import { supabase } from '../../lib/supabase';
import { getActiveOrgId } from '../context/orgState';

/* ─────────────────────────────────────────────────────────────────────
 * logAction — writes one row into admin_action_log.
 *
 * Designed to be called inline alongside any mutation an admin makes:
 *
 *   await updateClaimStatus(id, 'completed');
 *   await logAction({
 *     action: 'claim.approve',
 *     targetType: 'claim',
 *     targetId: id,
 *     before: { status: 'pending' },
 *     after:  { status: 'completed' },
 *     metadata: { payout_eur: 5.49 },
 *   });
 *
 * The RLS policy on admin_action_log requires actor_id = auth.uid(), so
 * we read the current session to fill that in. Best-effort: failures are
 * logged to the console and swallowed — the surrounding mutation must
 * not be rolled back because the audit row didn't write.
 *
 * `actor_email` is captured at write-time so deleted admins still show a
 * sensible label in the activity feed.
 * ───────────────────────────────────────────────────────────────────── */
export async function logAction({
  action,
  targetType = null,
  targetId   = null,
  before     = null,
  after      = null,
  metadata   = null,
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // not signed in — silently skip (e.g., during signup)

    // Look up our org + email in one go. RLS lets us read our own row.
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('email, org_id')
      .eq('id', user.id)
      .maybeSingle();

    // Prefer the currently-active org from the switcher over the
    // admin's home-org so PackPerks staff actions get logged under
    // whichever client org they're managing right now.
    const orgId = getActiveOrgId() || profile?.org_id || null;
    const { error } = await supabase.from('admin_action_log').insert({
      actor_id:    user.id,
      actor_email: profile?.email || user.email || null,
      org_id:      orgId,
      action,
      target_type: targetType,
      target_id:   targetId,
      before_state: before,
      after_state:  after,
      metadata,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      // IP is intentionally omitted — collecting it client-side is
      // unreliable. Edge-function-mediated actions capture it from
      // x-forwarded-for.
    });
    if (error) console.error('logAction insert failed:', error);
  } catch (e) {
    console.error('logAction crashed:', e);
  }
}
