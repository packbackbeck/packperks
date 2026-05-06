import { useState, useEffect } from 'react';
import Header from './components/Header';
import CupProgress from './components/CupProgress';
import FeaturedReward from './components/FeaturedReward';
import GoalSection from './components/GoalSection';
import Modal from './components/Modal';
import UserPage from './components/UserPage';
import ReceiptPage from './components/ReceiptPage';
import SuccessPage from './components/SuccessPage';
import RewardDetailSheet from './components/RewardDetailSheet';
import CupScanPage from './components/CupScanPage';
import CupScanSuccess from './components/CupScanSuccess';
import DirectRefundSheet from './components/DirectRefundSheet';
import RefundSuccessPage from './components/RefundSuccessPage';
import ShareCupSheet from './components/ShareCupSheet';
import DonateSheet from './components/DonateSheet';
import DonateSuccessPage from './components/DonateSuccessPage';
import usePersistedState from './hooks/usePersistedState';
import { rewards } from './data/rewards';
import { track, EVENTS } from './utils/analytics';
import {
  getOrCreateUser,
  generateInitialProfile,
  getCupBalance,
  updateCupBalance,
  getHistory,
  addHistoryEntry,
  createClaim,
  updateUserProfile,
  logCupScan,
} from './lib/api';
import './App.css';

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  /* ── Supabase-backed state ── */
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cupCount, setCupCount] = useState(0);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState(null);

  /* ── UI preferences ── */
  const [selectedRewardId, setSelectedRewardId] = useState('chicken-sandwich'); // loaded from Supabase in init
  const [claimed, setClaimed] = usePersistedState('claimed', false); // transient UI flag, localStorage is fine

  /* ── Navigation ── */
  const [page, setPage] = useState('home');

  /* ── Transient claim state ── */
  const [claimedIban, setClaimedIban] = useState('');
  const [lastCupsAdded] = useState(1);

  /* ── Detail sheet ── */
  const [detailReward, setDetailReward] = useState(null);

  /* ── Nudge (highlight remaining cups) ── */
  const [nudgeCount, setNudgeCount] = useState(0);

  /* ── Modal state ── */
  const [termsOpen, setTermsOpen] = useState(false);
  const [directRefundOpen, setDirectRefundOpen] = useState(false);
  const [refundIban, setRefundIban] = useState('');
  const [refundCupCount, setRefundCupCount] = useState(0);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [donateSheetOpen, setDonateSheetOpen] = useState(false);
  const [donatedCups, setDonatedCups] = useState(0);

  /* ── Derived values ── */
  const selectedReward = rewards.find((r) => r.id === selectedRewardId) || rewards[0];
  const otherRewards = rewards.filter((r) => r.id !== selectedRewardId);
  const isUnlocked = cupCount >= selectedReward.cupsNeeded;
  const cupsRemaining = Math.max(0, selectedReward.cupsNeeded - cupCount);

  /* ── Init: load user + state from Supabase ── */
  useEffect(() => {
    async function init() {
      try {
        const user = await getOrCreateUser();

        // Generate a display name for brand-new users
        let displayName = user.display_name;
        let animalIndex = user.animal_index ?? 0;
        if (!displayName) {
          const generated = generateInitialProfile();
          displayName = generated.displayName;
          animalIndex = generated.animalIndex;
          await updateUserProfile(user.id, { displayName, animalIndex });
        }

        setUserId(user.id);
        setProfile({
          displayName,
          animalIndex,
          email: user.email || '',
          iban: user.iban || '',
          phone: 'iPhone 15 Pro',
        });
        if (user.selected_reward_id) setSelectedRewardId(user.selected_reward_id);

        const [balance, hist] = await Promise.all([
          getCupBalance(user.id),
          getHistory(user.id),
        ]);
        setCupCount(balance);
        setHistory(hist);
      } catch (err) {
        console.error('PackPerks init failed:', err);
        setInitError(err.message || 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  /* ── Helpers ── */
  const addHistory = (type, label) => {
    setHistory((prev) => [...prev, { type, label, time: formatTime(Date.now()) }]);
  };

  const persist = (...promises) => Promise.all(promises).catch(console.error);

  /* ── Profile handler ── */
  const handleSaveProfile = (updates) => {
    setProfile((prev) => ({ ...prev, ...updates }));
    if (userId) persist(updateUserProfile(userId, updates));
  };

  /* ── Reward handlers ── */
  const handlePickReward = (id) => {
    const reward = rewards.find((r) => r.id === id);
    track(EVENTS.REWARD_SELECTED, { reward_id: id, reward_name: reward?.name, cup_count: cupCount });
    setSelectedRewardId(id);
    setClaimed(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (userId) persist(updateUserProfile(userId, { selectedRewardId: id }));
  };

  const handleAddCup = () => setPage('cup-scan');
  const handleWithdraw = () => setDirectRefundOpen(true);

  /* ── Direct refund ── */
  const handleDirectRefundConfirm = (iban) => {
    track(EVENTS.WITHDRAW_ALL_CUPS, { cups_withdrawn: cupCount, deposit_value: (cupCount * 1.00).toFixed(2) });
    const count = cupCount;
    const label = `Direct refund: ${count} cup${count !== 1 ? 's' : ''} — €${(count * 1.00).toFixed(2)}`;
    addHistory('cups_withdrawn', label);
    setRefundIban(iban);
    setRefundCupCount(count);
    setCupCount(0);
    setClaimed(false);
    setDirectRefundOpen(false);
    setPage('refund-success');

    if (userId) {
      persist(
        updateCupBalance(userId, 0),
        createClaim(userId, { type: 'direct_refund', cupsRedeemed: count, payoutAmount: count * 1.00, iban }),
        addHistoryEntry(userId, 'cups_withdrawn', label)
      );
    }
  };

  /* ── Cashback claim ── */
  const handleClaim = (iban) => {
    track(EVENTS.REWARD_CLAIM_ATTEMPTED, {
      reward_id: selectedRewardId,
      reward_name: selectedReward.name,
      iban_length: iban.length,
      cup_count: cupCount,
    });
    setClaimedIban(iban);
    handleSaveProfile({ iban }); // persist IBAN for future auto-fill
    setPage('receipt');
  };

  const handleReceiptSubmit = (_photoDataUrl) => {
    // Photo upload to backend goes here in Phase 2
    setPage('success');
  };

  const handleSuccessDone = () => {
    track(EVENTS.REWARD_CLAIM_SUCCESS, {
      reward_id: selectedRewardId,
      reward_name: selectedReward.name,
      cup_count: cupCount,
    });
    const newCount = Math.max(0, cupCount - selectedReward.cupsNeeded);
    const label = `Claimed: ${selectedReward.name}`;
    addHistory('reward_claimed', label);
    setCupCount(newCount);
    setClaimed(false);
    setPage('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (userId) {
      persist(
        updateCupBalance(userId, newCount),
        createClaim(userId, {
          type: 'cashback',
          rewardId: selectedRewardId,
          cupsRedeemed: selectedReward.cupsNeeded,
          payoutAmount: selectedReward.euros,
          iban: claimedIban,
        }),
        addHistoryEntry(userId, 'reward_claimed', label)
      );
    }
  };

  const handleClaimAttempt = () => {
    track(EVENTS.REWARD_CLAIM_ATTEMPTED, { reward_id: selectedRewardId, reward_name: selectedReward.name, cup_count: cupCount });
  };

  const handleResetClaim = () => setClaimed(false);
  const handleOpenRefund = () => { track(EVENTS.DIRECT_REFUND_OPENED, { cup_count: cupCount }); setDirectRefundOpen(true); };
  const handleOpenTerms = () => { track(EVENTS.TERMS_OPENED); setTermsOpen(true); };

  /* ── Detail sheet ── */
  const handleViewDetail = (reward) => setDetailReward(reward);
  const handleClaimFromDetail = () => {
    setDetailReward(null);
    setPage('receipt');
  };

  /* ── Cup scan flow ── */
  const handleCupScanSubmit = (_photoDataUrl) => {
    track(EVENTS.CUP_ADDED);
    const newCount = cupCount + 1;
    const label = 'Cup returned at Burger King';
    setCupCount(newCount);
    addHistory('cup_added', label);
    setPage('cup-scan-success');

    if (userId) {
      persist(
        updateCupBalance(userId, newCount),
        addHistoryEntry(userId, 'cup_added', label),
        logCupScan(userId, { cupsAwarded: 1 })
      );
    }
  };

  const handleCupScanAgain = () => setPage('cup-scan');
  const handleCupScanHome = () => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  /* ── Nudge ── */
  const handleNudge = (remaining) => {
    setNudgeCount(remaining);
    setTimeout(() => setNudgeCount(0), 3000);
  };

  /* ── Loading / error screens ── */
  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#FFF8F4' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🥤</div>
          <div style={{ color: '#E24400', fontSize: '0.875rem', fontWeight: 600 }}>Loading your cups…</div>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', background: '#FFF8F4' }}>
        <div>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⚠️</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Database not set up yet</div>
          <div style={{ color: '#666', fontSize: '0.8rem', marginBottom: '1rem' }}>
            Run the SQL migration in your Supabase project, then reload.
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '0.75rem', fontSize: '0.7rem', color: '#999', wordBreak: 'break-all' }}>
            {initError}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', background: '#E24400', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ── Pages ── */
  if (page === 'cup-scan') {
    return <CupScanPage onSubmit={handleCupScanSubmit} onBack={() => setPage('home')} />;
  }

  if (page === 'donate-success') {
    return <DonateSuccessPage amount={donatedCups} onClose={() => setPage('home')} />;
  }

  if (page === 'cup-scan-success') {
    return (
      <CupScanSuccess
        cupsAdded={lastCupsAdded}
        newTotal={cupCount}
        onAddMore={handleCupScanAgain}
        onHome={handleCupScanHome}
      />
    );
  }

  if (page === 'receipt') {
    return <ReceiptPage reward={selectedReward} onSubmit={handleReceiptSubmit} onBack={() => setPage('home')} />;
  }

  if (page === 'success') {
    return <SuccessPage reward={selectedReward} claimedIban={claimedIban} onDone={handleSuccessDone} />;
  }

  if (page === 'refund-success') {
    return (
      <RefundSuccessPage
        cupCount={refundCupCount}
        iban={refundIban}
        onDone={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />
    );
  }

  if (page === 'user') {
    return (
      <div className="app">
        <UserPage
          profile={profile}
          onSaveProfile={handleSaveProfile}
          cupCount={cupCount}
          history={history}
          onAddCup={handleAddCup}
          onWithdraw={handleWithdraw}
          onOpenShare={() => setShareSheetOpen(true)}
          onOpenDonate={() => setDonateSheetOpen(true)}
          onClose={() => setPage('home')}
        />
        <DirectRefundSheet
          open={directRefundOpen}
          onClose={() => setDirectRefundOpen(false)}
          cupCount={cupCount}
          onConfirm={handleDirectRefundConfirm}
        />
        <ShareCupSheet
          open={shareSheetOpen}
          onClose={(cupsShared) => {
            setShareSheetOpen(false);
            if (cupsShared > 0) {
              const newCount = Math.max(0, cupCount - cupsShared);
              const label = `Shared ${cupsShared} cup${cupsShared !== 1 ? 's' : ''} via QR code`;
              setCupCount(newCount);
              addHistory('cups_shared', label);
              if (userId) persist(updateCupBalance(userId, newCount), addHistoryEntry(userId, 'cups_shared', label));
            }
          }}
          cupCount={cupCount}
        />
        <DonateSheet
          open={donateSheetOpen}
          onClose={(cupsToDonate) => {
            setDonateSheetOpen(false);
            if (cupsToDonate > 0) {
              const newCount = Math.max(0, cupCount - cupsToDonate);
              const label = `Donated ${cupsToDonate} cup${cupsToDonate !== 1 ? 's' : ''} to Plastic Soup Foundation`;
              setCupCount(newCount);
              setDonatedCups(cupsToDonate);
              addHistory('cups_donated', label);
              setPage('donate-success');
              if (userId) persist(updateCupBalance(userId, newCount), addHistoryEntry(userId, 'cups_donated', label));
            }
          }}
          cupCount={cupCount}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Header cupCount={cupCount} onBadgeClick={() => setPage('user')} />

      <section className="app__hero">
        <h1 className="app__headline">
          Collect Cups &amp;<br />Get Rewards
        </h1>
        <p className="app__subtext">
          We pool your cup deposits into one cashback payout — worth more than a standard refund.
        </p>
      </section>

      <CupProgress
        collected={cupCount}
        target={selectedReward.cupsNeeded}
        nudgeCount={nudgeCount}
      />

      <FeaturedReward
        key={selectedRewardId}
        reward={selectedReward}
        isUnlocked={isUnlocked}
        cupsRemaining={cupsRemaining}
        cupsCollected={cupCount}
        claimed={claimed}
        onClaim={handleClaim}
        onClaimAttempt={handleClaimAttempt}
        onResetClaim={handleResetClaim}
        onOpenTerms={handleOpenTerms}
        onOpenRefund={handleOpenRefund}
        onViewDetail={() => handleViewDetail(selectedReward)}
        onNudge={handleNudge}
      />

      <GoalSection
        rewards={otherRewards}
        cupCount={cupCount}
        onSelectReward={handlePickReward}
        onViewDetail={handleViewDetail}
      />

      {detailReward && (
        <RewardDetailSheet
          reward={detailReward}
          isSelected={detailReward.id === selectedRewardId}
          cupCount={cupCount}
          onPick={(id) => { handlePickReward(id); }}
          onClaim={handleClaimFromDetail}
          onClose={() => setDetailReward(null)}
        />
      )}

      <Modal open={termsOpen} onClose={() => setTermsOpen(false)} title="Voucher Terms">
        <p><strong>How it works:</strong> Return your reusable PackBack cups at any participating Burger King location. Each returned cup adds to your balance.</p>
        <ul>
          <li>Rewards are digital vouchers — no app download needed.</li>
          <li>One reward can be claimed per cup cycle.</li>
          <li>Vouchers are valid for 30 days after claiming.</li>
          <li>Cashback is sent to your IBAN within 3 business days.</li>
          <li>You can switch your reward goal at any time before claiming.</li>
        </ul>
        <p><strong>Refund policy:</strong> If you prefer cash over a food reward, use &quot;Get the direct refund&quot; to withdraw your cup deposit instead.</p>
        <button className="modal-btn" onClick={() => setTermsOpen(false)}>Got it</button>
      </Modal>

      <DirectRefundSheet
        open={directRefundOpen}
        onClose={() => setDirectRefundOpen(false)}
        cupCount={cupCount}
        onConfirm={handleDirectRefundConfirm}
      />
    </div>
  );
}
