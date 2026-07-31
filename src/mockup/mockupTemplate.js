/* ─────────────────────────────────────────────────────────────────────
 * mockupTemplate — the mockup config shape, a CSV fill-in template
 * (download + upload-to-apply), and the "research this org" AI prompt.
 *
 * A mockup config fully describes one dummy store-home screen. It is the
 * single object saved to the shared library and fed to <MockupPreview/>.
 * ───────────────────────────────────────────────────────────────────── */

// Design palette — retargets the app's --bk-* CSS variables, scoped to the
// preview only (see MockupPreview). Mirrors DEFAULT_DESIGN.colors.
export const DEFAULT_PALETTE = {
  background: '#F4EBDC',
  primary:    '#502314',
  accent:     '#FEA01E',
  accentDeep: '#E24400',
  surface:    '#FFFFFF',
  text:       '#1D1D1D',
  textMuted:  '#6C6259',
  success:    '#1A8737',
};

export function blankReward(i = 0) {
  const palette = ['#FEA01E', '#1A8737', '#E24400'];
  return {
    name: '',
    image: '',
    cupsNeeded: 6,
    euros: '',              // '' → auto (cupsNeeded × 1.25)
    bgColor: palette[i % palette.length],
    tags: '',               // comma-separated
  };
}

export const DEFAULT_CONFIG = {
  orgName: 'Sunrise Coffee',
  partnerBrandName: '',
  logoUrl: '',
  logoWidth: '',            // '' → CSS default size
  brandColor: '#FD6F46',
  palette: { ...DEFAULT_PALETTE },
  heroHeadline: 'Turn cups into cashback',
  heroSubtext: 'Bring your own cup on every visit, collect cups, and turn them into real cashback rewards.',
  cupsCollected: 2,
  sections: { showPackbackLogo: true, showBrandLogo: true },
  rewards: [
    { name: 'Flat White', image: '', cupsNeeded: 6, euros: '', bgColor: '#FEA01E', tags: 'BARISTA' },
    { name: 'Cappuccino', image: '', cupsNeeded: 5, euros: '', bgColor: '#1A8737', tags: '' },
    { name: 'Cold Brew',  image: '', cupsNeeded: 8, euros: '', bgColor: '#E24400', tags: 'ICED' },
  ],
  selectedIndex: 0,
};

/* Deep-clone a config so edits never mutate DEFAULT_CONFIG / a saved row. */
export function cloneConfig(c) {
  const base = c || DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...base,
    palette: { ...DEFAULT_PALETTE, ...(base.palette || {}) },
    sections: { ...DEFAULT_CONFIG.sections, ...(base.sections || {}) },
    rewards: (() => {
      const rw = (base.rewards && base.rewards.length ? base.rewards : DEFAULT_CONFIG.rewards)
        .slice(0, 30)                       // was 3 — templates can showcase many rewards
        .map((r, i) => ({ ...blankReward(i), ...r }));
      return rw;
    })(),
    selectedIndex: (() => {
      const n = (base.rewards && base.rewards.length ? base.rewards : DEFAULT_CONFIG.rewards).length;
      return Math.min(Math.max(0, n - 1), Math.max(0, Number(base.selectedIndex) || 0));
    })(),
  };
}

/* ── Built-in starter mockups ──────────────────────────────────────────
 * Ready-made, version-controlled example configs the team can load from the
 * Library modal without any DB row. Unlike DEFAULT_CONFIG (a blank BYO start),
 * each starter is a complete, on-brand dummy vendor.
 *
 * Stanfordo is a cup-DEPOSIT trattoria (NOT bring-your-own): the customer
 * returns their cup after a visit and turns collected cups into cashback, so
 * the hero copy mirrors the 'deposit' preset in copyPresets.js (return
 * packaging → earn cashback), never any "bring your own cup" wording.
 */
export const STARTER_MOCKUPS = [
  {
    id: 'starter-rotterdam-coffee-fest',
    name: 'Rotterdam Coffee Fest — festival (25 rewards)',
    config: {
      orgName: 'Rotterdam Coffee Fest',
      partnerBrandName: '',
      logoUrl: '',
      logoWidth: '',
      brandColor: '#C82D8F',              // magenta accent from the brand kit
      palette: {
        background: '#7A3E97',            // festival purple
        primary:    '#C82D8F',            // magenta headline / primary
        accent:     '#DCE84F',            // lime
        accentDeep: '#A8236F',            // deep magenta
        surface:    '#8A56A6',            // lighter purple card surface
        text:       '#F4EFA6',            // light lime text on purple
        textMuted:  '#D8C7E6',            // soft lilac
        success:    '#DCE84F',            // lime = unlocked
      },
      heroHeadline: 'Turn festival cups into rewards',
      heroSubtext: 'Sip your way through Rotterdam Coffee Fest — collect cups at every stand and turn them into coffee, gear, tastings and limited-edition merch.',
      cupsCollected: 9,
      sections: { showPackbackLogo: true, showBrandLogo: true },
      // 5 rewards from each of 5 categories (tagged by category). No photos —
      // the coloured brand tiles carry each one.
      rewards: [
        // 1 · Coffee products
        { name: 'Coffee samples — A Matter of Concrete', image: '', cupsNeeded: 4,  euros: '', bgColor: '#C82D8F', tags: 'COFFEE' },
        { name: 'Coffee bags — Giraffe Coffee Roasters', image: '', cupsNeeded: 8,  euros: '', bgColor: '#5E2E7A', tags: 'COFFEE' },
        { name: 'Coffee samples — Grounded',             image: '', cupsNeeded: 4,  euros: '', bgColor: '#2B2B2B', tags: 'COFFEE' },
        { name: 'Coffee bags — Evermore',                image: '', cupsNeeded: 8,  euros: '', bgColor: '#A8236F', tags: 'COFFEE' },
        { name: 'Coffee products — Contributor Coffee',  image: '', cupsNeeded: 7,  euros: '', bgColor: '#6E3A8C', tags: 'COFFEE' },
        // 2 · Coffee equipment & accessories
        { name: 'Brewing accessories — Hario Europe',            image: '', cupsNeeded: 10, euros: '', bgColor: '#5E2E7A', tags: 'EQUIPMENT' },
        { name: 'Barista accessories — Espresso Service West',   image: '', cupsNeeded: 10, euros: '', bgColor: '#C82D8F', tags: 'EQUIPMENT' },
        { name: 'Reusable bottles & filters — BRITA Nederland',  image: '', cupsNeeded: 9,  euros: '', bgColor: '#2B2B2B', tags: 'EQUIPMENT' },
        { name: 'Coffee tools — A Matter of Concrete',           image: '', cupsNeeded: 11, euros: '', bgColor: '#A8236F', tags: 'EQUIPMENT' },
        { name: 'ZeroCup accessories — UBITE',                   image: '', cupsNeeded: 12, euros: '', bgColor: '#6E3A8C', tags: 'EQUIPMENT' },
        // 3 · Tea & alternative drinks
        { name: 'Chai samples — Nomadschai',                     image: '', cupsNeeded: 4,  euros: '', bgColor: '#C82D8F', tags: 'TEA' },
        { name: 'Oat drink products — Oatly',                    image: '', cupsNeeded: 5,  euros: '', bgColor: '#5E2E7A', tags: 'TEA' },
        { name: 'Chai concentrate — Nomadschai',                 image: '', cupsNeeded: 6,  euros: '', bgColor: '#2B2B2B', tags: 'TEA' },
        { name: 'Oatly barista products',                        image: '', cupsNeeded: 6,  euros: '', bgColor: '#A8236F', tags: 'TEA' },
        { name: 'Non-coffee tasting — festival exhibitors',      image: '', cupsNeeded: 5,  euros: '', bgColor: '#6E3A8C', tags: 'TEA' },
        // 4 · Workshops & experiences
        { name: 'Coffee cupping — A Matter of Concrete',         image: '', cupsNeeded: 12, euros: '', bgColor: '#5E2E7A', tags: 'WORKSHOP' },
        { name: 'Coffee tasting — Giraffe Coffee Roasters',      image: '', cupsNeeded: 12, euros: '', bgColor: '#C82D8F', tags: 'WORKSHOP' },
        { name: 'Brewing workshop — Hario Europe',               image: '', cupsNeeded: 14, euros: '', bgColor: '#2B2B2B', tags: 'WORKSHOP' },
        { name: 'Espresso demo — Espresso Service West',         image: '', cupsNeeded: 13, euros: '', bgColor: '#A8236F', tags: 'WORKSHOP' },
        { name: 'Water-for-coffee tasting — BRITA Nederland',    image: '', cupsNeeded: 11, euros: '', bgColor: '#6E3A8C', tags: 'WORKSHOP' },
        // 5 · Merchandise & premium rewards
        { name: 'Limited-edition ZeroCup — UBITE',               image: '', cupsNeeded: 16, euros: '', bgColor: '#C82D8F', tags: 'PREMIUM' },
        { name: 'HOKA cap or running socks',                     image: '', cupsNeeded: 14, euros: '', bgColor: '#5E2E7A', tags: 'PREMIUM' },
        { name: 'Rotterdam Coffee Fest × UBITE cup',             image: '', cupsNeeded: 15, euros: '', bgColor: '#2B2B2B', tags: 'PREMIUM' },
        { name: 'Giraffe Coffee Roasters merch',                 image: '', cupsNeeded: 12, euros: '', bgColor: '#A8236F', tags: 'PREMIUM' },
        { name: 'A Matter of Concrete accessories',              image: '', cupsNeeded: 13, euros: '', bgColor: '#6E3A8C', tags: 'PREMIUM' },
      ],
      selectedIndex: 22,                   // feature the Rotterdam Coffee Fest × UBITE cup
    },
  },
  {
    id: 'starter-stanfordo',
    name: 'Stanfordo — trattoria (deposit)',
    config: {
      orgName: 'Stanfordo',
      partnerBrandName: '',
      logoUrl: '',
      logoWidth: '',
      brandColor: '#B8402F',
      palette: {
        background: '#F6EEE1',
        primary:    '#5A2A22',
        accent:     '#C6472F',
        accentDeep: '#8F2E1E',
        surface:    '#FFFFFF',
        text:       '#211915',
        textMuted:  '#6C6259',
        success:    '#3E7D4F',
      },
      heroHeadline: 'Return your cup, get cashback',
      heroSubtext: 'Enjoy your meal at Stanfordo, return your cup at the counter, and turn collected cups into real cashback.',
      cupsCollected: 5,
      sections: { showPackbackLogo: true, showBrandLogo: true },
      rewards: [
        { name: 'Pizza Margherita',    image: 'https://www.themealdb.com/images/media/meals/x0lk931587671540.jpg', cupsNeeded: 8,  euros: '', bgColor: '#C6472F', tags: 'CLASSICO' },
        { name: 'Spaghetti Carbonara', image: 'https://www.themealdb.com/images/media/meals/llcbn01574260722.jpg', cupsNeeded: 6,  euros: '', bgColor: '#E0A12B', tags: '' },
        { name: 'Lasagne al Forno',    image: 'https://www.themealdb.com/images/media/meals/wtsvxx1511296896.jpg', cupsNeeded: 10, euros: '', bgColor: '#3E7D4F', tags: "CHEF'S PICK" },
      ],
      selectedIndex: 0,
    },
  },
];

// ── CSV template ───────────────────────────────────────────────────────
// Flat, human-friendly columns. One header row + one worked example row.
export const CSV_COLUMNS = [
  'orgName', 'partnerBrandName', 'brandColor', 'logoUrl', 'logoWidth',
  'paletteBackground', 'palettePrimary', 'paletteAccent', 'paletteAccentDeep',
  'paletteSurface', 'paletteText', 'paletteTextMuted', 'paletteSuccess',
  'heroHeadline', 'heroSubtext', 'cupsCollected',
  'reward1Name', 'reward1Image', 'reward1CupsNeeded', 'reward1Euros', 'reward1BgColor', 'reward1Tags', 'reward1Selected',
  'reward2Name', 'reward2Image', 'reward2CupsNeeded', 'reward2Euros', 'reward2BgColor', 'reward2Tags', 'reward2Selected',
  'reward3Name', 'reward3Image', 'reward3CupsNeeded', 'reward3Euros', 'reward3BgColor', 'reward3Tags', 'reward3Selected',
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exampleRow() {
  return {
    orgName: 'Sunrise Coffee', partnerBrandName: '', brandColor: '#E4572E', logoUrl: '', logoWidth: '',
    paletteBackground: '#F4EBDC', palettePrimary: '#502314', paletteAccent: '#FEA01E', paletteAccentDeep: '#E24400',
    paletteSurface: '#FFFFFF', paletteText: '#1D1D1D', paletteTextMuted: '#6C6259', paletteSuccess: '#1A8737',
    heroHeadline: 'Turn cups into cashback', heroSubtext: 'Bring your cup, collect, and cash out.', cupsCollected: '2',
    reward1Name: 'Flat White', reward1Image: '', reward1CupsNeeded: '6', reward1Euros: '', reward1BgColor: '#FEA01E', reward1Tags: 'BARISTA', reward1Selected: 'yes',
    reward2Name: 'Cappuccino', reward2Image: '', reward2CupsNeeded: '5', reward2Euros: '', reward2BgColor: '#1A8737', reward2Tags: '', reward2Selected: '',
    reward3Name: 'Cold Brew', reward3Image: '', reward3CupsNeeded: '8', reward3Euros: '', reward3BgColor: '#E24400', reward3Tags: 'ICED', reward3Selected: '',
  };
}

export function downloadTemplate() {
  const header = CSV_COLUMNS.join(',');
  const example = CSV_COLUMNS.map(c => csvEscape(exampleRow()[c])).join(',');
  const empty = CSV_COLUMNS.map(() => '').join(',');
  const csv = [header, example, empty].join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mockup-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Minimal RFC-4180-ish CSV parser (handles quoted fields + escaped quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => (c || '').trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* Turn one parsed CSV row into a mockup config (merged over defaults). */
export function csvRowToConfig(row) {
  const val = (k, d = '') => (row[k] != null && row[k] !== '' ? row[k] : d);
  const mkReward = (n, i) => ({
    ...blankReward(i),
    name: val(`reward${n}Name`),
    image: val(`reward${n}Image`),
    cupsNeeded: Number(val(`reward${n}CupsNeeded`, 6)) || 6,
    euros: val(`reward${n}Euros`),
    bgColor: val(`reward${n}BgColor`, blankReward(i).bgColor),
    tags: val(`reward${n}Tags`),
  });
  const rewards = [mkReward(1, 0), mkReward(2, 1), mkReward(3, 2)].filter(r => r.name);
  const selectedIndex = ['reward1Selected', 'reward2Selected', 'reward3Selected']
    .findIndex(k => /^(yes|y|true|1|x)$/i.test(val(k)));
  return cloneConfig({
    orgName: val('orgName', DEFAULT_CONFIG.orgName),
    partnerBrandName: val('partnerBrandName'),
    brandColor: val('brandColor', DEFAULT_CONFIG.brandColor),
    logoUrl: val('logoUrl'),
    logoWidth: val('logoWidth'),
    palette: {
      background: val('paletteBackground', DEFAULT_PALETTE.background),
      primary:    val('palettePrimary', DEFAULT_PALETTE.primary),
      accent:     val('paletteAccent', DEFAULT_PALETTE.accent),
      accentDeep: val('paletteAccentDeep', DEFAULT_PALETTE.accentDeep),
      surface:    val('paletteSurface', DEFAULT_PALETTE.surface),
      text:       val('paletteText', DEFAULT_PALETTE.text),
      textMuted:  val('paletteTextMuted', DEFAULT_PALETTE.textMuted),
      success:    val('paletteSuccess', DEFAULT_PALETTE.success),
    },
    heroHeadline: val('heroHeadline', DEFAULT_CONFIG.heroHeadline),
    heroSubtext: val('heroSubtext', DEFAULT_CONFIG.heroSubtext),
    cupsCollected: Number(val('cupsCollected', 2)) || 0,
    rewards: rewards.length ? rewards : DEFAULT_CONFIG.rewards,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
  });
}

// ── AI research prompt ─────────────────────────────────────────────────
// Copied by the team, filled with a business name, and run in any AI. The
// AI returns a ready-to-upload CSV row for the template above.
export const AI_RESEARCH_PROMPT = `You are preparing a PackPerks pitch mockup for a prospective partner café or restaurant. PackPerks lets customers bring a reusable cup, collect "cups" (a loyalty stamp) on each visit, and turn them into real cashback rewards.

BUSINESS TO RESEARCH: <<paste the business name, and its city and/or website>>

Research this business (brand colours, signature menu items, tone of voice). Then produce the values for a mockup of THIS brand's store screen. If something is unknown, make a realistic, on-brand guess. Never leave a field blank.

Rules:
- brandColor and every palette*/bgColor value must be a 6-digit hex colour (e.g. #E4572E).
- heroHeadline: max ~6 words, upbeat, about earning cashback for reusing cups.
- heroSubtext: one short supporting sentence.
- Pick 3 signature items the business is known for. For each: a short name, a realistic euro price, cupsNeeded as a whole number 4–10 (pricier items need more cups), and a background colour hex that suits the product.
- Mark exactly ONE reward as the flagship by putting "yes" in its rewardXSelected column; leave the others blank.
- Leave logoUrl and every rewardXImage blank unless you have a real, public https image URL.

Return ONLY a CSV with this exact header row followed by one data row (comma-separated, wrap any value containing a comma in double quotes):

orgName,partnerBrandName,brandColor,logoUrl,logoWidth,paletteBackground,palettePrimary,paletteAccent,paletteAccentDeep,paletteSurface,paletteText,paletteTextMuted,paletteSuccess,heroHeadline,heroSubtext,cupsCollected,reward1Name,reward1Image,reward1CupsNeeded,reward1Euros,reward1BgColor,reward1Tags,reward1Selected,reward2Name,reward2Image,reward2CupsNeeded,reward2Euros,reward2BgColor,reward2Tags,reward2Selected,reward3Name,reward3Image,reward3CupsNeeded,reward3Euros,reward3BgColor,reward3Tags,reward3Selected`;
