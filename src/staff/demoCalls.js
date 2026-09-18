/* The dashboard's preview of the staff app answers from here instead of
 * the staff-app function: sample codes, and new ones that live only on
 * this screen. Nothing is minted or saved. */

const MIN = 60_000;

function sample(minsAgo, cups, status, collectedAfter) {
  const created = Date.now() - minsAgo * MIN;
  return {
    id: crypto.randomUUID(),
    cups,
    package_type: 'cup',
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + 15 * MIN).toISOString(),
    cancelled_at: status === 'cancelled' ? new Date(created + 2 * MIN).toISOString() : null,
    claimed_cups: status === 'claimed' ? cups : 0,
    claimed_at: status === 'claimed' ? new Date(created + collectedAfter * MIN).toISOString() : null,
    status,
    url: null,
  };
}

export function demoCalls(venue) {
  let codes = [
    sample(22, 2, 'claimed', 1),
    sample(48, 1, 'claimed', 2),
    sample(95, 3, 'expired'),
    sample(140, 1, 'claimed', 1),
  ];
  const today = () => {
    const live = codes.filter(c => c.status !== 'cancelled');
    return { codes: live.length, cups: live.reduce((t, c) => t + c.cups, 0) };
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  return async function call(action, body = {}) {
    await wait(action === 'mint' ? 500 : 200);
    if (action === 'list') {
      return { codes: body.before ? [] : codes, has_more: false, today: today() };
    }
    if (action === 'mint') {
      const created = Date.now();
      const code = {
        id: crypto.randomUUID(),
        cups: body.cups,
        package_type: body.package_type || 'cup',
        created_at: new Date(created).toISOString(),
        expires_at: new Date(created + 15 * MIN).toISOString(),
        cancelled_at: null,
        claimed_cups: 0,
        claimed_at: null,
        status: 'waiting',
        url: `https://perks.packback.network/${venue.slug}/?batch=preview`,
      };
      codes = [code, ...codes];
      return { code };
    }
    if (action === 'status') {
      // In the preview a code is "scanned" a few seconds after it appears.
      codes = codes.map(c => (c.id === body.id && c.status === 'waiting' && Date.now() - Date.parse(c.created_at) > 6000
        ? { ...c, status: 'claimed', claimed_cups: c.cups, claimed_at: new Date().toISOString() }
        : c));
      return { code: codes.find(c => c.id === body.id) };
    }
    if (action === 'cancel') {
      codes = codes.map(c => (c.id === body.id
        ? { ...c, status: 'cancelled', cancelled_at: new Date().toISOString(), url: null }
        : c));
      return { code: codes.find(c => c.id === body.id) };
    }
    throw Object.assign(new Error('preview'), { code: 'preview' });
  };
}
