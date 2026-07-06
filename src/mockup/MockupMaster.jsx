import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import usePersistedState from '../hooks/usePersistedState';
import MockupEditor from './MockupEditor';
import MockupPreview from './MockupPreview';
import PhoneFrame from './PhoneFrame';
import {
  DEFAULT_CONFIG, cloneConfig, downloadTemplate, parseCsv, csvRowToConfig, AI_RESEARCH_PROMPT,
} from './mockupTemplate';
import { getSession, listMockups, createMockup, updateMockup, deleteMockup } from './mockupStore';
import './MockupMaster.css';

/* ─────────────────────────────────────────────────────────────────────
 * MockupMaster — standalone staff tool (served at /mockup) for building
 * a dummy store-home mockup to pitch prospective vendors, without ever
 * creating a real org. Editor on the left, live phone preview on the
 * right, plus a shared team library, CSV import, AI prompt and PNG export.
 * ───────────────────────────────────────────────────────────────────── */

export default function MockupMaster() {
  const [config, setConfig] = usePersistedState('mockup_draft', cloneConfig(DEFAULT_CONFIG));
  const [currentId, setCurrentId] = usePersistedState('mockup_current_id', null);
  const [name, setName] = usePersistedState('mockup_current_name', 'Untitled mockup');
  const [framed, setFramed] = usePersistedState('mockup_framed', true);
  const [zoom, setZoom] = usePersistedState('mockup_zoom', 0.85);

  const [session, setSession] = useState(undefined); // undefined = loading
  const [library, setLibrary] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const phoneRef = useRef(null);
  const csvRef = useRef(null);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2600); };

  const refreshLibrary = async () => {
    try { setLibrary(await listMockups()); }
    catch (e) { console.warn('library load failed', e); }
  };

  useEffect(() => {
    let alive = true;
    getSession().then(s => {
      if (!alive) return;
      setSession(s);
      if (s) refreshLibrary();
    });
    return () => { alive = false; };
  }, []);

  // ── Library actions (require a session) ──
  const requireSession = () => {
    if (!session) { setLibraryOpen(true); flash('Sign in to the admin (same browser) to use the shared library.'); return false; }
    return true;
  };

  // Small JPEG snapshot of the current preview, stored with the mockup so the
  // library list can show a thumbnail of each saved design.
  async function captureThumb() {
    const node = phoneRef.current;
    if (!node) return null;
    try {
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
      const canvas = await html2canvas(node, {
        scale: 0.4, useCORS: true, logging: false, backgroundColor: framed ? '#0b0b0d' : '#ECEBF1',
      });
      return canvas.toDataURL('image/jpeg', 0.62);
    } catch { return null; }
  }

  async function handleSave() {
    if (!requireSession()) return;
    setBusy(true);
    try {
      const thumb = await captureThumb();
      if (currentId) {
        const row = await updateMockup(currentId, { name, config, thumb });
        flash('Saved.'); setLibrary(lib => lib.map(m => (m.id === row.id ? row : m)));
      } else {
        const row = await createMockup(name, config, thumb);
        setCurrentId(row.id); flash('Saved to library.'); await refreshLibrary();
      }
    } catch (e) { flash(`Save failed: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function handleSaveAsNew() {
    if (!requireSession()) return;
    setBusy(true);
    try {
      const thumb = await captureThumb();
      const row = await createMockup(name + ' (copy)', config, thumb);
      setCurrentId(row.id); setName(row.name); flash('Saved as a new mockup.'); await refreshLibrary();
    } catch (e) { flash(`Save failed: ${e.message}`); }
    finally { setBusy(false); }
  }

  function handleLoad(m) {
    setConfig(cloneConfig(m.config)); setCurrentId(m.id); setName(m.name); setLibraryOpen(false);
  }

  function handleNew() {
    setConfig(cloneConfig(DEFAULT_CONFIG)); setCurrentId(null); setName('Untitled mockup');
  }

  async function handleDelete(m) {
    if (!window.confirm(`Delete “${m.name}”? This can't be undone.`)) return;
    try {
      await deleteMockup(m.id);
      setLibrary(lib => lib.filter(x => x.id !== m.id));
      if (currentId === m.id) setCurrentId(null);
    } catch (e) { flash(`Delete failed: ${e.message}`); }
  }

  // ── CSV import ──
  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCsv(ev.target.result);
        if (!rows.length) { flash('No data rows found in that CSV.'); return; }
        setConfig(csvRowToConfig(rows[0]));
        setCurrentId(null);
        flash('Applied CSV.');
      } catch (err) { flash(`Could not read CSV: ${err.message}`); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── AI prompt ──
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(AI_RESEARCH_PROMPT); flash('AI prompt copied to clipboard.'); }
    catch { setPromptOpen(true); }
  }

  // ── PNG export ──
  async function exportPng() {
    const node = phoneRef.current;
    if (!node) return;
    setBusy(true);
    try {
      // Ensure the brand font is ready so text renders correctly, then race
      // the capture against a timeout so a stuck resource can't hang the UI.
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
      // html2canvas draws text with the page's already-loaded DM Sans (no font
      // inlining), which is both reliable and correct-font here.
      const capture = html2canvas(node, {
        scale: 2, useCORS: true, logging: false, backgroundColor: framed ? '#0b0b0d' : '#ECEBF1',
      }).then(canvas => canvas.toDataURL('image/png'));
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000));
      const dataUrl = await Promise.race([capture, timeout]);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `mockup-${(name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      a.click();
      flash('PNG downloaded.');
    } catch (e) {
      flash(e.message === 'timeout'
        ? 'Export timed out. Try uploading images instead of pasting external URLs.'
        : 'Export failed — an external image likely blocked it. Upload images instead of pasting URLs.');
      console.warn('png export failed', e);
    } finally { setBusy(false); }
  }

  return (
    <div className="mockup-app">
      <header className="mockup-topbar">
        <div className="mockup-topbar__brand">
          <span className="mockup-topbar__logo">◧</span>
          <div>
            <h1 className="mockup-topbar__title">MockupMaster</h1>
            <span className="mockup-topbar__sub">Pitch mockups — no org required</span>
          </div>
        </div>

        <input
          className="mockup-name"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Mockup name"
          placeholder="Mockup name"
        />

        <div className="mockup-toolbar">
          <button className="mockup-btn" onClick={handleNew} title="Start a blank mockup">New</button>
          <button className="mockup-btn mockup-btn--primary" onClick={handleSave} disabled={busy}>
            {currentId ? 'Save' : 'Save to library'}
          </button>
          {currentId && <button className="mockup-btn" onClick={handleSaveAsNew} disabled={busy} title="Save a copy">Save as new</button>}
          <button className="mockup-btn" onClick={() => { setLibraryOpen(true); if (session) refreshLibrary(); }}>Library</button>
          <span className="mockup-toolbar__sep" />
          <button className="mockup-btn" onClick={downloadTemplate} title="Download a CSV you can fill in and re-upload">CSV template</button>
          <button className="mockup-btn" onClick={() => csvRef.current?.click()} title="Upload a filled CSV to build a mockup">Upload CSV</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={handleCsvUpload} />
          <button className="mockup-btn" onClick={copyPrompt} title="Copy an AI prompt that researches a business and returns a ready-to-upload CSV">Copy AI prompt</button>
          <span className="mockup-toolbar__sep" />
          <label className="mockup-switch" title="Wrap the preview in an iPhone frame">
            <input type="checkbox" checked={framed} onChange={e => setFramed(e.target.checked)} />
            <span>iPhone frame</span>
          </label>
          <button className="mockup-btn mockup-btn--accent" onClick={exportPng} disabled={busy}>Export PNG</button>
        </div>
      </header>

      {notice && <div className="mockup-notice">{notice}</div>}

      <div className="mockup-body">
        <aside className="mockup-pane mockup-pane--editor">
          <MockupEditor config={config} onChange={setConfig} />
        </aside>

        <main className="mockup-pane mockup-pane--preview">
          <div className="mockup-zoombar">
            <button className="mockup-zoombtn" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
            <span className="mockup-zoomval">{Math.round(zoom * 100)}%</span>
            <button className="mockup-zoombtn" onClick={() => setZoom(z => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
            <button className="mockup-zoombtn mockup-zoombtn--reset" onClick={() => setZoom(0.85)} title="Reset zoom">Reset</button>
          </div>
          <div className="mockup-stage">
            <div className="mockup-zoomwrap" style={{ transform: `scale(${zoom})` }}>
              <PhoneFrame ref={phoneRef} framed={framed} bg={config.palette?.background}>
                <MockupPreview config={config} />
              </PhoneFrame>
            </div>
          </div>
        </main>
      </div>

      {libraryOpen && (
        <div className="mockup-modal-back" onClick={() => setLibraryOpen(false)}>
          <div className="mockup-modal" onClick={e => e.stopPropagation()}>
            <div className="mockup-modal__head">
              <h2>Shared library</h2>
              <button className="mockup-btn mockup-btn--sm" onClick={() => setLibraryOpen(false)}>Close</button>
            </div>
            {session === undefined ? (
              <p className="mockup-muted">Checking sign-in…</p>
            ) : !session ? (
              <p className="mockup-muted">You’re not signed in. Open this tool from a logged-in <strong>/admin</strong> tab in the same browser to save and load shared mockups. You can still build, import CSV and export a PNG here.</p>
            ) : library.length === 0 ? (
              <p className="mockup-muted">No saved mockups yet. Build one and hit “Save to library”.</p>
            ) : (
              <ul className="mockup-lib">
                {library.map(m => (
                  <li key={m.id} className={`mockup-lib__row${currentId === m.id ? ' is-current' : ''}`}>
                    <button className="mockup-lib__load" onClick={() => handleLoad(m)}>
                      <span className="mockup-lib__thumb">
                        {m.thumb
                          ? <img src={m.thumb} alt="" />
                          : <span className="mockup-lib__thumb-fallback" style={{ background: m.config?.brandColor || '#672BFF' }}>{(m.config?.orgName || 'M').charAt(0).toUpperCase()}</span>}
                      </span>
                      <span className="mockup-lib__meta-col">
                        <span className="mockup-lib__name">{m.name}</span>
                        <span className="mockup-lib__meta">{(m.config?.orgName || '—')}</span>
                      </span>
                    </button>
                    <button className="mockup-btn mockup-btn--sm mockup-btn--danger" onClick={() => handleDelete(m)}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {promptOpen && (
        <div className="mockup-modal-back" onClick={() => setPromptOpen(false)}>
          <div className="mockup-modal" onClick={e => e.stopPropagation()}>
            <div className="mockup-modal__head">
              <h2>AI research prompt</h2>
              <button className="mockup-btn mockup-btn--sm" onClick={() => setPromptOpen(false)}>Close</button>
            </div>
            <p className="mockup-muted">Copy this, paste the business name where marked, run it in any AI, then upload the CSV it returns.</p>
            <textarea className="mockup-prompt" readOnly value={AI_RESEARCH_PROMPT} onFocus={e => e.target.select()} />
          </div>
        </div>
      )}
    </div>
  );
}
