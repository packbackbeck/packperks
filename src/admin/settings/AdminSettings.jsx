import { useState } from 'react';
import './AdminSettings.css';

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-switch__thumb" />
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="as-field">
      <div className="as-field__label-wrap">
        <label className="as-field__label">{label}</label>
        {hint && <span className="as-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function AdminSettings({ draftState }) {
  const { draft, updateDraft } = draftState;
  const settings = draft.settings;

  function updateSetting(key, value) {
    updateDraft(prev => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
  }

  const sections = [
    {
      id: 'rates',
      title: 'Payout Rates',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
        </svg>
      ),
    },
    {
      id: 'copy',
      title: 'App Copy',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      ),
    },
    {
      id: 'rules',
      title: 'Cup Rules',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8h1a4 4 0 010 8h-1"/>
          <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
          <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
        </svg>
      ),
    },
    {
      id: 'features',
      title: 'Feature Flags',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      ),
    },
    {
      id: 'legal',
      title: 'Legal Links',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      ),
    },
  ];

  const [activeSection, setActiveSection] = useState('rates');

  return (
    <div className="admin-settings">
      <div className="as-header">
        <h1 className="as-header__title">Settings</h1>
        <p className="as-header__sub">Platform configuration — changes require a Publish to go live</p>
      </div>

      <div className="as-layout">
        {/* Section nav */}
        <nav className="as-nav">
          {sections.map(s => (
            <button
              key={s.id}
              className={`as-nav-btn ${activeSection === s.id ? 'as-nav-btn--active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              <span className="as-nav-btn__icon">{s.icon}</span>
              {s.title}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="as-content">

          {activeSection === 'rates' && (
            <div className="as-section">
              <div className="as-section__title">Payout Rates</div>
              <div className="as-section__desc">These rates determine how much users earn per cup returned.</div>

              <Field label="Cashback rate (€ per cup)" hint="Applied when user claims a food reward">
                <div className="as-input-prefix-wrap">
                  <span className="as-input-prefix">€</span>
                  <input
                    className="as-input as-input--prefix"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={settings.cashbackRatePerCup}
                    onChange={e => updateSetting('cashbackRatePerCup', parseFloat(e.target.value) || 0)}
                  />
                  <span className="as-input-suffix">per cup</span>
                </div>
              </Field>

              <Field label="Direct refund rate (€ per cup)" hint="Applied when user requests cash refund instead of a reward">
                <div className="as-input-prefix-wrap">
                  <span className="as-input-prefix">€</span>
                  <input
                    className="as-input as-input--prefix"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={settings.refundRatePerCup}
                    onChange={e => updateSetting('refundRatePerCup', parseFloat(e.target.value) || 0)}
                  />
                  <span className="as-input-suffix">per cup</span>
                </div>
              </Field>

              <div className="as-rate-preview">
                <div className="as-rate-preview__title">Rate preview</div>
                <div className="as-rate-preview__row">
                  <span>3 cups cashback</span>
                  <span className="as-rate-preview__val">€{(settings.cashbackRatePerCup * 3).toFixed(2)}</span>
                </div>
                <div className="as-rate-preview__row">
                  <span>6 cups cashback</span>
                  <span className="as-rate-preview__val">€{(settings.cashbackRatePerCup * 6).toFixed(2)}</span>
                </div>
                <div className="as-rate-preview__row as-rate-preview__row--muted">
                  <span>3 cups direct refund</span>
                  <span>€{(settings.refundRatePerCup * 3).toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'copy' && (
            <div className="as-section">
              <div className="as-section__title">App Copy</div>
              <div className="as-section__desc">Text displayed to users in the app. Changes go live on next Publish.</div>

              <Field label="Hero headline">
                <input className="as-input" value={settings.heroHeadline} onChange={e => updateSetting('heroHeadline', e.target.value)} placeholder="Collect Cups & Get Rewards" />
              </Field>

              <Field label="Hero subtext">
                <textarea className="as-textarea" rows={2} value={settings.heroSubtext} onChange={e => updateSetting('heroSubtext', e.target.value)} />
              </Field>

              <Field label="Donation recipient name">
                <input className="as-input" value={settings.donationRecipient} onChange={e => updateSetting('donationRecipient', e.target.value)} placeholder="Plastic Soup Foundation" />
              </Field>

              <Field label="Donation description">
                <textarea className="as-textarea" rows={2} value={settings.donationDescription} onChange={e => updateSetting('donationDescription', e.target.value)} />
              </Field>
            </div>
          )}

          {activeSection === 'rules' && (
            <div className="as-section">
              <div className="as-section__title">Cup Rules</div>
              <div className="as-section__desc">Controls around how cups are earned and shared.</div>

              <Field label="Cups awarded per scan" hint="How many cups a successful scan adds">
                <input className="as-input as-input--short" type="number" min="1" max="10" value={settings.maxCupsPerScan} onChange={e => updateSetting('maxCupsPerScan', parseInt(e.target.value) || 1)} />
              </Field>

              <Field label="Max cups shareable via QR">
                <input className="as-input as-input--short" type="number" min="1" max="50" value={settings.maxCupsToShare} onChange={e => updateSetting('maxCupsToShare', parseInt(e.target.value) || 1)} />
              </Field>

              <Field label="Minimum IBAN length (characters)">
                <input className="as-input as-input--short" type="number" min="10" max="34" value={settings.minIbanLength} onChange={e => updateSetting('minIbanLength', parseInt(e.target.value) || 15)} />
              </Field>
            </div>
          )}

          {activeSection === 'features' && (
            <div className="as-section">
              <div className="as-section__title">Feature Flags</div>
              <div className="as-section__desc">Toggle features on or off for all users.</div>

              {[
                { key: 'featureCupSharing',    label: 'Cup Sharing',    desc: 'Allow users to share cups via QR code' },
                { key: 'featureDonations',     label: 'Donations',      desc: 'Allow users to donate cups to charity' },
                { key: 'featureDirectRefunds', label: 'Direct Refunds', desc: 'Allow users to withdraw cups as cash at the lower rate' },
              ].map(f => (
                <div key={f.key} className="as-feature-row">
                  <div className="as-feature-row__info">
                    <div className="as-feature-row__label">{f.label}</div>
                    <div className="as-feature-row__desc">{f.desc}</div>
                  </div>
                  <ToggleSwitch checked={settings[f.key]} onChange={v => updateSetting(f.key, v)} />
                </div>
              ))}

              <div className="as-maintenance-block">
                <div className="as-maintenance-block__header">
                  <div>
                    <div className="as-maintenance-block__label">Maintenance Mode</div>
                    <div className="as-maintenance-block__desc">Shows a banner to all users that the app is temporarily unavailable.</div>
                  </div>
                  <ToggleSwitch checked={settings.maintenanceMode} onChange={v => updateSetting('maintenanceMode', v)} />
                </div>
                {settings.maintenanceMode && (
                  <div className="as-maintenance-block__warning">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    Maintenance mode is ON — users cannot currently access the rewards app.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'legal' && (
            <div className="as-section">
              <div className="as-section__title">Legal Links</div>
              <div className="as-section__desc">URLs shown in the app footer.</div>

              <Field label="Privacy Policy URL">
                <input className="as-input as-input--mono" value={settings.privacyUrl} onChange={e => updateSetting('privacyUrl', e.target.value)} placeholder="https://packperks.nl/privacy" />
              </Field>

              <Field label="Terms of Service URL">
                <input className="as-input as-input--mono" value={settings.termsUrl} onChange={e => updateSetting('termsUrl', e.target.value)} placeholder="https://packperks.nl/terms" />
              </Field>

              <Field label="Cookie Policy URL">
                <input className="as-input as-input--mono" value={settings.cookieUrl} onChange={e => updateSetting('cookieUrl', e.target.value)} placeholder="https://packperks.nl/cookies" />
              </Field>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
