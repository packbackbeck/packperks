import { useCallback, useEffect, useState } from 'react';
import { POINTS_PER_CUP, pointsFor } from './brands';

/* ─────────────────────────────────────────────────────────────────────
 * The demo wallet. Lives in this browser only (localStorage, one per
 * brand) and never talks to the database: a demo must not add cups,
 * claims or events to anyone's dashboard.
 *
 * Every page load counts as one returned cup, so refreshing the page is
 * how a demo "returns" a cup. A load is identified by
 * performance.timeOrigin, which keeps React StrictMode's double-run and
 * a second component on the same page from counting it twice.
 * ───────────────────────────────────────────────────────────────────── */

const KEY = (brand) => `ppdemo:v1:${brand}`;
const EVENT = 'ppdemo:wallet';
const LOAD_ID = typeof performance !== 'undefined' && performance.timeOrigin
  ? String(Math.round(performance.timeOrigin))
  : String(Date.now());

const EMPTY = { points: 0, cups: 0, redeemed: 0, activity: [], lastLoad: null };

function read(brand) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(brand)) || 'null');
    if (v && typeof v.points === 'number') return { ...EMPTY, ...v };
  } catch { /* private mode, or a bad value */ }
  return { ...EMPTY };
}

function write(brand, state) {
  try { localStorage.setItem(KEY(brand), JSON.stringify(state)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: brand }));
}

function withCup(state) {
  return {
    ...state,
    points: state.points + POINTS_PER_CUP,
    cups: state.cups + 1,
    activity: [{ kind: 'cup', points: POINTS_PER_CUP, at: Date.now() }, ...state.activity].slice(0, 30),
  };
}

// Brands whose cup this page load has already counted. Module-level, so
// StrictMode calling the initialiser twice still counts (and greets) once.
const countedThisLoad = new Set();

function loadAndCount(brand) {
  const current = read(brand);
  if (current.lastLoad === LOAD_ID) return current;
  const next = { ...withCup(current), lastLoad: LOAD_ID };
  write(brand, next);
  countedThisLoad.add(brand);
  return next;
}

export function useDemoWallet(brand) {
  const [state, setState] = useState(() => loadAndCount(brand));
  // A cup was counted for this page load: the app greets it.
  const earnedOnLoad = countedThisLoad.has(brand);

  useEffect(() => {
    // Another tab with the same demo keeps this one in step.
    const sync = () => setState(read(brand));
    const onStorage = (e) => { if (e.key === KEY(brand)) sync(); };
    const onLocal = (e) => { if (e.detail === brand) sync(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, onLocal);
    };
  }, [brand]);

  const update = useCallback((fn) => {
    const next = fn(read(brand));
    write(brand, next);
    setState(next);
    return next;
  }, [brand]);

  /** One more cup, without a refresh. */
  const earn = useCallback(() => update(withCup), [update]);

  /** Slide-to-redeem landed: the points leave the balance. */
  const redeem = useCallback((reward) => update((s) => {
    const cost = pointsFor(reward);
    if (s.points < cost) return s;
    return {
      ...s,
      points: s.points - cost,
      redeemed: s.redeemed + 1,
      activity: [{ kind: 'reward', id: reward.id, name: reward.name, points: -cost, at: Date.now() }, ...s.activity].slice(0, 30),
    };
  }), [update]);

  /** Back to an empty wallet. The current load is not counted again. */
  const reset = useCallback(() => update(() => ({ ...EMPTY, lastLoad: LOAD_ID })), [update]);

  return { ...state, earnedOnLoad, earn, redeem, reset };
}
