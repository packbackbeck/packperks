import { useEffect, useRef, useState } from 'react';
import { Check, ImageUp, Palette, RotateCcw, SwatchBook, Upload, X } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader } from '../ui';
import { DEFAULT_DESIGN } from './designDefaults';
import { extractColorsFromFile, extractFromUrl } from './extractColors';
import { COLOR_GROUPS, COLOR_KEYS, COLOR_LABELS, palettesFor } from './designModel';
import { contrast, contrastVerdict, toHex } from './colorUtils';
import { ColourInput } from './DesignFields';

const SAME = (a, b) => COLOR_KEYS.every(k => (toHex(a?.[k]) || '') === (toHex(b?.[k]) || ''));

/* Colours: every colour by the job it does in the app, each with a contrast
 * check where it carries text or icons; then ready palettes and a palette
 * pulled from an image, for starting over. */
export default function ColoursPanel({ colors, org, readOnly, onPatch, onReplace }) {
  const palettes = palettesFor(org);
  const isDefault = SAME(colors, DEFAULT_DESIGN.colors);

  return (
    <div className="dz-stack">
      <Card>
        <CardHeader
          icon={Palette}
          title="Colours"
          subtitle="Click a swatch to pick a colour, or type a hex code. The preview updates as you go."
          ruled
          actions={!readOnly && (
            <Button variant="ghost" size="sm" icon={RotateCcw} disabled={isDefault} onClick={() => onReplace({ ...DEFAULT_DESIGN.colors })}>
              Reset colours
            </Button>
          )}
        />
        <CardBody>
          <div className="dz-colour-groups">
            {COLOR_GROUPS.map(g => (
              <section key={g.id} className="dz-colour-group" aria-labelledby={`dz-cg-${g.id}`}>
                <div className="dz-colour-group__head">
                  <h3 id={`dz-cg-${g.id}`} className="dz-group-label">{g.title}</h3>
                  <p className="dz-colour-group__sub">{g.subtitle}</p>
                  {g.id === 'brand' && (
                    <span className="dz-gradient" title="The cup progress fill: accent fading into the reward-card colour">
                      <span style={{ background: `linear-gradient(90deg, ${colors.accent} 0%, ${colors.accent} 60%, ${colors.accentDeep} 100%)` }} />
                      Progress fill
                    </span>
                  )}
                </div>
                <div className="dz-swatches">
                  {g.roles.map(r => (
                    <Swatch key={r.key} role={r} colors={colors} disabled={readOnly} onChange={(v) => onPatch({ [r.key]: v })} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={SwatchBook}
          title="Start from a palette"
          subtitle="Replace all eight colours at once, then fine-tune them above. Nothing goes live until you publish."
        />
        <CardBody>
          <div className="dz-palettes">
            {palettes.map(p => {
              const on = SAME(colors, p.colors);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`dz-palette${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => onReplace(p.colors)}
                  style={{ '--dz-pal-bg': p.colors.background }}
                >
                  <span className="dz-palette__preview" aria-hidden="true">
                    <span className="dz-palette__bar" style={{ background: p.colors.primary }} />
                    <span className="dz-palette__row">
                      <span style={{ background: p.colors.accent }} />
                      <span style={{ background: p.colors.accentDeep }} />
                      <span style={{ background: p.colors.success }} />
                    </span>
                  </span>
                  <span className="dz-palette__name">
                    {p.name}
                    {on && <Check size={13} aria-hidden="true" />}
                  </span>
                  {p.highlight && <span className="dz-palette__hint">From {toHex(org?.brand_color)}</span>}
                </button>
              );
            })}
          </div>
          <ImageImport org={org} disabled={readOnly} onApply={onReplace} />
        </CardBody>
      </Card>
    </div>
  );
}

function Swatch({ role, colors, disabled, onChange }) {
  const value = colors[role.key] || '';
  const changed = (toHex(value) || '') !== DEFAULT_DESIGN.colors[role.key];
  let check = null;
  if (role.check) {
    const [fg, bg, use, pair] = role.check;
    const ratio = contrast(colors[fg], colors[bg]);
    const verdict = contrastVerdict(ratio, use);
    if (verdict) check = { ratio, verdict, pair, fg: colors[fg], bg: colors[bg], use };
  }
  return (
    <article className="dz-swatch">
      <div className="dz-swatch__top">
        <ColourInput value={value} label={role.name} onChange={onChange} disabled={disabled} />
      </div>
      <div className="dz-swatch__title">
        <h4 className="dz-swatch__name">{role.name}</h4>
        {changed && !disabled && (
          <button type="button" className="dz-link" title="Use the PackBack default" onClick={() => onChange(DEFAULT_DESIGN.colors[role.key])}>
            Default
          </button>
        )}
      </div>
      <p className="dz-swatch__detail">{role.detail}</p>
      {check && (
        <div className="dz-swatch__foot">
          <span
            className="dz-contrast"
            title={`${check.pair}: contrast ${check.ratio.toFixed(1)}:1. ${check.use === 'shape'
              ? 'Icons and shapes need at least 3:1.'
              : 'Body text needs 4.5:1; large, bold text needs 3:1.'}`}
          >
            <span className="dz-contrast__sample" style={{ background: check.bg, color: check.fg }}>Aa</span>
            <Badge tone={check.verdict.tone}>{check.ratio.toFixed(1)}:1 · {check.verdict.label}</Badge>
          </span>
        </div>
      )}
    </article>
  );
}

/* Suggest a palette from an uploaded image or the organisation's logo. */
function ImageImport({ org, disabled, onApply }) {
  const fileRef = useRef(null);
  const [source, setSource] = useState(null);   // { url, local }
  const [palette, setPalette] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [applied, setApplied] = useState(false);

  // Object URLs made for a local file are released when replaced or unmounted.
  useEffect(() => () => { if (source?.local) URL.revokeObjectURL(source.url); }, [source]);

  async function read(kind, input) {
    setErr(null);
    setApplied(false);
    setBusy(true);
    setPalette(null);
    setSource(kind === 'file' ? { url: URL.createObjectURL(input), local: true } : { url: input, local: false });
    try {
      const colors = kind === 'file' ? await extractColorsFromFile(input) : await extractFromUrl(input);
      setPalette(colors);
    } catch (ex) {
      setErr(kind === 'file'
        ? (ex.message || 'Could not read that image.')
        : 'Your logo can’t be read from here. Download it and upload the file instead.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onFile(file) {
    if (!file || disabled) return;
    if (!file.type.startsWith('image/')) { setErr('That file isn’t an image.'); return; }
    read('file', file);
  }

  function clear() {
    setSource(null);
    setPalette(null);
    setErr(null);
    setApplied(false);
  }

  return (
    <div className="dz-import">
      <div
        className={`dz-import__drop${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        <span className="dz-import__thumb">
          {source ? <img src={source.url} alt="" /> : <ImageUp size={20} aria-hidden="true" />}
        </span>
        <div className="dz-import__text">
          <p className="dz-import__title">Pull colours from an image</p>
          <p className="dz-import__sub">
            {busy ? 'Reading the colours…' : 'Upload your logo or a brand photo, or drop it here. You’ll see the suggestion before anything changes.'}
          </p>
        </div>
        <div className="dz-import__buttons">
          <Button size="sm" icon={Upload} disabled={busy || disabled} onClick={() => fileRef.current?.click()}>Upload image</Button>
          {org?.logo_url && (
            <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => read('url', org.logo_url)}>Use your logo</Button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {err && <p className="dz-error" role="alert">{err}</p>}

      {palette && (
        <div className="dz-import__result">
          <div className="dz-import__chips">
            {COLOR_KEYS.filter(k => palette[k]).map(k => (
              <span key={k} className="dz-import__chip" title={COLOR_LABELS[k]}>
                <i style={{ background: palette[k] }} />
                <span>{COLOR_LABELS[k]}</span>
                <code>{palette[k]}</code>
              </span>
            ))}
          </div>
          <div className="dz-import__actions">
            {applied ? (
              <Badge tone="success" icon={Check}>Applied to your draft</Badge>
            ) : (
              <Button size="sm" variant="primary" icon={Check} disabled={disabled} onClick={() => { onApply(palette); setApplied(true); }}>
                Use these colours
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={X} onClick={clear}>{applied ? 'Close' : 'Discard'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
