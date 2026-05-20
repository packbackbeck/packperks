import { useOrg } from '../context/OrgContext';
import './OrgBadge.css';

/* Compact pill in the top bar / sidebar showing the currently-active
 * organisation's name + a tiny coloured square representing its brand
 * colour. Clicking it jumps to the Organisation tab. Phase 3 will
 * replace this with a proper switcher dropdown; for now it's a
 * read-only badge driven by OrgContext (so it updates when the admin
 * switches orgs via the URL ?org= param). */
export default function OrgBadge({ onNavigate }) {
  const { activeOrg } = useOrg();
  if (!activeOrg) return null;

  return (
    <button
      type="button"
      className="ob"
      onClick={() => onNavigate?.('org')}
      title={`Go to ${activeOrg.name}`}
    >
      <span className="ob__chip" style={{ background: activeOrg.brand_color || '#FD6F46' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01"/>
        </svg>
      </span>
      <span className="ob__name">{activeOrg.name}</span>
    </button>
  );
}
