// PackPerks - delete-my-account Edge Function
//
// Self-service account erasure for a REGISTERED customer (GDPR right to be
// forgotten). The caller must present their own Supabase auth session (they
// only have one once they've verified an email), so a person can only ever
// delete their OWN footprint — never someone else's.
//
// Deletes, for the identity behind the caller's auth user:
//   • every users row that shares their identity (all stores in a BYO group)
//   • their activity_history + claims (FK is NO ACTION, so delete first)
//   • cup_balances + cup_scans cascade automatically with the users rows
//   • their customer_identities row(s) (payout_details cascade)
//   • the auth user itself
//
// Body: none needed. Auth: verify_jwt = true (a real session is required).

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

  try {
    // Identity/identities behind this auth user.
    const { data: idRows } = await supabase.from('customer_identities').select('id').eq('auth_user_id', authUid);
    const identityIds = (idRows || []).map((r: { id: string }) => r.id);

    // Every users row belonging to this person: linked by identity OR directly
    // by auth_user_id (a device row that adopted this auth user).
    const userIds = new Set<string>();
    const { data: byAuth } = await supabase.from('users').select('id').eq('auth_user_id', authUid);
    (byAuth || []).forEach((u: { id: string }) => userIds.add(u.id));
    if (identityIds.length) {
      const { data: byId } = await supabase.from('users').select('id').in('identity_id', identityIds);
      (byId || []).forEach((u: { id: string }) => userIds.add(u.id));
    }
    const ids = [...userIds];

    if (ids.length) {
      // FK delete_rule is NO ACTION for these two — remove them first.
      await supabase.from('activity_history').delete().in('user_id', ids);
      await supabase.from('claims').delete().in('user_id', ids);
      // Deleting the users rows cascades cup_balances + cup_scans, and NULLs the
      // cups/byo references.
      const { error: delUsersErr } = await supabase.from('users').delete().in('id', ids);
      if (delUsersErr) return json({ error: 'delete_failed', detail: delUsersErr.message }, 500);
    }

    if (identityIds.length) {
      await supabase.from('customer_identities').delete().in('id', identityIds); // cascades payout_details
    }

    // Finally remove the auth user so the email is fully forgotten.
    try { await supabase.auth.admin.deleteUser(authUid); } catch (_e) { /* best-effort */ }

    return json({ deleted: true, users: ids.length, identities: identityIds.length });
  } catch (e) {
    return json({ error: 'delete_failed', detail: String(e) }, 500);
  }
});
