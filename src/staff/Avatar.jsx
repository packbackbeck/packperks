const COLOURS = ['#5333A5', '#FD6F46', '#1A8737', '#0B7FB8', '#C2185B', '#E8930C'];

function initials(profile) {
  const source = (profile?.name || profile?.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (profile?.name && parts[1] ? parts[1][0] : '')).toUpperCase();
}

function colourFor(text) {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

/* The person's photo, or their initials on a colour. */
export default function Avatar({ profile, size = 36 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (profile?.avatar_url) {
    return <img className="st-avatar" src={profile.avatar_url} alt="" style={style} />;
  }
  return (
    <span className="st-avatar st-avatar--initials" style={{ ...style, background: colourFor(profile?.email) }} aria-hidden="true">
      {initials(profile)}
    </span>
  );
}
