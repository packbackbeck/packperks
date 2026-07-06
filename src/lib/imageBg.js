/* ─────────────────────────────────────────────────────────────────────
 * imageBg — detect whether a logo image has a transparent background.
 *
 * Used to decide how to render a brand logo on a coloured tile/pin:
 *   • transparent background  → tint the mark WHITE (a clean monogram on
 *                               the venue's colour), with breathing room.
 *   • opaque background       → show the logo in its ORIGINAL colours,
 *                               edge-to-edge (no padding/gaps).
 *
 * Detection samples the four corner pixels' alpha on a small canvas. If the
 * image is cross-origin without CORS the canvas taints and we can't read it —
 * we then assume 'opaque' (safest: shows the real logo, no white-out).
 * Results are cached per URL so each logo is only analysed once.
 * ───────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';

const cache = new Map(); // url → Promise<'transparent' | 'opaque'>

export function detectImageBg(url) {
  if (!url) return Promise.resolve('opaque');
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve('opaque'); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = Math.max(2, Math.min(40, img.naturalWidth || 40));
        const h = Math.max(2, Math.min(40, img.naturalHeight || 40));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
        let clear = 0;
        for (const [x, y] of corners) {
          if (d[(y * w + x) * 4 + 3] < 25) clear++;
        }
        resolve(clear >= 2 ? 'transparent' : 'opaque');
      } catch {
        resolve('opaque'); // tainted (CORS) → show original, no white-out
      }
    };
    img.onerror = () => resolve('opaque');
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

/** React hook: null while detecting, then 'transparent' | 'opaque'. */
export function useImageBg(url) {
  const [bg, setBg] = useState(() => (url ? null : 'opaque'));
  useEffect(() => {
    let alive = true;
    if (!url) { setBg('opaque'); return undefined; }
    setBg(null);
    detectImageBg(url).then(r => { if (alive) setBg(r); });
    return () => { alive = false; };
  }, [url]);
  return bg;
}
