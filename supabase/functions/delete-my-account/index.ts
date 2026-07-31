// PackPerks - delete-my-account Edge Function
//
// Self-service account erasure for a REGISTERED customer (GDPR right to be
// forgotten). The caller must present their own Supabase auth session, so a
// person can only ever delete their OWN footprint.
//
// The actual deletion is done by the purge_my_account() Postgres function, which
// gathers EVERY users row belonging to this person via connected components —
// by auth_user_id, by their current device_id, AND by any shared identity graph
// (including tombstones) — then deletes activity/claims/users (cup_balances +
// cup_scans cascade) and every customer_identity in the set (payout_details
// cascade). This closes the "account came back after delete" bug, where the old
// version found identities only by auth_user_id (which was null on the scattered
// identities) and left rows + identities behind for the device to resurface.
// Finally we remove the auth user so the email is fully forgotten.
//
// Body: { device_id?: string }. Auth: verify_jwt = true.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'missing_token' }, 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return json({ error: 'invalid_token' }, 401);
  const authUid = user.id;

  let body: { device_id?: string } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const deviceId = (body?.device_id || '').trim() || null;

  try {
    const { data, error } = await supabase.rpc('purge_my_account', {
      p_auth: authUid,
      p_device: deviceId,
    });
    if (error) return json({ error: 'delete_failed', detail: error.message }, 500);

    // Finally remove the auth user so the email is fully forgotten and can't
    // resurface an account on next load.
    try { await supabase.auth.admin.deleteUser(authUid); } catch (_e) { /* best-effort */ }

    return json({ deleted: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    return json({ error: 'delete_failed', detail: String(e) }, 500);
  }
});
