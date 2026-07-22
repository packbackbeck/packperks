/* ─────────────────────────────────────────────────────────────────────
 * appUrl — the canonical customer-app URL to bake into a NEW printed QR
 * code or a shared link.
 *
 * Override per deployment with VITE_APP_URL. Defaults to the new .network
 * domain. PackPerks runs on three domains (the Vercel URL, perks.packback.app,
 * and perks.packback.network) — all serve the same app.
 *
 * IMPORTANT: cup redemption is domain-agnostic. When a QR is scanned inside the
 * app, we re-enter the scan on the CURRENT origin (see App.handleCupScan /
 * parseQr), ignoring whatever host is in the QR. So this constant only decides
 * which domain a NEW printed QR points a *native phone camera* at. Keep the old
 * .app domain live so previously-printed QRs (which point at .app) keep working.
 * ───────────────────────────────────────────────────────────────────── */

const RAW = (import.meta.env.VITE_APP_URL || 'https://perks.packback.network/').trim();

/** Canonical app URL, always with a trailing slash. */
export const APP_URL = RAW.endsWith('/') ? RAW : `${RAW}/`;
