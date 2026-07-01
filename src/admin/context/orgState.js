/* ─────────────────────────────────────────────────────────────────────
 * orgState — module-level mutable state for the currently-active
 * organisation.
 *
 * Why this lives outside React: adminApi.js is a non-component
 * module that the React tree calls into. Routing every call through
 * a hook would require either (a) refactoring all callers, or (b) a
 * higher-order pattern that defeats the simplicity of `await
 * getAdminUsers()`. A module-level `let` is the pragmatic
 * compromise — OrgContext writes it on every active-org change, and
 * adminApi reads it inside each query.
 *
 * Threading & race safety: the admin app is a single browser tab with
 * one React tree, so there's no concurrency concern. If we ever ship
 * a non-React caller (e.g. a service worker) it would need its own
 * org-scoping signal anyway.
 *
 * `null` is the bootstrap state — adminApi treats null as "no filter
 * yet, return everything" so the very first render before OrgContext
 * has resolved doesn't blow up with an empty result set. As soon as
 * OrgContext determines the active org it calls setActiveOrgId() and
 * any subsequent query is scoped.
 * ───────────────────────────────────────────────────────────────────── */

let _activeOrgId = null;

export function setActiveOrgId(orgId) {
  _activeOrgId = orgId || null;
}

export function getActiveOrgId() {
  return _activeOrgId;
}

/* Helper used inside adminApi query chains to conditionally apply
 * an org_id filter. If no org is active yet (bootstrap window) the
 * query is returned unfiltered — same behaviour as before multi-org.
 *
 *     const { data } = await applyOrgFilter(
 *       supabase.from('users').select('id')
 *     );
 */
export function applyOrgFilter(query, orgIdsOverride) {
  // Explicit scope override (Phase 3 group analytics): an array of org ids.
  //   • [id]        → single-org filter (same as default)
  //   • [id1, id2…] → group filter via .in()
  //   • []          → no filter
  // When the override is omitted (undefined), fall back to the global active
  // org — the original, unchanged behaviour every other caller relies on.
  if (orgIdsOverride !== undefined) {
    const ids = Array.isArray(orgIdsOverride)
      ? orgIdsOverride.filter(Boolean)
      : (orgIdsOverride ? [orgIdsOverride] : []);
    if (ids.length === 0) return query;
    if (ids.length === 1) return query.eq('org_id', ids[0]);
    return query.in('org_id', ids);
  }
  const orgId = _activeOrgId;
  if (!orgId) return query;
  return query.eq('org_id', orgId);
}
