/* ─────────────────────────────────────────────────────────────────────
 * The two demo brands: what their PackPerks programme offers and what
 * the PackPerks parts look like inside their app.
 *
 * The rewards here are a copy of each organisation's published config
 * (Rewards & offers in the dashboard), so a demo works offline and on a
 * slow network. useOrgRewards() replaces them with the live list when it
 * can read it, so a change in the dashboard shows up here too.
 *
 * Points are a demo-only currency: one returned cup is POINTS_PER_CUP
 * points, so a reward that needs 7 cups costs 70 points.
 * ───────────────────────────────────────────────────────────────────── */

export const POINTS_PER_CUP = 10;

export const pointsFor = (reward) => Math.round((Number(reward?.cupsNeeded) || 0) * POINTS_PER_CUP);

// KFC: the images are KFC's own ordering images, as in the KFC org's config.
const KFC_IMG = 'https://deliverect-resizer.imgix.net/';
const KFC_OPTS = '?h=600&w=600&fit=crop&crop=center&auto=compress,format&cs=srgb';
const KFC_GCS = 'rt:fill/g:ce/el:0/aHR0cHM6Ly9zdG9yYWdlLmdvb2dsZWFwaXMuY29tL2lrb25hLWJ1Y2tldC1wcm9kdWN0aW9uL2ltYWdlcy82NjU3MzQzNGY5YjNjOTI0YzM4ZGY1MWIv';
const kfcImg = (sig, file) => `${KFC_IMG}${sig}/${KFC_GCS}${file}${KFC_OPTS}`;

// McDonald's: the product tiles from mcdonalds.com/nl (transparent PNGs).
const mcdImg = (name) => `https://s7d1.scene7.com/is/image/mcdonalds/${name}:nutrition-calculator-tile?fmt=png-alpha`;

export const BRANDS = {
  kfc: {
    key: 'kfc',
    name: 'KFC',
    orgSlug: 'kfc',
    path: '/demo/kfc',
    // Inside the KFC app the PackPerks parts wear the KFC org's PackPerks
    // palette (Client app → Colours) and KFC's own button red.
    kit: {
      bg: '#FFF1E2', primary: '#A6192E', onPrimary: '#FFFFFF',
      button: '#E4002B', onButton: '#FFFFFF',
      fill: '#E4002B', fillInk: '#FFFFFF',
      muted: '#8C857D', tile: '#FDE8EB', rail: '#E7ECF0',
      voucher: { brown: '#A6192E', orange: '#E4002B', cream: '#FFF1E2', black: '#000000' },
    },
    rewards: [
      { id: 'kfc-zinger-burger', order: 0, name: 'Zinger Burger', cupsNeeded: 7, euros: 6.99, imageScale: 1.25, featured: true,
        image: kfcImg('2Ym5iKpf6VqNV_6IUnbaMT7JVqfvcZxOsvxflm6qq7Y', 'WmluZ2VyQnVyZ2VyX0FMQ18yMDI1X1ViZXJFYXRzXzE5MjB4MTA4MHB4LTY3YWRlMzk5MTc3OTg2MjRkYmMxOGU0ZS5qcGc='),
        desc: { en: 'A spicy, crispy Zinger fillet on a white sesame bun with iceberg lettuce, a slice of tomato and burger mayo.',
                nl: 'Pittige, krokante Zinger-filet op een sesambol met ijsbergsla, tomaat en burgermayo.' } },
      { id: 'kfc-cookie-double-chocolate', order: 1, name: 'Double Chocolate Cookie', cupsNeeded: 3, euros: 2.5, imageScale: 1.25,
        image: kfcImg('CP8m3xKtdJ940Z_ATc_4zcpJeDBaKtw-yT89WJj47ns', 'Q29va2llRG91YmxlQ2hvY18yMDI1X1ViZXJFYXRzXzE5MjB4MTA4MHB4LTY3YWRmMzdiYzhkNmU3YzQ4OTcxMTA4NS5qcGc='),
        desc: { en: 'Crisp on the outside, soft in the middle, with pieces of milk and dark chocolate.',
                nl: 'Krokant van buiten, zacht van binnen, met stukjes melk- en pure chocolade.' } },
      { id: 'kfc-double-crunch-burger', order: 2, name: 'Double Crunch Burger', cupsNeeded: 4, euros: 3.99, imageScale: 1.2,
        image: kfcImg('yBgPQP1hkhqU5XZfSuFwZeqQCI8_N5CVWjRq361Uj7A', 'RG91YmxlQ3J1bmNoX0FMQ18yMDI1X1ViZXJFYXRzXzE5MjB4MTA4MHB4LTY3YWRlMzk5MTc3OTg2MjRkYmMxOGU0OC5qcGc='),
        desc: { en: 'A white sesame bun with two Crispy Tenders, iceberg lettuce and pepper mayo.',
                nl: 'Sesambol met twee Crispy Tenders, ijsbergsla en pepermayo.' } },
      { id: 'kfc-kentucky-loaded-fries', order: 3, name: 'Kentucky Loaded Fries', cupsNeeded: 5, euros: 4.15, imageScale: 1.25,
        image: kfcImg('-dTAesBGIr86HNXICq5wbwOSVFTJ3UFc9KyBomv2Gww', 'MjAyNV9XNV9TaWRlc19rZW50dWNreSUyMExvYWRlZCUyMGZyaWVzXzE0MDB4ODAwLTY5OWYwMzM5MmM1NDk0NDdlYzM3NTQwMi5wbmc='),
        desc: { en: 'Fries with a creamy cheese sauce, pieces of bacon and crispy fried onions.',
                nl: 'Friet met romige kaassaus, stukjes bacon en krokante gebakken uitjes.' } },
      { id: 'kfc-veggie-burger', order: 4, name: 'Veggie Burger', cupsNeeded: 7, euros: 6.99, imageScale: 1.2,
        image: kfcImg('kWA0p_LBEdWEZfrczFy75bPttHyAgHCweR3LL1fFv1A', 'VmVnZ2llQnVyZ2VyXzIwMjVfVWJlckVhdHNfMTkyMHgxMDgwcHgtNjdhZGU0ZTJjOGQ2ZTdjNDg5NzExMDBhLmpwZw=='),
        desc: { en: 'Two Original Recipe Veggie Tenders on a sesame bun with iceberg lettuce, tomato and mayo.',
                nl: 'Twee Original Recipe Veggie Tenders op een sesambol met ijsbergsla, tomaat en mayo.' } },
      { id: 'kfc-colonel-burger', order: 5, name: 'Colonel Burger', cupsNeeded: 9, euros: 8.99, imageScale: 1.25,
        image: kfcImg('XZ7diM9P0xaAeHY_I7HVmhkdqDjawf3MpqtOKI3x8tw', 'Q29sb25lbEJ1cmdlcl9BTENfMjAyNV9VYmVyRWF0c18xOTIweDEwODBweC02N2FkZTM5ODE3Nzk4NjI0ZGJjMThlNDYuanBn'),
        desc: { en: 'KFC’s most iconic burger: an Original fillet in the 11 herbs and spices, with tomato, lettuce, cheese and the secret sauce.',
                nl: 'De bekendste burger van KFC: Original-filet met de 11 kruiden en specerijen, tomaat, sla, kaas en de geheime saus.' } },
    ],
  },

  mcdonalds: {
    key: 'mcdonalds',
    name: 'McDonald’s',
    orgSlug: 'mcdonalds',
    path: '/demo/mcdonalds',
    // McDonald's org palette (red tiles on a soft yellow), with the app's
    // own call-to-action style: yellow with dark text.
    kit: {
      bg: '#FFF4D6', primary: '#DB0007', onPrimary: '#FFFFFF',
      button: '#FFBC0D', onButton: '#292929',
      fill: '#FFBC0D', fillInk: '#292929',
      muted: '#7A6F5C', tile: '#FFF8E8', rail: '#EFE7D6',
      // The voucher is PackPerks' own screen: the McDonald's org's colours.
      voucher: { brown: '#A50004', orange: '#DB0007', cream: '#FFF4D6', black: '#292929' },
    },
    rewards: [
      { id: 'mcd-big-mac', order: 0, name: 'Big Mac', cupsNeeded: 7, euros: 6.1, imageScale: 1, featured: true,
        image: mcdImg('ngk_gui_nl_main_big_mac'),
        desc: { en: 'Two 100% beef patties with Big Mac sauce, lettuce, cheese, pickles and onions on a sesame bun.',
                nl: 'Twee 100% rundvleesburgers met Big Mac-saus, sla, kaas, augurk en ui op een sesambol.' } },
      { id: 'mcd-cheeseburger', order: 1, name: 'Cheeseburger', cupsNeeded: 3, euros: 2.6, imageScale: 1,
        image: mcdImg('gui_main_cheeseburger'),
        desc: { en: 'A 100% beef patty with cheese, pickles, onions, ketchup and mustard.',
                nl: 'Een 100% rundvleesburger met kaas, augurk, ui, ketchup en mosterd.' } },
      { id: 'mcd-mcflurry-mms', order: 2, name: 'McFlurry M&M’s', cupsNeeded: 4, euros: 3.95, imageScale: 1,
        image: mcdImg('gui_nl_main_mcflurrymm'),
        desc: { en: 'Creamy soft serve mixed with M&M’s.',
                nl: 'Romig softijs gemengd met M&M’s.' } },
      { id: 'mcd-franse-frietjes-medium', order: 3, name: 'Franse Frietjes Medium', cupsNeeded: 4, euros: 3.45, imageScale: 1,
        image: mcdImg('gui_nl_main_frites_medium'),
        desc: { en: 'Our world-famous fries: golden, crispy and lightly salted.',
                nl: 'Onze wereldberoemde frietjes: goudbruin, krokant en licht gezouten.' } },
      { id: 'mcd-chicken-mcnuggets-6', order: 4, name: 'Chicken McNuggets 6 stuks', cupsNeeded: 6, euros: 5.45, imageScale: 1,
        image: mcdImg('nuggets_chicken_6'),
        desc: { en: 'Six crispy Chicken McNuggets with a dip of your choice.',
                nl: 'Zes krokante Chicken McNuggets met een saus naar keuze.' } },
      { id: 'mcd-mcchicken', order: 5, name: 'McChicken', cupsNeeded: 6, euros: 5.5, imageScale: 1,
        image: mcdImg('ngk_gui_nl_main_app_mcchicken'),
        desc: { en: 'A crispy chicken patty with lettuce and mayo on a sesame bun.',
                nl: 'Krokante kipburger met sla en mayonaise op een sesambol.' } },
    ],
  },
};

export const BRAND_LIST = [BRANDS.kfc, BRANDS.mcdonalds];

/* Which brand a /demo/… path asks for. */
export function brandForPath(path) {
  const seg = String(path || '').replace(/\/+$/, '').split('/')[2] || '';
  if (seg === 'kfc') return 'kfc';
  if (/^(mcdonalds?|mcd|mcdonald-s)$/.test(seg)) return 'mcdonalds';
  return null;
}

/* PackPerks smart sorting: the reward just out of reach first, then what
 * can be redeemed now (most valuable first), then the rest. */
export function sortRewards(rewards, points) {
  const byCost = [...rewards].sort((a, b) => pointsFor(a) - pointsFor(b) || a.order - b.order);
  const next = byCost.find(r => pointsFor(r) > points);
  const rank = r => (r === next ? 0 : pointsFor(r) <= points ? 1 : 2);
  return [...rewards].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 1 ? pointsFor(b) - pointsFor(a) : pointsFor(a) - pointsFor(b))
    || a.order - b.order);
}

/* The cheapest reward the balance has not reached yet (null when every
 * reward is within reach). */
export function nextReward(rewards, points) {
  return [...rewards]
    .sort((a, b) => pointsFor(a) - pointsFor(b) || a.order - b.order)
    .find(r => pointsFor(r) > points) || null;
}
