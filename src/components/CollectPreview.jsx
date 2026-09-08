import { useEffect, useState } from 'react';
import CollectSheet from './CollectSheet';

/* Dev-only preview of the collect sheet: /<group>/<store>?collect=12
 *
 * The sheet normally opens from an APPROVED claim in the activity modal,
 * which needs real data to reach. This shortcut renders it over whatever
 * store is loaded, so the screen can be reviewed (and demoed) on its own.
 * It renders nothing in a production build. */
export default function CollectPreview() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const raw = new URLSearchParams(window.location.search).get('collect');
    if (raw == null) return;
    const n = Number(raw);
    setAmount(Number.isFinite(n) && n > 0 ? n : 12);
    setOpen(true);
  }, []);

  if (!import.meta.env.DEV || !open) return null;
  return (
    <CollectSheet
      amount={amount}
      rewardName="Spanish latte"
      reference="PP-DEMO1"
      onClose={() => setOpen(false)}
    />
  );
}
