import { supabase } from './supabase'
import { generateProfile } from './animals'

// ── Device identity ────────────────────────────────────────────────────────
// The only thing that stays in localStorage: a stable device fingerprint.
//
// `crypto.randomUUID()` is only defined in secure contexts (HTTPS or
// localhost/127.0.0.1). When the dev server is reached via a raw LAN IP
// (e.g. http://10.43.22.14:5173 from a phone), the browser leaves it
// undefined and this used to throw — which crashed init before any
// Supabase calls fired. Fall back to a manual v4 UUID generator when
// missing so LAN testing works without HTTPS.
function safeUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function getDeviceId() {
  let id = localStorage.getItem('packperks_device_id')
  if (!id) {
    id = safeUUID()
    localStorage.setItem('packperks_device_id', id)
  }
  return id
}

// ── Profile generation (for brand-new users) ───────────────────────────────
// A random adjective + animal (e.g. "Bouncy Axolotl"), with a matching emoji
// avatar. Lists + avatars live in ./animals so the app and this module stay in
// sync (animal_index points into ANIMALS there).
export function generateInitialProfile() {
  return generateProfile()
}

// ── Timestamp formatter ────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── User ───────────────────────────────────────────────────────────────────
// Hybrid identity model:
//
//   1. **Anonymous (default)** — keyed by localStorage `device_id`. Works
//      with zero friction on first run; clearing the browser data loses
//      the balance.
//   2. **Linked to Supabase Auth** — once the user verifies an email via
//      magic link, we set `users.auth_user_id` and from then on they can
//      sign in from any device and re-bind the row to a new device_id.
//
// `getOrCreateUser()` prefers the auth path when a Supabase session is
// present (i.e. the user has signed in with their email at least once),
// and falls back to the device path otherwise. Returning an existing
// row by either lookup is always preferred over inserting a duplicate.

/* The (device_id, org_id) slot is UNIQUE. When an insert hits that constraint
 * (23505), some row already holds the slot — either a StrictMode double-insert,
 * or (the real bug) a TOMBSTONE left behind after an email merge, whose
 * `merged_into` points at the surviving account. Resolve to a usable live row:
 *   • tombstone → follow `merged_into` to the survivor (and adopt the auth user
 *     onto it if it's not linked yet),
 *   • live but unlinked → adopt the auth user,
 *   • otherwise → just return whoever holds the slot.
 * Returns null only if the slot genuinely can't be resolved. */
async function resolveDeviceOrgOccupant(deviceId, orgId, authUid = null, authEmail = null) {
  let q = supabase.from('users').select('*').eq('device_id', deviceId)
  if (orgId) q = q.eq('org_id', orgId)
  const { data: occupant } = await q.maybeSingle()
  if (!occupant) return null

  // Follow the merge chain (tombstone → survivor → … → survivor) to the final
  // live row. An email reused across MANY accounts can produce a multi-hop
  // chain, so a single hop isn't enough. Cap the walk to avoid any cycle.
  let row = occupant
  let hops = 0
  while (row?.merged_into && hops++ < 12) {
    const { data: next } = await supabase
      .from('users').select('*').eq('id', row.merged_into).maybeSingle()
    if (!next) break
    row = next
  }
  if (!row) return occupant // never null when the slot is occupied

  // Adopt the auth user onto the resolved row if it's still anonymous.
  if (authUid && !row.auth_user_id) {
    const { data: linked } = await supabase.from('users')
      .update({ auth_user_id: authUid, email: row.email || authEmail || null })
      .eq('id', row.id).select().maybeSingle()
    if (linked) return linked
  }
  return row
}
export async function getOrCreateUser(orgId) {
  const deviceId = getDeviceId()

  // Never resolve a user without an org. A device can have one row PER org, so
  // an org-less insert mints an orphan (org_id = null) row that fragments the
  // balance and can collide downstream. getDefaultOrgId() no longer falls back
  // to Burger King — if there's genuinely no org, bail rather than mint junk.
  if (!orgId) orgId = await getDefaultOrgId()
  if (!orgId) return null

  // 1. Auth path — if a Supabase session is in scope, look the user up
  //    by auth_user_id. This is the only path that survives a fresh
  //    browser / new device.
  const { data: sessionData } = await supabase.auth.getSession()
  const authUid = sessionData?.session?.user?.id
  const authEmail = sessionData?.session?.user?.email

  if (authUid) {
    // Per-org identity: scope every lookup to the active org so the same
    // person/device gets a separate row (and balance) in each org.
    let byAuthQ = supabase.from('users').select('*').eq('auth_user_id', authUid).is('merged_into', null)
    if (orgId) byAuthQ = byAuthQ.eq('org_id', orgId)
    // order+limit(1): if a bad merge ever left two live rows for one
    // (auth, org), take the newest instead of throwing PGRST116 "multiple rows".
    const { data: byAuth } = await byAuthQ.order('updated_at', { ascending: false }).limit(1).maybeSingle()

    if (byAuth) {
      // Refresh the device_id binding so subsequent anonymous-path
      // visits on this device find the same row even without a session.
      if (byAuth.device_id !== deviceId) {
        await supabase.from('users').update({ device_id: deviceId }).eq('id', byAuth.id)
      }
      return byAuth
    }

    // Session exists but no users row for this org — check whether the
    // current device_id row (in this org) is unlinked, and adopt it.
    let byDeviceQ = supabase.from('users').select('*').eq('device_id', deviceId).is('merged_into', null)
    if (orgId) byDeviceQ = byDeviceQ.eq('org_id', orgId)
    const { data: byDevice } = await byDeviceQ.order('updated_at', { ascending: false }).limit(1).maybeSingle()

    if (byDevice && !byDevice.auth_user_id) {
      const { data: linked } = await supabase
        .from('users')
        .update({
          auth_user_id: authUid,
          email: byDevice.email || authEmail || null,
          email_verified_at: new Date().toISOString(),
        })
        .eq('id', byDevice.id)
        .select()
        .single()
      return linked || byDevice
    }
    // No row yet — fall through and create one bound to both keys.
    const newRow = {
      device_id: deviceId,
      auth_user_id: authUid,
      email: authEmail || null,
      email_verified_at: new Date().toISOString(),
      animal_index: 0,
    }
    if (orgId) newRow.org_id = orgId
    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert(newRow)
      .select()
      .single()
    if (createErr) {
      // The (device_id, org_id) slot is already taken — StrictMode double-insert
      // or a tombstone from an email merge. Resolve to the live row/survivor
      // instead of crashing with "duplicate key … users_device_org_key".
      if (createErr.code === '23505') {
        const resolved = await resolveDeviceOrgOccupant(deviceId, orgId, authUid, authEmail)
        if (resolved) return resolved
      }
      throw createErr
    }
    const balRow = { user_id: created.id, balance: 0, lifetime_cups: 0 }
    if (orgId) balRow.org_id = orgId
    await supabase.from('cup_balances').insert(balRow)
    return created
  }

  // 2. Anonymous device path — scoped to the active org so each org keeps
  //    its own customer/user row for this device. Exclude tombstoned rows so a
  //    merged-away row never masquerades as a live user.
  let existingQ = supabase.from('users').select('*').eq('device_id', deviceId).is('merged_into', null)
  if (orgId) existingQ = existingQ.eq('org_id', orgId)
  const { data: existing } = await existingQ.order('updated_at', { ascending: false }).limit(1).maybeSingle()

  if (existing) return existing

  const anonRow = { device_id: deviceId, animal_index: 0 }
  if (orgId) anonRow.org_id = orgId
  const { data: newUser, error } = await supabase
    .from('users')
    .insert(anonRow)
    .select()
    .single()

  // Slot already taken — StrictMode double-insert, or a tombstone left by an
  // email merge. Resolve to the live row / merge survivor rather than crashing.
  if (error?.code === '23505') {
    const resolved = await resolveDeviceOrgOccupant(deviceId, orgId)
    if (resolved) return resolved
  }

  if (error) throw error

  // Ignore duplicate balance row (same race condition safety)
  const anonBalRow = { user_id: newUser.id, balance: 0, lifetime_cups: 0 }
  if (orgId) anonBalRow.org_id = orgId
  await supabase.from('cup_balances').insert(anonBalRow)

  return newUser
}

// ── Customer identity (Phase 3 store groups) ───────────────────────────────
//
// A `customer_identities` row is the ONE shared profile for a person across
// every org in a group. `users` stays one row per (person, org) with its own
// per-org balance; `users.identity_id` points at that shared identity.
//
// This is BEST-EFFORT and only meaningful for GROUPED orgs — call it after
// resolving the per-org user row, and only when the org belongs to a group.
// It never throws: an identity is an enhancement (shared profile + the Stores
// page), never a prerequisite for collecting cups, so any failure is logged
// and swallowed. Ungrouped orgs (every existing org) never call this, so
// their hot path is completely unchanged.
//
// Reuse order: (1) an identity already linked on this row, (2) an identity
// matching the auth user, (3) an identity a sibling `users` row on the SAME
// device already points at (same browser, another store in the group), else
// (4) mint a fresh identity seeded from this row's profile.
export async function ensureIdentityForUser(userRow, opts = {}) {
  try {
    if (!userRow?.id) return null

    const authUid  = opts.authUid  || userRow.auth_user_id || null
    const deviceId = opts.deviceId || userRow.device_id    || null

    let identity = null

    // (1) AUTH identity wins. A verified email links ONE canonical identity for
    //     a person across every device + store. This must take precedence over
    //     an identity already linked on this row: a device that was reset and
    //     re-set up at another store mints its own throwaway identity first, and
    //     if we short-circuited on that we'd never adopt the real account after
    //     the email is connected (the "different name / lost avatar / 0 balance
    //     at the second store" bug). Re-pointing below reconciles the row.
    if (authUid) {
      const { data } = await supabase
        .from('customer_identities').select('*').eq('auth_user_id', authUid).maybeSingle()
      identity = data || null
    }

    // (2) Already linked on this row.
    if (!identity && userRow.identity_id) {
      const { data } = await supabase
        .from('customer_identities').select('*').eq('id', userRow.identity_id).maybeSingle()
      identity = data || null
    }

    // (3) Same-browser sibling rows (other stores in the group) already
    //     linked to an identity → reuse it.
    if (!identity && deviceId) {
      const { data: siblings } = await supabase
        .from('users').select('identity_id')
        .eq('device_id', deviceId)
        .not('identity_id', 'is', null)
        .limit(1)
      const sibId = siblings?.[0]?.identity_id
      if (sibId) {
        const { data } = await supabase
          .from('customer_identities').select('*').eq('id', sibId).maybeSingle()
        identity = data || null
      }
    }

    // (4) Mint a fresh identity from this row's profile.
    if (!identity) {
      const insert = {
        auth_user_id: authUid,
        display_name: userRow.display_name || null,
        animal_index: userRow.animal_index ?? 0,
        email:        userRow.email || opts.authEmail || null,
        email_verified: !!userRow.email_verified_at,
        entry_org_id: userRow.org_id || null,
      }
      const { data: created, error: createErr } = await supabase
        .from('customer_identities').insert(insert).select('*').single()
      if (createErr) {
        // Unique auth_user_id race (StrictMode / concurrent tab) — re-fetch.
        if (createErr.code === '23505' && authUid) {
          const { data } = await supabase
            .from('customer_identities').select('*').eq('auth_user_id', authUid).maybeSingle()
          identity = data || null
        } else {
          console.warn('ensureIdentityForUser: create failed', createErr)
          return null
        }
      } else {
        identity = created
      }
    }

    if (!identity) return null

    // Backfill the identity's auth_user_id when we have one and it's missing.
    // This is the root fix for the "cross-store cups show 0 after reset" bug:
    // without it, an identity minted while signed-out (or adopted by a sibling)
    // never became findable by auth, so each device reset spawned a NEW identity
    // and cups scattered. The UNIQUE(auth_user_id) constraint means only one
    // identity can hold it — if another already does, we leave this one alone
    // (the sign-in consolidation reconciles the rest).
    if (authUid && !identity.auth_user_id) {
      const { error: authErr } = await supabase
        .from('customer_identities').update({ auth_user_id: authUid }).eq('id', identity.id)
      if (!authErr) identity.auth_user_id = authUid
    }

    // Link the user row to the identity.
    if (userRow.identity_id !== identity.id) {
      await supabase.from('users').update({ identity_id: identity.id }).eq('id', userRow.id)
      userRow.identity_id = identity.id
    }
    // Backfill entry_org_id if the identity somehow lacks one.
    if (!identity.entry_org_id && userRow.org_id) {
      await supabase.from('customer_identities')
        .update({ entry_org_id: userRow.org_id }).eq('id', identity.id)
      identity.entry_org_id = userRow.org_id
    }

    // ── Profile sync (BYO groups only): keep name / email / animal
    // identical across every store in the group. Deposit groups keep their
    // original per-store profiles, so this is gated on opts.syncProfile.
    // The identity is the source of truth for name/email/animal. Two-way:
    // backfill the identity from this row when it's missing a value, and
    // backfill this row from the identity so a newly-visited store inherits
    // the profile from the first store.
    if (opts.syncProfile) try {
      const canonName   = identity.display_name || userRow.display_name || null
      const canonAnimal = (identity.animal_index != null ? identity.animal_index : userRow.animal_index) ?? 0
      const canonEmail  = identity.email || userRow.email || null

      // Backfill the identity from this row where it's blank.
      const idPatch = {}
      if (!identity.display_name && canonName)              idPatch.display_name = canonName
      if (identity.animal_index == null && canonAnimal != null) idPatch.animal_index = canonAnimal
      if (!identity.email && canonEmail)                    idPatch.email = canonEmail
      if (Object.keys(idPatch).length) {
        await supabase.from('customer_identities').update(idPatch).eq('id', identity.id)
        Object.assign(identity, idPatch)
      }

      // Reconcile THIS row to the identity (the source of truth) so every store
      // shows the same name/animal. Forcing the value — not just filling blanks —
      // heals a stale row that kept a different auto-generated name from an
      // earlier visit (the cause of the "name differs on the dashboard" bug).
      const rowPatch = {}
      if (canonName && userRow.display_name !== canonName)          rowPatch.display_name = canonName
      if (canonAnimal != null && userRow.animal_index !== canonAnimal) rowPatch.animal_index = canonAnimal
      if (!userRow.email && canonEmail)                            rowPatch.email = canonEmail
      if (Object.keys(rowPatch).length) {
        await supabase.from('users').update(rowPatch).eq('id', userRow.id)
        Object.assign(userRow, rowPatch)
      }
    } catch (e) {
      console.warn('ensureIdentityForUser: profile sync (non-fatal):', e)
    }

    return identity
  } catch (e) {
    console.warn('ensureIdentityForUser threw (non-fatal):', e)
    return null
  }
}

// Push name/email/animal onto the shared identity so every OTHER store in
// the group inherits them on their next load. Best-effort, never throws.
export async function updateIdentityProfile(identityId, fields = {}) {
  if (!identityId) return
  const patch = {}
  if (fields.displayName != null) patch.display_name = fields.displayName
  if (fields.animalIndex != null) patch.animal_index = fields.animalIndex
  if (fields.email != null)       patch.email = fields.email
  if (fields.marketingConsent != null) {
    patch.marketing_consent = !!fields.marketingConsent
    patch.marketing_consent_at = fields.marketingConsentAt || new Date().toISOString()
  }
  if (!Object.keys(patch).length) return
  try { await supabase.from('customer_identities').update(patch).eq('id', identityId) }
  catch (e) { console.warn('updateIdentityProfile (non-fatal):', e) }
}

// Propagate a profile edit (name / email) to the shared identity AND
// every sibling `users` row in the same identity, so the account looks
// identical across all stores. Best-effort, never throws.
export async function propagateProfileToGroup(identityId, { displayName, animalIndex, email, marketingConsent, marketingConsentAt } = {}) {
  if (!identityId) return
  try {
    await updateIdentityProfile(identityId, { displayName, animalIndex, email, marketingConsent, marketingConsentAt })
    const rowPatch = {}
    if (displayName != null) rowPatch.display_name = displayName
    if (animalIndex != null) rowPatch.animal_index = animalIndex
    if (email != null)       rowPatch.email = email
    if (marketingConsent != null) {
      rowPatch.marketing_consent = !!marketingConsent
      rowPatch.marketing_consent_at = marketingConsentAt || new Date().toISOString()
    }
    if (Object.keys(rowPatch).length) {
      await supabase.from('users').update(rowPatch).eq('identity_id', identityId)
    }
  } catch (e) {
    console.warn('propagateProfileToGroup (non-fatal):', e)
  }
}

// ── Email magic link auth ──────────────────────────────────────────────────
//
// Two-step flow:
//   1. `sendMagicLink(email)` — Supabase emails the user a one-tap link.
//      Returns immediately so the UI can render a "check your inbox" state.
//   2. User clicks the link → comes back to the app with a session
//      cookie in place. App.jsx subscribes to onAuthStateChange and
//      re-runs getOrCreateUser, which links the existing anonymous row
//      to the new auth.users id (see step 1 of getOrCreateUser).
//
// The redirect target defaults to the current origin so the user lands
// back inside the app instead of on a generic Supabase confirmation page.
export async function sendMagicLink(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('invalid_email')
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      // Land them back on THEIR VENUE, not the bare origin. Tapping the magic
      // link on a phone used to redirect to '/' (no slug) → the app fell back
      // to the default org (Burger King) and crashed on load ("trouble loading
      // your cups"). Desktop users who type the 6-digit code instead stay on
      // the venue, which is why this only bit phones. Include the current path
      // so the link returns to /<group>/<venue>. (Supabase must allow this URL
      // in Auth → URL Configuration → Redirect URLs, e.g. origin + '/**'.)
      emailRedirectTo: typeof window !== 'undefined'
        ? window.location.origin + window.location.pathname
        : undefined,
      // Allow creating new auth.users rows on first signin. Existing
      // PackPerks customers who never had an email will get a fresh
      // auth row that we link to their device-side user row.
      shouldCreateUser: true,
    },
  })
  if (error) throw error
}

// Change the email on the CURRENT (signed-in) account, keeping the account and
// its cups. Supabase sends a confirmation to the new address; the change only
// takes effect once the customer opens that link. Account-preserving — unlike
// signing in with a different email, which would start a separate account.
export async function changeAuthEmail(newEmail) {
  const email = (newEmail || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid_email')
  const { error } = await supabase.auth.updateUser({ email })
  if (error) throw error
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ── Restore-by-email flow (lost-my-cups recovery) ─────────────────────────
// Symmetric to sendMagicLink but explicitly intended for the "I lost my
// cups" path where the user types the 6-digit OTP into the UI instead of
// clicking the link in the email. Same Supabase Auth endpoint either way
// — the difference is purely how the client picks up the session.
export async function requestRestoreOtp(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('invalid_email')
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      // Create the auth.users row if it doesn't exist yet. The edge
      // function's "no_prior_history" branch handles the case where
      // the email has no PackPerks footprint — they just become a
      // fresh user after the standard SIGNED_IN flow.
      shouldCreateUser: true,
      // No emailRedirectTo override — we WANT the user to come back
      // through the in-app code entry, not a magic-link round trip.
    },
  })
  if (error) throw error
}

// Verify the 6-digit code the user typed. On success, a Supabase Auth
// session is established (same as if they'd clicked the magic link).
// We then call the restore-by-email edge function to actually merge
// their device row into the email-side history.
export async function verifyRestoreOtp(email, code) {
  if (!email || !code) throw new Error('missing_email_or_code')
  const cleaned = String(code).replace(/\D/g, '').slice(0, 6)
  if (cleaned.length !== 6) throw new Error('invalid_code')
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: cleaned,
    type: 'email',
  })
  if (error) throw error
}

// ── H2 / duplicate-email guard ────────────────────────────────────────────
// Anonymous endpoint: take an email + the current device_id. If no OTHER
// account in the same org has that email it saves directly and returns
// { status: 'saved' }. If one or more do, it does NOT save and returns
// { status: 'merge_required', other_count } so the UI can switch to the
// verify-and-merge flow (requestRestoreOtp → verifyRestoreOtp → mergeByEmail).
export async function checkEmailSaveOrMerge(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('invalid_email')
  }
  const { data, error } = await supabase.functions.invoke('check-email-save', {
    body: { email: email.trim(), device_id: getDeviceId() },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data
}

// JWT-authenticated: after the user has verified the OTP for an email,
// merge EVERY PackPerks row (in this org) carrying that email — plus the
// current device user — into one survivor. Returns the merged result so
// the UI can show "you now have N cups total". Must be called AFTER
// verifyRestoreOtp() succeeds so there's a valid auth session.
// Pre-check the per-org WEEKLY merge limit before actually merging. Call after
// verifyRestoreOtp() (needs the auth session). Returns { held: true, message }
// when the limit is reached (the merge was filed for admin review — do NOT
// proceed), or { held: false } when it's fine to merge. `source` is
// 'merge_by_email' (merge offer) or 'restore' (lost-my-cups).
export async function mergeGuard(source = 'merge_by_email') {
  try {
    const { data, error } = await supabase.functions.invoke('merge-guard', {
      body: { device_id: getDeviceId(), source },
    })
    if (error) return { held: false } // never block a merge on a guard failure
    return data || { held: false }
  } catch {
    return { held: false }
  }
}

// Is a merge for the signed-in person still WAITING for admin review? When a
// merge is held by the weekly limit it's filed as a pending merge_request; until
// admin approves it the app must keep the user on their current account only
// (not the merged total). Returns { pending: boolean }. Fails open to false so a
// transient error never traps the user in the current-account-only view.
export async function getMergeStatus() {
  try {
    const { data, error } = await supabase.functions.invoke('merge-status', { body: {} })
    if (error) return { pending: false }
    return data || { pending: false }
  } catch {
    return { pending: false }
  }
}

export async function mergeByEmail() {
  const { data, error } = await supabase.functions.invoke('merge-by-email', {
    body: { device_id: getDeviceId() },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data
}

// Finalise the restore: ask the edge function to find the email-side
// users row, merge any cups the current device has into it, and link
// the rows together. Must be called AFTER verifyRestoreOtp succeeds so
// there's a valid auth session for the JWT check on the server.
//
// Returns the function's structured response — UIs that want to show
// "we restored N cups" can read `merged_balance` when status === 'merged'.
// Public contact-support form (customer + vendor). Emails info@packback.network
// with a subject tagged USER/VENDOR + topic. No auth needed.
export async function sendSupportMessage({ audience = 'user', topic, email, message, company = '', hp = '' }) {
  const { data, error } = await supabase.functions.invoke('send-support', {
    body: { audience, topic, email, message, company, hp },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.error || error.message), { detail: payload })
  }
  return data
}

/* Self-service account deletion for a registered customer. Requires a valid
 * auth session (the edge function verifies the JWT and only ever deletes the
 * caller's own footprint). */
// Unify the signed-in person's account across the whole group: point every one
// of their users rows at ONE auth-linked identity and merge duplicate per-store
// rows. This is what makes cross-store balances actually appear after a device
// reset + reconnect. Idempotent + best-effort; returns { identity_id } or null.
export async function consolidateIdentity() {
  try {
    const { data, error } = await supabase.functions.invoke('consolidate-identity', {
      body: { device_id: getDeviceId() },
    })
    if (error) return null
    return data || null
  } catch {
    return null
  }
}

export async function deleteMyAccount() {
  const { data, error } = await supabase.functions.invoke('delete-my-account', { body: { device_id: getDeviceId() } })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.error || error.message), { detail: payload })
  }
  return data
}

export async function finaliseRestore() {
  const deviceId = getDeviceId()
  const { data, error } = await supabase.functions.invoke('restore-by-email', {
    body: { device_id: deviceId },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data
}

// Read-only helper for components that want to show the current email
// in a "signed in as …" affordance.
export async function getCurrentAuthEmail() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.email || null
}

// Subscribe to auth state changes. Returns the unsubscribe function.
// App.jsx uses this to refresh the local user object when the magic
// link click lands a brand-new session.
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data?.subscription?.unsubscribe?.()
}

// Version of the privacy statement users accept when they record consent.
// Bump this when the policy materially changes so consent proof stays auditable.
export const CONSENT_POLICY_VERSION = '2026-07'

export async function updateUserProfile(userId, updates) {
  const dbUpdates = { updated_at: new Date().toISOString() }
  if ('displayName' in updates) dbUpdates.display_name = updates.displayName
  if ('animalIndex' in updates) dbUpdates.animal_index = updates.animalIndex
  if ('email' in updates) dbUpdates.email = updates.email
  if ('selectedRewardId' in updates) dbUpdates.selected_reward_id = updates.selectedRewardId
  if ('device' in updates) dbUpdates.device = updates.device
  // Marketing-email consent (optional opt-in). Service email itself needs no
  // consent (contract / legitimate interest), so only the marketing flag is
  // stored — with proof metadata (when, where, which policy version).
  if ('marketingConsent' in updates) {
    dbUpdates.marketing_consent = !!updates.marketingConsent
    dbUpdates.marketing_consent_at = updates.marketingConsentAt || new Date().toISOString()
    dbUpdates.marketing_consent_source = updates.marketingConsentSource || 'app'
    dbUpdates.consent_policy_version = updates.consentPolicyVersion || CONSENT_POLICY_VERSION
  }

  const { error } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', userId)

  if (error) throw error
}

// ── Cup balance ────────────────────────────────────────────────────────────
export async function getCupBalance(userId) {
  const { data, error } = await supabase
    .from('cup_balances')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data?.balance ?? 0
}

// Cumulative stats for the user-app impact card.
// `lifetime_cups` is the running total of every cup ever credited to
// this user — never decremented, even when they redeem rewards. Used
// by the impact metrics card to show "you've returned N cups across
// your whole time using PackPerks". The current `balance` is also
// returned in the same trip so the caller can avoid a second query.
export async function getUserStats(userId) {
  if (!userId) return { balance: 0, lifetimeCups: 0 }
  const { data, error } = await supabase
    .from('cup_balances')
    .select('balance, lifetime_cups')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    balance:      data?.balance       ?? 0,
    lifetimeCups: data?.lifetime_cups ?? 0,
  }
}

// Community-wide totals for the Impact detail modal. Sums every
// cup_balances row's `lifetime_cups` (optionally scoped to a single
// org) so the customer sees the real, server-sourced "look what we've
// done together" number — not a marketing estimate.
//
// Scoping: pass an `orgId` to get just that brand's community total
// (the more common case for per-org campaigns). Pass null/undefined
// to get the cross-org PackPerks-wide total. RLS on cup_balances
// permits authenticated reads (same as `getCupBalance` already does)
// so anonymous users count too.
export async function getGlobalImpact(orgId) {
  // C.8.4: use the server-side aggregate RPC so the total is accurate (the old
  // phone-side sum was capped at PostgREST's ~1000-row default and under-counted).
  const { data, error } = await supabase.rpc('impact_totals', { p_org_id: orgId ?? null })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    totalLifetimeCups: Number(row?.total_lifetime_cups || 0),
    returningUsers: Number(row?.returning_users || 0),
  }
}

export async function updateCupBalance(userId, newBalance) {
  const { data, error } = await supabase
    .from('cup_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw error

  // C.8.5: normal users already have a balance row, so the UPDATE above just
  // works (behaviour unchanged). But if the best-effort insert at account
  // creation ever failed, the UPDATE matches 0 rows and the balance would be
  // stuck at 0 forever. In that case, create the row so the new balance sticks.
  if (!data || data.length === 0) {
    const { data: u } = await supabase.from('users').select('org_id').eq('id', userId).maybeSingle()
    const row = { user_id: userId, balance: newBalance }
    if (u?.org_id) row.org_id = u.org_id
    const { error: insErr } = await supabase.from('cup_balances').insert(row)
    if (insErr) throw insErr
  }
}

// ── Cup claim via QR scan (new flow) ───────────────────────────────────────
//
// Parses a scanned QR payload into an array of cup UUIDs, then invokes the
// claim-cups edge function which atomically activates them and increments
// the user's balance. The payload format is either:
//   • A URL: `https://…/?cups=<uuid>,<uuid>,...`
//   • Or a raw list: `<uuid>,<uuid>,...`
// Anything else is rejected client-side.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* Parse the QR payload into a claim spec. Recognises three forms:
 *   • URL ?batch=<uuid>     → { batchId }      ← preferred (tiny QR)
 *   • URL ?cups=<uuid,uuid> → { cupIds: [..] } ← legacy / multi-cup
 *   • Raw uuid CSV          → { cupIds: [..] } ← bare payload
 * Returns null if the payload doesn't look like a PackPerks cup code. */
export function parseCupQr(payload) {
  if (!payload || typeof payload !== 'string') return null
  let batch = null
  let cupsParam = null
  let byo = null
  let byoPath = null
  try {
    const url = new URL(payload)
    batch = url.searchParams.get('batch')
    cupsParam = url.searchParams.get('cups')
    byo = url.searchParams.get('byo')
    byoPath = url.pathname
  } catch {
    cupsParam = payload
  }
  if (batch && UUID_RE.test(batch)) return { batchId: batch }
  if (cupsParam) {
    const ids = cupsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length > 0 && ids.every(id => UUID_RE.test(id))) return { cupIds: ids }
  }
  // Phase 3 BYO stationary counter QR: /<slug>/?byo=1 — carries no cup UUIDs;
  // it's credited by the byo-mint edge function (always +1 up to the per-store
  // daily cap). Return the store-slug path so the caller can re-enter the
  // stationary-QR flow on the CURRENT origin — the QR's own domain (vercel or
  // perks.packback.app) is intentionally ignored so it works everywhere.
  if (byo !== null) return { byo: true, byoPath: byoPath || '/' }
  return null
}

// Upload a cup-scan snapshot to the private cup-scans bucket. The
// scanId is generated client-side so the upload and the subsequent
// claim-cups call can share a key — admin UI reads this back via a
// signed URL.
//
// The gallery flow on iOS Safari has, historically, been the most
// fragile path here:
//   • Compressed JPEG data-URLs can still weigh in at 1–2 MB on a
//     1600px source if the JPEG has heavy texture.
//   • Some HEIC originals decode oddly on Safari and produce data-URLs
//     with mime "image/png" or no mime at all — we used to honour that
//     and write `.png` files that nothing else expected.
//
// Both bite us silently because the upload returns 200 with garbage,
// or 413 with a CORS-stripped error body. So now:
//   1. We always upload as `image/jpeg` with a `.jpg` extension.
//   2. We bail early (and log loudly) on data-URLs that are obviously
//      empty / malformed.
//   3. We surface storage errors in the console with the source URL
//      length, so a future investigator can see "ah, it was 4.2 MB
//      hitting the bucket limit".
export async function uploadCupScanPhoto(scanId, photoDataUrl) {
  if (!scanId) return null
  if (!photoDataUrl || typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:')) {
    if (photoDataUrl) console.warn('uploadCupScanPhoto: ignoring non-dataURL photo (len=' + (photoDataUrl?.length ?? 0) + ')')
    return null
  }
  const blob = dataUrlToBlob(photoDataUrl)
  if (!blob || blob.size === 0) {
    console.warn('uploadCupScanPhoto: empty blob, skipping (raw len=' + photoDataUrl.length + ')')
    return null
  }
  // Always normalise to JPEG. compressToJpeg in the user app already
  // emits image/jpeg, but iOS Safari occasionally tags a re-encoded
  // gallery image as image/png. Forcing the content type + extension
  // keeps the admin table thumbnail and the bucket key in sync.
  const path = `${scanId}.jpg`
  // upsert:false — anon only has INSERT (not UPDATE) on cup-scans; upsert
  // would require UPDATE and fail RLS for anonymous users. scanId is unique
  // per scan, so a plain insert is correct.
  const { error } = await supabase.storage
    .from('cup-scans')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    console.error('cup-scan upload failed (path=' + path + ', size=' + blob.size + ' bytes):', error)
    return null
  }
  return path
}

export async function getCupScanSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null
  const { data, error } = await supabase.storage
    .from('cup-scans')
    .createSignedUrl(photoPath, ttlSec)
  if (error) {
    console.error('cup-scan sign url failed:', error)
    return null
  }
  return data?.signedUrl ?? null
}

export async function shareCups(userId, count) {
  const { data, error } = await supabase.functions.invoke('share-cups', {
    body: { user_id: userId, count, device_id: getDeviceId() },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data // { cup_ids, count, newBalance, batch_id }
}

// `parsed` is what parseCupQr returns (or a bare array for back-compat).
// Optional opts: { scanId, scanType, photoPath } pass-through to server
// so admins can review the photo and audit every attempt.
export async function claimCups(userId, parsed, opts = {}) {
  const body = { user_id: userId, device_id: getDeviceId() }
  if (Array.isArray(parsed)) {
    body.cup_ids = parsed
  } else if (parsed?.batchId) {
    body.batch_id = parsed.batchId
  } else if (parsed?.cupIds) {
    body.cup_ids = parsed.cupIds
  } else {
    throw new Error('claimCups: invalid scan payload')
  }
  if (opts.scanId)    body.scan_id   = opts.scanId
  if (opts.scanType)  body.scan_type = opts.scanType
  if (opts.photoPath) body.photo_path = opts.photoPath

  const { data, error } = await supabase.functions.invoke('claim-cups', { body })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.reason || error.message), { detail: payload })
  }
  return data
}

// ── BYO cup mint (Phase 3 "Bring Your Own cup") ────────────────────────────
// Adds one cup at a Bring-Your-Own store by scanning the stationary counter
// QR (/<slug>/?byo=1). The byo-mint edge function enforces the rolling-24h
// soft cap: it auto-credits ≤2 cups, and the 3rd+ returns
// { status:'pending_review' } (creating an admin approval request) instead of
// crediting. Success returns { status:'credited', newBalance, preBalance, ... }.
export async function mintByoCup(userId, orgId, locationId = null) {
  const { data, error } = await supabase.functions.invoke('byo-mint', {
    body: { user_id: userId, org_id: orgId, device_id: getDeviceId(), location_id: locationId || null },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.error || error.message), { detail: payload })
  }
  return data
}

// ── Cup scans (legacy: photo-based, kept for backwards compat) ─────────────
// Logs each scan event. Phase 2: set status='pending' and populate photo_url.
export async function logCupScan(userId, { cupsAwarded = 1, photoUrl = null } = {}) {
  const { data, error } = await supabase
    .from('cup_scans')
    .insert({
      user_id: userId,
      cups_awarded: cupsAwarded,
      photo_url: photoUrl,
      status: photoUrl ? 'pending' : 'approved', // pending when photo present so admin reviews it
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

// ── Activity history ───────────────────────────────────────────────────────
// Combined activity across every store in a group for one person, keyed by
// their shared identity. Each item is tagged with the `storeName` it belongs
// to. Best-effort — returns [] on any failure. Used by the "general" account
// view opened from the Stores hub.
export async function getGroupActivity(identityId, orgNameById = {}) {
  if (!identityId) return []
  try {
    const { data: rows } = await supabase
      .from('users').select('id, org_id').eq('identity_id', identityId).is('merged_into', null)
    const userIds = (rows || []).map(r => r.id)
    if (!userIds.length) return []
    const orgByUser = {}
    ;(rows || []).forEach(r => { orgByUser[r.id] = r.org_id })
    const { data } = await supabase
      .from('activity_history').select('user_id, type, label, created_at')
      .in('user_id', userIds).order('created_at', { ascending: true })
    return (data || []).map(row => ({
      type: row.type,
      label: row.label,
      time: formatTime(row.created_at),
      createdAt: row.created_at,
      storeName: orgNameById[orgByUser[row.user_id]] || null,
    }))
  } catch (e) {
    console.warn('getGroupActivity (non-fatal):', e)
    return []
  }
}

export async function getHistory(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('type, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []).map(row => ({
    type: row.type,
    label: row.label,
    time: formatTime(row.created_at),
    // Raw timestamp is needed by the activity modal to find the exact
    // matching claim row (claim and activity are written ~simultaneously
    // in a Promise.all, so matching on time proximity gives the right one
    // even when the user has multiple claims for the same reward).
    createdAt: row.created_at,
  }))
}

export async function addHistoryEntry(userId, type, label) {
  const { error } = await supabase
    .from('activity_history')
    .insert({ user_id: userId, type, label })

  if (error) throw error
}

// ── Published app config (rewards + settings pushed from admin) ────────────
//
// Multi-org transition: `app_config` was a single-tenant key-value row
// keyed 'published'. After migration 011, every org gets its own row
// keyed 'published:<org_id>'. These helpers accept an optional orgId
// and, when none is given, resolve the default org from the
// `organizations` table. We also fall back to the legacy 'published'
// key if the per-org row doesn't exist yet (graceful behaviour during
// the deploy window between code rolling out and the migration
// running).

// Resolve the default org id (the oldest non-deleted org). Exported so
// the admin context layer in Phase 2 can reuse the same logic before
// the user has picked an active org.
export async function getDefaultOrgId() {
  // There is NO global "default org" in the multi-venue model. This used to
  // return the OLDEST org — which is Burger King — so any slug-less or
  // unresolved visitor was silently dropped into Burger King (its rewards, and
  // a users row in the wrong org that then collided on users_device_org_key).
  // Callers must resolve a real org from the URL; the root path is a chooser.
  return null
}

// Fetch an organisation row by its URL slug. Used by the user-facing
// app to bootstrap branding/copy/rewards for a path like /coffeeshop/.
export async function getOrgBySlug(slug) {
  if (!slug) return null
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, country, brand_color, logo_url, logo_width, partner_brand_name, email_domain_hint')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

// Whether reward claiming is paused for this org because its cashback budget
// cap has been reached. Calls a boolean-only RPC: the cap amount and spend
// stay server-side and are never exposed to the customer. Fails open (returns
// false) so a transient error never blocks a genuine claim — the DB trigger
// is the hard guard.
export async function isRewardBudgetBlocked(orgId) {
  if (!orgId) return false
  try {
    const { data, error } = await supabase.rpc('reward_budget_status', { p_org_id: orgId })
    if (error) { console.warn('reward_budget_status failed:', error.message); return false }
    return data === true
  } catch (e) {
    console.warn('reward_budget_status threw:', e)
    return false
  }
}

// Fetch an organisation row by id. Used after a deep-link cup scan to
// resolve which org the scanned batch belongs to (in case the user
// arrived via QR rather than the slug).
export async function getOrgById(orgId) {
  if (!orgId) return null
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, country, brand_color, logo_url, logo_width, partner_brand_name, email_domain_hint')
      .eq('id', orgId)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

// Fetch the default (oldest non-deleted) organisation row. Used as a
// fallback when the URL has no slug.
export async function getDefaultOrg() {
  // No global default org (see getDefaultOrgId). Returning the oldest org here
  // is what dropped unresolved visitors into Burger King. Return null; the
  // caller redirects an unresolved venue to the root chooser.
  return null
}

export async function getAppConfig(orgId) {
  try {
    const resolvedOrgId = orgId || (await getDefaultOrgId())
    if (resolvedOrgId) {
      const { data } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', `published:${resolvedOrgId}`)
        .maybeSingle()
      if (data?.value) return data.value
      // Org is known but has no published config yet — return null rather
      // than leaking another org's config through the legacy key.
      return null
    }
    // No org context at all (e.g. fresh single-tenant install before
    // migration 011 ran) — try the pre-migration legacy key.
    const { data: legacy } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'published')
      .maybeSingle()
    return legacy?.value || null
  } catch {
    return null
  }
}

export async function saveAppConfig(config, orgId) {
  const resolvedOrgId = orgId || (await getDefaultOrgId())
  if (!resolvedOrgId) {
    throw new Error('saveAppConfig: no organization available to save against')
  }
  const { error } = await supabase
    .from('app_config')
    .upsert({
      key: `published:${resolvedOrgId}`,
      value: config,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ── Claims ─────────────────────────────────────────────────────────────────

// Fetch the claims belonging to this device's user. Used by the user-side
// activity feed to surface live status (pending / completed / failed) from
// admin actions, since activity_history is append-only and doesn't update.
export async function getMyClaims(userIds) {
  // Anon device users can't SELECT `claims` under RLS, so read via a
  // security-definer RPC that returns only non-sensitive fields (status,
  // Tikkie link, amount — not the receipt photo). Accepts one id or an
  // array (a person can have a row per store in a BYO group).
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('get_customer_claims', { p_user_ids: ids })
  if (error) throw error
  return data || []
}

// Redirect Refund home: the smart-bin pins for the map. Managed in the
// dashboard (Smart Bins page); public-readable because a bin's location is
// a shop-window fact, not customer data.
export async function getSmartbinLocations(orgId) {
  if (!orgId) return []
  const { data, error } = await supabase
    .from('smartbin_locations')
    .select('id, name, address, lat, lng, status')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) throw error
  return (data || []).filter(b => b.lat != null && b.lng != null)
}

// Redirect Refund home: the customer's own "in process" receipts — batches
// scanned before the smart bin's confirmation reached PackPerks. Same RPC
// trust model as get_customer_claims (keyed by the device's account ids).
export async function getMyPending(userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('get_my_pending', { p_user_ids: ids })
  if (error) throw error
  return data || []
}

// Record the customer's notify-channel choice for a claim (set on the verdict
// screen). Anon can't UPDATE claims, so this goes through a security-definer RPC.
export async function setClaimNotifyPrefs(claimId, { email = false, push = false } = {}) {
  if (!claimId) return
  const { error } = await supabase.rpc('set_claim_notify', {
    p_claim_id: claimId, p_email: !!email, p_push: !!push,
  })
  if (error) throw error
}

// Record a completed donation claim so the admin Donations page can
// aggregate real cup and euro totals. Unlike other claims, donations
// are auto-completed (no admin review / receipt needed) — the user is
// voluntarily giving up their cup value, so there's nothing to approve.
export async function addDonationClaim(userId, cupsCount, payoutAmount, orgId) {
  const insert = {
    user_id: userId,
    type: 'donation',
    cups_redeemed: cupsCount,
    payout_amount: payoutAmount ?? 0,
    status: 'completed',
  }
  if (orgId) insert.org_id = orgId
  const { error } = await supabase.from('claims').insert(insert)
  if (error) throw error
}

export async function createClaim(userId, { type, rewardId, cupsRedeemed, payoutAmount, receiptPhotoUrl, receiptPhotoPath, attachReceiptPhoto, orgId }) {
  // Generate the claim id client-side and insert WITHOUT a RETURNING
  // select. Why: the anonymous user app has INSERT on `claims` but no
  // SELECT policy (locked down in C-1), so `.insert().select().single()`
  // would fail trying to read the new row back. Supplying our own id
  // sidesteps the read entirely — anon INSERT alone is enough.
  const id = safeUUID()
  // Set receipt_photo_path AT INSERT TIME. An anonymous user cannot UPDATE
  // the claim afterwards: PostgREST only mutates rows the role can also
  // SELECT, and anon has no SELECT policy on claims (they hold payout data),
  // so an UPDATE silently affects 0 rows and the path never sticks — which
  // made verify-receipt report "no photo" and the whole claim fail for
  // anonymous users. The photo path is deterministic (`<id>.jpg`, since the
  // upload forces JPEG to exactly this key), so we can set it up front.
  const photoPath = receiptPhotoPath ?? (attachReceiptPhoto ? `${id}.jpg` : null)
  const insert = {
    id,
    user_id: userId,
    type,
    reward_id: rewardId ?? null,
    cups_redeemed: cupsRedeemed,
    payout_amount: payoutAmount,
    receipt_photo_url: receiptPhotoUrl ?? null,
    receipt_photo_path: photoPath,
    status: 'pending',
  }
  if (orgId) insert.org_id = orgId
  const { error } = await supabase.from('claims').insert(insert)
  if (error) throw error
  return id
}

// Fire the customer a "we've received your cashback request" confirmation email
// once their claim is in review. The recipient is resolved SERVER-SIDE from the
// claim's own user row — we only hand over the claim id — so this can't be used
// to email an arbitrary address. Best-effort and never throws: a failed
// confirmation must not disrupt the claim flow, and it simply no-ops when the
// user has no email on file or the claim isn't a pending cashback.
export async function sendClaimConfirmation(claimId) {
  if (!claimId) return { sent: false }
  try {
    const { data, error } = await supabase.functions.invoke('send-claim-confirmation', {
      body: { claim_id: claimId },
    })
    if (error) return { sent: false }
    return data || { sent: false }
  } catch {
    return { sent: false }
  }
}

// ── Receipt upload + AI verification ───────────────────────────────────────
//
// Two-step flow that matches the verify-receipt edge function contract:
//   1. uploadReceiptPhoto(claimId, blob)  → puts photo at receipts/{claim_id}.{ext}
//   2. verifyReceipt(claimId)             → triggers Claude Haiku, writes verdict
//
// Both are anon-keyed; the edge function uses service_role internally.

// Turn a data-URL like "data:image/jpeg;base64,xxx" into a Blob.
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',')
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export async function uploadReceiptPhoto(claimId, photoDataUrl) {
  if (!photoDataUrl) throw new Error('no_photo')
  const blob = dataUrlToBlob(photoDataUrl)
  // Force JPEG. The user app re-encodes to JPEG before calling this, but
  // iOS sometimes hands back a generic `application/octet-stream` mime —
  // and the receipts bucket only allows real image types, so trusting
  // blob.type would 415 the upload and kill the claim before the AI runs.
  // (uploadCupScanPhoto already does this; receipts must match.)
  const path = `${claimId}.jpg`

  // upsert:false — anonymous users only have INSERT on the receipts bucket,
  // NOT update. upsert:true makes Storage require UPDATE permission too, so
  // anon uploads were rejected with "new row violates row-level security
  // policy" (signed-in users have broader perms, which is why it worked for
  // them). The claim id is a fresh UUID per submit, so the object never
  // pre-exists and a plain insert is correct.
  const { error } = await supabase.storage
    .from('receipts')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    })
  if (error) throw error

  // NOTE: we deliberately do NOT update claims.receipt_photo_path here.
  // createClaim already set it at INSERT time (anon can't UPDATE claims —
  // no SELECT policy means the UPDATE silently affects 0 rows). The path is
  // deterministic (`${claimId}.jpg`), so the row written at creation already
  // points at exactly this object.
  return path
}

export async function verifyReceipt(claimId) {
  const { data, error } = await supabase.functions.invoke('verify-receipt', {
    body: { claim_id: claimId },
  })
  if (error) throw error
  return data // { status, failureChecks, verdict, summary, requiredItem }
}

// Helper: get a temporary signed URL for displaying a private receipt photo.
// Used by admin UI; ttl defaults to 10 minutes.
export async function getReceiptSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(photoPath, ttlSec)
  if (error) {
    console.error('Sign URL failed:', error)
    return null
  }
  return data?.signedUrl ?? null
}

// A customer typed a store we don't list yet ("Haven't found your store?").
// Recorded in its own table (not analytics), so it always lands regardless of
// cookie consent and shows on the admin Future vendors page. `name` may include
// a city, e.g. "Blend Coffee, Utrecht". Fails soft — a request never blocks UI.
export async function submitStoreRequest(name, { region = null, orgId = null } = {}) {
  const clean = String(name || '').trim().slice(0, 200)
  if (!clean) return false
  const { error } = await supabase.from('store_requests').insert({
    name: clean,
    region,
    org_id: orgId,
    device_id: getDeviceId(),
  })
  if (error) {
    console.warn('store_requests insert failed:', error.message)
    return false
  }
  return true
}
