// PackPerks - merge-status Edge Function
//
// Tells the customer app whether the signed-in person currently has an
// account-merge request that is STILL WAITING for admin review.
//
// Why this exists: the weekly merge limit means a merge can be "held" — filed
// as a pending merge_request instead of running immediately. While it's held,
// the customer must keep seeing ONLY their current account + current balance,
// never the merged total. The app can't read merge_requests directly (RLS is
// admin-only), so it asks here. When admin approves (or rejects) the request,
// its status leaves 'pending' and this returns { pending: false } — the app
// then adopts the shared identity and the merged view appears.
//
// Body: none. Auth: verify_jwt = true (a real session identifies the person).

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
  if (!jwt) return json({ pending: false });
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return json({ pending: false });
  const authUid = user.id;
  const email = (user.email || '').trim().toLowerCase();

  try {
    // Every users row this person owns: linked directly by auth_user_id, or via
    // any customer_identities row that carries this auth user.
    const userIds = new Set<string>();
    const { data: byAuth } = await supabase.from('users').select('id').eq('auth_user_id', authUid);
    (byAuth || []).forEach((u: { id: string }) => userIds.add(u.id));
    const { data: idRows } = await supabase.from('customer_identities').select('id').eq('auth_user_id', authUid);
    const identityIds = (idRows || []).map((r: { id: string }) => r.id);
    if (identityIds.length) {
      const { data: byId } = await supabase.from('users').select('id').in('identity_id', identityIds);
      (byId || []).forEach((u: { id: string }) => userIds.add(u.id));
    }
    const ids = [...userIds];

    // A pending request that names any of this person's rows as the survivor,
    // OR one filed under their email, means a merge is awaiting review.
    let pending = false;
    if (ids.length) {
      const { data: bySurv } = await supabase
        .from('merge_requests')
        .select('id')
        .eq('status', 'pending')
        .in('survivor_user_id', ids)
        .limit(1);
      pending = !!(bySurv && bySurv.length);
    }
    if (!pending && email) {
      const { data: byEmail } = await supabase
        .from('merge_requests')
        .select('id')
        .eq('status', 'pending')
        .eq('email', email)
        .limit(1);
      pending = !!(byEmail && byEmail.length);
    }

    return json({ pending });
  } catch (e) {
    // Fail open to "not pending" — a transient error must never permanently
    // trap a user in the current-account-only view.
    return json({ pending: false, error: String(e) });
  }
});
