import { useState } from 'react';
import './AdminTopBar.css';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function AdminTopBar({ draftState, onPreview }) {
  const { isDirty, lastSaved, published, statusLabel, saveDraft, publishDraft, publishNote, setPublishNote, publishError, clearPublishError } = draftState;
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [localNote, setLocalNote] = useState('');

  function handlePublish() {
    publishDraft(localNote);
    setLocalNote('');
    setPublishModalOpen(false);
  }

  const statusClass = isDirty ? 'dirty' : published ? 'published' : 'saved';

  return (
    <>
      {publishError && (
        <div className="admin-publish-error-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span><strong>Publish failed:</strong> {publishError}</span>
          <span className="admin-publish-error-bar__sql" onClick={() => {
            navigator.clipboard?.writeText(`-- Run this in Supabase SQL Editor:\ncreate table if not exists app_config (\n  key text primary key,\n  value jsonb not null,\n  updated_at timestamptz default now()\n);\nalter table app_config enable row level security;\ncreate policy "public_read"   on app_config for select using (true);\ncreate policy "public_insert" on app_config for insert with check (true);\ncreate policy "public_update" on app_config for update using (true);\n\n-- Allow claim status updates:\ncreate policy "admin_update_claims" on claims for update using (true);\n\n-- Fix claims status constraint (allows completed + failed):\nalter table claims drop constraint if exists claims_status_check;\nalter table claims add constraint claims_status_check\n  check (status in ('pending', 'completed', 'failed'));\n`);
          }}>📋 Copy fix SQL</span>
          <button className="admin-publish-error-bar__close" onClick={clearPublishError}>×</button>
        </div>
      )}
      <header className="admin-topbar">
        <div className="admin-topbar__left">
          <div className="admin-topbar__logo">
            <span className="admin-topbar__logo-bk">BK</span>
            <div className="admin-topbar__logo-text">
              <span className="admin-topbar__logo-title">PackPerks</span>
              <span className="admin-topbar__logo-sub">Admin Console</span>
            </div>
          </div>
        </div>

        <div className="admin-topbar__center">
          <div className={`admin-topbar__status admin-topbar__status--${statusClass}`}>
            <span className="admin-topbar__status-dot" />
            <span className="admin-topbar__status-label">{statusLabel}</span>
            {lastSaved && (
              <span className="admin-topbar__status-time">· {timeAgo(lastSaved)}</span>
            )}
          </div>
        </div>

        <div className="admin-topbar__right">
          <button className="admin-topbar__btn admin-topbar__btn--ghost" onClick={onPreview}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Preview
          </button>
          <button
            className="admin-topbar__btn admin-topbar__btn--secondary"
            onClick={saveDraft}
            disabled={!isDirty}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save
          </button>
          <button
            className="admin-topbar__btn admin-topbar__btn--primary"
            onClick={() => setPublishModalOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 2 11 13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Publish
          </button>
        </div>
      </header>

      {publishModalOpen && (
        <div className="admin-publish-overlay" onClick={() => setPublishModalOpen(false)}>
          <div className="admin-publish-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-publish-modal__header">
              <div className="admin-publish-modal__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 2 11 13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
              <div>
                <h3 className="admin-publish-modal__title">Publish to live</h3>
                <p className="admin-publish-modal__sub">This pushes all changes to the user-facing app immediately.</p>
              </div>
            </div>
            <label className="admin-publish-modal__label">Change summary (optional)</label>
            <input
              className="admin-publish-modal__input"
              placeholder="e.g. Added new reward, updated cashback rate…"
              value={localNote}
              onChange={e => setLocalNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePublish()}
              autoFocus
            />
            <div className="admin-publish-modal__actions">
              <button className="admin-publish-modal__cancel" onClick={() => setPublishModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-publish-modal__confirm" onClick={handlePublish}>
                Publish now →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
