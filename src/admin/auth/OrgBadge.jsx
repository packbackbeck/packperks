import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import './OrgBadge.css';

/* Compact pill in the top bar showing the current org's name + a tiny
 * coloured square representing its brand colour. Clicking it jumps to
 * the Organisation tab — same affordance as having a "back to org"
 * shortcut without burying it in a menu. */
export default function OrgBadge({ onNavigate }) {
  const [org, setOrg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('organizations')
      .select('id, name, brand_color')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setOrg(data); });
    return () => { cancelled = true; };
  }, []);

  if (!org) return null;

  return (
    <button
      type="button"
      className="ob"
      onClick={() => onNavigate?.('org')}
      title={`Go to ${org.name}`}
    >
      <span className="ob__chip" style={{ background: org.brand_color || '#FD6F46' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01"/>
        </svg>
      </span>
      <span className="ob__name">{org.name}</span>
    </button>
  );
}
