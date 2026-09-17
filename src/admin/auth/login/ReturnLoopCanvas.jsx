import { useEffect, useRef } from 'react';

/* The moving backdrop of the sign-in panel: the PackPerks return loop.
 *
 * Three tilted orbits sit beside the headline. The loop stays clear of the
 * copy's text (`clearOf`, a ref) and above the top edge of `above` (a ref to
 * the product window); on a narrow panel it shrinks, moves down or right, or
 * drops its outer orbit to fit. Cups travel round them, the way
 * a reusable cup travels between counter and customer. Each orbit has a smart
 * bin on it: a cup that passes the bin dips in and drops a coin, and the coin
 * arcs into the wallet at the centre, filling the ring around it. Every fifth
 * coin unlocks a reward, which the wallet marks with a sparkle. The cups carry
 * on round, because they are reused. Faint specks and a few tiny cups drift up
 * across the rest of the panel.
 *
 * Everything drawn is a function of one clock, so a resize never makes
 * anything jump and the still frame for reduced motion is one call to draw().
 * Glows are sprites painted once per pixel ratio; a frame allocates nothing.
 * The canvas fills its parent and follows its size, and only animates while
 * it is on screen and the tab is visible. */

const TAU = Math.PI * 2;
const MAX_DPR = 2;
const T0 = 1000;          // s: the clock starts here, so every count is positive
const FLIGHT = 1.9;       // s: a coin's trip from a bin to the wallet
const BIN_FLASH = 1.1;    // s: the bin's glow after a cup drops in
const REWARD_EVERY = 5;   // coins per reward
const REWARD_SHOW = 1.9;  // s: the reward sparkle
const FILL_TIME = 0.5;    // s: the wallet ring filling one step
const TILT = -0.15;       // rad: the orbits rise to the right
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);
const TAIL = 6;           // segments in a cup's trail
const TAIL_STEP = 0.05;   // rad per segment

/* Sizes are px at the 1440px layout (a 976px-wide panel) and scale with the
 * panel. `bin` is the bin's angle on the orbit: 0 is the right end, π/2 the
 * front, π the left end; each bin sits where the dashboard window can't hide
 * it. The period is one lap in seconds. */
const ORBITS = [
  { rx: 62, ry: 25, period: 23, cups: 2, bin: 0.3 * Math.PI, phase: 0.5 },
  { rx: 126, ry: 43, period: 32, cups: 3, bin: 0.75 * Math.PI, phase: 2.2 },
  { rx: 196, ry: 60, period: 43, cups: 3, bin: Math.PI, phase: 4.3 },
].map((o) => ({ ...o, omega: TAU / o.period }));

/* Scale 1 is the loop on the 1440px layout; it never grows past MAX_SCALE,
 * which already fills the height between the top of the panel and the
 * product window. CENTRE_Y is the wallet's height when there is no copy to
 * line up with. */
const CENTRE_Y = 92;
const MAX_SCALE = 1.1;
const MIN_SCALE = 0.56;
const CUP_REACH = 8; // px a cup sticks out past its orbit, at scale 1

const LILAC_TRACK = 'rgba(185,166,255,1)';
const WARM_LINE = '#FFB688';
const WARM_HALO = 'rgba(242,100,58,1)';
const RING_TRACK = 'rgba(185,166,255,0.2)';
const SPARK_ANGLES = [0.2, 1.25, 2.3, 3.35, 4.4, 5.45];

/* Same seeded sequence on every resize, so the specks never jump. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const mod = (a, n) => ((a % n) + n) % n;
const wrapPi = (a) => mod(a + Math.PI, TAU) - Math.PI;
const easeInOut = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);

function sprite(size, dpr, paint) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(size * dpr);
  c.height = Math.ceil(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  paint(g, size / 2);
  return c;
}

function glow(g, c, stops) {
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, 0, c * 2, c * 2);
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* A takeaway cup, 24px box: lid, tapered body, sleeve. */
function paintCup(g) {
  const body = g.createLinearGradient(0, 7.6, 0, 19);
  body.addColorStop(0, '#FFFFFF');
  body.addColorStop(1, '#DDD3FF');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(7.2, 7.6);
  g.lineTo(16.8, 7.6);
  g.lineTo(15.5, 18.1);
  g.quadraticCurveTo(15.4, 19, 14.6, 19);
  g.lineTo(9.4, 19);
  g.quadraticCurveTo(8.6, 19, 8.5, 18.1);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(139,108,255,0.55)';
  g.beginPath();
  g.moveTo(7.62, 11.2);
  g.lineTo(16.38, 11.2);
  g.lineTo(15.98, 14.2);
  g.lineTo(8.02, 14.2);
  g.closePath();
  g.fill();
  g.fillStyle = '#C9BBFF';
  roundedRect(g, 6.2, 5, 11.6, 2.8, 1.4);
  g.fill();
}

/* A coin, 16px box. */
function paintCoin(g) {
  const face = g.createLinearGradient(3, 2, 13, 14);
  face.addColorStop(0, '#FFE1CC');
  face.addColorStop(0.45, '#FFB688');
  face.addColorStop(1, '#F2643A');
  g.fillStyle = face;
  g.beginPath();
  g.arc(8, 8, 5.6, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.lineWidth = 0.9;
  g.beginPath();
  g.arc(8, 8, 3.5, 0, TAU);
  g.stroke();
}

/* A four-point sparkle with a soft warm glow, 40px box. */
function paintSparkle(g, c) {
  glow(g, c, [[0, 'rgba(255,214,190,0.55)'], [0.35, 'rgba(242,100,58,0.16)'], [1, 'rgba(242,100,58,0)']]);
  const r = 12;
  const k = 1.5;
  const face = g.createRadialGradient(c, c, 0, c, c, r);
  face.addColorStop(0, '#FFFFFF');
  face.addColorStop(0.5, '#FFE6D6');
  face.addColorStop(1, '#FFB688');
  g.fillStyle = face;
  g.beginPath();
  g.moveTo(c, c - r);
  g.quadraticCurveTo(c + k, c - k, c + r, c);
  g.quadraticCurveTo(c + k, c + k, c, c + r);
  g.quadraticCurveTo(c - k, c + k, c - r, c);
  g.quadraticCurveTo(c - k, c - k, c, c - r);
  g.fill();
}

/* A smart bin, 20px box: a body with a return slot on top. */
function paintBin(g) {
  g.fillStyle = 'rgba(139,108,255,0.22)';
  roundedRect(g, 4.5, 7, 11, 10.5, 2.2);
  g.fill();
  g.strokeStyle = 'rgba(226,218,255,0.62)';
  g.lineWidth = 1.1;
  g.stroke();
  g.strokeStyle = 'rgba(236,230,255,0.85)';
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(7.3, 4.9);
  g.lineTo(12.7, 4.9);
  g.stroke();
  g.strokeStyle = 'rgba(226,218,255,0.4)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(10, 9.6);
  g.lineTo(10, 13.6);
  g.moveTo(8.4, 12.2);
  g.lineTo(10, 13.8);
  g.lineTo(11.6, 12.2);
  g.stroke();
}

function makeSprites(dpr) {
  return {
    dpr,
    cup: sprite(24, dpr, paintCup),
    coin: sprite(16, dpr, paintCoin),
    sparkle: sprite(40, dpr, paintSparkle),
    bin: sprite(20, dpr, paintBin),
    lilacGlow: sprite(48, dpr, (g, c) => glow(g, c, [[0, 'rgba(139,108,255,0.55)'], [0.4, 'rgba(139,108,255,0.16)'], [1, 'rgba(139,108,255,0)']])),
    warmGlow: sprite(48, dpr, (g, c) => glow(g, c, [[0, 'rgba(255,182,136,0.7)'], [0.35, 'rgba(242,100,58,0.24)'], [1, 'rgba(242,100,58,0)']])),
    core: sprite(160, dpr, (g, c) => glow(g, c, [[0, 'rgba(242,100,58,0.34)'], [0.22, 'rgba(242,100,58,0.14)'], [0.5, 'rgba(139,108,255,0.12)'], [1, 'rgba(139,108,255,0)']])),
    dot: sprite(8, dpr, (g, c) => glow(g, c, [[0, 'rgba(236,230,255,1)'], [0.45, 'rgba(236,230,255,0.45)'], [1, 'rgba(236,230,255,0)']])),
    warmDot: sprite(8, dpr, (g, c) => glow(g, c, [[0, 'rgba(255,214,190,1)'], [0.45, 'rgba(255,182,136,0.45)'], [1, 'rgba(255,182,136,0)']])),
  };
}

/* Where orbit `o` is at angle `th`, for a loop of scale `k` centred on x, y. */
function project(o, th, k, x, y, out) {
  const dx = o.rx * k * Math.cos(th);
  const dy = o.ry * k * Math.sin(th);
  out[0] = x + dx * COS_T - dy * SIN_T;
  out[1] = y + dx * SIN_T + dy * COS_T;
}

/* Half the height of a loop of `n` orbits at scale 1. */
function loopReach(n) {
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const o = ORBITS[i];
    reach = Math.max(reach, Math.hypot(o.rx * SIN_T, o.ry * COS_T));
  }
  return reach + CUP_REACH;
}

export default function ReturnLoopCanvas({ className, clearOf, above }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return undefined;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = motion.matches;
    let inView = true;
    let visible = document.visibilityState !== 'hidden';
    let width = 0;
    let height = 0;
    let dpr = 1;
    let sprites = null;
    let raf = 0;
    let clock = T0;
    let last = 0;

    // Layout, recomputed on resize.
    let scale = 1;
    let cx = 0;
    let cy = 0;
    let orbitCount = ORBITS.length;
    let lines = []; // the copy's text lines: left, top, right, bottom
    let floor = 0; // the loop stays above this
    let centreY = CENTRE_Y;
    const binX = new Float32Array(ORBITS.length);
    const binY = new Float32Array(ORBITS.length);
    let tracks = null; // offscreen canvas with the three orbits
    let tracksX = 0;
    let tracksY = 0;
    let tracksW = 0;
    let tracksH = 0;
    let specks = new Float32Array(0);
    let speckKind = new Uint8Array(0);
    let speckCount = 0;

    // Every line of text in the copy, and the window's top edge, in canvas
    // coordinates.
    function readCopy() {
      lines = [];
      const origin = host.getBoundingClientRect();
      const stage = above?.current;
      floor = stage ? stage.getBoundingClientRect().top - origin.top + 2 : height;
      centreY = CENTRE_Y;
      const el = clearOf?.current;
      if (!el) return;
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        range.selectNodeContents(walker.currentNode);
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          lines.push([r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top]);
        }
      }
      if (lines.length) {
        let top = Infinity;
        let bottom = 0;
        for (const line of lines) {
          top = Math.min(top, line[1]);
          bottom = Math.max(bottom, line[3]);
        }
        centreY = Math.round((top + bottom) / 2 + 6);
      }
    }

    function clashes(x, y, pad) {
      for (const [l, t, r, b] of lines) {
        if (x > l - pad && x < r + pad && y > t - pad && y < b + pad) return true;
      }
      return false;
    }

    // Does a loop of `n` orbits at scale `k`, centred on x, y, keep off the
    // copy? Only the outer orbit may run off the right edge.
    function fits(n, k, x, y) {
      const p = new Float32Array(2);
      const inner = ORBITS[n - 2];
      if (x + k * Math.hypot(inner.rx * COS_T, inner.ry * SIN_T) > width + 6) return false;
      if (clashes(x, y, 30 * k)) return false;
      for (let i = 0; i < n; i++) {
        const o = ORBITS[i];
        for (let a = 0; a < 40; a++) {
          project(o, (a / 40) * TAU, k, x, y, p);
          if (p[0] < width + 12 && clashes(p[0], p[1], 12 * k)) return false;
        }
        project(o, o.bin, k, x, y, p);
        if (p[0] > width - 14 * k || clashes(p[0], p[1] + 7 * k, 18 * k)) return false;
      }
      return true;
    }

    // The biggest loop that fits beside the copy: all three orbits if they
    // can, level with the copy and in the middle of the space after it; else
    // lower, further right, smaller, or without the outer orbit.
    function placeLoop() {
      let copyEnd = 0;
      for (const line of lines) copyEnd = Math.max(copyEnd, line[2]);
      const biggest = Math.min(Math.max(0.45 + (0.55 * width) / 976, MIN_SCALE), MAX_SCALE);
      for (let n = ORBITS.length; n >= 2; n--) {
        const reach = loopReach(n);
        for (let k = biggest; k >= MIN_SCALE - 0.001; k -= 0.02) {
          const centred = Math.min(width - 118 * k, copyEnd + (width - copyEnd) * 0.5);
          const lowest = floor - reach * k;
          for (let y = Math.min(centreY, lowest); y <= lowest; y += 6) {
            if (y - reach * k < 0) continue;
            for (const x of [centred, width - 118 * k, width - 90 * k]) {
              if (fits(n, k, x, y)) {
                orbitCount = n;
                scale = k;
                cx = x;
                cy = y;
                return;
              }
            }
          }
        }
      }
      orbitCount = 2;
      scale = MIN_SCALE;
      cx = width - 90 * MIN_SCALE;
      cy = centreY;
    }

    function orbitPoint(o, th, out) {
      project(o, th, scale, cx, cy, out);
    }

    function paintTracks() {
      let hw = 0;
      let hh = 0;
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        const rx = o.rx * scale;
        const ry = o.ry * scale;
        hw = Math.max(hw, Math.hypot(rx * COS_T, ry * SIN_T));
        hh = Math.max(hh, Math.hypot(rx * SIN_T, ry * COS_T));
      }
      tracksW = Math.ceil(hw * 2 + 8);
      tracksH = Math.ceil(hh * 2 + 8);
      tracksX = cx - tracksW / 2;
      tracksY = cy - tracksH / 2;
      tracks = tracks || document.createElement('canvas');
      tracks.width = Math.ceil(tracksW * dpr);
      tracks.height = Math.ceil(tracksH * dpr);
      const g = tracks.getContext('2d');
      g.scale(dpr, dpr);
      const mx = tracksW / 2;
      const my = tracksH / 2;
      // Brighter at the front, as if lit from the viewer's side.
      const depth = g.createLinearGradient(0, 0, 0, tracksH);
      depth.addColorStop(0, 'rgba(185,166,255,0.05)');
      depth.addColorStop(0.5, 'rgba(185,166,255,0.13)');
      depth.addColorStop(1, 'rgba(185,166,255,0.3)');
      g.strokeStyle = depth;
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        const outer = i === ORBITS.length - 1;
        g.lineWidth = outer ? 1 : 1.2;
        g.setLineDash(outer ? [2, 5] : []);
        g.beginPath();
        g.ellipse(mx, my, o.rx * scale, o.ry * scale, TILT, 0, TAU);
        g.stroke();
      }
    }

    function measure() {
      const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = host.clientWidth;
      height = host.clientHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!width || !height) return; // the panel is hidden (phones)
      if (!sprites || sprites.dpr !== dpr) sprites = makeSprites(dpr);

      readCopy();
      placeLoop();
      const point = new Float32Array(2);
      ORBITS.forEach((o, i) => {
        orbitPoint(o, o.bin, point);
        binX[i] = point[0];
        binY[i] = point[1];
      });
      paintTracks();

      // Specks: x, y, rise speed, sway, sway speed, phase, size, brightness.
      const rand = seeded(11);
      speckCount = Math.round((width * height) / 24000);
      specks = new Float32Array(speckCount * 8);
      speckKind = new Uint8Array(speckCount);
      for (let i = 0; i < speckCount; i++) {
        const k = i * 8;
        specks[k] = rand() * width;
        specks[k + 1] = rand() * (height + 40);
        specks[k + 2] = 5 + 11 * rand();
        specks[k + 3] = 4 + 12 * rand();
        specks[k + 4] = 0.15 + 0.35 * rand();
        specks[k + 5] = rand() * TAU;
        const roll = rand();
        speckKind[i] = roll < 0.16 ? 2 : roll < 0.3 ? 1 : 0;
        specks[k + 6] = speckKind[i] === 2 ? 9 + 4 * rand() : 3 + 3.5 * rand();
        specks[k + 7] = speckKind[i] === 2 ? 0.14 + 0.12 * rand() : 0.18 + 0.4 * rand();
      }
    }

    function put(img, x, y, size, alpha) {
      if (alpha <= 0.004) return;
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }

    function drawSpecks(t) {
      const span = height + 40;
      for (let i = 0; i < speckCount; i++) {
        const k = i * 8;
        const y = mod(specks[k + 1] - specks[k + 2] * t, span) - 20;
        const x = specks[k] + specks[k + 3] * Math.sin(specks[k + 4] * t + specks[k + 5]);
        const twinkle = 0.65 + 0.35 * Math.sin(specks[k + 4] * 2.3 * t + specks[k + 5] * 3);
        // Fade in at the bottom and out at the top.
        const edge = Math.min(1, (y + 20) / 80, (height - y) / 120);
        const kind = speckKind[i];
        const img = kind === 2 ? sprites.cup : kind === 1 ? sprites.warmDot : sprites.dot;
        put(img, x, y, specks[k + 6], specks[k + 7] * twinkle * edge);
      }
    }

    const at = new Float32Array(2);

    function drawTrail(o, th, sc, alpha) {
      ctx.lineWidth = 1.6 * sc;
      for (let s = 0; s < TAIL; s++) {
        ctx.globalAlpha = alpha * 0.5 * (1 - s / TAIL);
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.rx * scale, o.ry * scale, TILT, th - (s + 1) * TAIL_STEP, th - s * TAIL_STEP - 0.004);
        ctx.stroke();
      }
    }

    // Cups on the back half (front = false) or the front half.
    function drawCups(t, front) {
      ctx.strokeStyle = LILAC_TRACK;
      ctx.lineCap = 'round';
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        for (let j = 0; j < o.cups; j++) {
          const th = o.phase + (j / o.cups) * TAU + o.omega * t;
          const sn = Math.sin(th);
          if ((sn >= 0) !== front) continue;
          const depth = (sn + 1) / 2;
          const sc = scale * (0.76 + 0.3 * depth);
          let alpha = 0.45 + 0.55 * depth;
          orbitPoint(o, th, at);
          // Near the bin the cup dips in and comes back out.
          const d = wrapPi(th - o.bin);
          const dip = Math.exp(-(d * d) / 0.014);
          drawTrail(o, th, sc, alpha * (1 - dip));
          alpha *= 1 - 0.8 * dip;
          const x = at[0];
          const y = at[1] + 5 * sc * dip;
          put(sprites.lilacGlow, x, y, 40 * sc, alpha * 0.9);
          put(sprites.cup, x, y, 24 * sc, alpha);
        }
      }
    }

    function drawBins(t) {
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        let since = Infinity;
        for (let j = 0; j < o.cups; j++) {
          const th = o.phase + (j / o.cups) * TAU + o.omega * t;
          since = Math.min(since, mod(th - o.bin, TAU) / o.omega);
        }
        const x = binX[i];
        const y = binY[i] + 7 * scale;
        const depth = (Math.sin(o.bin) + 1) / 2;
        const sc = scale * (0.8 + 0.25 * depth);
        if (since < BIN_FLASH) {
          const u = since / BIN_FLASH;
          put(sprites.warmGlow, x, y - 3 * sc, 46 * sc, (1 - u) * 0.95);
          ctx.globalAlpha = (1 - u) * 0.55;
          ctx.strokeStyle = WARM_LINE;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, (7 + 16 * easeOut(u)) * sc, 0, TAU);
          ctx.stroke();
        }
        put(sprites.bin, x, y, 20 * sc, 0.55 + 0.35 * depth);
      }
    }

    function drawCoins(t) {
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        const x0 = binX[i];
        const y0 = binY[i];
        const qx = (x0 + cx) / 2;
        const qy = Math.min(y0, cy) - 62 * scale;
        for (let j = 0; j < o.cups; j++) {
          const th = o.phase + (j / o.cups) * TAU + o.omega * t;
          const since = mod(th - o.bin, TAU) / o.omega;
          if (since >= FLIGHT) continue;
          const p = since / FLIGHT;
          const fadeIn = Math.min(1, p * 7);
          const fadeOut = p > 0.9 ? (1 - p) / 0.1 : 1;
          // A short trail of sparks, then the coin itself.
          for (let s = 3; s >= 0; s--) {
            const u = easeInOut(Math.max(0, p - s * 0.035));
            const a = 1 - u;
            const x = a * a * x0 + 2 * a * u * qx + u * u * cx;
            const y = a * a * y0 + 2 * a * u * qy + u * u * cy;
            const size = scale * (1 - 0.4 * u);
            if (s === 0) {
              put(sprites.warmGlow, x, y, 38 * size, fadeIn * fadeOut * 0.9);
              put(sprites.coin, x, y, 16 * size, fadeIn * fadeOut);
            } else {
              put(sprites.warmDot, x, y, (6 - s) * size, fadeIn * fadeOut * (0.5 - s * 0.12));
            }
          }
        }
      }
    }

    function drawWallet(t) {
      // How many coins have landed so far, and when the last one did.
      let landed = 0;
      let lastLanded = -Infinity;
      for (let i = 0; i < orbitCount; i++) {
        const o = ORBITS[i];
        for (let j = 0; j < o.cups; j++) {
          const start = o.phase + (j / o.cups) * TAU;
          landed += Math.floor((start + o.omega * (t - FLIGHT) - o.bin) / TAU);
          const since = mod(start + o.omega * t - o.bin, TAU) / o.omega;
          const arrived = since >= FLIGHT ? t - since + FLIGHT : t - since - o.period + FLIGHT;
          if (arrived > lastLanded) lastLanded = arrived;
        }
      }
      const step = landed % REWARD_EVERY;
      const since = t - lastLanded;
      const flare = Math.exp(-since / 0.55);
      const rewarding = step === 0 && since < REWARD_SHOW;
      const u = rewarding ? since / REWARD_SHOW : 1;
      const R = 15 * scale;

      put(sprites.core, cx, cy, 170 * scale, 0.8 + 0.2 * flare + (rewarding ? 0.5 * (1 - u) : 0));

      ctx.lineCap = 'round';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = RING_TRACK;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.stroke();

      let fill = 0;
      let ringAlpha = 1;
      if (step === 0) {
        if (rewarding) {
          fill = REWARD_EVERY;
          ringAlpha = 1 - easeInOut(u);
        }
      } else {
        fill = step - 1 + easeOut(Math.min(1, since / FILL_TIME));
      }
      if (fill > 0.01) {
        const end = -Math.PI / 2 + (TAU * fill) / REWARD_EVERY;
        ctx.strokeStyle = WARM_HALO;
        ctx.globalAlpha = 0.22 * ringAlpha;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, R, -Math.PI / 2, end);
        ctx.stroke();
        ctx.strokeStyle = WARM_LINE;
        ctx.globalAlpha = 0.95 * ringAlpha;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(cx, cy, R, -Math.PI / 2, end);
        ctx.stroke();
      }

      let pop = 0;
      if (rewarding) {
        // A ring spreads out and sparks fly from the wallet.
        const wave = easeOut(u);
        ctx.strokeStyle = WARM_LINE;
        ctx.globalAlpha = 0.6 * (1 - u);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, R + 34 * scale * wave, 0, TAU);
        ctx.stroke();
        for (let s = 0; s < SPARK_ANGLES.length; s++) {
          const a = SPARK_ANGLES[s];
          const r = R + 10 * scale + 30 * scale * wave;
          put(sprites.warmDot, cx + r * Math.cos(a), cy + r * Math.sin(a), 6 * scale, 0.9 * (1 - u));
        }
        pop = Math.sin(Math.PI * Math.min(1, u * 1.6));
      }

      const size = 40 * scale * (0.52 + 0.05 * Math.sin(t * 1.7) + 0.16 * flare + 0.45 * pop);
      const turn = t * 0.2 + pop * 0.8;
      const c = Math.cos(turn) * dpr;
      const s = Math.sin(turn) * dpr;
      ctx.setTransform(c, s, -s, c, cx * dpr, cy * dpr);
      put(sprites.sparkle, 0, 0, size, 0.9 + 0.1 * flare);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawSpecks(t);
      ctx.globalAlpha = 1;
      if (tracks) ctx.drawImage(tracks, tracksX, tracksY, tracksW, tracksH);
      drawCups(t, false);
      drawWallet(t);
      drawBins(t);
      drawCups(t, true);
      drawCoins(t);
      ctx.globalAlpha = 1;
    }

    /* The moment drawn when motion is reduced: a coin halfway to a wallet
     * that is three-fifths full, with no cup in a bin. */
    function stillMoment() {
      for (let t = T0; t < T0 + 240; t += 0.05) {
        let flying = false;
        let landed = 0;
        let dipping = false;
        for (let i = 0; i < orbitCount; i++) {
          const o = ORBITS[i];
          for (let j = 0; j < o.cups; j++) {
            const start = o.phase + (j / o.cups) * TAU;
            const th = start + o.omega * t;
            const since = mod(th - o.bin, TAU) / o.omega;
            if (since > FLIGHT * 0.4 && since < FLIGHT * 0.55) flying = true;
            if (Math.abs(wrapPi(th - o.bin)) < 0.17) dipping = true;
            landed += Math.floor((start + o.omega * (t - FLIGHT) - o.bin) / TAU);
          }
        }
        if (flying && !dipping && landed % REWARD_EVERY === 3) return t;
      }
      return T0 + 7;
    }
    let stillAt = 0;
    let stillFor = 0; // the orbit count stillAt was picked for

    function tick(now) {
      if (last) clock += Math.min(now - last, 64) / 1000;
      last = now;
      draw(clock);
      raf = requestAnimationFrame(tick);
    }

    // Start, stop or redraw to match the size, visibility and motion
    // preference.
    function sync() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (!width || !height) return;
      if (still) {
        if (stillFor !== orbitCount) {
          stillAt = stillMoment();
          stillFor = orbitCount;
        }
        draw(stillAt);
      } else if (inView && visible) {
        raf = requestAnimationFrame(tick);
      } else {
        draw(clock); // paused: keep the current moment on screen
      }
    }

    measure();
    sync();

    const resize = new ResizeObserver(() => {
      measure();
      sync();
    });
    resize.observe(host);
    if (clearOf?.current) resize.observe(clearOf.current);
    if (above?.current) resize.observe(above.current);

    // The copy's lines move when the web font arrives.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      measure();
      sync();
    });

    const view = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        sync();
      })
      : null;
    view?.observe(canvas);

    const onVisibility = () => {
      visible = document.visibilityState !== 'hidden';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotionChange = (e) => {
      still = e.matches;
      sync();
    };
    motion.addEventListener?.('change', onMotionChange);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      resize.disconnect();
      view?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener?.('change', onMotionChange);
    };
  }, [clearOf, above]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
