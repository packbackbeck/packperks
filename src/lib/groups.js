/* ─────────────────────────────────────────────────────────────────────
 * groups.js — customer-side helpers for Phase 3 store groups.
 *
 * A "group" ties several venues together so one person keeps a single
 * identity across them (per-store balances + a shared Stores page). A
 * group has a copy "mode" — 'deposit' (original) or 'byo' (bring your
 * own cup, no deposit) — that selects the default customer copy.
 *
 * Everything here is READ-ONLY and defensive: an ungrouped org resolves
 * to `null` and the customer app then behaves exactly as it always has.
 * Only grouped orgs get group context, so existing single orgs are
 * completely unaffected.
 * ───────────────────────────────────────────────────────────────────── */

import { supabase } from './supabase'
import { getCopyPreset, normalizeMode } from './copyPresets'

/* Resolve a group directly by its slug (for the /<groupSlug> hub route),
 * plus its active member orgs. Returns null if no such group. */
export async function getGroupBySlug(slug) {
  if (!slug) return null
  try {
    const { data: group } = await supabase
      .from('org_groups').select('id, name, slug').eq('slug', slug).maybeSingle()
    if (!group) return null
    const { data: members } = await supabase
      .from('organizations')
      .select('id, name, slug, brand_color, logo_url, group_active, deleted_at')
      .eq('group_id', group.id).is('deleted_at', null)
    return {
      group,
      members: (members || [])
        .filter(m => m.group_active !== false)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }
  } catch (e) {
    console.warn('getGroupBySlug failed:', e)
    return null
  }
}

/* Resolve an org's group context, or null if the org isn't in a group.
 * Returns { groupId, group, mode, groupConfig, members } where members
 * are the group's active (group_active, non-deleted) orgs. */
export async function getGroupContext(orgId) {
  if (!orgId) return null
  try {
    const { data: org } = await supabase
      .from('organizations').select('id, group_id').eq('id', orgId).maybeSingle()
    if (!org?.group_id) return null
    const groupId = org.group_id

    const [{ data: group }, { data: cfg }, { data: members }] = await Promise.all([
      supabase.from('org_groups').select('id, name, slug').eq('id', groupId).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', `published:group:${groupId}`).maybeSingle(),
      supabase.from('organizations')
        .select('id, name, slug, brand_color, logo_url, group_active, deleted_at')
        .eq('group_id', groupId).is('deleted_at', null),
    ])

    return {
      groupId,
      group: group || null,
      mode: normalizeMode(cfg?.value?.settings?.mode),
      groupConfig: cfg?.value || null,
      members: (members || [])
        .filter(m => m.group_active !== false)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }
  } catch (e) {
    console.warn('getGroupContext failed:', e)
    return null
  }
}

/* Compose the effective mode-sensitive customer copy for a grouped org.
 *
 * Base is the mode preset; the GROUP config's own hero / design.copy
 * (seeded from the preset when the group was created, and the only
 * copy an admin can edit today) layer on top. Per-ORG copy overrides
 * are intentionally NOT consulted here — that's the later full copy-
 * editing phase — so a group's copy stays consistent across its stores.
 *
 * Only call this for grouped orgs (getGroupContext != null); ungrouped
 * orgs must keep the app's existing hardcoded / per-org copy untouched. */
export function composeGroupCopy(groupCtx) {
  const mode = normalizeMode(groupCtx?.mode)
  const preset = getCopyPreset(mode)
  // Admin edits (Stage 5 / A6) live under settings.copy as a partial bundle;
  // any key the admin hasn't touched falls back to the mode preset, so the
  // copy is always complete.
  const ov = groupCtx?.groupConfig?.settings?.copy || {}
  return {
    mode,
    heroHeadline:   ov.heroHeadline || preset.heroHeadline,
    heroSubtext:    ov.heroSubtext  || preset.heroSubtext,
    storesIntro:    ov.storesIntro  || preset.storesIntro,
    designCopy:     { ...preset.designCopy, ...(ov.designCopy || {}) },
    howItWorks:     (ov.howItWorks && Array.isArray(ov.howItWorks.steps)) ? ov.howItWorks : preset.howItWorks,
    terms:          (ov.terms && Array.isArray(ov.terms.points))          ? ov.terms      : preset.terms,
    crossOrgNotice: ov.crossOrgNotice || preset.crossOrgNotice,
    dailyCapReview: ov.dailyCapReview || preset.dailyCapReview,
    scanSuccess:    ov.scanSuccess    || preset.scanSuccess,
  }
}

/* Per-store balances for a person across a group, keyed by org id →
 * { balance, lifetime }. Relies on users.identity_id (set lazily by
 * ensureIdentityForUser). Orgs where the person has no row simply don't
 * appear in the map (the caller shows 0). */
export async function getGroupBalances(identityId, memberOrgIds) {
  const out = {}
  if (!identityId || !memberOrgIds?.length) return out
  try {
    const { data: rows } = await supabase
      .from('users').select('id, org_id')
      .eq('identity_id', identityId)
      .in('org_id', memberOrgIds)
      .is('merged_into', null)
    const userIds = (rows || []).map(r => r.id)
    if (!userIds.length) return out

    const orgByUser = {}
    ;(rows || []).forEach(r => { orgByUser[r.id] = r.org_id })

    const { data: bals } = await supabase
      .from('cup_balances').select('user_id, balance, lifetime_cups')
      .in('user_id', userIds)
    ;(bals || []).forEach(b => {
      const orgId = orgByUser[b.user_id]
      if (!orgId) return
      const cur = out[orgId] || { balance: 0, lifetime: 0 }
      cur.balance  += b.balance || 0
      cur.lifetime += b.lifetime_cups || 0
      out[orgId] = cur
    })
    return out
  } catch (e) {
    console.warn('getGroupBalances failed:', e)
    return out
  }
}

/* A1 gate: has the person collected ≥1 cup anywhere in the group?
 * (Uses lifetime so redeeming back to 0 doesn't re-lock the group.) */
export function hasAnyGroupCup(balancesByOrg) {
  return Object.values(balancesByOrg || {}).some(b => (b.lifetime || 0) > 0 || (b.balance || 0) > 0)
}

/* Per-store extras for the Stores page: each org's featured reward (name +
 * image, for the card thumbnail) and its primary location (city + coords,
 * for the map). Keyed by org id. Read-only + defensive. */
export async function getGroupStores(orgIds) {
  const out = {}
  if (!orgIds?.length) return out
  try {
    const keys = orgIds.map(id => `published:${id}`)
    const [{ data: cfgs }, { data: locs }] = await Promise.all([
      supabase.from('app_config').select('key, value').in('key', keys),
      supabase.from('locations')
        .select('org_id, name, city, address, lat, lng, status')
        .in('org_id', orgIds),
    ])

    ;(cfgs || []).forEach(c => {
      const orgId = c.key.replace('published:', '')
      const rewards = (c.value?.rewards || []).filter(r => r.status === 'live')
      const featured = rewards.find(r => r.featured) || rewards[0] || null
      out[orgId] = out[orgId] || {}
      out[orgId].featured = featured ? { name: featured.name, image: featured.image || '', cupsNeeded: featured.cupsNeeded } : null
      out[orgId].rewardCount = rewards.length
      // All live rewards that have an image — for the auto-cycling thumbnail.
      // Featured first so the slideshow opens on it.
      out[orgId].rewards = [...rewards]
        .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
        .map(r => ({ name: r.name, image: r.image || '' }))
        .filter(r => r.image)
    })

    ;(locs || []).forEach(l => {
      out[l.org_id] = out[l.org_id] || {}
      const cur = out[l.org_id].location
      const hasCoords = l.lat != null && l.lng != null
      // Prefer a location that carries coordinates.
      if (!cur || (cur.lat == null && hasCoords)) {
        out[l.org_id].location = {
          name: l.name || null,
          city: l.city || null,
          address: l.address || null,
          lat: l.lat != null ? Number(l.lat) : null,
          lng: l.lng != null ? Number(l.lng) : null,
        }
      }
    })

    return out
  } catch (e) {
    console.warn('getGroupStores failed:', e)
    return out
  }
}
