import QuickLinks from '../shared/QuickLinks';
import './AdminHistory.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function buildChangeSummary(version, prevSnapshot) {
  if (!prevSnapshot) return ['Initial publish'];
  const changes = [];
  const curr = version.snapshot;
  const prev = prevSnapshot;

  if (curr.settings && prev.settings) {
    if (curr.settings.cashbackRatePerCup !== prev.settings.cashbackRatePerCup) {
      changes.push(`Cashback rate changed to €${curr.settings.cashbackRatePerCup}/cup`);
    }
    if (curr.settings.refundRatePerCup !== prev.settings.refundRatePerCup) {
      changes.push(`Refund rate changed to €${curr.settings.refundRatePerCup}/cup`);
    }
    if (curr.settings.heroHeadline !== prev.settings.heroHeadline) {
      changes.push('Hero headline updated');
    }
    if (curr.settings.maintenanceMode !== prev.settings.maintenanceMode) {
      changes.push(curr.settings.maintenanceMode ? 'Maintenance mode enabled' : 'Maintenance mode disabled');
    }
  }

  if (curr.rewards && prev.rewards) {
    const currIds = new Set(curr.rewards.map(r => r.id));
    const prevIds = new Set(prev.rewards.map(r => r.id));
    const added = curr.rewards.filter(r => !prevIds.has(r.id));
    const removed = prev.rewards.filter(r => !currIds.has(r.id));
    if (added.length > 0) changes.push(`Added reward: ${added.map(r => r.name).join(', ')}`);
    if (removed.length > 0) changes.push(`Removed reward: ${removed.map(r => r.name).join(', ')}`);

    curr.rewards.forEach(r => {
      const old = prev.rewards.find(p => p.id === r.id);
      if (old && old.status !== r.status) changes.push(`${r.name}: status changed to ${r.status}`);
    });
  }

  return changes.length > 0 ? changes : ['Minor updates'];
}

export default function AdminHistory({ draftState, onNavigate }) {
  const { versions, restoreVersion, published } = draftState;

  if (versions.length === 0) {
    return (
      <div className="admin-history">
        <div className="ah-header">
          <h1 className="ah-header__title">History</h1>
          <p className="ah-header__sub">No versions published yet. Hit Publish to create the first version.</p>
        </div>
        <div className="ah-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
            <polyline points="12 8 12 12 14 14"/>
            <path d="M3.05 11a9 9 0 1.5-4.5"/>
            <polyline points="3 3 3 9 9 9"/>
          </svg>
          <p>Your version history will appear here after your first Publish.</p>
        </div>

        <QuickLinks currentPage="history" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="admin-history">
      <div className="ah-header">
        <div>
          <h1 className="ah-header__title">Version History</h1>
          <p className="ah-header__sub">{versions.length} published version{versions.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="ah-timeline">
        {versions.map((version, index) => {
          const prevSnapshot = versions[index + 1]?.snapshot || null;
          const changes = buildChangeSummary(version, prevSnapshot);
          const isLatest = index === 0;

          return (
            <div key={version.id} className={`ah-version ${isLatest ? 'ah-version--latest' : ''}`}>
              <div className="ah-version__line-wrap">
                <div className={`ah-version__dot ${isLatest ? 'ah-version__dot--latest' : ''}`} />
                {index < versions.length - 1 && <div className="ah-version__line" />}
              </div>

              <div className="ah-version__card">
                <div className="ah-version__card-header">
                  <div className="ah-version__meta">
                    <span className="ah-version__number">{version.id}</span>
                    {isLatest && <span className="ah-version__live-badge">Live</span>}
                    <span className="ah-version__time">{timeAgo(version.publishedAt)}</span>
                  </div>
                  <div className="ah-version__date">{formatDate(version.publishedAt)}</div>
                </div>

                {version.note && (
                  <div className="ah-version__note">"{version.note}"</div>
                )}

                <ul className="ah-version__changes">
                  {changes.map((c, i) => (
                    <li key={i} className="ah-version__change-item">
                      <span className="ah-version__change-dot" />
                      {c}
                    </li>
                  ))}
                </ul>

                <div className="ah-version__actions">
                  <button
                    className="ah-version__restore-btn"
                    onClick={() => {
                      if (window.confirm(`Restore ${version.id} to draft? You can review and re-publish.`)) {
                        restoreVersion(version.id);
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                    </svg>
                    Restore to draft
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <QuickLinks currentPage="history" onNavigate={onNavigate} />
    </div>
  );
}
