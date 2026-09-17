import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, PageHeader } from '../ui';
import './AdminHistory.css';
import { adminMoney } from '../lib/adminMoney';

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
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const d = Math.floor(diff / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function buildChangeSummary(version, prevSnapshot) {
  if (!prevSnapshot) return ['First publish'];
  const changes = [];
  const curr = version.snapshot;
  const prev = prevSnapshot;

  if (curr.settings && prev.settings) {
    if (curr.settings.cashbackRatePerCup !== prev.settings.cashbackRatePerCup) {
      changes.push(`Cashback rate changed to ${adminMoney(curr.settings.cashbackRatePerCup)} per cup`);
    }
    if (curr.settings.refundRatePerCup !== prev.settings.refundRatePerCup) {
      changes.push(`Refund rate changed to ${adminMoney(curr.settings.refundRatePerCup)} per cup`);
    }
    if (curr.settings.heroHeadline !== prev.settings.heroHeadline) {
      changes.push('Home page headline updated');
    }
    if (curr.settings.maintenanceMode !== prev.settings.maintenanceMode) {
      changes.push(curr.settings.maintenanceMode ? 'Maintenance mode switched on' : 'Maintenance mode switched off');
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

  return changes.length > 0 ? changes : ['Smaller changes'];
}

export default function AdminHistory({ draftState }) {
  const { versions, restoreVersion } = draftState;
  const [confirming, setConfirming] = useState(null); // version id

  const count = versions.length;

  return (
    <div className="ui-page ah-page">
      <PageHeader
        title="Version history"
        subtitle="Every time this venue’s settings and rewards were published, newest first. Restore a version to load it into your draft."
      >
        {count > 0 && <Badge tone="neutral">{count} published version{count !== 1 ? 's' : ''}</Badge>}
      </PageHeader>

      {count === 0 ? (
        <Card>
          <EmptyState icon={History} title="Nothing published yet">
            Your version history starts the first time you press Publish.
          </EmptyState>
        </Card>
      ) : (
        <Card className="ah-card">
          <CardHeader
            title="Published versions"
            icon={History}
            subtitle="What changed in each publish, compared with the one before it."
            ruled
          />
          <CardBody flush>
            <ol className="ah-timeline">
              {versions.map((version, index) => {
                const prevSnapshot = versions[index + 1]?.snapshot || null;
                const changes = buildChangeSummary(version, prevSnapshot);
                const isLatest = index === 0;
                return (
                  <li key={version.id} className={`ah-version${isLatest ? ' ah-version--live' : ''}`}>
                    <div className="ah-version__rail" aria-hidden="true">
                      <span className="ah-version__dot" />
                      {index < count - 1 && <span className="ah-version__line" />}
                    </div>

                    <div className="ah-version__main">
                      <div className="ah-version__head">
                        <div className="ah-version__title">
                          <span className="ah-version__id">{version.id}</span>
                          {isLatest && <Badge tone="success">Live</Badge>}
                        </div>
                        <div className="ah-version__when">
                          <span>{timeAgo(version.publishedAt)}</span>
                          <span className="ah-version__date">{formatDate(version.publishedAt)}</span>
                        </div>
                      </div>

                      {version.note && <p className="ah-version__note">“{version.note}”</p>}

                      <ul className="ah-version__changes">
                        {changes.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>

                      <div className="ah-version__actions">
                        <Button size="sm" icon={RotateCcw} onClick={() => setConfirming(version.id)}>
                          Restore to draft
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      )}

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={`Restore ${confirming || ''} to your draft?`}
        subtitle="Your current draft is replaced by this version."
        icon={RotateCcw}
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={RotateCcw}
              onClick={() => {
                restoreVersion(confirming);
                setConfirming(null);
              }}
            >
              Restore to draft
            </Button>
          </>
        )}
      >
        <p className="ah-modal-text">
          Nothing changes for customers yet. Check the draft, then publish it when you’re happy.
        </p>
      </Modal>
    </div>
  );
}
