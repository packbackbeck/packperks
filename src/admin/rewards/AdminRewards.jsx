import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import RewardEditPanel from './RewardEditPanel';
import './AdminRewards.css';
import { useAdminMoney } from '../lib/adminMoney';

/* P-43: full status palette, with 'hidden' aliased to the paused
 * orange so legacy rows render coherently until edited. */
const STATUS_COLORS = {
  draft:     { bg: 'rgba(255,197,47,0.12)', text: '#B8922A' },
  scheduled: { bg: 'rgba(83, 51, 165, 0.12)', text: '#5333A5' },
  live:      { bg: 'rgba(74,222,128,0.12)',  text: '#16A34A' },
  paused:    { bg: 'rgba(253,111,70,0.12)',  text: '#C84A26' },
  expired:   { bg: '#F0EDE8',                text: '#6C6259' },
  archived:  { bg: 'rgba(156,163,175,0.15)', text: '#6B7280' },
  hidden:    { bg: 'rgba(253,111,70,0.12)',  text: '#C84A26' },
};

function RewardListCard({
  reward, isSelected, onSelect, claimCount,
  reorderMode = false, isDragging = false, isDragOver = false,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}) {
  const { money } = useAdminMoney();
  const sc = STATUS_COLORS[reward.status] || STATUS_COLORS.draft;
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
        <div className="rew-grip" aria-hidden="true" title="Drag to reorder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>
            <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
            <circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
          </svg>
        </div>
      )}
      <button
        className={`rew-card ${isSelected ? 'rew-card--active' : ''} ${reward.status === 'hidden' ? 'rew-card--hidden' : ''}`}
        onClick={onSelect}
        tabIndex={reorderMode ? -1 : undefined}
      >
        <div className="rew-card__thumb" style={{ background: reward.bgColor || '#F8F4EC' }}>
          {reward.image && <img src={typeof reward.image === 'string' ? reward.image : ''} alt={reward.name} />}
        </div>
        <div className="rew-card__body">
          <div className="rew-card__name">{reward.name}</div>
          <div className="rew-card__meta">
            <span>{money(reward.euros || 0)}</span>
            <span>·</span>
            <span>{reward.cupsNeeded} cups</span>
            {claimCount > 0 && <><span>·</span><span className="rew-card__claims">{claimCount} claims</span></>}
          </div>
        </div>
        <div className="rew-card__right">
          <span className="rew-card__status" style={{ background: sc.bg, color: sc.text }}>
            {reward.status}
          </span>
          {reward.featured && <span className="rew-card__featured" title="Featured">★</span>}
        </div>
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

export default function AdminRewards({ draftState, onNavigate }) {
  const { draft, updateDraft } = draftState;
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
    if (!window.confirm('Archive this reward? It will be hidden from users.')) return;
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
        alert('No filled-in rows found. Open the template, fill in at least the "name" column for each reward, save, and upload again.');
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
      alert(`Imported ${newRewards.length} reward${newRewards.length !== 1 ? 's' : ''}. Review and Publish when ready.`);
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

  return (
    <div className="admin-rewards">
      <div className="rew-header">
        <div>
          <h1 className="rew-header__title">Rewards & Offers</h1>
          <p className="rew-header__sub">
            <span className="rew-header__chip rew-header__chip--live">{liveCount} Live</span>
            <span className="rew-header__chip rew-header__chip--draft">{draftCount} Draft</span>
          </p>
        </div>
        <div className="rew-header__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleImportCSV}
          />
          <button className="rew-header__import" onClick={downloadTemplate} title="Download a CSV template — fill it in, then upload via Import CSV">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download template
          </button>
          <button className="rew-header__import" onClick={() => fileInputRef.current?.click()} title="Upload a filled-in CSV to import rewards as drafts">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Import CSV
          </button>
          <button className="rew-header__add" onClick={handleAddReward}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Reward
          </button>
        </div>
      </div>

      <div className="rew-layout">
        {/* Left: reward list */}
        <div className="rew-list">
          {/* List controls */}
          <div className="rew-list__controls">
            <div className="rew-list__search-wrap">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="rew-list__search"
                placeholder="Search rewards…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                disabled={reorderMode}
              />
            </div>
            <div className="rew-list__filter-row">
              <select className="rew-list__select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} disabled={reorderMode}>
                <option value="all">All status</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
                <option value="paused">Paused</option>
                <option value="expired">Expired</option>
                <option value="archived">Archived</option>
              </select>
              <select className="rew-list__select" value={sortBy} onChange={e => setSortBy(e.target.value)} disabled={reorderMode}>
                <option value="order">Default order</option>
                <option value="name">Name A–Z</option>
                <option value="price">Price ↓</option>
                <option value="popularity">Most claimed</option>
              </select>
            </div>
            {rewards.length > 1 && (
              <button
                type="button"
                className={'rew-reorder-toggle' + (reorderMode ? ' rew-reorder-toggle--active' : '')}
                onClick={reorderMode ? exitReorderMode : enterReorderMode}
              >
                {reorderMode ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Done reordering
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                    Rearrange order
                  </>
                )}
              </button>
            )}
          </div>

          <div className="rew-list__inner">
            <div className="rew-list__label">
              CATALOG ({displayRewards.length}/{rewards.length})
            </div>
            {reorderMode ? (
              <div className="rew-list__reorder-hint rew-list__reorder-hint--active">
                Drag the products into the order you want. Changes auto-save; Publish to push them live.
              </div>
            ) : rewards.length > 1 ? (
              <div className="rew-list__reorder-hint">
                Tip: press “Rearrange order” to drag products into the order customers see.
              </div>
            ) : null}
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
              <div className="rew-list__empty">
                {rewards.length === 0 ? 'No rewards yet. Add one above.' : 'No rewards match filters.'}
              </div>
            )}
          </div>
        </div>

        {/* Right: edit panel */}
        <div className="rew-editor">
          {selectedReward ? (
            <RewardEditPanel
              reward={selectedReward}
              onChange={handleUpdate}
              onSetFeatured={() => handleSetFeatured(selectedReward.id)}
              onArchive={() => handleArchive(selectedReward.id)}
              cashbackRate={draftState?.draft?.settings?.cashbackRatePerCup || 1.25}
            />
          ) : (
            <div className="rew-editor__empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
                <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/>
                <line x1="12" y1="22" x2="12" y2="7"/>
                <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/>
                <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
              </svg>
              <p>Select a reward to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
