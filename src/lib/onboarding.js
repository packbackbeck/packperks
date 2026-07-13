/* ─────────────────────────────────────────────────────────────────────
 * Onboarding — persistence + the shared quiz vocabulary, and the logic that
 * turns a completed quiz into a store ranking.
 *
 * The customer answers three light questions (drinks, country, city). We keep
 * the result in localStorage (the same store the app already uses for consent,
 * device id, collected claims) and, on the market page, derive a tag set per
 * store so matching cafés and reward items float to the top. Answers are
 * remembered so re-opening the quiz starts from where the customer left off.
 * ───────────────────────────────────────────────────────────────────── */

const KEY = 'packperks_onboarding';

/** The saved answers ({ drinkPreferences, country, city, completedAt }) or null. */
export function getOnboarding() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
  catch { return null; }
}

/** Persist completed answers (stamped so we can reason about recency later). */
export function setOnboarding(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, completedAt: Date.now() })); }
  catch { /* private mode / storage full — non-fatal */ }
}

/** Forget the answers so onboarding runs fresh (used by the secret re-open). */
export function clearOnboarding() {
  try { localStorage.removeItem(KEY); }
  catch { /* non-fatal */ }
}

/** Has the customer finished onboarding at least once? */
export function isOnboardingDone() {
  return !!getOnboarding();
}

/* ── Quiz vocabulary (shared by the screens AND the scoring below) ── */

export const DRINK_OPTIONS = [
  { key: 'coffee',        emoji: '☕', label: 'Coffee' },
  { key: 'iced_coffee',   emoji: '🧊', label: 'Iced coffee' },
  { key: 'tea',           emoji: '🍵', label: 'Tea' },
  { key: 'matcha',        emoji: '🍃', label: 'Matcha' },
  { key: 'smoothies',     emoji: '🧃', label: 'Smoothies' },
  { key: 'soft_drinks',   emoji: '🥤', label: 'Soft drinks' },
  { key: 'hot_chocolate', emoji: '🍫', label: 'Hot chocolate' },
  { key: 'other',         emoji: '✨', label: 'Other' },
];

export const MAX_DRINKS = 3;

export const COUNTRIES = [
  { key: 'netherlands', emoji: '🇳🇱', label: 'Netherlands' },
  { key: 'uae',         emoji: '🇦🇪', label: 'UAE' },
];

export const CITIES = {
  netherlands: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Breda', 'Other city'],
  uae:         ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Al Ain', 'Other city'],
};

const DRINK_LABEL = Object.fromEntries(DRINK_OPTIONS.map(d => [d.key, d.label.toLowerCase()]));

/** Human list of the chosen drinks for the processing copy ("coffee and matcha"). */
export function drinkPhrase(keys = []) {
  const words = keys.map(k => DRINK_LABEL[k]).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* ── Store tagging + scoring ──
 * We don't have a curated tag column per café, so tags are derived from the
 * text we already have (name, area, featured item, reward names). It's a
 * heuristic, but enough to float a matching city/drink to the top. */

const DRINK_KEYWORDS = {
  coffee:        ['coffee', 'koffie', 'espresso', 'cappuccino', 'latte', 'flat white', 'americano', 'roaster', 'barista', 'brew'],
  iced_coffee:   ['iced', 'ijskoffie', 'ice coffee', 'cold brew', 'frappe', 'frappé', 'freddo'],
  tea:           ['tea', 'thee', 'chai', 'thés', 'infus'],
  matcha:        ['matcha'],
  smoothies:     ['smoothie', 'smoothies', 'açai', 'acai'],
  soft_drinks:   ['soda', 'soft drink', 'cola', 'lemonade', 'limonade', 'frisdrank', 'juice', 'sap', 'sinaasappel'],
  hot_chocolate: ['chocolate', 'chocolade', 'cacao', 'cocoa', 'hot choc', 'mocha', 'stork'],
  other:         [],
};

function cityFromArea(area) {
  const parts = String(area || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** { drinks: string[], city: string } derived from a store card. */
export function deriveStoreTags(store) {
  if (!store) return { drinks: [], city: '' };
  const hay = [
    store.name, store.area, store.location?.city,
    store.featured?.name,
    ...(store.rewards || []).map(r => r?.name),
  ].filter(Boolean).join(' ').toLowerCase();

  const drinks = [];
  for (const [key, words] of Object.entries(DRINK_KEYWORDS)) {
    if (words.some(w => hay.includes(w))) drinks.push(key);
  }
  const city = (store.location?.city || cityFromArea(store.area) || '').toLowerCase();
  return { drinks, city };
}

/**
 * Higher = better match for the customer's onboarding answers. City is the
 * strongest signal (people care where they can actually use it), then each
 * matching drink adds a little. Returns 0 with no prefs, so callers can safely
 * fall back to their normal ordering.
 */
export function scoreStore(store, prefs) {
  if (!prefs) return 0;
  const tags = deriveStoreTags(store);
  let score = 0;

  const prefCity = (prefs.city || '').trim().toLowerCase();
  if (prefCity && prefCity !== 'other city' && tags.city && tags.city === prefCity) score += 100;

  const drinks = prefs.drinkPreferences || [];
  if (drinks.length && tags.drinks.length) {
    score += tags.drinks.filter(d => drinks.includes(d)).length * 12;
  }
  return score;
}
