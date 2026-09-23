/* ─────────────────────────────────────────────────────────────────────
 * Is this render a preview of the app rather than a customer using it?
 *
 * Two places embed the customer app read-only: Design & copy's iframe
 * (`?preview=1`) and User analytics → Heatmap / Session replay
 * (`?uxpreview=<screen>`). Both want the screens to LOOK right and
 * nothing else to happen — no account, no writes, nothing tracked.
 *
 * Its own tiny module because App.jsx is not the only thing that has to
 * know. A screen that reaches for the camera has to know too: previewing
 * the cup scanner in the dashboard would otherwise ask the person looking
 * at a heatmap for permission to use their webcam.
 * ───────────────────────────────────────────────────────────────────── */
export function isAppPreview() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get('preview') === '1' || !!q.get('uxpreview');
  } catch {
    return false;
  }
}
