import { createContext, useContext } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * ViewRole — the role the dashboard is CURRENTLY RENDERING AS, which is
 * not always the role the signed-in person holds.
 *
 * An owner opening `#overview?as=vendor` is previewing: their real role
 * stays owner (AuthContext is the authority on that, and permissions are
 * still checked against it), but every page should present itself the
 * way a vendor sees it. Pages ask this when the question is "what should
 * I show?" rather than "what may this person do?".
 *
 * Deliberately a plain module with no component in it: the shell renders
 * the provider directly, which keeps this file exporting only hooks and
 * helpers and leaves Fast Refresh working.
 *
 * Outside a provider it reports the signed-in reality, so admin surfaces
 * that render without the shell behave normally.
 * ───────────────────────────────────────────────────────────────────── */

export const ViewRoleCtx = createContext({ viewRole: null, isVendorView: false, previewing: false });

export function useViewRole() {
  return useContext(ViewRoleCtx);
}

/* The hash marker the shell and OrgContext both read. OrgContext sits
 * above the shell, so it can't take the value from the provider — it has
 * to read the URL itself, and both must agree on the spelling. */
export function readVendorPreviewFlag() {
  if (typeof window === 'undefined') return false;
  const q = (window.location.hash || '').split('?')[1] || '';
  return new URLSearchParams(q).get('as') === 'vendor';
}
