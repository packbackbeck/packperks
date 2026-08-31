import { useEffect, useState } from 'react';
import './ModelChooser.css';
import logo from '../assets/images/packperks-logo.svg';
import { supabase } from '../lib/supabase';

/* Root-path ('/') venue-model chooser.
 *
 * The bare root has no venue slug, so it must NOT boot the customer app — doing
 * so used to fall back to an org (the oldest = Burger King), flashing BK rewards
 * and creating a wrong-org users row that crashed on the unique constraint.
 * Instead the root is a minimal chooser with the three live models:
 *
 *   • Bring Your Own          → the café group hub
 *   • Titaan Rewards          → the SmartBin deposit venue (t2)
 *   • Titaan Direct Refund    → the SmartBin → Tikkie venue (t3)
 *
 * A venue in maintenance mode greys its tile out and makes it inert — the
 * same published settings.maintenanceMode flag that shows the maintenance
 * page inside the app. No data is collected here, so no cookie gate. */

/* The three destinations. BYO's href resolves live (group rename-safe);
 * the Titaan slugs are the two provisioned venues. */
const TITAAN_SLUGS = ['t2', 't3'];

export default function ModelChooser() {
  const [byoHref, setByoHref] = useState('/byo');
  // slug → true while that venue is in maintenance. BYO greys out only if
  // EVERY member café is down (one closed café shouldn't kill the hub).
  const [maint, setMaint] = useState({ byo: false, titaan: false, t3: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: group } = await supabase
          .from('org_groups').select('id, slug').order('created_at').limit(1).maybeSingle();
        if (alive && group?.slug) setByoHref(`/${group.slug}`);

        const [{ data: titaanOrgs }, { data: byoMembers }] = await Promise.all([
          supabase.from('organizations').select('id, slug').in('slug', TITAAN_SLUGS).is('deleted_at', null),
          group?.id
            ? supabase.from('organizations').select('id').eq('group_id', group.id).is('deleted_at', null)
            : Promise.resolve({ data: [] }),
        ]);

        const ids = [
          ...(titaanOrgs || []).map(o => o.id),
          ...(byoMembers || []).map(o => o.id),
        ];
        if (!ids.length) return;
        const { data: cfgs } = await supabase
          .from('app_config').select('key, value')
          .in('key', ids.map(id => `published:${id}`));
        const down = new Set(
          (cfgs || [])
            .filter(c => c.value?.settings?.maintenanceMode)
            .map(c => c.key.replace('published:', '')),
        );
        if (!alive) return;
        const bySlug = Object.fromEntries((titaanOrgs || []).map(o => [o.slug, o.id]));
        setMaint({
          titaan: down.has(bySlug.t2),
          t3: down.has(bySlug.t3),
          byo: (byoMembers || []).length > 0 && byoMembers.every(m => down.has(m.id)),
        });
      } catch { /* chooser stays fully clickable on any lookup hiccup */ }
    })();
    return () => { alive = false; };
  }, []);

  const Tile = ({ href, variant, title, sub, down, children }) => (
    <a
      className={`mc__tile mc__tile--${variant}${down ? ' mc__tile--off' : ''}`}
      href={down ? undefined : href}
      aria-disabled={down || undefined}
      onClick={down ? (e) => e.preventDefault() : undefined}
    >
      <span className="mc__tile-icon" aria-hidden="true">{children}</span>
      <span className="mc__tile-title">{title}</span>
      <span className="mc__tile-sub">{down ? 'Under maintenance' : sub}</span>
    </a>
  );

  return (
    <div className="mc">
      <div className="mc__inner">
        <img className="mc__logo" src={logo} alt="PackPerks" />
        <p className="mc__prompt">Choose the model</p>

        <div className="mc__tiles">
          <Tile href={byoHref} variant="byo" title="Bring Your Own" sub="Café venues" down={maint.byo}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h14l-1.3 15.3a2.5 2.5 0 0 1-2.5 2.2H8.8a2.5 2.5 0 0 1-2.5-2.2L5 4z" />
              <path d="M4 8h16" /><path d="M10 12v4M14 12v4" />
            </svg>
          </Tile>

          <Tile href="/t2" variant="bin" title="Titaan Rewards" sub="SmartBin deposit · rewards" down={maint.titaan}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16" />
              <path d="M6 7l1 12.5a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9L20 7" />
              <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </Tile>

          <Tile href="/t3" variant="refund" title="Titaan Direct Refund" sub="SmartBin · instant Tikkie refund" down={maint.t3}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
              <path d="M16 9.6a3.6 3.6 0 1 0 0 4.8" />
              <path d="M8.4 11.2h5M8.4 12.9h5" />
            </svg>
          </Tile>
        </div>
      </div>
    </div>
  );
}
