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
    rewards: (base.rewards && base.rewards.length ? base.rewards : DEFAULT_CONFIG.rewards)
      .slice(0, 3)
      .map((r, i) => ({ ...blankReward(i), ...r })),
    selectedIndex: Math.min(2, Math.max(0, Number(base.selectedIndex) || 0)),
  };
}

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
