import { supabase } from './supabase'

// ── Device identity ────────────────────────────────────────────────────────
// The only thing that stays in localStorage: a stable device fingerprint.
function getDeviceId() {
  let id = localStorage.getItem('packperks_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('packperks_device_id', id)
  }
  return id
}

// ── Profile generation (for brand-new users) ───────────────────────────────
const ANIMAL_NAMES = ['Fox', 'Panda', 'Bear', 'Rabbit', 'Cat', 'Owl', 'Deer', 'Penguin']
const SILLY_NAMES = {
  Fox:     ['Ferris Fox',    'Felix Fox',    'Francis Fox'],
  Panda:   ['Amanda Panda',  'Sandy Panda',  'Wanda Panda'],
  Bear:    ['Barry Bear',    'Perry Bear',   'Larry Bear'],
  Rabbit:  ['Habit Rabbit',  'Grabbit Rabbit','Abbott Rabbit'],
  Cat:     ['Chadwick Cat',  'Pat the Cat',  'Natty Cat'],
  Owl:     ['Rowland Owl',   'Powell Owl',   'Fowler Owl'],
  Deer:    ['Cheerful Deer', 'Sheer Deer',   'Pierre Deer'],
  Penguin: ['Finn Penguin',  'Quinn Penguin','Guin Penguin'],
}

export function generateInitialProfile() {
  const animalIndex = Math.floor(Math.random() * ANIMAL_NAMES.length)
  const names = SILLY_NAMES[ANIMAL_NAMES[animalIndex]]
  const displayName = names[Math.floor(Math.random() * names.length)]
  return { animalIndex, displayName }
}

// ── Timestamp formatter ────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── User ───────────────────────────────────────────────────────────────────
export async function getOrCreateUser() {
  const deviceId = getDeviceId()

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (existing) return existing

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ device_id: deviceId, animal_index: 0 })
    .select()
    .single()

  // React StrictMode mounts twice — second insert hits the unique constraint.
  // Just re-fetch the row that the first call created.
  if (error?.code === '23505') {
    const { data: existing2 } = await supabase
      .from('users')
      .select('*')
      .eq('device_id', deviceId)
      .single()
    return existing2
  }

  if (error) throw error

  // Ignore duplicate balance row (same race condition safety)
  await supabase
    .from('cup_balances')
    .insert({ user_id: newUser.id, balance: 0, lifetime_cups: 0 })

  return newUser
}

export async function updateUserProfile(userId, updates) {
  const dbUpdates = { updated_at: new Date().toISOString() }
  if ('displayName' in updates) dbUpdates.display_name = updates.displayName
  if ('animalIndex' in updates) dbUpdates.animal_index = updates.animalIndex
  if ('email' in updates) dbUpdates.email = updates.email
  if ('iban' in updates) dbUpdates.iban = updates.iban
  if ('selectedRewardId' in updates) dbUpdates.selected_reward_id = updates.selectedRewardId

  const { error } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', userId)

  if (error) throw error
}

// ── Cup balance ────────────────────────────────────────────────────────────
export async function getCupBalance(userId) {
  const { data, error } = await supabase
    .from('cup_balances')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data?.balance ?? 0
}

export async function updateCupBalance(userId, newBalance) {
  const { error } = await supabase
    .from('cup_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  if (error) throw error
}

// ── Cup scans ──────────────────────────────────────────────────────────────
// Logs each scan event. Phase 2: set status='pending' and populate photo_url.
export async function logCupScan(userId, { cupsAwarded = 1, photoUrl = null } = {}) {
  const { data, error } = await supabase
    .from('cup_scans')
    .insert({
      user_id: userId,
      cups_awarded: cupsAwarded,
      photo_url: photoUrl,
      status: photoUrl ? 'pending' : 'approved', // pending when photo present so admin reviews it
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

// ── Activity history ───────────────────────────────────────────────────────
export async function getHistory(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('type, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []).map(row => ({
    type: row.type,
    label: row.label,
    time: formatTime(row.created_at),
  }))
}

export async function addHistoryEntry(userId, type, label) {
  const { error } = await supabase
    .from('activity_history')
    .insert({ user_id: userId, type, label })

  if (error) throw error
}

// ── Published app config (rewards + settings pushed from admin) ────────────
export async function getAppConfig() {
  try {
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'published')
      .maybeSingle()
    return data?.value || null
  } catch {
    return null
  }
}

export async function saveAppConfig(config) {
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'published', value: config, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ── Claims ─────────────────────────────────────────────────────────────────
export async function createClaim(userId, { type, rewardId, cupsRedeemed, payoutAmount, iban, receiptPhotoUrl }) {
  const { data, error } = await supabase
    .from('claims')
    .insert({
      user_id: userId,
      type,
      reward_id: rewardId ?? null,
      cups_redeemed: cupsRedeemed,
      payout_amount: payoutAmount,
      iban,
      receipt_photo_url: receiptPhotoUrl ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}
