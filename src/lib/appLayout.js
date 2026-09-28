/* ─────────────────────────────────────────────────────────────────────
 * The order of the customer app's home screen, in ONE place.
 *
 * A venue can rearrange its home screen in the dashboard (Client app →
 * Sections). What it saves is a list of keys under
 * `settings.design.layout`, one list per kind of app:
 *
 *   rewards — Deposit Rewards and Bring Your Own (App.jsx)
 *   tikkie  — Deferred Tikkie's wallet (TikkieHomePage.jsx)
 *
 * The customer app and the dashboard's preview both read the order through
 * `homeOrder`, so they cannot disagree. A saved list is never trusted as
 * it is: unknown keys are dropped, and a section added to the app after
 * the list was saved is put back where the default order has it, so a new
 * section can never vanish from a venue that rearranged theirs.
 *
 * Whether a section shows is separate: the `show…` switches in
 * `settings.design.sections`, which existed before ordering did.
 * ───────────────────────────────────────────────────────────────────── */

export const HOME_ORDER = {
  rewards: ['headline', 'progress', 'featured', 'more'],
  tikkie: ['wallet', 'actions', 'email', 'howPaid', 'activity', 'impact', 'bins'],
};

const LAYOUT_KEY = { rewards: 'home', tikkie: 'tikkieHome' };

/** The saved list for this kind of app, or null when the venue kept the
 *  default. */
export function savedOrder(layout, kind) {
  const saved = layout?.[LAYOUT_KEY[kind]];
  return Array.isArray(saved) && saved.length ? saved : null;
}

/** The home screen's sections, in the order to draw them. */
export function homeOrder(layout, kind) {
  const base = HOME_ORDER[kind] || [];
  const saved = savedOrder(layout, kind);
  if (!saved) return base;
  const known = saved.filter((k, i) => base.includes(k) && saved.indexOf(k) === i);
  // Anything the saved list lacks goes back after the section it follows
  // in the default order.
  for (const k of base) {
    if (known.includes(k)) continue;
    const before = base.slice(0, base.indexOf(k)).reverse().find(p => known.includes(p));
    known.splice(before ? known.indexOf(before) + 1 : 0, 0, k);
  }
  return known;
}

/** The patch that saves `order` for this kind of app. */
export function layoutPatch(kind, order) {
  return { [LAYOUT_KEY[kind]]: order };
}
