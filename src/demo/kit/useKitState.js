import { useRef, useState } from 'react';
import { pointsFor } from '../brands';

/* The state behind the kit, held by the demo page and handed to the brand
 * app and its PackPerksLayer through KitContext. */
export function useKitState({ brand, lang, t, wallet, rewards, live }) {
  const [sheet, setSheet] = useState(null);         // { mode, reward? }
  const [voucher, setVoucher] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [freshKey, setFreshKey] = useState(0);      // bumps when a cup is added here
  const goRewardsRef = useRef(() => {});
  const toastTimer = useRef(0);

  const toast = (msg) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  return {
    brand, lang, t, wallet, rewards, live,
    // Pop the newest cup: on the load that returned it, and on every cup after.
    fresh: wallet.earnedOnLoad || freshKey > 0,
    freshKey,
    sheet, voucher, toastMsg, toast, goRewardsRef,
    openSheet: (mode) => setSheet({ mode }),
    closeSheet: () => setSheet(null),
    earn: () => { wallet.earn(); setFreshKey(k => k + 1); setSheet({ mode: 'done' }); },
    openReward: (reward) => {
      const short = pointsFor(reward) - wallet.points;
      if (short > 0) { toast(t('needMore', { n: short })); return; }
      setSheet({ mode: 'redeem', reward });
    },
    openVoucher: (reward) => { setSheet(null); setVoucher(reward); },
    closeVoucher: () => setVoucher(null),
    goRewards: () => { setSheet(null); goRewardsRef.current(); },
  };
}
