/**
 * Reward image framing.
 *
 * Admins can reposition / zoom a product image inside its box from the reward
 * editor (Rewards → Visuals → Image). The chosen values are stored on the
 * reward object as three plain numbers:
 *
 *   imageScale  — zoom factor   (1 = fit as-is, >1 zoom in, <1 zoom out)
 *   imageX      — horizontal pan, in % of the box width  (-100..100)
 *   imageY      — vertical pan,   in % of the box height (-100..100)
 *   imageRotate — rotation in degrees (-180..180, 0 = upright)
 *
 * The SAME transform is applied everywhere the image is shown (editor preview,
 * featured card, selected card, catalog cards, detail sheet) so what the admin
 * sets is exactly what the customer sees.
 *
 * Returns `undefined` when the image is untouched (default framing) so existing
 * rewards render byte-for-byte as before and no inline style is emitted.
 */
export function rewardImageStyle(reward) {
  if (!reward) return undefined;
  const rawScale = Number(reward.imageScale);
  const rawX = Number(reward.imageX);
  const rawY = Number(reward.imageY);
  const rawRotate = Number(reward.imageRotate);
  const scale = Number.isFinite(rawScale) ? rawScale : 1;
  const x = Number.isFinite(rawX) ? rawX : 0;
  const y = Number.isFinite(rawY) ? rawY : 0;
  const rotate = Number.isFinite(rawRotate) ? rawRotate : 0;
  if (scale === 1 && x === 0 && y === 0 && rotate === 0) return undefined;
  // Pan in screen space first, then rotate and scale about the centre.
  return { transform: `translate(${x}%, ${y}%) rotate(${rotate}deg) scale(${scale})` };
}

/** Default framing values, used to seed the editor controls + Reset. */
export const DEFAULT_IMAGE_FRAMING = { imageScale: 1, imageX: 0, imageY: 0, imageRotate: 0 };
