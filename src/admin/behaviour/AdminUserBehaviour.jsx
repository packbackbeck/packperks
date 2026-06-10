import { useEffect, useState, useCallback } from 'react';
import { getUserBehaviourStats } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import QuickLinks from '../shared/QuickLinks';
import './AdminUserBehaviour.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminUserBehaviour — the behavioural funnel, separate from System Health.
 *
 * Every rate is computed from live rows; each card shows the numerator and
 * denominator it came from in two small inner cards. Metrics that need
 * event instrumentation we don't capture yet are shown as "Not tracked yet"
 * with a note, never a faked number.
 * ───────────────────────────────────────────────────────────────────── */

const GROUPS = [
  { id: 'primary',   title: 'Primary',   desc: 'The core return-and-claim funnel.' },
  { id: 'secondary', title: 'Secondary', desc: 'Supporting behaviour and claim mix.' },
  { id: 'optional',  title: 'Optional',  desc: 'Derived or instrumentation-dependent signals.' },
];

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

function BehaviourCard({ m }) {
  const hasNum = m.numLabel != null && m.numerator != null;
  const hasDen = m.denLabel != null && m.denominator != null;
  const noData = m.measurable && !m.valueText && (m.denominator == null || m.denominator === 0);

  let valueEl;
  if (!m.measurable) valueEl = <span className="ub-card__na">Not tracked yet</span>;
  else if (m.valueText) valueEl = m.valueText;
  else if (noData) valueEl = <span className="ub-card__na">No data yet</span>;
  else valueEl = fmtPct(m.value);

  return (
    <div className={`ub-card${!m.measurable ? ' ub-card--na' : ''}`}>
      <div className="ub-card__label">{m.label}</div>

      <div className="ub-card__value">{valueEl}</div>

      {m.measurable ? (
        (hasNum || hasDen) && (
          <div className="ub-card__subs">
            {hasNum && (
              <div className="ub-sub">
                <span className="ub-sub__num">{fmtNum(m.numerator)}</span>
                <span className="ub-sub__lbl">{m.numLabel}</span>
              </div>
            )}
            {hasNum && hasDen && <span className="ub-sub__op">/</span>}
            {hasDen && (
              <div className="ub-sub">
                <span className="ub-sub__num">{fmtNum(m.denominator)}</span>
                <span className="ub-sub__lbl">{m.denLabel}</span>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="ub-card__note">{m.note}</div>
      )}

      <div className="ub-card__desc">{m.desc}</div>
    </div>
  );
}

export default function AdminUserBehaviour({ onNavigate }) {
  const { activeOrg } = useOrg();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const orgName = activeOrg?.partner_brand_name || activeOrg?.name || 'this organisation';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserBehaviourStats();
      setMetrics(data);
    } catch (e) {
      console.error('getUserBehaviourStats failed', e);
      setError(e?.message || 'Failed to load behaviour metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, activeOrg?.id]);

  return (
    <div className="ub-page">
      <div className="ub-header">
        <div>
          <h1 className="ub-header__title">User Behaviour</h1>
          <p className="ub-header__sub">
            Real behavioural rates for {orgName}. Every percentage shows the exact counts
            it was calculated from. All-time, computed from live cups, scans, claims, and users.
          </p>
        </div>
        <button className="ub-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="ub-error">{error}</div>}

      {metrics && GROUPS.map(g => {
        const cards = metrics.filter(m => m.group === g.id);
        if (!cards.length) return null;
        return (
          <section key={g.id} className="ub-section">
            <div className="ub-section__head">
              <h2 className="ub-section__title">{g.title}</h2>
              <p className="ub-section__desc">{g.desc}</p>
            </div>
            <div className="ub-grid">
              {cards.map(m => <BehaviourCard key={m.id} m={m} />)}
            </div>
          </section>
        );
      })}

      <QuickLinks currentPage="behaviour" onNavigate={onNavigate} />
    </div>
  );
}
