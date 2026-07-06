/* ─────────────────────────────────────────────────────────────────────
 * MockupPreview — a faithful, NON-functional render of a single store's
 * customer home screen, built from a mockup config.
 *
 * It REUSES the real customer components (Header, CupProgress,
 * FeaturedReward, GoalSection) so the mockup automatically tracks any
 * change to the live app UI. The brand palette retargets the app's
 * --bk-* CSS variables scoped to this container only (never :root), and
 * the whole thing is pointer-events:none so nothing is interactive.
 *
 * Deliberately NOT rendered (locked): the multi-store "See all stores"
 * button, and every modal/sheet (detail, how-it-works, terms, refund,
 * donate, cup-scan) — those need real navigation/data.
 * ───────────────────────────────────────────────────────────────────── */

import '../App.css';
import Header from '../components/Header';
import CupProgress from '../components/CupProgress';
import FeaturedReward from '../components/FeaturedReward';
import GoalSection from '../components/GoalSection';
import { COLOR_VAR_MAP } from '../admin/appdesign/designDefaults';

// A blank, transparent 1×1 SVG for rewards with no photo yet, so the coloured
// tile behind it shows through cleanly (html2canvas handles it on export).
const BLANK_IMG = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20width%3D%221%22%20height%3D%221%22/%3E';

function toReward(r, i) {
  const euros = r.euros !== '' && r.euros != null && Number.isFinite(Number(r.euros)) ? Number(r.euros) : undefined;
  return {
    id: `mk-${i}`,
    name: (r.name || '').trim() || 'Reward',
    image: r.image || BLANK_IMG,
    cupsNeeded: Math.max(1, Number(r.cupsNeeded) || 6),
    euros,
    bgColor: r.bgColor || '#FEA01E',
    tags: (r.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    description: '',
  };
}

export default function MockupPreview({ config }) {
  const org = {
    name: config.orgName || 'Your brand',
    partner_brand_name: config.partnerBrandName || config.orgName || 'Your brand',
    logo_url: config.logoUrl || null,
    logo_width: config.logoWidth ? Number(config.logoWidth) : null,
    brand_color: config.brandColor || '#FD6F46',
    slug: 'mockup', // not 'burger-king' → uses logo / coloured-initial chip
  };
  const design = {
    sections: {
      showPackbackLogo: config.sections?.showPackbackLogo !== false,
      showBrandLogo: config.sections?.showBrandLogo !== false,
    },
  };

  const built = (config.rewards || []).filter(r => (r.name || '').trim()).map(toReward);
  const rewards = built.length ? built : [toReward({ name: 'Reward', cupsNeeded: 6, bgColor: '#FEA01E' }, 0)];
  const sel = Math.min(rewards.length - 1, Math.max(0, Number(config.selectedIndex) || 0));
  const selectedReward = rewards[sel];
  const otherRewards = rewards.filter((_, i) => i !== sel);

  const cupCount = Math.max(0, Number(config.cupsCollected) || 0);
  const isUnlocked = cupCount >= selectedReward.cupsNeeded;
  const cupsRemaining = Math.max(0, selectedReward.cupsNeeded - cupCount);

  // Retarget --bk-* to the mockup palette, scoped to this element only.
  const paletteStyle = {};
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    if (config.palette?.[key]) paletteStyle[cssVar] = config.palette[key];
  }

  const noop = () => {};

  return (
    <div className="mockup-screen" style={paletteStyle} aria-label="Store home preview">
      <div className="app">
        <Header
          cupCount={cupCount}
          org={org}
          design={design}
          onBadgeClick={noop}
          onAddCup={noop}
        />

        <section className="app__hero">
          <h1 className="app__headline">{config.heroHeadline}</h1>
          <p className="app__subtext">{config.heroSubtext}</p>
        </section>

        <CupProgress collected={cupCount} target={selectedReward.cupsNeeded} nudgeCount={0} />

        <FeaturedReward
          key={selectedReward.id}
          reward={selectedReward}
          isUnlocked={isUnlocked}
          cupsRemaining={cupsRemaining}
          cupsCollected={cupCount}
          claimed={false}
          savedIban=""
        />

        {otherRewards.length > 0 && (
          <GoalSection
            rewards={otherRewards}
            cupCount={cupCount}
            onSelectReward={noop}
            onViewDetail={noop}
          />
        )}
      </div>
    </div>
  );
}
