import { useEffect, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * The brand's live rewards, read from its PackPerks organisation.
 *
 * Two plain reads with the public key (the same rows the customer app
 * reads at /<slug>/): the organisation by slug, then its published
 * config. No supabase client on purpose — no device id, no session, no
 * writes of any kind. Anything that fails leaves the bundled copy in
 * place, so the demo never depends on the network to work.
 * ───────────────────────────────────────────────────────────────────── */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function get(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useOrgRewards(brand) {
  const [rewards, setRewards] = useState(brand.rewards);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // The page remounts this per brand (BrandDemo is keyed by it), so the
    // bundled list from useState is always the right starting point.
    let cancelled = false;
    if (!URL || !KEY) return undefined;
    (async () => {
      try {
        const orgs = await get(`organizations?slug=eq.${encodeURIComponent(brand.orgSlug)}&deleted_at=is.null&select=id`);
        const id = orgs?.[0]?.id;
        if (!id) return;
        const rows = await get(`app_config?key=eq.${encodeURIComponent(`published:${id}`)}&select=value`);
        const list = rows?.[0]?.value?.rewards;
        if (!Array.isArray(list)) return;
        const bundled = Object.fromEntries(brand.rewards.map(r => [r.id, r]));
        const mapped = list
          .filter(r => (r.status || 'live') === 'live' && Number(r.cupsNeeded) > 0)
          .map((r, i) => ({
            id: r.id,
            order: Number.isFinite(r.order) ? r.order : i,
            name: r.name,
            cupsNeeded: Number(r.cupsNeeded),
            euros: Number(r.euros) || 0,
            image: r.image || bundled[r.id]?.image || '',
            imageScale: Number(r.imageScale) || 1,
            featured: !!r.featured,
            ppc: brand.pointsPerCup,
            // The dashboard holds one description; the bundled copy has both
            // languages, so keep it where the reward is the same one.
            desc: bundled[r.id]?.desc || { en: r.description || '', nl: r.description || '' },
          }))
          .sort((a, b) => a.order - b.order);
        if (!cancelled && mapped.length) { setRewards(mapped); setLive(true); }
      } catch { /* keep the bundled copy */ }
    })();
    return () => { cancelled = true; };
  }, [brand]);

  return { rewards, live };
}
