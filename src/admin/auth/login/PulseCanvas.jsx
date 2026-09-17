import { useEffect, useRef } from 'react';

/* The moving backdrop of the sign-in panel. Faint rows every 42px; a 26px dot
 * grid that lights up as heartbeat-shaped pulses travel along the rows; and
 * now and then a ring spreading from one dot, like a cup coming back. Lilac,
 * with PackPerks orange in every third pulse and most of the rings.
 *
 * The canvas fills its parent and follows its size. It only animates while it
 * is on screen, and draws one still frame when the visitor prefers reduced
 * motion. */

const ROW_GAP = 42;
const ROW_FIRST = 25.2;
const DOT_GAP = 26;
const DOT_FIRST = 13;
const PING_LIFE = 2200; // ms
const STILL_AT = 38000; // ms: the moment drawn when motion is reduced
const MAX_DPR = 2;

const LILAC = [201, 188, 255];
const WARM = [255, 170, 120];
const LILAC_CORE = 'rgba(240,235,255,0.95)';
const WARM_CORE = 'rgba(255,236,224,0.95)';
const LILAC_GLOW = 'rgba(150,126,255,0.9)';
const WARM_GLOW = 'rgba(242,100,58,0.85)';

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

/* Same seeded sequence on every resize, so the layout never jumps. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* One heartbeat across t = -1…1: a small bump, the tall spike, a dip below
 * the line and a small recovery. */
function beat(t) {
  const g = (x, w) => Math.exp(-(x * x) / (2 * w * w));
  return 0.16 * g(t + 0.64, 0.09) + g(t + 0.16, 0.12) - 0.82 * g(t - 0.24, 0.12) + 0.1 * g(t - 0.6, 0.08);
}

export default function PulseCanvas({ className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return undefined;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = motion.matches;
    let inView = true;
    let width = 0;
    let height = 0;
    let rows = [];
    let pulses = [];
    let pings = [];
    let nextPing = 0;
    let raf = 0;

    function measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      rows = [];
      for (let y = ROW_FIRST; y < height; y += ROW_GAP) rows.push(y);

      const rand = seeded(7);
      pulses = [];
      for (const y of rows) {
        const count = rand() < 0.5 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          pulses.push({
            y,
            speed: 34 + 62 * rand(),
            offset: rand() * (width + 400),
            span: 90 + 90 * rand(),
            amp: 11 + 17 * rand(),
            warm: pulses.length % 3 === 1,
          });
        }
      }
    }

    function draw(now) {
      const t = now / 1000;
      ctx.clearRect(0, 0, width, height);

      const live = pulses.map((p) => {
        const loop = width + 2 * p.span + 260;
        return { p, x: ((p.offset + t * p.speed) % loop) - p.span - 130 };
      });

      // Rows.
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(LILAC, 0.075);
      ctx.beginPath();
      for (const y of rows) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Dots. Unlit ones go out in one batch; lit ones grow, brighten and take
      // on the colour of the pulses around them.
      const lit = [];
      ctx.beginPath();
      for (let y = DOT_FIRST; y < height; y += DOT_GAP) {
        for (let x = DOT_FIRST; x < width; x += DOT_GAP) {
          let glow = 0;
          let warm = 0;
          for (const { p, x: px } of live) {
            const dy = p.y - y;
            if (dy > 70 || dy < -70) continue;
            const dx = px - x;
            if (dx > 112 || dx < -112) continue;
            const g = Math.exp(-(dx * dx) / 2600 - (dy * dy) / 900);
            glow += g;
            if (p.warm) warm += g;
          }
          if (glow < 0.004) {
            ctx.moveTo(x + 1, y);
            ctx.arc(x, y, 1, 0, Math.PI * 2);
          } else {
            lit.push(x, y, glow, warm / glow);
          }
        }
      }
      ctx.fillStyle = rgba(LILAC, 0.11);
      ctx.fill();
      for (let i = 0; i < lit.length; i += 4) {
        const k = Math.min(lit[i + 2], 1);
        const mix = lit[i + 3];
        const r = Math.round(LILAC[0] + (WARM[0] - LILAC[0]) * mix);
        const g = Math.round(LILAC[1] + (WARM[1] - LILAC[1]) * mix);
        const b = Math.round(LILAC[2] + (WARM[2] - LILAC[2]) * mix);
        ctx.fillStyle = rgba([r, g, b], 0.11 + 0.7 * k);
        ctx.beginPath();
        ctx.arc(lit[i], lit[i + 1], 1 + 0.9 * k, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pulses.
      for (const { p, x } of live) {
        if (x < -p.span || x > width + p.span) continue;
        const from = x - p.span;
        const to = x + p.span;
        const tone = p.warm ? WARM : LILAC;
        const stroke = ctx.createLinearGradient(from, 0, to, 0);
        stroke.addColorStop(0, rgba(tone, 0));
        stroke.addColorStop(0.55, rgba(tone, 0.55));
        stroke.addColorStop(0.78, p.warm ? WARM_CORE : LILAC_CORE);
        stroke.addColorStop(1, rgba(tone, 0));
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.shadowColor = p.warm ? WARM_GLOW : LILAC_GLOW;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        for (let px = from; px <= to; px += 3) {
          const py = p.y - beat((px - x) / p.span) * p.amp;
          if (px === from) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Rings.
      if (!still && now > nextPing) {
        const col = Math.floor((width / DOT_GAP) * Math.random());
        const row = Math.floor((height / DOT_GAP) * Math.random());
        pings.push({
          x: DOT_FIRST + DOT_GAP * col,
          y: DOT_FIRST + DOT_GAP * row,
          born: now,
          warm: Math.random() < 0.7,
        });
        nextPing = now + 700 + 900 * Math.random();
      }
      pings = pings.filter((ping) => now - ping.born < PING_LIFE);
      for (const ping of pings) {
        const k = (now - ping.born) / PING_LIFE;
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(ping.warm ? WARM : LILAC, (ping.warm ? 0.6 : 0.5) * (1 - k));
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, 2 + 26 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = ping.warm
          ? `rgba(255,222,204,${(0.95 * (1 - k)).toFixed(3)})`
          : `rgba(240,235,255,${(0.9 * (1 - k)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(now) {
      draw(now);
      raf = requestAnimationFrame(tick);
    }

    // Start, stop or redraw to match the current size, visibility and motion
    // preference.
    function sync() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!width || !height) return;
      if (still) {
        pings = [];
        draw(STILL_AT);
      } else if (inView) {
        raf = requestAnimationFrame(tick);
      }
    }

    measure();
    sync();

    const resize = new ResizeObserver(() => {
      measure();
      sync();
    });
    resize.observe(host);

    const view = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        sync();
      })
      : null;
    view?.observe(canvas);

    const onMotionChange = (e) => {
      still = e.matches;
      sync();
    };
    motion.addEventListener?.('change', onMotionChange);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      view?.disconnect();
      motion.removeEventListener?.('change', onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
