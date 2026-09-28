/* ─────────────────────────────────────────────────────────────────────
 * uxKeys — how a control is named, in ONE place.
 *
 * Two sides depend on agreeing exactly: the customer app, which writes a
 * key onto every tap, and the dashboard, which looks that key up in the
 * embedded app to find out where the control actually is now. If the two
 * ever compute a different key for the same button, every tap on it
 * silently falls back to raw coordinates and the heat drifts — which is
 * the failure this module exists to make impossible.
 *
 * Nothing here reads a field's contents or anything inside a
 * `[data-ppk-private]` subtree; `labelFor` is the visible NAME of a
 * control, never what somebody typed into it.
 * ───────────────────────────────────────────────────────────────────── */

/* Controls worth naming. Anything tapped outside this is a dead tap: the
 * customer aimed at something that does nothing, which is the whole reason
 * to record it.
 *
 * The native list is not enough on its own. Half this app's controls are
 * card-shaped divs with an onClick — a reward card, an activity row, a
 * store tile — and React leaves no attribute to find them by. What they do
 * have is `cursor: pointer`, which is how the stylesheet already tells the
 * customer they are pressable, so that is what we match on. */
export const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], [role="switch"], input, select, textarea, label, summary, [data-ppk]';

export const MAX_SCAN = 3000;      // elements a sweep will look at
export const MAX_ELEMENTS = 140;   // controls kept per screen

export const slug = (s) => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function cursorOf(el, win) {
  try { return (win || window).getComputedStyle(el).cursor; } catch { return ''; }
}

/** What a person calls this control. Never a field's contents. */
export function labelFor(el) {
  const aria = el.getAttribute?.('aria-label');
  if (aria) return aria.trim().slice(0, 60);
  const title = el.getAttribute?.('title');
  if (title) return title.trim().slice(0, 60);
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    // A field's own name, never what is in it.
    const name = el.getAttribute('name') || el.getAttribute('placeholder') || el.type;
    return String(name || tag).trim().slice(0, 60);
  }
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 60) : (tag || 'element');
}

/** The part of a key that comes from what the control says.
 *
 *  Not the whole label: the wallet tile reads "Available to collect €0.90"
 *  on one account and "Available to collect €1.80 Collect it all below.
 *  €0.90 sits in a link in your activity." on another, because a note is
 *  appended when the balance is split. Keyed on all of that, one control
 *  had a different identity per customer and matched nothing in the
 *  preview the heatmap draws on.
 *
 *  So: an `aria-label` when there is one, since those are written by hand
 *  and do not move; otherwise the first three words of the visible text
 *  with the numbers taken out. Enough to tell "Scan a QR code" from
 *  "Collect via Tikkie", short enough to survive whatever the app appends
 *  after it. */
function keyName(el) {
  const aria = el.getAttribute?.('aria-label');
  const raw = aria || labelFor(el);
  return slug(raw)
    .replace(/\d+/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
}

/** A key that means the same control tomorrow, and on somebody else's
 *  account. `data-ppk` wins wherever a component sets one; otherwise the
 *  tag, one meaningful class, and the short stable name above. */
export function keyFor(el) {
  const explicit = el.getAttribute?.('data-ppk');
  if (explicit) return `ppk:${slug(explicit)}`;
  const tag = el.tagName?.toLowerCase() || 'el';
  const cls = (el.className && typeof el.className === 'string' ? el.className : '')
    .split(/\s+/)
    .filter(c => c && !/^(is-|has-|ui-kpi--|active$|open$|selected$)/.test(c))[0] || '';
  const name = keyName(el);
  return `${tag}:${slug(cls)}${name ? `:${name}` : ''}`.slice(0, 110);
}

/* The control a tap belongs to. A native one if there is one; otherwise the
 * OUTERMOST element of the pointer region under the finger — `cursor` is
 * inherited, so the innermost would be whichever label happened to be
 * under the thumb. */
export function pressableAncestor(node, win) {
  const doc = node.ownerDocument || document;
  const native = node.closest?.(INTERACTIVE);
  if (native) return native;
  let best = null;
  for (let el = node; el && el !== doc.body; el = el.parentElement) {
    if (cursorOf(el, win) === 'pointer') best = el;
    else if (best) break;
    else if (el.parentElement === doc.body) break;
  }
  return best;
}

/** Every control on this document right now. */
export function pressableNodes(doc = document, win) {
  const out = new Set(doc.querySelectorAll(INTERACTIVE));
  const all = doc.body ? doc.body.querySelectorAll('*') : [];
  const limit = Math.min(all.length, MAX_SCAN);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (out.has(el)) continue;
    if (cursorOf(el, win) !== 'pointer') continue;
    // Only the outermost of a pointer region: a price inside a reward card
    // is not a control of its own.
    const parent = el.parentElement;
    if (parent && parent !== doc.body && cursorOf(parent, win) === 'pointer') continue;
    out.add(el);
  }
  return [...out];
}

/** Nothing inside a subtree the app marked private is ever identified. */
export function isPrivate(el) {
  return !!el.closest?.('[data-ppk-private]');
}

/** Is this control pinned to the viewport? A sheet, a modal, the cookie
 *  banner and the scan page all are, and a tap on one must never have the
 *  scroll position added to it — that is what smeared every popup screen
 *  down the page. */
export function isPinned(el, win) {
  const w = win || window;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    let pos;
    try { pos = w.getComputedStyle(node).position; } catch { return false; }
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/**
 * Where every named control on a document is, in that document's own
 * pixels. The dashboard runs this inside the embedded customer app so a
 * tap can be put back exactly on the control it hit, whatever height that
 * particular page happens to be.
 *
 * @returns {Map<string, {left:number, top:number, width:number, height:number, pinned:boolean, label:string}>}
 */
export function measureControls(doc = document, win) {
  const w = win || doc.defaultView || window;
  const scrollX = w.scrollX || 0;
  const scrollY = w.scrollY || 0;
  const out = new Map();
  for (const el of pressableNodes(doc, w)) {
    if (out.size >= MAX_ELEMENTS * 2) break;
    if (isPrivate(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const key = keyFor(el);
    // The first match wins: two controls with the same name are rare, and
    // the first is the one a tap most likely meant.
    if (out.has(key)) continue;
    const pinned = isPinned(el, w);
    out.set(key, {
      left: r.left + scrollX,
      top: pinned ? r.top : r.top + scrollY,
      width: r.width,
      height: r.height,
      pinned,
      label: labelFor(el),
    });
  }
  return out;
}
