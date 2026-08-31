import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../auth/AuthContext';
import { getEmailTemplates, saveEmailTemplates, sendTestEmail } from '../lib/adminApi';
import {
  EMAIL_TEMPLATES, templateByKey, renderTemplate, sampleValues, auditTags,
} from '../lib/emailTemplates';
import './AdminEmailTemplates.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminEmailTemplates — edit the automated mails customers receive.
 *
 * Three things make this trustworthy rather than a text box that might
 * do something:
 *   1. The preview renders with the SAME substitution the edge function
 *      performs, so what you see is the mail that goes out.
 *   2. Only overrides are stored. A template you never touch keeps
 *      inheriting the default, and "Reset" genuinely deletes the override.
 *   3. A test send goes through the server (the mail key never reaches
 *      the browser) and lands in the signed-in admin's inbox.
 *
 * The backup-cup outage alert is deliberately NOT here — it has its own
 * editor on the Backup Cups page, next to the recipient list it needs.
 * Two editors writing one template is how templates get lost.
 * ───────────────────────────────────────────────────────────────────── */

export default function AdminEmailTemplates() {
  const { activeOrgId, activeOrg } = useOrg();
  const { profile, user } = useAuth();
  const ownEmail = profile?.email || user?.email || '';

  const [stored, setStored] = useState({});      // saved overrides
  const [draft, setDraft] = useState({});        // edits in flight
  const [activeKey, setActiveKey] = useState(EMAIL_TEMPLATES[0].key);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  // Where a tag lands when you click it: whichever field you touched last.
  const subjectRef = useRef(null);
  const htmlRef = useRef(null);
  const lastFocusRef = useRef('html');

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getEmailTemplates(activeOrgId);
      setStored(rows);
      setDraft(rows);
    } catch (e) {
      setError(e?.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTestTo(ownEmail); }, [ownEmail]);

  const def = templateByKey(activeKey);
  // Effective values: the override if there is one, else the default.
  const current = useMemo(() => {
    const o = draft[activeKey] || {};
    return {
      enabled: o.enabled !== false,
      subject: o.subject ?? def.subject,
      html: o.html ?? def.html,
    };
  }, [draft, activeKey, def]);

  const isOverridden = useMemo(() => {
    const o = stored[activeKey];
    return !!o && (o.subject != null || o.html != null || o.enabled === false);
  }, [stored, activeKey]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(stored),
    [draft, stored],
  );

  function update(patch) {
    setNotice(null);
    setDraft(d => ({
      ...d,
      [activeKey]: {
        enabled: current.enabled,
        subject: current.subject,
        html: current.html,
        ...d[activeKey],
        ...patch,
      },
    }));
  }

  /* Insert a tag at the caret of whichever field was last focused. */
  function insertTag(tag) {
    const which = lastFocusRef.current;
    const el = which === 'subject' ? subjectRef.current : htmlRef.current;
    const value = which === 'subject' ? current.subject : current.html;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + tag + value.slice(end);
    update({ [which]: next });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + tag.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const values = useMemo(
    () => ({ ...sampleValues(def), venue: activeOrg?.name || 'your venue' }),
    [def, activeOrg],
  );
  const previewSubject = renderTemplate(current.subject, values);
  const previewHtml = renderTemplate(current.html, values);
  const subjectAudit = auditTags(def, current.subject);
  const htmlAudit = auditTags(def, current.html);
  const unknownTags = [...new Set([...subjectAudit.unknown, ...htmlAudit.unknown])];

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Drop overrides that are identical to the default — that keeps the
      // venue inheriting future copy improvements instead of freezing a copy.
      const cleaned = {};
      for (const t of EMAIL_TEMPLATES) {
        const o = draft[t.key];
        if (!o) continue;
        const entry = {};
        if (o.subject != null && o.subject !== t.subject) entry.subject = o.subject;
        if (o.html != null && o.html !== t.html) entry.html = o.html;
        if (o.enabled === false && t.canDisable) entry.enabled = false;
        if (Object.keys(entry).length) cleaned[t.key] = entry;
      }
      await saveEmailTemplates(activeOrgId, cleaned);
      setStored(cleaned);
      setDraft(cleaned);
      setNotice('Saved. New emails use this straight away.');
    } catch (e) {
      setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setNotice(null);
    setDraft(d => {
      const next = { ...d };
      delete next[activeKey];
      return next;
    });
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await sendTestEmail({
        orgId: activeOrgId,
        templateKey: activeKey,
        subject: current.subject,
        html: current.html,
        to: testTo.trim(),
      });
      setNotice(`Test sent to ${testTo.trim()}. It uses sample values, not real customer data.`);
    } catch (e) {
      setError(e?.message || 'Test send failed.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="aet">
      <header className="aet__head">
        <div>
          <h1 className="aet__title">Email templates</h1>
          <p className="aet__sub">
            The automated emails PackPerks sends your customers. Edit the subject and the HTML,
            drop in {'{{tags}}'} for the live values, and preview exactly what lands in their inbox.
          </p>
        </div>
        <div className="aet__headactions">
          {dirty && <span className="aet__dirty">Unsaved changes</span>}
          <button className="aet__btn aet__btn--primary" onClick={handleSave} disabled={saving || loading || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {error && <div className="aet__error">{error}</div>}
      {notice && <div className="aet__notice">{notice}</div>}

      <div className="aet__tabs" role="tablist">
        {EMAIL_TEMPLATES.map(t => {
          const o = stored[t.key];
          const edited = !!o && (o.subject != null || o.html != null);
          const off = o?.enabled === false;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeKey === t.key}
              className={`aet__tab${activeKey === t.key ? ' is-on' : ''}`}
              onClick={() => { setActiveKey(t.key); setNotice(null); }}
            >
              <span className="aet__tab-name">{t.label}</span>
              <span className="aet__tab-meta">
                {off ? <em className="aet__tab-off">Off</em> : edited ? 'Edited' : 'Default'}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="aet__empty">Loading templates…</div>
      ) : (
        <div className="aet__grid">
          {/* ── Editor ── */}
          <section className="aet__card">
            <p className="aet__when"><strong>When it’s sent.</strong> {def.when}</p>

            {def.canDisable ? (
              <label className="aet__switch">
                <input
                  type="checkbox"
                  checked={current.enabled}
                  onChange={e => update({ enabled: e.target.checked })}
                />
                <span className="aet__switch-track"><span className="aet__switch-thumb" /></span>
                <span className="aet__switch-label">
                  {current.enabled ? 'Sending' : 'Paused'}
                  <em>{def.disableNote}</em>
                </span>
              </label>
            ) : (
              <p className="aet__locked">This email can’t be switched off — logging in depends on it.</p>
            )}

            <label className="aet__field">
              <span>Subject</span>
              <input
                ref={subjectRef}
                value={current.subject}
                onFocus={() => { lastFocusRef.current = 'subject'; }}
                onChange={e => update({ subject: e.target.value })}
              />
            </label>

            <div className="aet__tagbar">
              <span className="aet__tagbar-label">Insert a tag</span>
              <div className="aet__tags">
                {def.tags.map(t => (
                  <button key={t.tag} type="button" className="aet__tag" title={t.desc} onClick={() => insertTag(t.tag)}>
                    {t.tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="aet__field">
              <span>HTML body</span>
              <textarea
                ref={htmlRef}
                className="aet__code"
                rows={16}
                spellCheck={false}
                value={current.html}
                onFocus={() => { lastFocusRef.current = 'html'; }}
                onChange={e => update({ html: e.target.value })}
              />
            </label>

            {unknownTags.length > 0 && (
              <p className="aet__warn">
                Unknown tag{unknownTags.length > 1 ? 's' : ''}: {unknownTags.map(t => `{{${t}}}`).join(', ')} —
                these are sent to the customer as literal text. Use the buttons above for tags this email can fill.
              </p>
            )}

            <div className="aet__actions">
              <button className="aet__btn" onClick={handleReset} disabled={saving || !isOverridden}>
                Reset to default
              </button>
            </div>

            <div className="aet__test">
              <span className="aet__test-label">Send yourself a test</span>
              <div className="aet__test-row">
                <input
                  value={testTo}
                  onChange={e => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Test recipient"
                />
                <button className="aet__btn" onClick={handleTest} disabled={testing || !testTo.trim()}>
                  {testing ? 'Sending…' : 'Send test'}
                </button>
              </div>
              <p className="aet__hint">
                Sends the version on screen (saved or not) with sample values. Nothing reaches customers.
              </p>
            </div>
          </section>

          {/* ── Preview ── */}
          <section className="aet__card aet__card--preview">
            <h2 className="aet__card-title">Preview</h2>
            <p className="aet__hint">Rendered with the same tag substitution the sender uses.</p>
            <div className="aet__mail">
              <div className="aet__mail-head">
                <span className="aet__mail-from">PackPerks</span>
                <span className="aet__mail-subject">{previewSubject || <em>No subject</em>}</span>
              </div>
              <iframe
                className="aet__mail-body"
                title="Email preview"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;background:#fff">${previewHtml}</body>`}
              />
            </div>
            <div className="aet__legend">
              <span className="aet__legend-title">Tags this email can fill</span>
              <ul>
                {def.tags.map(t => (
                  <li key={t.tag}><code>{t.tag}</code> <span>{t.desc}</span></li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
