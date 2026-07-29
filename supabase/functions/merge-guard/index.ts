// PackPerks - merge-guard Edge Function
//
// A pre-check the client calls BEFORE performing an account merge (either the
// merge-offer path -> merge-by-email, or the lost-my-cups path ->
// restore-by-email). It enforces a per-org WEEKLY merge limit:
//
//   under the limit -> logs a 'completed' merge_requests row (the counter for
//     future attempts) and returns { held: false }; the client then runs the
//     real merge as usual.
//   at/over the limit -> files a 'pending' merge_requests row for admin review
//     and returns { held: true, message } with the org's configurable copy;
//     the client shows that and does NOT merge.
//
// Body: { device_id, source? }  (source: 'merge_by_email' | 'restore')
// Auth: the caller's Supabase OTP JWT proves email ownership.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

interface Row { id: string; org_id: string | null; auth_user_id: string | null; merged_into: string | null; updated_at: string | null; created_at: string | null; }
const ts = (r: Row) => new Date(r.updated_at || r.created_at || 0).getTime();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'missing_token' }, 401);
  const { data: ud } = await supabase.auth.getUser(jwt);
  const authUser = ud?.user;
  const email = (authUser?.email || '').toLowerCase();
  if (!email) return json({ error: 'no_email' }, 400);

  let deviceId = '';
  let source = 'merge_by_email';
  try {
    const b = await req.json();
    deviceId = typeof b?.device_id === 'string' ? b.device_id : '';
    if (b?.source === 'restore') source = 'restore';
  } catch { /* body optional */ }

  // Candidate rows: same-email live rows (+ the device row).
  const sel = 'id, org_id, auth_user_id, merged_into, updated_at, created_at';
  const { data: emailRows } = await supabase.from('users').select(sel).ilike('email', email).is('merged_into', null);
  let candidates = ((emailRows || []) as Row[]).slice();
  let deviceRow: Row | null = null;
  if (deviceId) {
    const { data: dr } = await supabase.from('users').select(sel).eq('device_id', deviceId).maybeSingle();
    if (dr && !(dr as Row).merged_into && !candidates.find((c) => c.id === (dr as Row).id)) {
      deviceRow = dr as Row;
      candidates.push(deviceRow);
    }
  }
  if (!candidates.length) return json({ held: false, reason: 'no_candidates' });

  // Org-scope + survivor/absorbed resolution (mirrors merge-by-email).
  const anchor = deviceRow || candidates.find((c) => c.auth_user_id === authUser!.id) || candidates[0];
  const orgId = anchor.org_id;
  candidates = candidates.filter((c) => c.org_id === orgId);
  const survivor = candidates.find((c) => c.auth_user_id === authUser!.id)
    || [...candidates].sort((a, b) => ts(b) - ts(a))[0];
  const absorbed = candidates.filter((c) => c.id !== survivor.id).map((c) => c.id);
  // A cross-store link (this email already has an account in another store)
  // is itself a merge event for the person's single identity, so it must be
  // limit-gated too — not just same-store duplicates.
  const crossOrg = ((emailRows || []) as Row[]).some((r) => r.org_id !== orgId);
  if (!absorbed.length && !crossOrg) return json({ held: false, reason: 'nothing_to_merge' });

  // Per-org weekly limit + copy.
  const { data: limitCfg } = await supabase.from('app_config').select('value').eq('key', `merge:limit:${orgId}`).maybeSingle();
  const cfg = (limitCfg?.value || {}) as { weeklyLimit?: number; limitCopy?: string };
  // 0 is a valid setting (hold every merge for review). Number('0')||1 would
  // wrongly become 1, so guard with isFinite and clamp to 0..20.
  const rawLimit = Number(cfg.weeklyLimit);
  const weeklyLimit = Math.max(0, Math.min(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 1));
  const limitCopy = cfg.limitCopy
    || 'You have reached this store weekly account-merge limit. We have sent your request to the store for review, and they will approve it shortly.';
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from('merge_requests').select('id', { count: 'exact', head: true })
    .eq('email', email).in('status', ['completed', 'approved', 'admin']).gte('requested_at', weekAgo);

  if ((count || 0) >= weeklyLimit) {
    const { data: existing } = await supabase.from('merge_requests').select('id')
      .eq('email', email).eq('status', 'pending').gte('requested_at', weekAgo).maybeSingle();
    if (!existing) {
      await supabase.from('merge_requests').insert({
        org_id: orgId, survivor_user_id: survivor.id, absorbed_user_ids: absorbed,
        email, device_id: deviceId, source, status: 'pending',
        reason: `Weekly merge limit reached (${weeklyLimit}/week)`,
      });
    }
    return json({ held: true, message: limitCopy, weekly_limit: weeklyLimit });
  }

  // Under the limit: record it (this is also the counter for the next attempt).
  await supabase.from('merge_requests').insert({
    org_id: orgId, survivor_user_id: survivor.id, absorbed_user_ids: absorbed,
    email, device_id: deviceId, source, status: 'completed',
    reason: 'Within weekly limit', decided_at: new Date().toISOString(),
  });
  return json({ held: false });
});
