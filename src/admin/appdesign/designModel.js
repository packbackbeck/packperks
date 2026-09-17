import {
  Activity, Banknote, BookOpen, EyeOff, Gift, HeartHandshake, House, Image, Leaf,
  Palette, Share2, Store, Type, LayoutGrid, User,
} from 'lucide-react';
import { DEFAULT_DESIGN } from './designDefaults';
import { paletteFromBrand } from './colorUtils';

/* ─────────────────────────────────────────────────────────────────────
 * What the Design & copy page edits, described once: colour roles, ready
 * palettes, copy fields, section switches and the built-in guide. The
 * wording says what each setting does in the customer app today, checked
 * against src/components and src/App.jsx.
 * ───────────────────────────────────────────────────────────────────── */

export const TABS = [
  { id: 'colors', label: 'Colours', icon: Palette },
  { id: 'copy', label: 'Copy', icon: Type },
  { id: 'sections', label: 'Sections', icon: LayoutGrid },
  { id: 'guide', label: 'Guide', icon: BookOpen },
];

export const SCREENS = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'account', label: 'Account', icon: User },
  { id: 'guide', label: 'Guide', icon: BookOpen },
];

/* ── Colours ──────────────────────────────────────────────────────────
 * `check` is the pairing the colour has to stay readable against:
 * [foreground key, background key, 'text' | 'shape', what the pair is]. */
export const COLOR_GROUPS = [
  {
    id: 'brand',
    title: 'Brand',
    subtitle: 'The colours that make the app look like yours.',
    roles: [
      {
        key: 'primary', name: 'Buttons and header',
        detail: 'The main button, the header tiles and the guide’s Next button.',
        check: ['surface', 'primary', 'text', 'Button text on it'],
      },
      {
        key: 'accent', name: 'Progress and add button',
        detail: 'Fills the cup progress bar and colours the + button.',
        check: ['surface', 'accent', 'shape', 'White icons on it'],
      },
      {
        key: 'accentDeep', name: 'Reward card',
        detail: 'The featured reward card and the empty part of the progress bar. The fill fades into it.',
        check: ['surface', 'accentDeep', 'text', 'Reward name on it'],
      },
    ],
  },
  {
    id: 'page',
    title: 'Page',
    subtitle: 'What your content sits on.',
    roles: [
      { key: 'background', name: 'Page background', detail: 'Behind everything, on every screen. Keep it light.' },
      { key: 'surface', name: 'Cards and button text', detail: 'Cards and sheets, and the text and icons on coloured buttons.' },
    ],
  },
  {
    id: 'text',
    title: 'Text',
    subtitle: 'Body text needs a contrast of at least 4.5:1 to be easy to read.',
    roles: [
      {
        key: 'text', name: 'Headlines and body text',
        detail: 'The home headline, titles and most of what customers read.',
        check: ['text', 'background', 'text', 'On the page background'],
      },
      {
        key: 'textMuted', name: 'Secondary text',
        detail: 'The back link, the cup count and small print on the account screen.',
        check: ['textMuted', 'background', 'text', 'On the page background'],
      },
    ],
  },
  {
    id: 'status',
    title: 'Status',
    subtitle: 'Used when something went right.',
    roles: [
      {
        key: 'success', name: 'Unlocked and success',
        detail: 'The reward card and progress bar once a reward is unlocked, and the cashback amount.',
        check: ['surface', 'success', 'text', 'Text on it'],
      },
    ],
  },
];

export const COLOR_KEYS = COLOR_GROUPS.flatMap(g => g.roles.map(r => r.key));

export const COLOR_LABELS = Object.fromEntries(
  COLOR_GROUPS.flatMap(g => g.roles.map(r => [r.key, r.name])),
);

const SUCCESS = DEFAULT_DESIGN.colors.success;

const FIXED_PALETTES = [
  { id: 'classic', name: 'PackBack classic', colors: { ...DEFAULT_DESIGN.colors } },
  {
    id: 'forest', name: 'Forest',
    colors: { primary: '#1F3B2D', accent: '#3FA36B', accentDeep: '#1E7A4C', background: '#EEF4EE', surface: '#FFFFFF', text: '#1B211D', textMuted: '#56625A', success: SUCCESS },
  },
  {
    id: 'ocean', name: 'Ocean',
    colors: { primary: '#102A43', accent: '#2F80ED', accentDeep: '#1B4FA8', background: '#EEF3FA', surface: '#FFFFFF', text: '#111827', textMuted: '#52606D', success: SUCCESS },
  },
  {
    id: 'berry', name: 'Berry',
    colors: { primary: '#3D1236', accent: '#E0457B', accentDeep: '#8E2A6B', background: '#FBF0F4', surface: '#FFFFFF', text: '#1F1320', textMuted: '#6B5566', success: SUCCESS },
  },
  {
    id: 'mono', name: 'Charcoal',
    colors: { primary: '#1D1D1F', accent: '#8A8A8E', accentDeep: '#3A3A3C', background: '#F2F2F4', surface: '#FFFFFF', text: '#1D1D1F', textMuted: '#5E5E62', success: SUCCESS },
  },
];

/* Ready palettes, the organisation's own brand colour first. */
export function palettesFor(org) {
  const brand = org?.brand_color ? paletteFromBrand(org.brand_color, DEFAULT_DESIGN.colors) : null;
  return [
    ...(brand ? [{ id: 'brand', name: 'Your brand', colors: brand, highlight: true }] : []),
    ...FIXED_PALETTES,
  ];
}

/* ── Copy ─────────────────────────────────────────────────────────────
 * source 'settings' → settings[key]; 'design' → settings.design.copy[key].
 * `fallback` is what the app shows when a design label is left empty. */
export const COPY_GROUPS = [
  {
    id: 'home',
    title: 'Home screen',
    subtitle: 'The first words customers read.',
    icon: House,
    screen: 'home',
    groupCopy: true,
    fields: [
      {
        key: 'heroHeadline', source: 'settings', label: 'Headline', soft: 34, hard: 48,
        hint: 'A comma starts a new line in the app.',
        emptyNote: 'Left empty, the home screen has no headline.',
      },
      {
        key: 'heroSubtext', source: 'settings', label: 'Text under the headline', multiline: true, soft: 120, hard: 180,
        hint: 'One or two short sentences.',
        emptyNote: 'Left empty, nothing shows under the headline.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Account screen',
    subtitle: 'The buttons under the cup balance and the heading above recent activity.',
    icon: User,
    screen: 'account',
    groupCopy: true,
    fields: [
      { key: 'shareButtonLabel', source: 'design', label: 'Share button', soft: 18, hard: 24, fallback: 'Share your Cup', section: 'showShareCup', feature: 'featureCupSharing', featureLabel: 'Cup sharing' },
      { key: 'nextCupFreeLabel', source: 'design', label: 'Gift button', soft: 18, hard: 24, fallback: 'Next cup for free', section: 'showNextCupForFree', feature: 'featureCupSharing', featureLabel: 'Cup sharing' },
      { key: 'donateButtonLabel', source: 'design', label: 'Donate button', soft: 18, hard: 24, fallback: 'Donate', section: 'showDonate', feature: 'featureDonations', featureLabel: 'Donations' },
      { key: 'activityLabel', source: 'design', label: 'Activity heading', soft: 20, hard: 28, fallback: 'Activity', section: 'showActivity' },
    ],
  },
  {
    id: 'donations',
    title: 'Donations',
    subtitle: 'Your charity partner, as named on this dashboard’s Donations page. The app’s donate screen doesn’t use these yet: it always names Plastic Soup Foundation.',
    icon: HeartHandshake,
    feature: 'featureDonations',
    featureLabel: 'Donations',
    fields: [
      { key: 'donationRecipient', source: 'settings', label: 'Charity', soft: 32, hard: 48 },
      { key: 'donationDescription', source: 'settings', label: 'What the donation does', multiline: true, soft: 140, hard: 220 },
    ],
  },
  {
    id: 'unused',
    title: 'Not shown in the app yet',
    subtitle: 'These are saved with your design, but no screen uses them today.',
    icon: EyeOff,
    quiet: true,
    fields: [
      { key: 'badgeText', source: 'design', label: 'Cup balance label', soft: 12, hard: 16 },
      { key: 'refundButtonLabel', source: 'design', label: 'Direct refund button', soft: 22, hard: 28 },
    ],
  },
];

/* ── Sections ───────────────────────────────────────────────────────── */
export const SECTION_GROUPS = [
  {
    id: 'home',
    title: 'Home screen',
    screen: 'home',
    rows: [
      { key: 'showPackbackLogo', label: 'PackBack logo', icon: Image, tone: 'slate', summary: 'The PackBack logo at the top left.' },
      { key: 'showBrandLogo', label: 'Your logo', icon: Store, tone: 'violet', summary: 'Your logo beside it. Without an uploaded logo, the first letter of your name in your brand colour.' },
      { key: 'showDirectRefund', label: 'Direct refund link', icon: Banknote, tone: 'emerald', summary: '“Get the direct refund” under the reward, for customers who want cash instead.', feature: 'featureDirectRefunds', featureLabel: 'Direct refunds' },
    ],
  },
  {
    id: 'account',
    title: 'Account screen',
    screen: 'account',
    rows: [
      { key: 'showShareCup', label: 'Share button', icon: Share2, tone: 'sky', summary: 'Customers send cups to a friend with a QR code.', feature: 'featureCupSharing', featureLabel: 'Cup sharing' },
      { key: 'showNextCupForFree', label: 'Gift button', icon: Gift, tone: 'orange', summary: 'A second way into cup sharing, worded as giving a friend their next cup.', feature: 'featureCupSharing', featureLabel: 'Cup sharing' },
      { key: 'showDonate', label: 'Donate button', icon: HeartHandshake, tone: 'rose', summary: 'Customers give cups to your charity partner.', feature: 'featureDonations', featureLabel: 'Donations' },
      { key: 'showImpact', label: 'Impact card', icon: Leaf, tone: 'lime', summary: 'Lifetime cups and the CO₂ they saved. Appears once a customer has returned a cup.' },
      { key: 'showActivity', label: 'Activity list', icon: Activity, tone: 'amber', summary: 'Recent cups, rewards and payouts.' },
    ],
  },
];

/* Feature switches default to on when a draft doesn't carry them. */
export function featureOn(settings, key) {
  if (!key) return true;
  return settings?.[key] !== false;
}

/* ── Guide ────────────────────────────────────────────────────────────
 * The app's built-in guide. A copy of DEFAULT_STEPS in
 * src/components/HowItWorks.jsx, which that file doesn't export; keep
 * the two in step. Step 3 is plain text here (the app bolds two words). */
export const BUILT_IN_GUIDE = [
  { key: 'collect', title: 'Collect your cups', text: 'Bring your reusable cup to any participating spot and scan the counter QR. Every cup you collect adds to your balance.', image: '/how-it-works/step-1.png', bg: 'linear-gradient(165deg, #FDF1E6 0%, #F9DFCB 100%)', accent: '#E08A53', icon: 'cup' },
  { key: 'unlock', title: 'Unlock a reward', text: 'Collect enough cups to unlock a reward, then choose the product you want from the list.', image: '/how-it-works/step-2.png', bg: 'linear-gradient(165deg, #FCF2D6 0%, #F8E7B9 100%)', accent: '#E0A12B', icon: 'reward' },
  { key: 'buy', title: 'Buy it in the store', text: 'Buy that product at any supermarket or grocery store in the Netherlands, and keep the printed receipt.', image: '/how-it-works/step-3.png', bg: 'linear-gradient(165deg, #E9F4E7 0%, #D6ECD8 100%)', accent: '#5FA044', icon: 'store' },
  { key: 'verify', title: 'Verify your purchase', text: 'Snap a photo of your receipt so we can confirm the purchase.', image: '/how-it-works/step-4.png', bg: 'linear-gradient(165deg, #E6EAFC 0%, #D2DBF8 100%)', accent: '#5468C8', icon: 'receipt' },
  { key: 'cashback', title: 'Get your cashback', text: 'Once it is verified, we send you a Tikkie link to collect your cashback, usually within a few days.', image: '/how-it-works/step-5.png', bg: 'linear-gradient(165deg, #ECF8F1 0%, #DAF1E6 100%)', accent: '#2EA785', icon: 'cash' },
];

export const GUIDE_ICON_NAMES = {
  cup: 'Cup', reward: 'Gift', store: 'Shop', receipt: 'Receipt', cash: 'Cashback',
};

/* A step as the app shows it: anything the admin left empty falls back to
 * the built-in step in the same position (HowItWorks resolveSteps). */
export function resolveGuideStep(step, index) {
  const base = BUILT_IN_GUIDE[index % BUILT_IN_GUIDE.length];
  return {
    key: step.key || `step-${index}`,
    title: step.title || '',
    text: step.body ?? step.text ?? '',
    image: step.image || base.image,
    bg: step.bg || base.bg,
    accent: step.accent || base.accent,
    icon: step.icon || base.icon,
    usesBuiltInImage: !step.image,
    usesBuiltInBg: !step.bg,
  };
}

export const GUIDE_TIPS_AFTER = 6;
