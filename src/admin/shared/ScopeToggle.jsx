import { useOrg } from '../context/OrgContext';
import './ScopeToggle.css';

/* ─────────────────────────────────────────────────────────────────────
 * ScopeToggle — Phase 3 analytics scope switch.
 *
 * Shown on the group-aware analytics pages (Overview, System Health,
 * User Behaviour) ONLY when the active org belongs to a group. Lets an
 * admin flip the numbers between:
 *   • "This store"  — the selected org only (default)
 *   • "<Group name>" — every store in the group combined
 *
 * Scope state lives in OrgContext (statsScope + setStatsScope) so all
 * three pages share one choice, and it resets to "This store" whenever
 * the active org changes.
 * ───────────────────────────────────────────────────────────────────── */
export default function ScopeToggle() {
  const { activeGroup, groupMembers, statsScope, setStatsScope } = useOrg();
  if (!activeGroup) return null;
  const count = groupMembers.length;
  return (
    <div className="scope-toggle" role="radiogroup" aria-label="Statistics scope">
      <button
        type="button"
        role="radio"
        aria-checked={statsScope === 'org'}
        className={`scope-toggle__opt ${statsScope === 'org' ? 'is-on' : ''}`}
        onClick={() => setStatsScope('org')}
      >
        This store
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={statsScope === 'group'}
        className={`scope-toggle__opt ${statsScope === 'group' ? 'is-on' : ''}`}
        onClick={() => setStatsScope('group')}
        title={`Combine all ${count} stores in ${activeGroup.name}`}
      >
        {activeGroup.name}
        <span className="scope-toggle__count">{count}</span>
      </button>
    </div>
  );
}
