import { useState, useMemo } from 'react';
import './GoalSection.css';
import RewardCard from './RewardCard';
import { useRegion } from '../lib/RegionContext';

export default function GoalSection({ rewards, cupCount, onSelectReward, onViewDetail }) {
  const { symbol } = useRegion();
  // Cheapest first by default (fewest cups = lowest price). Tap cycles
  // asc → desc → unsorted → asc.
  const [sortOrder, setSortOrder] = useState('asc'); // null | 'asc' | 'desc'
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSortClick = () => {
    if (sortOrder === null) setSortOrder('asc');
    else if (sortOrder === 'asc') setSortOrder('desc');
    else setSortOrder(null);
  };

  const processedRewards = useMemo(() => {
    let result = [...rewards];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => 
        r.name.toLowerCase().includes(q) || 
        r.description.toLowerCase().includes(q)
      );
    }

    if (sortOrder === 'asc') {
      result.sort((a, b) => a.cupsNeeded - b.cupsNeeded);
    } else if (sortOrder === 'desc') {
      result.sort((a, b) => b.cupsNeeded - a.cupsNeeded);
    }

    return result;
  }, [rewards, sortOrder, searchQuery]);

  return (
    <section className="goal-section" aria-label="Other rewards">
      <div className={`goal-section__header ${isSearching ? 'goal-section__header--searching' : ''}`}>
        <h2 className="goal-section__title">Change your goal</h2>
        <div className="goal-section__actions">
          {/* Sort Button */}
          <button 
            className={`goal-section__filter-btn goal-section__filter-btn--sort ${sortOrder ? 'goal-section__filter-btn--active' : ''}`} 
            aria-label="Sort by price"
            onClick={handleSortClick}
          >
            <span style={{ fontWeight: 600 }}>{symbol}</span>
            <svg 
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" 
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ 
                transform: sortOrder === 'desc' ? 'rotate(180deg)' : 'none',
                opacity: sortOrder === null ? 0.5 : 1,
                transition: 'transform 0.2s ease'
              }}
            >
              <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
          </button>

          {/* Search Button / Input */}
          <div className={`goal-section__search-wrap ${isSearching ? 'goal-section__search-wrap--open' : ''}`}>
            {isSearching ? (
              <div className="goal-section__search-input-box">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Search..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={() => { if (!searchQuery) setIsSearching(false); }}
                />
                {searchQuery && (
                  <button className="goal-section__search-clear" onClick={() => { setSearchQuery(''); setIsSearching(false); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
            ) : (
              <button className="goal-section__filter-btn" aria-label="Search rewards" onClick={() => setIsSearching(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span>Search</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="goal-section__list">
        {processedRewards.length > 0 ? (
          processedRewards.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              cupCount={cupCount}
              onSelect={onSelectReward}
              onViewDetail={() => onViewDetail?.(reward)}
            />
          ))
        ) : (
          <p className="goal-section__empty">No rewards found.</p>
        )}
      </div>
    </section>
  );
}
