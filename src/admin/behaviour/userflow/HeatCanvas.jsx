import { useEffect, useRef } from 'react';
import { anchorPoints, paintHeat } from './heatPoints';

/* The heat itself, over the embedded app. Sized to the page the app is
 * actually rendering, and redrawn whenever that page, the taps or the
 * control positions change. See heatPoints.js for where a tap goes. */
export default function HeatCanvas({ points, controls, intensity = 1, width, height }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const { pts } = anchorPoints(points, controls, { width, pageHeight: height });
    paintHeat(canvas, pts, width, height, intensity, dpr);
  }, [points, controls, intensity, width, height]);
  return <canvas ref={ref} className="ufs-heat" aria-hidden="true" />;
}
