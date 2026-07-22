# PackPerks BYO — Screen Flow

Screenshots of **every customer-facing screen state** in the Bring-Your-Own-Cup app, captured at 375×812 (2× / retina) from the live dev build via the `?__shot=<name>` audit harness (`src/lib/shotPresets.js`) plus a few interaction-driven captures.

- **`_flowchart.png`** — the whole set arranged into the user journey with labelled connectors.
- **`_flow.html`** — editable source of the flowchart (open locally; references the PNGs by name).
- Store/market pages (`home-*`, `stores-list`, `user-*`) are captured **full-height** so every reward is visible; the flowchart crops them for scannability.
- Each `<name>.png` matches its screen name, so re-running the capture overwrites in place.

Regenerate (dev server on `localhost:5173` must be running):

```
node docs/byo-screens/capture-screens.cjs   # 28 shot-preset screens (full-height store pages)
node docs/byo-screens/capture-extra.cjs      # interaction-driven: map, story-guide steps, edit-profile, onboarding
node docs/byo-screens/capture-consent.cjs    # cookie consent: main / customize / reject (blocked)
node docs/byo-screens/capture-emails.cjs     # 6 Supabase Auth templates + the cashback-ready email
node docs/byo-screens/render-flow.cjs        # compose _flowchart.png from _flow.html
```

Uses the bundled `puppeteer-core` driving system Google Chrome, with `prefers-reduced-motion` emulated so entrance animations don't cut text off mid-fade.

## Screens by journey lane

| Lane | File | Screen |
|---|---|---|
| 0 · Onboarding | `onboarding-1` | Value prop |
| 0 · Onboarding | `onboarding-2` | How you earn it (story guide) |
| 0 · Onboarding | `onboarding-3` | Personalise (drinks / region) |
| 0 · Onboarding | `onboarding-4` | Building your café list |
| 1 · Discover | `stores-list` | Stores hub — list |
| 1 · Discover | `stores-map` | Stores hub — map (pins) |
| 1 · Discover | `home-empty` | Venue home — 0 cups |
| 2 · Collect cups | `cup-scan` | Scan counter QR |
| 2 · Collect cups | `cup-scan-success` | Cup added ✓ |
| 2 · Collect cups | `byo-popup` | Daily cup limit |
| 3 · Venue home | `home-partial` | Collecting |
| 3 · Venue home | `home-full` | Reward ready |
| 3 · Venue home | `home-member` | Member |
| 3 · Story guide | `how-it-works-1` | Bring your cup |
| 3 · Story guide | `how-it-works-2` | Collect cups |
| 3 · Story guide | `how-it-works-3` | Get cashback |
| 3 · Overlays | `reward-detail` | Reward detail sheet |
| 3 · Overlays | `terms` | Cashback terms |
| 3 · Overlays | `budget-paused` | Rewards paused |
| 3 · Overlays | `inapp-prompt` | In-app browser prompt |
| 4 · Claim | `receipt-rules` | Receipt rules |
| 4 · Claim | `receipt-camera` | Receipt camera |
| 4 · Claim | `verifying` | Verifying receipt |
| 4 · Claim | `success` | Submitted ✓ |
| 4 · Claim | `rejected` | Receipt rejected |
| 5 · Account | `user-visitor` | Account — visitor |
| 5 · Account | `user-member` | Account — member |
| 5 · Account | `edit-profile` | Edit profile (name / region / prefs) |
| 5 · Account | `user-combined` | Account — all stores |
| 6 · Sign in | `signin-idle` | Sign in |
| 6 · Sign in | `signin-sent` | Code sent |
| 6 · Sign in | `signin-signedin` | Signed in |
| 6 · Sign in | `signin-change` | Change email |
| 6 · Sign in | `signin-merge` | Merge accounts |
| 7 · System | `loading` | Loading / boot |
| 7 · System | `error` | Error |
| 7 · System | `maintenance` | Maintenance (notify-me) |
| 7 · Consent | `consent-main` | Cookie choice (Accept all / Essential / Customize) |
| 7 · Consent | `consent-customize` | Granular toggles |
| 7 · Consent | `consent-reject` | Blocked (essential cookies needed) |
| 8 · Emails | `email-confirm-signup` | Confirm signup |
| 8 · Emails | `email-magic-link` | Magic link / verification code |
| 8 · Emails | `email-cashback-ready` | Cashback ready to collect |
| 8 · Emails | `email-change-email` | Change email |
| 8 · Emails | `email-reset-password` | Reset password |
| 8 · Emails | `email-reauthentication` | Reauthentication |
| 8 · Emails | `email-invite` | Admin invite |

37 app screens + 3 consent + 7 emails.

**Not included (by design):** `cup-scan-error` ("cups already scanned") — doesn't apply to BYO; and `success-noemail` — claiming requires an email, so a no-email submission can't happen.
