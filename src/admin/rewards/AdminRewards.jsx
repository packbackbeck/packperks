import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import RewardEditPanel from './RewardEditPanel';
import './AdminRewards.css';

const STATUS_COLORS = {
  live:   { bg: 'rgba(74,222,128,0.12)',  text: '#16A34A' },
  hidden: { bg: 'rgba(156,163,175,0.15)', text: '#6B7280' },
  draft:  { bg: 'rgba(255,197,47,0.12)',  text: '#B8922A' },
};

function RewardListCard({ reward, isSelected, onSelect, claimCount }) {
  const sc = STATUS_COLORS[reward.status] || STATUS_COLORS.draft;
  return (
    <button
      className={`rew-card ${isSelected ? 'rew-card--active' : ''} ${reward.status === 'hidden' ? 'rew-card--hidden' : ''}`}
      onClick={onSelect}
    >
      <div className="rew-card__thumb" style={{ background: reward.bgColor || '#F5F4F0' }}>
        {reward.image && <img src={typeof reward.image === 'string' ? reward.image : ''} alt={reward.name} />}
      </div>
      <div className="rew-card__body">
        <div className="rew-card__name">{reward.name}</div>
        <div className="rew-card__meta">
          <span>€{reward.euros?.toFixed(2)}</span>
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
  const rewards = draft.rewards;

  const [selectedId, setSelectedId] = useState(rewards[0]?.id || null);
  const [claimCounts, setClaimCounts] = useState({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('order');
  const [filterStatus, setFilterStatus] = useState('all');
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
      if (rows.length === 0) { alert('No valid rows found. Make sure the CSV has a header row with at least a "name" column.'); return; }
      const newRewards = rows.map((row, idx) => ({
        id: `imported-${++nextTempId}`,
        name: row.name || 'Untitled',
        description: row.description || '',
        image: row.image || row.imageurl || '',
        cupsNeeded: parseInt(row.cupsneeded || row.cups) || 3,
        euros: parseFloat(row.euros || row.price) || 0,
        bgColor: row.bgcolor || row.color || '#FEA01E',
        tags: row.tags ? row.tags.split('|').map(t => t.trim()).filter(Boolean) : ['FREE'],
        displayLines: [row.name || 'Untitled'],
        allergyInfo: row.allergyinfo || row.allergy || '',
        nutrition: [],
        status: 'draft', featured: false, order: rewards.length + idx,
        discountEnabled: false, discountPercent: 10,
      }));
      updateDraft(prev => ({ ...prev, rewards: [...prev.rewards, ...newRewards] }));
      setSelectedId(newRewards[0].id);
      alert(`Imported ${newRewards.length} reward${newRewards.length !== 1 ? 's' : ''} as Draft.`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function downloadTemplate() {
    const csv = 'name,description,euros,cupsNeeded,bgColor,tags,image,allergyInfo\n"Chicken Sandwich","Crispy chicken fillet",5.49,3,#FEA01E,"FREE|PLANT-BASED","https://example.com/img.png","Contains: Gluten"\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rewards-template.csv';
    a.click();
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
          <button className="rew-header__import" onClick={() => fileInputRef.current?.click()} title="Import rewards from CSV">
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
              />
            </div>
            <div className="rew-list__filter-row">
              <select className="rew-list__select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All status</option>
                <option value="live">Live</option>
                <option value="draft">Draft</option>
                <option value="hidden">Hidden</option>
              </select>
              <select className="rew-list__select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="order">Default order</option>
                <option value="name">Name A–Z</option>
                <option value="price">Price ↓</option>
                <option value="popularity">Most claimed</option>
              </select>
            </div>
          </div>

          <div className="rew-list__inner">
            <div className="rew-list__label">
              CATALOG ({displayRewards.length}/{rewards.length})
              <button className="rew-list__template-btn" onClick={downloadTemplate} title="Download CSV template">↓ template</button>
            </div>
            {displayRewards.map(reward => (
              <RewardListCard
                key={reward.id}
                reward={reward}
                isSelected={reward.id === selectedId}
                onSelect={() => setSelectedId(reward.id)}
                claimCount={claimCounts[reward.id] || 0}
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
