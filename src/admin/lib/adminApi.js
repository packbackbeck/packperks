import { supabase } from '../../lib/supabase';

export async function getAdminStats() {
  const [usersRes, balancesRes, claimsRes, scansRes, historyRes, cupActivityRes] = await Promise.all([
    supabase.from('users').select('id, created_at, updated_at'),
    supabase.from('cup_balances').select('user_id, balance, lifetime_cups'),
    supabase.from('claims').select('id, type, cups_redeemed, payout_amount, status, created_at'),
    supabase.from('cup_scans').select('id, status, cups_awarded, created_at'),
    supabase.from('activity_history').select('id, type, created_at').order('created_at', { ascending: false }).limit(20),
    // Fetch all cup_added events for reliable daily chart (no limit, guaranteed written)
    supabase.from('activity_history').select('id, type, created_at').eq('type', 'cup_added'),
  ]);

  const users    = usersRes.data || [];
  const balances = balancesRes.data || [];
  const claims   = claimsRes.data || [];
  const scans    = scansRes.data || [];
  const recentActivity = historyRes.data || [];
  const cupActivity    = cupActivityRes.data || [];

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const totalUsers   = users.length;
  const activeUsers  = users.filter(u => new Date(u.updated_at).getTime() > thirtyDaysAgo).length;

  // Reliable lifetime total: current balances + all cups ever redeemed/refunded
  const totalCupsCollected =
    balances.reduce((sum, b) => sum + (b.balance || 0), 0) +
    claims.reduce((sum, c) => sum + (c.cups_redeemed || 0), 0);

  const totalCupsRedeemed = claims
    .filter(c => c.type === 'cashback')
    .reduce((sum, c) => sum + (c.cups_redeemed || 0), 0);
  const totalCashback = claims
    .filter(c => c.status === 'completed')
    .reduce((sum, c) => sum + (c.payout_amount || 0), 0);
  const pendingClaims = claims.filter(c => c.status === 'pending').length;
  const pendingScans  = scans.filter(s => s.status === 'pending').length;
  const failedClaims  = claims.filter(c => c.status === 'failed').length;

  return {
    totalUsers,
    activeUsers,
    totalCupsCollected,
    totalCupsRedeemed,
    totalCashback,
    pendingClaims,
    pendingScans,
    failedClaims,
    recentActivity,
    rawClaims: claims,
    rawScans: scans,
    rawUsers: users,
    rawBalances: balances,
    rawCupActivity: cupActivity,  // reliable per-day cup data
  };
}

export async function getAdminUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, display_name, email, iban, selected_reward_id, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const { data: balances } = await supabase
    .from('cup_balances')
    .select('user_id, balance, lifetime_cups');

  const balanceMap = Object.fromEntries(
    (balances || []).map(b => [b.user_id, { balance: b.balance, lifetime: b.lifetime_cups }])
  );

  return (users || []).map(u => ({
    ...u,
    cupBalance: balanceMap[u.id]?.balance || 0,
    lifetimeCups: balanceMap[u.id]?.lifetime || 0,
  }));
}

export async function getUserActivity(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getUserClaims(userId) {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function adjustUserBalance(userId, newBalance) {
  const { error } = await supabase
    .from('cup_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw error;
}

export async function adminUpdateUser(userId, updates) {
  const allowed = ['display_name', 'email', 'iban'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  const { error } = await supabase
    .from('users')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

export async function getAdminClaims() {
  const { data, error } = await supabase
    .from('claims')
    .select('id, user_id, type, reward_id, cups_redeemed, payout_amount, iban, receipt_photo_url, status, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, email');

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

  return (data || []).map(c => ({ ...c, user: userMap[c.user_id] || null }));
}

export async function updateClaimStatus(claimId, status) {
  const { error } = await supabase
    .from('claims')
    .update({ status })
    .eq('id', claimId);
  if (error) throw error;
}

export async function getAdminCupScans() {
  const { data, error } = await supabase
    .from('cup_scans')
    .select('id, user_id, cups_awarded, photo_url, status, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, email');

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

  return (data || []).map(s => ({ ...s, user: userMap[s.user_id] || null }));
}

export async function updateScanStatusWithNote(scanId, status, note = '') {
  const { error } = await supabase
    .from('cup_scans')
    .update({ status, rejection_note: note || null })
    .eq('id', scanId);
  if (error) throw error;
}

export async function getAdminReceiptChecks() {
  const { data, error } = await supabase
    .from('claims')
    .select('id, user_id, type, reward_id, cups_redeemed, payout_amount, iban, receipt_photo_url, status, created_at')
    .eq('type', 'cashback')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, email');

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
  return (data || []).map(c => ({ ...c, user: userMap[c.user_id] || null }));
}

export async function updateScanStatus(scanId, status) {
  const { error } = await supabase
    .from('cup_scans')
    .update({ status })
    .eq('id', scanId);
  if (error) throw error;
}
