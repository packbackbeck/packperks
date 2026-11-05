import { createContext, useContext } from 'react';

/* The kit's shared plumbing, kept out of the component files. */

export const KitContext = createContext(null);
export const useKit = () => useContext(KitContext);

export const cls = (...xs) => xs.filter(Boolean).join(' ');

export const kitStyle = (kit) => ({
  '--ppd-bg': kit.bg, '--ppd-primary': kit.primary, '--ppd-on-primary': kit.onPrimary,
  '--ppd-btn': kit.button, '--ppd-on-btn': kit.onButton,
  '--ppd-fill': kit.fill, '--ppd-fill-ink': kit.fillInk,
  '--ppd-muted': kit.muted, '--ppd-tile': kit.tile, '--ppd-rail': kit.rail,
});
