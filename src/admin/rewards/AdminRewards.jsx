import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowUpDown, Check, Download, Eye, FileWarning, Gift, GripVertical, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import RewardEditPanel from './RewardEditPanel';
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from '../ui';
import './AdminRewards.css';
import { useAdminMoney } from '../lib/adminMoney';
import { effectiveRates } from '../../lib/rates';
import { useViewRole } from '../context/ViewRole';

/* P-43: full status palette, with 'hidden' aliased to paused so legacy
 * rows render coherently until edited. */
const STATUS_TONE = {
  draft:     'warning',
  scheduled: 'primary',
  live:      'success',
  paused:    'warning',
  expired:   'neutral',
  archived:  'neutral',
  hidden:    'warning',
};

function statusLabel(status) {
  const s = status || 'draft';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function RewardListCard({
  reward, isSelected, onSelect, claimCount,
  reorderMode = false, isDragging = false, isDragOver = false,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}) {
  const { money } = useAdminMoney();
  return (
    <div
      className={
        'rew-card-wrap' +
        (reorderMode ? ' rew-card-wrap--reorder' : '') +
        (isDragging ? ' rew-card-wrap--dragging' : '') +
        (isDragOver ? ' rew-card-wrap--dragover' : '')
      }
      draggable={reorderMode}
      onDragStart={reorderMode ? onDragStart : undefined}
      onDragOver={reorderMode ? onDragOver : undefined}
      onDragLeave={reorderMode ? onDragLeave : undefined}
      onDrop={reorderMode ? onDrop : undefined}
      onDragEnd={reorderMode ? onDragEnd : undefined}
    >
      {reorderMode && (
        <span className="rew-grip" aria-hidden="true" title="Drag to reorder">
          <GripVertical size={16} />
        </span>
      )}
      <button
        type="button"
        className={`rew-card${isSelected ? ' rew-card--active' : ''}${reward.status === 'hidden' ? ' rew-card--hidden' : ''}`}
        onClick={onSelect}
        aria-current={isSelected || undefined}
        tabIndex={reorderMode ? -1 : undefined}
      >
        <span className="rew-card__thumb" style={{ background: reward.bgColor || 'var(--ui-soft)' }}>
          {reward.image && <img src={typeof reward.image === 'string' ? reward.image : ''} alt={reward.name} />}
        </span>
        <span className="rew-card__body">
          <span className="rew-card__name">{reward.name}</span>
          <span className="rew-card__meta">
            <span>{money(reward.euros || 0)}</span>
            <span aria-hidden="true">·</span>
            <span>{reward.cupsNeeded} cups</span>
            {claimCount > 0 && <><span aria-hidden="true">·</span><span className="rew-card__claims">{claimCount} claims</span></>}
          </span>
        </span>
        <span className="rew-card__right">
          <Badge tone={STATUS_TONE[reward.status] || 'warning'}>{statusLabel(reward.status)}</Badge>
          {reward.featured && (
            <span className="rew-card__featured" title="Featured">
              <Star size={13} fill="currentColor" aria-label="Featured" />
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += line[i]; }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  }).filter(row => row.name);
}

let nextTempId = Date.now();

export default function AdminRewards({ draftState }) {
  const { draft, updateDraft } = draftState;
  const { access } = useViewRole();
  const readOnly = !!access && !access.canEdit('rewards');
  const rewards = draft.rewards;

  const [selectedId, setSelectedId] = useState(rewards[0]?.id || null);
  const [claimCounts, setClaimCounts] = useState({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('order');
  const [filterStatus, setFilterStatus] = useState('all');
  // Drag-to-reorder mode: a deliberate toggle so normal clicks still select a
  // reward to edit. dragId = the card being dragged, dragOverId = the card it
  // is currently hovering over (the drop target).
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const fileInputRef = useRef(null);
  // Dialogs: the reward waiting for a delete confirmation, and the result of
  // a CSV import ({ title, text, ok }).
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importNotice, setImportNotice] = useState(null);

  const selectedReward = rewards.find(r => r.id === selectedId) || null;

  useEffect(() => {
    supabase.from('claims').select('reward_id').eq('type', 'cashback')
      .then(({ data }) => {
        const counts = {};
        (data || []).forEach(c => { if (c.reward_id) counts[c.reward_id] = (counts[c.reward_id] || 0) + 1; });
        setClaimCounts(counts);
      }).catch(() => {});
  }, []);

  /* Scheduled-status auto-transitions.
   *
   * On every mount + whenever the rewards array changes, scan for
   * rewards whose release date has arrived (draft / scheduled → live)
   * or whose expiry date has passed (live → expired). Saves the next
   * snapshot through updateDraft so the change shows up in the
   * publish diff and the admin sees what happened.
   *
   * The transition is also re-checked when the admin clicks Save in
   * the editor — see the RewardEditPanel's onChange flow — so an
   * admin who tweaks dates and saves immediately sees the resulting
   * status flip. */
  useEffect(() => {
    const now = Date.now();
    const transitions = [];
    for (const r of rewards) {
      const release = r.releaseAt ? new Date(r.releaseAt).getTime() : null;
      const expires = r.expiresAt ? new Date(r.expiresAt).getTime() : null;
      // Schedule → live once release has passed (and we haven't already expired)
      if ((r.status === 'scheduled' || r.status === 'draft') && release && now >= release && (!expires || now < expires)) {
        transitions.push({ id: r.id, status: 'live', reason: 'release_passed' });
      }
      // Live → expired once expiry has passed
      if (r.status === 'live' && expires && now >= expires) {
        transitions.push({ id: r.id, status: 'expired', reason: 'expiry_passed' });
      }
    }
    if (transitions.length === 0) return;
    updateDraft(prev => ({
      ...prev,
      rewards: prev.rewards.map(r => {
        const t = transitions.find(x => x.id === r.id);
        return t ? { ...r, status: t.status } : r;
      }),
    }));
  // We intentionally only re-run when the rewards array reference
  // changes, which is on every save. That's enough: timed transitions
  // happen the next time anything in the dashboard ticks the array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewards.length, rewards.map(r => `${r.id}:${r.status}:${r.releaseAt}:${r.expiresAt}`).join('|')]);

  const displayRewards = useMemo(() => {
    let list = rewards;
    if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'price') return b.euros - a.euros;
      if (sortBy === 'popularity') return (claimCounts[b.id] || 0) - (claimCounts[a.id] || 0);
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }, [rewards, search, sortBy, filterStatus, claimCounts]);

  function handleUpdate(updatedReward) {
    updateDraft(prev => ({
      ...prev,
      rewards: prev.rewards.map(r => r.id === updatedReward.id ? updatedReward : r),
    }));
  }

  // Move a reward to another reward's slot in the catalog order (drag → drop).
  // We reorder the actual rewards array AND renormalise every reward's `order`
  // to a contiguous 0..n-1 sequence, because the two must never drift: the
  // admin list sorts by `order`, but the customer app renders rewards in array
  // order. Reordering both keeps every view consistent (and is resilient to
  // pre-existing gaps or duplicate order values). Persisted through the same
  // draft flow as every other edit — and auto-saved — so it survives reloads
  // and goes live for customers when the admin publishes.
  function moveReward(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    updateDraft(prev => {
      const ordered = [...prev.rewards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const from = ordered.findIndex(r => r.id === fromId);
      const to = ordered.findIndex(r => r.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return { ...prev, rewards: ordered.map((r, i) => ({ ...r, order: i })) };
    });
  }

  // Entering reorder mode forces the list into its true saved order with no
  // search/filter, so dragging is unambiguous. Exiting just clears the mode.
  function enterReorderMode() {
    setSearch('');
    setFilterStatus('all');
    setSortBy('order');
    setReorderMode(true);
  }
  function exitReorderMode() {
    setReorderMode(false);
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragStart(e, id) {
    setDragId(id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch { /* some browsers */ }
    }
  }
  function handleDragOver(e, overId) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (overId !== dragOverId) setDragOverId(overId);
  }
  function handleDragLeave(overId) {
    setDragOverId(prev => (prev === overId ? null : prev));
  }
  function handleDrop(e, targetId) {
    e.preventDefault();
    let sourceId = dragId;
    if (!sourceId && e.dataTransfer) {
      try { sourceId = e.dataTransfer.getData('text/plain'); } catch { sourceId = null; }
    }
    moveReward(sourceId, targetId);
    setDragId(null);
    setDragOverId(null);
  }
  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleSetFeatured(rewardId) {
    updateDraft(prev => ({
      ...prev,
      rewards: prev.rewards.map(r => ({ ...r, featured: r.id === rewardId })),
    }));
  }

  function handleAddReward() {
    const newReward = {
      id: `new-reward-${++nextTempId}`,
      name: 'New Reward', description: '', image: '',
      cupsNeeded: 3, euros: 0, bgColor: '#FEA01E',
      tags: ['FREE'], displayLines: ['New Reward'],
      allergyInfo: '', nutrition: [
        { label: 'Energy', value: '' }, { label: 'Fat', value: '' },
        { label: 'Carbs', value: '' }, { label: 'Protein', value: '' },
        { label: 'Salt', value: '' },
      ],
      status: 'draft', featured: false, order: rewards.length,
      discountEnabled: false, discountPercent: 10,
    };
    updateDraft(prev => ({ ...prev, rewards: [...prev.rewards, newReward] }));
    setSelectedId(newReward.id);
  }

  function handleArchive(rewardId) {
    setConfirmDelete(rewards.find(r => r.id === rewardId) || { id: rewardId });
  }

  function confirmArchive() {
    const rewardId = confirmDelete?.id;
    setConfirmDelete(null);
    if (!rewardId) return;
    updateDraft(prev => ({
      ...prev,
      rewards: prev.rewards.filter(r => r.id !== rewardId),
    }));
    setSelectedId(rewards.find(r => r.id !== rewardId)?.id || null);
  }

  function handleImportCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      // Drop fully-empty rows (admins downloading the template get a few
      // blank rows by default — those shouldn't import as "Untitled").
      const meaningful = rows.filter(r =>
        Object.values(r).some(v => typeof v === 'string' && v.trim() !== '')
      );
      if (meaningful.length === 0) {
        setImportNotice({
          ok: false,
          title: 'No rewards to import',
          text: 'No filled-in rows found. Open the template, fill in at least the “name” column for each reward, save, and upload it again.',
        });
        return;
      }

      const ALLOWED_STATUSES = new Set(['draft', 'live', 'scheduled', 'paused', 'expired', 'archived']);
      const truthy = (v) => {
        if (v === true) return true;
        if (typeof v !== 'string') return false;
        return ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase());
      };
      const parseDateTime = (v) => {
        if (!v || !String(v).trim()) return null;
        const d = new Date(String(v).trim());
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      };
      // Build a nutrition array only from non-empty cells, in the same
      // order the editor uses by default.
      const buildNutrition = (row) => {
        const labels = [
          ['Energy',  row.nutritionenergy],
          ['Fat',     row.nutritionfat],
          ['Carbs',   row.nutritioncarbs],
          ['Protein', row.nutritionprotein],
          ['Salt',    row.nutritionsalt],
        ];
        return labels
          .filter(([, val]) => val && String(val).trim() !== '')
          .map(([label, value]) => ({ label, value: String(value).trim() }));
      };

      let featuredTaken = rewards.some(r => r.featured);
      const newRewards = meaningful.map((row, idx) => {
        const rawStatus = (row.status || '').trim().toLowerCase();
        const wantsFeatured = truthy(row.featured);
        const featured = wantsFeatured && !featuredTaken;
        if (featured) featuredTaken = true;
        return {
          id: `imported-${++nextTempId}`,
          name: row.name || 'Untitled',
          description: row.description || '',
          image: row.image || row.imageurl || '',
          cupsNeeded: parseInt(row.cupsneeded || row.cups) || 3,
          euros: parseFloat(row.euros || row.price) || 0,
          subsidy: parseFloat(row.subsidy) || 0,
          bgColor: row.bgcolor || row.color || '#FEA01E',
          tags: row.tags ? row.tags.split('|').map(t => t.trim()).filter(Boolean) : ['FREE'],
          displayLines: [row.name || 'Untitled'],
          allergyInfo: row.allergyinfo || row.allergy || '',
          nutrition: buildNutrition(row),
          status: ALLOWED_STATUSES.has(rawStatus) ? rawStatus : 'draft',
          releaseAt: parseDateTime(row.releaseat),
          expiresAt: parseDateTime(row.expiresat),
          featured,
          order: rewards.length + idx,
          discountEnabled: truthy(row.discountenabled),
          discountPercent: parseInt(row.discountpercent) || 10,
        };
      });
      updateDraft(prev => ({ ...prev, rewards: [...prev.rewards, ...newRewards] }));
      setSelectedId(newRewards[0].id);
      setImportNotice({
        ok: true,
        title: `Imported ${newRewards.length} reward${newRewards.length !== 1 ? 's' : ''}`,
        text: 'They were added to your draft. Review them, then Publish when they’re ready.',
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function downloadTemplate() {
    // Complete template: every column maps 1:1 to an editable field in
    // the reward edit panel. Rows are intentionally empty — admins fill
    // them in. The header is the contract — the importer keys off these
    // exact names (case-insensitive, lowercased).
    //
    // Field notes for the admin opening this in Excel/Sheets:
    //   • tags             — pipe-separated, e.g. "FREE|NEW". Allowed:
    //                        FREE, PLANT-BASED, NEW, LIMITED, POPULAR.
    //   • status           — draft | scheduled | live | paused | expired | archived
    //   • releaseAt        — ISO date-time, e.g. 2026-06-01T09:00:00Z
    //   • expiresAt        — ISO date-time, e.g. 2026-07-01T23:59:59Z
    //   • featured         — true | false (only one reward can be featured;
    //                        the import drops featured=true on later rows)
    //   • discountEnabled  — true | false
    //   • discountPercent  — integer 1–99
    //   • bgColor          — hex like #FEA01E. Quote it so Excel doesn't
    //                        eat the #.
    //   • nutrition*       — leave blank to skip nutrition entirely.
    //   • subsidy          — optional euros the partner tops up on top
    //                        of what cups fund (e.g. premium rewards).
    const headers = [
      'name', 'description', 'euros', 'cupsNeeded', 'subsidy',
      'bgColor', 'image', 'tags',
      'status', 'releaseAt', 'expiresAt',
      'featured', 'discountEnabled', 'discountPercent',
      'nutritionEnergy', 'nutritionFat', 'nutritionCarbs', 'nutritionProtein', 'nutritionSalt',
      'allergyInfo',
    ];
    // Three empty rows so admins can paste/type immediately without
    // having to add rows in Excel first.
    const emptyRow = headers.map(() => '').join(',');
    const csv = [headers.join(','), emptyRow, emptyRow, emptyRow].join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rewards-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  const liveCount  = rewards.filter(r => r.status === 'live').length;
  const draftCount = rewards.filter(r => r.status === 'draft').length;
  const filtering = filterStatus !== 'all' || !!search.trim();

  return (
    <div className="ui-page rew-page">
      <PageHeader
        title="Rewards & offers"
        subtitle="What customers can unlock with their cups. Edits save to your draft as you type; Publish puts them live."
      >
        {readOnly ? (
          <Badge tone="neutral" icon={Eye} title="Your role can’t change rewards">View only</Badge>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleImportCSV}
            />
            <Button
              icon={Download}
              onClick={downloadTemplate}
              title="Download a CSV template. Fill it in, then upload it with Import CSV."
            >
              Download template
            </Button>
            <Button
              icon={Upload}
              onClick={() => fileInputRef.current?.click()}
              title="Upload a filled-in CSV to import rewards as drafts"
            >
              Import CSV
            </Button>
            <Button variant="primary" icon={Plus} onClick={handleAddReward}>
              Add reward
            </Button>
          </>
        )}
      </PageHeader>

      <div className="rew-layout">
        {/* Left: reward list */}
        <Card className="rew-list" aria-label="Rewards">
          <div className="rew-list__head">
            <div className="rew-list__title-row">
              <h2 className="ui-card__title">Catalog</h2>
              <span className="rew-list__counts">
                <Badge tone="success">{liveCount} live</Badge>
                <Badge tone="warning">{draftCount} draft</Badge>
              </span>
            </div>

            <label className={`rew-search${reorderMode ? ' rew-search--off' : ''}`}>
              <Search size={14} aria-hidden="true" />
              <input
                className="rew-search__input"
                placeholder="Search rewards"
                aria-label="Search rewards"
                value={search}
                onChange={e => setSearch(e.target.value)}
                disabled={reorderMode}
              />
              {search && !reorderMode && (
                <button type="button" className="rew-search__clear" aria-label="Clear search" onClick={() => setSearch('')}>
                  <X size={12} />
                </button>
              )}
            </label>

            <div className="rew-list__filters">
              <select
                className="ui-select rew-list__select"
                aria-label="Filter by status"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                disabled={reorderMode}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
                <option value="paused">Paused</option>
                <option value="expired">Expired</option>
                <option value="archived">Archived</option>
              </select>
              <select
                className="ui-select rew-list__select"
                aria-label="Sort rewards"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                disabled={reorderMode}
              >
                <option value="order">Customer order</option>
                <option value="name">Name A–Z</option>
                <option value="price">Price, high to low</option>
                <option value="popularity">Most claimed</option>
              </select>
            </div>

            {rewards.length > 1 && !readOnly && (
              <Button
                variant={reorderMode ? 'primary' : 'outline'}
                size="sm"
                block
                icon={reorderMode ? Check : ArrowUpDown}
                onClick={reorderMode ? exitReorderMode : enterReorderMode}
              >
                {reorderMode ? 'Done reordering' : 'Rearrange order'}
              </Button>
            )}

            {reorderMode ? (
              <p className="rew-list__hint rew-list__hint--active">
                Drag the rewards into the order customers should see. Changes save to your draft; Publish puts them live.
              </p>
            ) : rewards.length > 1 && !readOnly ? (
              <p className="rew-list__hint">
                Use Rearrange order to drag rewards into the order customers see.
              </p>
            ) : null}
          </div>

          <div className="rew-list__meta">
            {filtering
              ? `Showing ${displayRewards.length} of ${rewards.length}`
              : `${rewards.length} reward${rewards.length === 1 ? '' : 's'}`}
          </div>

          <div className="rew-list__scroll">
            {displayRewards.map(reward => (
              <RewardListCard
                key={reward.id}
                reward={reward}
                isSelected={reward.id === selectedId}
                onSelect={() => setSelectedId(reward.id)}
                claimCount={claimCounts[reward.id] || 0}
                reorderMode={reorderMode}
                isDragging={dragId === reward.id}
                isDragOver={dragOverId === reward.id && dragId !== reward.id}
                onDragStart={(e) => handleDragStart(e, reward.id)}
                onDragOver={(e) => handleDragOver(e, reward.id)}
                onDragLeave={() => handleDragLeave(reward.id)}
                onDrop={(e) => handleDrop(e, reward.id)}
                onDragEnd={handleDragEnd}
              />
            ))}
            {displayRewards.length === 0 && (
              <EmptyState icon={rewards.length === 0 ? Gift : Search} title={rewards.length === 0 ? 'No rewards yet' : 'No matches'}>
                {rewards.length === 0
                  ? (readOnly ? 'This organisation has no rewards.' : 'Add one with Add reward, or import a CSV.')
                  : 'No rewards match this search or status.'}
              </EmptyState>
            )}
          </div>
        </Card>

        {/* Right: edit panel */}
        <Card className="rew-editor" aria-label="Reward editor">
          {selectedReward ? (
            <RewardEditPanel
              reward={selectedReward}
              onChange={handleUpdate}
              onSetFeatured={() => handleSetFeatured(selectedReward.id)}
              onArchive={() => handleArchive(selectedReward.id)}
              cashbackRate={effectiveRates(draftState?.draft?.settings || {}).cashback}
              readOnly={readOnly}
            />
          ) : (
            <div className="rew-editor__empty">
              <EmptyState icon={Gift} title={readOnly ? 'Select a reward to see its details' : 'Select a reward to edit'}>
                {rewards.length === 0 && !readOnly ? 'Or add your first one with Add reward.' : null}
              </EmptyState>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ? `“${confirmDelete.name}”` : 'this reward'}?`}
        subtitle="It leaves your draft now and disappears for customers when you publish."
        icon={Trash2}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={confirmArchive}>Delete reward</Button>
          </>
        )}
      >
        <p className="rew-modal-text">
          If you only want it off the menu for a while, set its status to Paused instead.
        </p>
      </Modal>

      <Modal
        open={!!importNotice}
        onClose={() => setImportNotice(null)}
        title={importNotice?.title || ''}
        icon={importNotice?.ok ? Check : FileWarning}
        iconTone={importNotice?.ok ? 'emerald' : 'amber'}
        footer={<Button variant="primary" onClick={() => setImportNotice(null)}>OK</Button>}
      >
        <p className="rew-modal-text">{importNotice?.text}</p>
      </Modal>
    </div>
  );
}
