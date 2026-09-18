import { useCallback, useEffect, useState } from 'react';
import './ModelChooser.css';
import logo from '../assets/images/packperks-logo.svg';
import { supabase } from '../lib/supabase';
import { ORG_MODE_META, resolveEffectiveMode } from '../admin/lib/orgModes';

/* Root-path ('/') venue directory.
 *
 * The bare root has no venue slug, so it must NOT boot the customer app — doing
 * so used to fall back to an org (the oldest = Burger King), flashing BK rewards
 * and creating a wrong-org users row that crashed on the unique constraint.
 * Instead the root lists every live venue as a tile — logo, name and the
 * mode it runs — in alphabetical order, each linking to /<slug>.
 *
 * A venue's mode is resolved the way the dashboard does it (orgModes.js): the
 * org's own published settings.mode (Deferred Tikkie), else its group's
 * (Bring Your Own / Deposit Rewards), else Deposit Rewards. Mode names are
 * those three and only those.
 *
 * Venues in maintenance mode (published settings.maintenanceMode) are left
 * out, as are deleted ones. No data is collected here, so no cookie gate. */

const MODE_ICON = {
  byo: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h14l-1.3 15.3a2.5 2.5 0 0 1-2.5 2.2H8.8a2.5 2.5 0 0 1-2.5-2.2L5 4z" /><path d="M4 8h16" />
    </svg>
  ),
  standard: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" /><path d="M6 7l1 12.5a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9L20 7" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  tikkie_only: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" />
    </svg>
  ),
};

async function loadVenues() {
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, brand_color, group_id')
    .is('deleted_at', null);
  if (error) throw error;
  const list = (orgs || []).filter(o => o.slug);
  if (!list.length) return [];

  const groupIds = [...new Set(list.map(o => o.group_id).filter(Boolean))];
  const keys = [
    ...list.map(o => `published:${o.id}`),
    ...groupIds.map(id => `published:group:${id}`),
  ];
  const { data: cfgs, error: cfgErr } = await supabase
    .from('app_config').select('key, value').in('key', keys);
  if (cfgErr) throw cfgErr;
  const settingsOf = Object.fromEntries((cfgs || []).map(c => [c.key, c.value?.settings || {}]));

  return list
    .filter(o => !settingsOf[`published:${o.id}`]?.maintenanceMode)
    .map(o => {
      // A group with no mode set is Bring Your Own; 'deposit' is Deposit Rewards.
      const groupMode = o.group_id
        ? (settingsOf[`published:group:${o.group_id}`]?.mode === 'deposit' ? 'deposit' : 'byo')
        : null;
      const mode = resolveEffectiveMode(settingsOf[`published:${o.id}`]?.mode, groupMode);
      return { ...o, mode };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('');
}

function VenueLogo({ venue }) {
  const [broken, setBroken] = useState(false);
  if (venue.logo_url && !broken) {
    return <img className="mc__logo-img" src={venue.logo_url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className="mc__monogram" style={{ '--brand': venue.brand_color || 'var(--pb-orange-warm, #FD6F46)' }}>
      {initials(venue.name)}
    </span>
  );
}

export default function ModelChooser() {
  const [venues, setVenues] = useState(null);   // null while loading
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    loadVenues()
      .then(v => { if (alive) setVenues(v); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setVenues(null);
    setAttempt(a => a + 1);
  }, []);

  return (
    <div className="mc">
      <header className="mc__head">
        <img className="mc__logo" src={logo} alt="PackPerks" />
        <p className="mc__prompt">Choose your venue</p>
      </header>

      {failed ? (
        <div className="mc__state">
          <p>We couldn’t load the venues just now.</p>
          <button type="button" className="mc__retry" onClick={retry}>Try again</button>
        </div>
      ) : venues && venues.length === 0 ? (
        <div className="mc__state"><p>No venues are open right now.</p></div>
      ) : (
        <ul className="mc__grid" aria-busy={!venues || undefined}>
          {(venues || Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, skeleton: true }))).map((v, i) => (
            <li key={v.id} className="mc__cell" style={{ '--i': i }}>
              {v.skeleton ? (
                <div className="mc__tile mc__tile--skeleton" aria-hidden="true">
                  <span className="mc__logo-box" />
                  <span className="mc__bar mc__bar--name" />
                  <span className="mc__bar mc__bar--chip" />
                </div>
              ) : (
                <a className="mc__tile" href={`/${v.slug}`}>
                  <span className="mc__logo-box"><VenueLogo venue={v} /></span>
                  <span className="mc__name">{v.name}</span>
                  <span className={`mc__mode mc__mode--${v.mode}`}>
                    {MODE_ICON[v.mode]}
                    {ORG_MODE_META[v.mode]?.label}
                  </span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
