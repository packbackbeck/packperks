import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock, CircleAlert, CircleCheck, Eye, KeyRound, Lock, Mail, PenLine, RotateCcw, Save, Send,
  TriangleAlert,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../auth/AuthContext';
import { getEmailTemplates, saveEmailTemplates, sendTestEmail } from '../lib/adminApi';
import {
  EMAIL_TEMPLATES, templateByKey, renderTemplate, sampleValues, auditTags,
} from '../lib/emailTemplates';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Switch, Tabs } from '../ui';
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

  const tabs = EMAIL_TEMPLATES.map(t => {
    const o = stored[t.key];
    const edited = !!o && (o.subject != null || o.html != null);
    const off = o?.enabled === false;
    return {
      id: t.key,
      icon: t.key === 'login_code' ? KeyRound : Mail,
      label: (
        <>
          {t.label}
          {off
            ? <Badge tone="danger">Off</Badge>
            : edited ? <Badge tone="primary">Edited</Badge> : <span className="aet-tab-default">Default</span>}
        </>
      ),
    };
  });

  return (
    <div className="ui-page aet-page">
      <PageHeader
        title="Email templates"
        subtitle={<>The automatic emails PackPerks sends your customers. Edit the subject and the HTML, add {'{{tags}}'} for live values, and preview exactly what arrives in their inbox.</>}
      >
        {dirty && <Badge tone="warning">Unsaved changes</Badge>}
        <Button variant="primary" icon={Save} onClick={handleSave} disabled={saving || loading || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </PageHeader>

      {error && (
        <div className="aet-callout aet-callout--danger" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="aet-callout aet-callout--success" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}

      <div className="aet-tabs">
        <Tabs
          tabs={tabs}
          value={activeKey}
          onChange={(key) => { setActiveKey(key); setNotice(null); }}
          ariaLabel="Email templates"
        />
      </div>

      {loading ? (
        <Card>
          <EmptyState icon={Mail} title="Loading templates…" />
        </Card>
      ) : (
        <div className="aet-grid">
          {/* ── Editor ── */}
          <Card className="aet-editor">
            <CardHeader
              title={def.label}
              icon={PenLine}
              subtitle={isOverridden ? 'This venue uses its own version.' : 'This venue uses the PackPerks default.'}
              ruled
              actions={(
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={handleReset} disabled={saving || !isOverridden}>
                  Reset to default
                </Button>
              )}
            />
            <CardBody className="aet-editor__body">
              <div className="aet-when">
                <CalendarClock size={16} aria-hidden="true" />
                <p><strong>When it’s sent.</strong> {def.when}</p>
              </div>

              {def.canDisable ? (
                <div className="aet-toggle">
                  <Switch
                    id="aet-enabled"
                    checked={current.enabled}
                    onChange={(v) => update({ enabled: v })}
                    label={`Send the ${def.label.toLowerCase()} email`}
                  />
                  <label className="aet-toggle__text" htmlFor="aet-enabled">
                    <span className="aet-toggle__state">{current.enabled ? 'Sending' : 'Paused'}</span>
                    <span className="aet-toggle__note">{def.disableNote}</span>
                  </label>
                </div>
              ) : (
                <p className="aet-locked">
                  <Lock size={13} aria-hidden="true" />
                  This email can’t be switched off. Customers need it to log in.
                </p>
              )}

              <Field label="Subject" htmlFor="aet-subject">
                <input
                  id="aet-subject"
                  ref={subjectRef}
                  className="ui-input"
                  value={current.subject}
                  onFocus={() => { lastFocusRef.current = 'subject'; }}
                  onChange={e => update({ subject: e.target.value })}
                />
              </Field>

              <div className="aet-tagbar">
                <span className="aet-micro">Insert a tag where your cursor is</span>
                <div className="aet-tags">
                  {def.tags.map(t => (
                    <button key={t.tag} type="button" className="aet-tag" title={t.desc} onClick={() => insertTag(t.tag)}>
                      {t.tag}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="HTML body" htmlFor="aet-html">
                <textarea
                  id="aet-html"
                  ref={htmlRef}
                  className="ui-textarea aet-code"
                  rows={16}
                  spellCheck={false}
                  value={current.html}
                  onFocus={() => { lastFocusRef.current = 'html'; }}
                  onChange={e => update({ html: e.target.value })}
                />
              </Field>

              {unknownTags.length > 0 && (
                <div className="aet-callout aet-callout--warning" role="status">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <p>
                    Unknown tag{unknownTags.length > 1 ? 's' : ''}: <code>{unknownTags.map(t => `{{${t}}}`).join(', ')}</code>.
                    Customers would see {unknownTags.length > 1 ? 'these' : 'this'} as plain text. Use the tag buttons above for the values this email can fill in.
                  </p>
                </div>
              )}

              <div className="aet-test">
                <Field
                  label="Send yourself a test"
                  htmlFor="aet-test-to"
                  hint="Sends the version on screen, saved or not, filled with sample values. Nothing reaches customers."
                >
                  <div className="aet-test__row">
                    <input
                      id="aet-test-to"
                      className="ui-input"
                      value={testTo}
                      onChange={e => setTestTo(e.target.value)}
                      placeholder="you@example.com"
                    />
                    <Button icon={Send} onClick={handleTest} disabled={testing || !testTo.trim()}>
                      {testing ? 'Sending…' : 'Send test'}
                    </Button>
                  </div>
                </Field>
              </div>
            </CardBody>
          </Card>

          {/* ── Preview ── */}
          <Card className="aet-preview">
            <CardHeader
              title="Preview"
              icon={Eye}
              subtitle="Filled in the same way the real email is, with sample values."
            />
            <CardBody>
              <div className="aet-mail">
                <div className="aet-mail__head">
                  <span className="aet-mail__avatar" aria-hidden="true">P</span>
                  <div className="aet-mail__meta">
                    <span className="aet-mail__from">PackPerks</span>
                    <span className="aet-mail__subject">{previewSubject || <em>No subject</em>}</span>
                  </div>
                </div>
                <iframe
                  className="aet-mail__body"
                  title="Email preview"
                  sandbox=""
                  srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;background:#fff">${previewHtml}</body>`}
                />
              </div>

              <div className="aet-legend">
                <span className="aet-micro">Tags this email can fill in</span>
                <ul>
                  {def.tags.map(t => (
                    <li key={t.tag}><code>{t.tag}</code> <span>{t.desc}</span></li>
                  ))}
                </ul>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
