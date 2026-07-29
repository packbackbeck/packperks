import { useEffect, useState } from 'react';
import './ModelChooser.css';
import logo from '../assets/images/packperks-logo.svg';
import { supabase } from '../lib/supabase';

/* Root-path ('/') venue-model chooser.
 *
 * The bare root has no venue slug, so it must NOT boot the customer app — doing
 * so used to fall back to an org (the oldest = Burger King), flashing BK rewards
 * and creating a wrong-org users row that crashed on the unique constraint.
 * Instead the root is a minimal chooser: pick the BYO café group or the SmartBin
 * deposit venue. Each tile is a full navigation to a real slug, which then boots
 * the app for that venue with a proper org resolved. No data is collected here,
 * so there is no cookie gate. */
export default function ModelChooser() {
  // The BYO café tile points at the café GROUP slug. Resolve it live from the
  // DB so it follows any future rename (was hard-coded to the old '/byonl').
  // Falls back to '/byo' until the lookup resolves.
  const [byoHref, setByoHref] = useState('/byo');
  useEffect(() => {
    let alive = true;
    supabase.from('org_groups').select('slug').order('created_at').limit(1).maybeSingle()
      .then(({ data }) => { if (alive && data?.slug) setByoHref(`/${data.slug}`); })
      .catch(() => { /* keep the fallback */ });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mc">
      <div className="mc__inner">
        <img className="mc__logo" src={logo} alt="PackPerks" />
        <p className="mc__prompt">Choose the model</p>

        <div className="mc__tiles">
          <a className="mc__tile mc__tile--byo" href={byoHref}>
            <span className="mc__tile-icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h14l-1.3 15.3a2.5 2.5 0 0 1-2.5 2.2H8.8a2.5 2.5 0 0 1-2.5-2.2L5 4z" />
                <path d="M4 8h16" /><path d="M10 12v4M14 12v4" />
              </svg>
            </span>
            <span className="mc__tile-title">Bring your own cup</span>
            <span className="mc__tile-sub">Café venues</span>
          </a>

          <a className="mc__tile mc__tile--bin" href="/titaan">
            <span className="mc__tile-icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16" />
                <path d="M6 7l1 12.5a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9L20 7" />
                <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </span>
            <span className="mc__tile-title">SmartBin deposit</span>
            <span className="mc__tile-sub">at Titaan</span>
          </a>
        </div>
      </div>
    </div>
  );
}
