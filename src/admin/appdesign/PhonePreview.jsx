import { BatteryFull, ChevronLeft, Gift, Pencil, Plus, Signal, User, Wifi, X } from 'lucide-react';
import packbackLogo from '../../assets/images/packback-logo.png';
import cupIcon from '../../assets/images/cup-icon.svg';
import cupIconWhite from '../../assets/images/cup-icon-white.svg';
import cashbackIcon from '../../assets/images/cashback-icon.png';
import zigzagImg from '../../assets/images/zigzag.svg';
import { GUIDE_ICONS } from '../../components/HowItWorks';
import { rewardImageStyle } from '../../utils/imageTransform';
import './PhonePreview.css';

/* ─────────────────────────────────────────────────────────────────────
 * A phone showing the customer app painted with the draft design.
 *
 * Hand-built, not an iframe: embedding the real app caused reload loops
 * (auth listeners, HMR, the shared admin session). The screens below copy
 * the real layouts (Header, CupProgress, FeaturedReward, GoalSection,
 * UserPage, HowItWorks) at the app's own 375px width, then scale down, and
 * read the same CSS variables the app retargets per organisation. Screens
 * are decorative: nothing inside them is focusable.
 *
 * `view` is computed by the page (see buildPreviewView in
 * AdminAppDesign.jsx): the effective copy, the visible sections, the
 * featured reward and the guide steps, exactly as the app would resolve
 * them for this organisation.
 * ───────────────────────────────────────────────────────────────────── */

export default function PhonePreview({ screen, view, guideIndex = 0, onGuideIndex }) {
  const c = view.colors;
  const vars = {
    '--pb-brown': c.primary,
    '--pb-orange': c.accent,
    '--pb-red': c.accentDeep,
    '--pb-cream': c.background,
    '--white': c.surface,
    '--black': c.text,
    '--text-muted': c.textMuted,
    '--pb-green': c.success,
  };
  const steps = view.guideSteps;
  const step = steps[Math.min(guideIndex, steps.length - 1)] || steps[0];
  const screenBg = screen === 'guide' && step ? step.bg : c.background;

  return (
    <div className="dzp" aria-hidden="true">
      <div className="dzp__frame">
        <div className={`dzp__screen dzp__screen--${screen}`} style={{ ...vars, background: screenBg }}>
          <div className="dzp__status">
            <span className="dzp__time">9:41</span>
            <span className="dzp__island" />
            <span className="dzp__icons">
              <Signal size={15} strokeWidth={2.6} />
              <Wifi size={15} strokeWidth={2.6} />
              <BatteryFull size={20} strokeWidth={2} />
            </span>
          </div>
          <div className="dzp__scroll">
            {screen === 'home' && <HomeScreen view={view} />}
            {screen === 'account' && <AccountScreen view={view} />}
            {screen === 'guide' && step && (
              <GuideScreen steps={steps} index={Math.min(guideIndex, steps.length - 1)} primary={c.primary} />
            )}
          </div>
          {screen === 'guide' && steps.length > 1 && onGuideIndex && (
            <>
              <span className="dzp__tap dzp__tap--prev" onClick={() => onGuideIndex(Math.max(0, guideIndex - 1))} />
              <span className="dzp__tap dzp__tap--next" onClick={() => onGuideIndex(Math.min(steps.length - 1, guideIndex + 1))} />
            </>
          )}
          <span className="dzp__homebar" />
        </div>
      </div>
    </div>
  );
}

/* ── Home ───────────────────────────────────────────────────────────── */
function HomeScreen({ view }) {
  const { org, show, reward, others, collected, money } = view;
  const need = reward.cupsNeeded;
  const unlocked = collected >= need;
  return (
    <div className="dzp-app">
      {show.storesLink && (
        <span className="dzp-stores">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            <circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
          </svg>
          MORE STORES
        </span>
      )}

      <div className="dzp-header">
        {(show.packbackLogo || show.brandLogo) && (
          <div className="dzp-header__brands">
            {show.packbackLogo && <img src={packbackLogo} alt="" className="dzp-header__pb" />}
            {show.packbackLogo && show.brandLogo && <span className="dzp-header__x">x</span>}
            {show.brandLogo && <OrgMark org={org} />}
          </div>
        )}
        <div className="dzp-header__tiles">
          <span className="dzp-tile dzp-tile--add"><Plus size={20} strokeWidth={2.4} /></span>
          <span className="dzp-tile dzp-tile--cups">
            <span className="dzp-tile__count">{collected}</span>
            <img src={cupIcon} alt="" className="dzp-tile__cup" />
          </span>
          <span className="dzp-tile"><User size={20} strokeWidth={2} /></span>
        </div>
      </div>

      <div className="dzp-hero">
        {view.headline && <h1 className="dzp-hero__headline">{view.headline.replace(/,\s*/g, ',\n')}</h1>}
        {view.showSubtext && view.subtext && <p className="dzp-hero__sub">{view.subtext}</p>}
      </div>

      <CupTrack collected={collected} target={need} />

      <section className="dzp-feat">
        <div className={`dzp-feat__top${unlocked ? ' is-complete' : ''}`}>
          <div className="dzp-feat__fill" style={{ width: `${Math.min(100, (collected / need) * 100)}%` }} />
          <div className="dzp-feat__content">
            <RewardImage reward={reward} className="dzp-feat__img" />
            <div className="dzp-feat__info">
              <h2 className="dzp-feat__name">{reward.displayLines?.length ? reward.displayLines.join('\n') : reward.name}</h2>
              <div className="dzp-feat__tags">
                {(reward.tags || []).filter(t => t && t.toUpperCase() !== 'FREE').map(t => (
                  <span key={t} className="dzp-feat__tag">{t}</span>
                ))}
                <span className="dzp-feat__tag dzp-feat__tag--cups">
                  {money(reward.value)} for <MugGlyph size={12} /> {need} cups
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="dzp-feat__bottom">
          <img src={zigzagImg} alt="" className="dzp-feat__zigzag" />
          <p className="dzp-feat__desc">
            {view.isVoucher ? (
              <>{unlocked ? 'Show' : 'Once you unlock this, show'} your voucher to the staff at <strong>{view.store}</strong> and enjoy it. </>
            ) : (
              <>
                {unlocked ? 'Buy it from ' : 'Once you unlock this, buy it from '}
                <strong>{view.store}</strong> and take a picture of the receipt to claim the reward.{' '}
                {view.isTikkie ? <>We&apos;ll send your cashback via <b className="dzp-feat__tikkie">Tikkie</b>.</> : <>We&apos;ll send your cashback to you.</>}{' '}
                <em className="dzp-feat__link">Cashback terms</em>
              </>
            )}
            {show.directRefund && (
              <><span style={{ margin: '0 4px' }}>or</span><em className="dzp-feat__link">Get the direct refund</em></>
            )}
          </p>
          <span className={`dzp-feat__claim${unlocked ? '' : ' is-locked'}`}>
            {view.isVoucher ? 'Redeem at the counter' : (
              <><img src={cashbackIcon} alt="" className="dzp-feat__claim-icon" />Get {money(reward.value)} cashback</>
            )}
          </span>
        </div>
      </section>

      {others.length > 0 && (
        <section className="dzp-goals">
          <h2 className="dzp-goals__title">Change your goal</h2>
          {others.map(r => <GoalCard key={r.id} reward={r} collected={collected} money={money} />)}
        </section>
      )}
    </div>
  );
}

function OrgMark({ org }) {
  if (org?.logo_url) {
    const style = org.logo_width ? { width: `${org.logo_width}px`, height: 'auto' } : undefined;
    return <img src={org.logo_url} alt="" className="dzp-header__org" style={style} />;
  }
  const letter = (org?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return <span className="dzp-header__chip" style={{ background: org?.brand_color || '#FD6F46' }}>{letter}</span>;
}

function RewardImage({ reward, className }) {
  const uploaded = typeof reward.image === 'string' && /^https?:\/\//.test(reward.image);
  return (
    <div className={className} style={{ background: reward.bgColor || 'var(--pb-orange)' }}>
      {reward.image ? (
        <img
          src={reward.image}
          alt=""
          className={uploaded ? 'is-uploaded' : undefined}
          style={rewardImageStyle(reward)}
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        />
      ) : (
        <Gift size={40} strokeWidth={1.6} className="dzp-img-fallback" />
      )}
    </div>
  );
}

function GoalCard({ reward, collected, money }) {
  const need = reward.cupsNeeded;
  const unlocked = collected >= need;
  const left = Math.max(0, need - collected);
  const progress = Math.min(1, collected / need);
  const tag = (reward.tags || []).filter(t => t && t.toUpperCase() !== 'FREE')[0];
  return (
    <article className="dzp-goal">
      <div className="dzp-goal__inner">
        <RewardImage reward={reward} className="dzp-goal__img" />
        <div className="dzp-goal__info">
          <h3 className="dzp-goal__name">{reward.name}</h3>
          <div className="dzp-goal__meta">
            {tag && <span className="dzp-goal__tag" style={{ background: reward.bgColor || '#E9E9E9', color: readableOn(reward.bgColor) }}>{tag}</span>}
            <span className="dzp-goal__price">{money(reward.value)} for <MugGlyph size={11} /> {need} cups</span>
          </div>
        </div>
      </div>
      <div className="dzp-goal__track">
        <div
          className={`dzp-goal__fill${unlocked ? ' is-done' : ''}`}
          style={{ width: `${unlocked ? 100 : Math.max(20, progress * 100)}%` }}
        >
          <span>{unlocked ? 'Ready!' : `${left} cup${left !== 1 ? 's' : ''} left`}</span>
          <img src={cupIconWhite} alt="" />
        </div>
        {Array.from({ length: Math.max(0, need - 1) }, (_, i) => (
          <span key={i} className="dzp-goal__divider" style={{ left: `${((i + 1) / need) * 100}%` }} />
        ))}
      </div>
    </article>
  );
}

/* RewardCard's tag rule: dark text on very light or yellowish colours. */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#2A2A2A';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return (lum > 0.72 || (r > 190 && g > 170 && b < 150)) ? '#2A2A2A' : '#FFFFFF';
}

/* ── Cup progress (CupProgress.jsx, same geometry) ──────────────────── */
function CupTrack({ collected, target }) {
  const t = Math.max(0, target || 0);
  const complete = t > 0 && collected >= t;
  const twoRow = t > 6;
  const items = Array.from({ length: t }, (_, i) => ({ key: `c${i}`, star: false, filled: i < collected }));
  if (twoRow && t % 2 === 1) items.push({ key: 'star', star: true, filled: complete });
  const half = Math.ceil(items.length / 2);
  const rows = twoRow ? [items.slice(0, half), items.slice(half)] : [items];

  const CUP = 38, PAD = 10;
  const snake = (done, cups, len) => {
    if (done <= 0 || cups <= 0) return '0%';
    if (done >= cups) return '100%';
    const gap = `(100% - ${2 * PAD}px - ${CUP * len}px) / ${len + 1}`;
    return `calc(${PAD}px + ${(done + 0.5).toFixed(1)} * ${gap} + ${CUP * done}px)`;
  };
  const r0Cups = twoRow ? rows[0].filter(x => !x.star).length : 0;
  const r1Cups = twoRow ? rows[1].filter(x => !x.star).length : 0;

  return (
    <div className={`dzp-cups${complete ? ' is-complete' : ''}${twoRow ? ' is-tworow' : ''}`}>
      {!twoRow && <div className="dzp-cups__fill" style={{ width: `${t ? Math.min(1, collected / t) * 100 : 0}%` }} />}
      {twoRow && (
        <>
          <div className="dzp-cups__seg dzp-cups__seg--top" style={{ width: snake(Math.min(collected, r0Cups), r0Cups, rows[0].length) }} />
          <div className="dzp-cups__seg dzp-cups__seg--bottom" style={{ width: snake(Math.min(r1Cups, Math.max(0, collected - r0Cups)), r1Cups, rows[1].length) }} />
        </>
      )}
      <div className="dzp-cups__rows">
        {rows.map((row, ri) => (
          <div key={ri} className="dzp-cups__row">
            {row.map(it => (it.star ? <StarGlyph key={it.key} lit={it.filled} /> : <CupGlyph key={it.key} filled={it.filled} />))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CupGlyph({ filled }) {
  return (
    <svg className={`dzp-cups__cup${filled ? '' : ' is-empty'}`} viewBox="0 0 33 32" fill="none">
      {filled ? (
        <>
          <path fill="currentColor" d="M25.53 5.43c1.33 0 2.46 1.06 2.46 2.43v2.61c0 1.37-1.13 2.43-2.46 2.43h-.55l-1.7 13.43a1.1 1.1 0 0 1-1.1.97H10.08a1.1 1.1 0 0 1-1.1-.95L7.03 12.9h-.31c-1.33 0-2.46-1.06-2.46-2.43V7.86c0-1.37 1.13-2.43 2.46-2.43h18.81Z" />
          <path className="dzp-cups__check" d="m12.1 18.9 2.9 2.9 6-6" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M25.53 6.55H6.72c-.74 0-1.34.58-1.34 1.3v2.62c0 .72.6 1.31 1.34 1.31h18.81c.74 0 1.35-.59 1.35-1.31V7.86c0-.72-.6-1.31-1.35-1.31Z" stroke="currentColor" strokeWidth="2.23" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m8.06 11.78 2.02 14.41h12.09l2.02-14.41" stroke="currentColor" strokeWidth="2.23" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function StarGlyph({ lit }) {
  return (
    <svg className={`dzp-cups__star${lit ? ' is-lit' : ''}`} viewBox="0 0 24 24">
      <path d="M12 2.6l2.85 5.77 6.37.93-4.61 4.49 1.09 6.35L12 17.02l-5.7 3.0 1.09-6.35L2.78 9.3l6.37-.93z" fill={lit ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MugGlyph({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}

/* ── Account (UserPage.jsx) ─────────────────────────────────────────── */
function AccountScreen({ view }) {
  const { show, copy, collected, money } = view;
  const actions = [
    show.share && { key: 'share', label: copy.shareButtonLabel || 'Share your Cup', cls: '', icon: <HeartGlyph /> },
    { key: 'add', label: 'Add more cups', cls: '', icon: <Plus size={18} strokeWidth={2.2} /> },
    show.nextCupFree && { key: 'free', label: copy.nextCupFreeLabel || 'Next cup for free', cls: ' dzp-acc__action--free', icon: <Gift size={20} strokeWidth={2} /> },
    show.donate && { key: 'donate', label: copy.donateButtonLabel || 'Donate', cls: ' dzp-acc__action--donate', icon: <PiggyGlyph /> },
  ].filter(Boolean);
  const solo = actions.length === 1;

  return (
    <div className="dzp-acc">
      <div className="dzp-acc__head">
        <span className="dzp-acc__back"><ChevronLeft size={18} strokeWidth={2} />Back</span>
        <span className="dzp-acc__title">My Account</span>
        <span className="dzp-acc__spacer" />
      </div>

      <div className="dzp-acc__card dzp-acc__profile">
        <span className="dzp-acc__edit"><Pencil size={11} strokeWidth={2.4} />Edit</span>
        <span className="dzp-acc__avatar" role="img">🦦</span>
        <div className="dzp-acc__who">
          <span className="dzp-acc__name">Happy Otter</span>
          <span className="dzp-acc__email">sam@example.com</span>
          <span className="dzp-acc__device">iPhone (iOS 19.0)</span>
        </div>
      </div>

      <div className="dzp-acc__box">
        <p className="dzp-acc__note">Your balance at {view.store}.</p>
        <div className="dzp-acc__values">
          <div className="dzp-acc__value">
            <span className="dzp-acc__num"><img src={cupIcon} alt="" width="22" height="22" />{collected}</span>
            <span className="dzp-acc__label">cup{collected !== 1 ? 's' : ''} collected</span>
          </div>
          <span className="dzp-acc__approx">≈</span>
          <div className="dzp-acc__value">
            <span className="dzp-acc__num dzp-acc__num--money">{money(collected * view.cashbackRate)}</span>
            <span className="dzp-acc__label">in cashback</span>
          </div>
        </div>
        <div className="dzp-acc__actions">
          {actions.map(a => (
            <span key={a.key} className={`dzp-acc__action${a.cls}${solo ? ' dzp-acc__action--solo' : ''}`}>
              {a.icon}{a.label}
            </span>
          ))}
        </div>
      </div>

      {show.impact && (
        <div className="dzp-acc__section">
          <span className="dzp-acc__section-title">Your impact</span>
          <div className="dzp-acc__card dzp-acc__list">
            <ImpactRow tone="green" label="Cups returned" value={`${collected + 9}`} />
            <ImpactRow tone="blue" label="CO₂ avoided" value={`${Math.round((collected + 9) * 72)} g`} />
          </div>
        </div>
      )}

      {show.activity && (
        <div className="dzp-acc__section">
          <span className="dzp-acc__section-title">{copy.activityLabel || 'Activity'}</span>
          <div className="dzp-acc__card dzp-acc__list">
            <ActivityRow kind="cup" title="Cup added" when="Today, 09:12" />
            <ActivityRow kind="cup" title="Cup added" when="Yesterday, 17:40" />
            <ActivityRow kind="reward" title={`${money(view.reward.value)} cashback sent`} when="12 Sep" />
          </div>
        </div>
      )}
    </div>
  );
}

function ImpactRow({ tone, label, value }) {
  return (
    <div className="dzp-acc__row">
      <span className={`dzp-acc__dot dzp-acc__dot--${tone}`} />
      <span className="dzp-acc__row-label">{label}</span>
      <span className="dzp-acc__row-value">{value}</span>
    </div>
  );
}

function ActivityRow({ kind, title, when }) {
  return (
    <div className="dzp-acc__row">
      <span className={`dzp-acc__dot dzp-acc__dot--${kind === 'cup' ? 'accent' : 'green'}`} />
      <span className="dzp-acc__row-label">{title}<small>{when}</small></span>
      <span className="dzp-acc__row-value">{kind === 'cup' ? '+1' : ''}</span>
    </div>
  );
}

function HeartGlyph() {
  return (
    <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
      <path d="M7.5 12.5L1.5 6.5C0 5 0 2.5 1.5 1.5C3 0.5 5 0.5 6.5 2L7.5 3L8.5 2C10 0.5 12 0.5 13.5 1.5C15 2.5 15 5 13.5 6.5L7.5 12.5Z" fill="var(--pb-red)" />
    </svg>
  );
}

function PiggyGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
      <path d="M4.82 7.9 8 10" /><path d="M15.18 7.9 12 10" /><path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
    </svg>
  );
}

/* ── Guide (HowItWorks.jsx) ─────────────────────────────────────────── */
function GuideScreen({ steps, index, primary }) {
  const step = steps[index];
  const Icon = GUIDE_ICONS[step.icon] || GUIDE_ICONS.cup;
  const last = index >= steps.length - 1;
  return (
    <div className="dzp-hiw">
      <div className="dzp-hiw__bars">
        {steps.map((s, i) => (
          <span key={`${s.key}-${i}`} className="dzp-hiw__bar">
            <span style={{ width: i <= index ? '100%' : '0%', background: primary }} />
          </span>
        ))}
      </div>
      <div className="dzp-hiw__head">
        <span className="dzp-hiw__brand">How it works</span>
        <span className="dzp-hiw__close"><X size={18} strokeWidth={2.4} /></span>
      </div>
      <div className="dzp-hiw__content">
        <div className="dzp-hiw__art">
          <span className="dzp-hiw__art-fallback"><Icon /></span>
          {step.image && (
            <img
              key={step.image}
              src={step.image}
              alt=""
              className="dzp-hiw__art-img"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>
        <span className="dzp-hiw__chip" style={{ color: step.accent }}><Icon /></span>
        <h2 className="dzp-hiw__title">{step.title || <span className="dzp-hiw__placeholder">Step title</span>}</h2>
        <p className="dzp-hiw__text">{step.text || <span className="dzp-hiw__placeholder">The text for this step.</span>}</p>
      </div>
      <div className="dzp-hiw__foot">
        <span className="dzp-hiw__count">{index + 1} of {steps.length}</span>
        <span className="dzp-hiw__cta">{last ? 'Got it' : 'Next'}</span>
      </div>
    </div>
  );
}
