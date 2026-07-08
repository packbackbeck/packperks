# PackPerks — Data Breach Response Runbook

**Privacy owner:** [FILL: privacy owner name] · **Contact:** info@packback.network · **Last updated:** 2026-07-03

**Last updated:** (to be dated on adoption)
**Owner:** PackPerks Privacy Owner

This runbook governs how PackPerks detects, contains, assesses and reports a personal-data breach. It is written for the specific architecture of this system: a React/Vite SPA on Vercel with no traditional backend, all data in Supabase (Postgres + Auth + Storage + Edge Functions) in the EU region (**eu-west-1**), receipt photos processed transiently by the Anthropic API in the United States, and OTP/magic-link email delivered through Supabase-managed email infrastructure.

PackPerks is the sole **controller**. Any personal-data breach is therefore PackPerks' obligation to assess and report — partner venues are never notified of, and never involved in, an incident, because they only ever receive aggregate statistics via the admin-only dashboard.

Two regulatory clocks can run in parallel:

- **EU / GDPR (primary):** notify the Dutch supervisory authority — **Autoriteit Persoonsgegevens (AP)** — **without undue delay and, where feasible, within 72 hours** of becoming aware of a breach (Art. 33), and notify affected individuals without undue delay where the breach is likely to result in a **high risk** to their rights and freedoms (Art. 34).
- **UAE / PDPL (secondary, for UAE users):** under Federal Decree-Law No. 45 of 2021, notify the **UAE Data Office** upon becoming aware of a breach that would prejudice the privacy, confidentiality or security of the data subject's personal data, and notify affected data subjects where the breach prejudices their privacy or security. PDPL sets no fixed hour-count, so PackPerks applies the GDPR 72-hour discipline as its internal standard for both regimes.

> **Golden rule:** the 72-hour clock starts when PackPerks becomes **reasonably certain** a personal-data breach has occurred — not when the investigation is complete. When in doubt, treat it as a breach, open the incident log, and start the clock. It is always acceptable to make a notification and later confirm it was not required; it is never acceptable to miss the deadline.

---

## 1. Roles & contacts

| Role | Held by | Responsibility in an incident |
|---|---|---|
| **Incident Lead** | **PackPerks Privacy Owner** | Owns the whole response. Declares an incident, sets severity, decides on notification, and is the single point of contact for the AP and the UAE Data Office. All decisions in this runbook default to the Incident Lead. |
| **Technical Responder** | Top admin (the only person able to view full IBANs and run Supabase/Vercel admin actions) | Executes containment: rotates keys, revokes sessions, disables policies/functions, pulls logs. |
| **Deputy Lead** | Named backup for the Privacy Owner | Acts as Incident Lead if the Privacy Owner is unreachable within 2 hours. |
| **Comms** | Privacy Owner (or delegate) | Drafts user notifications and the AP/UAE filings. No partner venue is ever contacted about an incident. |

**Fill in on adoption:**

- Privacy Owner (Incident Lead): __________ — phone: __________ — email: info@packback.network
- Top admin (Technical Responder): __________ — phone: __________
- Deputy Lead: __________ — phone: __________
- Dutch AP breach-notification portal: `https://www.autoriteitpersoonsgegevens.nl` (Meldloket datalekken) — AP file/ref: __________
- UAE Data Office contact/portal: __________
- Supabase support / project ref (eu-west-1): __________
- Vercel account owner / team: __________
- Anthropic API account contact (for the US receipt-processing path): __________

Store this contact block somewhere reachable **without** logging into the systems that might be compromised (e.g. a printed card or a separate password manager). If the breach is of the admin console itself, you must still be able to reach these people.

---

## 2. Detection

A breach may surface through any of the following. Anyone who notices one must contact the Incident Lead immediately.

- **Admin audit log / login history anomalies** — unexpected admin logins, logins from unfamiliar IPs/user agents, or `before/after` changes in the audit log that no admin recognises. These logs capture admin IP + user agent specifically so this detection is possible.
- **IBAN exposure signals** — any access to the restricted payout table outside the Edge Function path, an unexpected IBAN export, or a raw IBAN appearing anywhere it should be masked. The payout table is the single highest-value target in the system.
- **Storage exposure** — a receipt-photo or cup-scan signed URL found circulating, a Storage bucket policy change, or bucket contents reachable without a signed URL.
- **Supabase / RLS signals** — Row-Level Security policy disabled or altered, a service-role key appearing in client code or logs, or an Edge Function behaving unexpectedly.
- **Auth abuse** — spikes in magic-link/OTP requests, credential-stuffing patterns, or reports of account takeover via the email-change flow.
- **Third-party notification** — a report from Supabase, Vercel, Anthropic, a security researcher, or a user ("I can see someone else's data / IBAN / receipts").
- **Leaked secret** — a Supabase key, service-role token, or admin credential found in a public repo, a Vercel build log, or client bundle.

On any credible signal, **open the incident log (Section 8) immediately** and record the timestamp of first awareness. That timestamp anchors the 72-hour clock.

---

## 3. Severity triage

Assign a severity within the first hour. Re-assess as facts change.

| Severity | Definition for PackPerks | Examples |
|---|---|---|
| **SEV-1 (Critical)** | Confirmed exposure of high-risk personal data, or full admin/service-role compromise. Almost certainly notifiable; likely a high-risk breach requiring user notification. | Raw IBANs exposed/exfiltrated; the restricted payout table read outside Edge Functions; service-role key compromised; top-admin account taken over; the audit-log integrity itself is in doubt. |
| **SEV-2 (High)** | Exposure of identifiable personal data below the IBAN tier, or a scoped compromise. Likely AP-notifiable; user notification depends on risk. | Receipt/cup-scan images exposed via leaked signed URLs; email addresses + activity history exposed; a single non-top admin account compromised; RLS misconfiguration exposing one table cross-user. |
| **SEV-3 (Moderate)** | Limited or uncertain exposure of lower-risk data; contained quickly; low likelihood of harm. | Non-essential `client_events` analytics exposed; coarse device labels/`device_id` exposure; a near-miss caught before data left the system. |
| **SEV-4 (Low / near-miss)** | No personal data left PackPerks' control; a vulnerability found and closed. | A misconfiguration fixed before exploitation; a scanning attempt blocked by rate-limiting. |

**Data-tier reference (highest sensitivity first):** raw IBAN → email + IBAN-last-4 + IBAN links → receipt/cup-scan images → activity/transaction history + AI verdicts → optional email alone / display name → coarse device label + `device_id` → non-essential `client_events` analytics.

SEV-1 and SEV-2 start the formal notification decision tree (Section 6) immediately. SEV-3/SEV-4 are logged and reviewed but usually do not require notification — record the reasoning either way.

---

## 4. Containment

Contain **before** completing the full assessment — stopping the bleeding does not wait for the paperwork. Log every action with a timestamp (Section 8). Choose the steps that fit the incident; for SEV-1 assume you need most of them.

### 4.1 Rotate Supabase keys

- Rotate the **service-role key** and the **anon/public key** in the Supabase dashboard (project settings → API). The service-role key bypasses RLS and is the crown-jewel secret — rotate it first on any suspected key leak or admin compromise.
- Update the rotated keys in **Vercel environment variables** and in each **Edge Function** secret store, then redeploy so nothing runs on a compromised key.
- Rotate the **JWT secret** if session-token forgery or Auth compromise is suspected (note: this invalidates all existing sessions — coordinate with 4.2).
- Rotate any third-party secrets that transited the compromised surface, including the **Anthropic API key** used for receipt verification.

### 4.2 Revoke sessions

- Force **global sign-out** in Supabase Auth to revoke all refresh tokens / active sessions, then require users to re-authenticate via magic link/OTP.
- If a specific account is compromised (e.g. via the email-change flow), revoke that user's sessions individually and freeze the email-change and IBAN-edit capabilities on that account.
- Revoke and reset **admin sessions** and admin credentials; force admin re-login. If the top-admin account is implicated, rotate its credentials first.

### 4.3 Disable affected policies / functions / access paths

- **Disable or tighten the affected RLS policies** on the implicated Postgres table(s). If a policy is exposing data cross-user, restrict it (deny-all) rather than leaving it permissive while you investigate.
- **Disable the implicated Edge Function(s)** — in particular the IBAN export/payout-confirmation function and any function touching the restricted payout table — until the path is proven safe.
- **Invalidate / expire signed URLs** for Storage if receipt or cup-scan images are implicated; shorten signed-URL TTLs and, if needed, rotate the Storage signing key so outstanding URLs stop resolving.
- **Lock down the payout table** — if IBAN exposure is even suspected, cut off all access except the Edge Function path and confirm no export is in flight.
- **Tighten Vercel** — if the deployed frontend is serving a compromised bundle or a leaked secret, roll back to a known-good deployment and/or take the affected deployment offline.
- Engage **rate-limiting / fraud controls** more aggressively if the vector is Auth abuse or scraping.

### 4.4 Preserve before you purge

Do **not** run normal deletion jobs or overwrite logs on affected data while investigating. Preserve the admin audit log, admin login history, Supabase logs, Vercel logs, and any relevant Edge Function logs. Apply a **legal hold** so the retention sweeps (which would otherwise purge audit/login logs at 12 months and images at 90 days) do not destroy evidence. See Section 7.

---

## 5. Assessment

Once contained, establish the facts needed for the notification decision and the filings:

1. **What happened** — the vector and root cause (leaked key, RLS misconfig, admin compromise, leaked signed URL, third-party issue, etc.).
2. **Which data categories** — map to the tiers in Section 3. Be specific: raw IBAN vs IBAN-last-4; receipt images vs AI-extracted fields; email vs display name; essential `device_id` vs non-essential `client_events`.
3. **Volume and identifiability** — how many data subjects and records; whether individuals are directly identifiable. Note that PackPerks customers are anonymous by default, which can lower re-identification risk for some categories but not for records tied to an email or IBAN.
4. **Which residency populations** — EU/Netherlands users, UAE users, or both. This determines whether the UAE Data Office path (Section 6) is triggered alongside the AP.
5. **Nature of the exposure** — confidentiality (read/exfiltrated), integrity (altered — e.g. tampered balances/claims), or availability (lost/inaccessible).
6. **Likely consequences** — for IBAN/email that means financial fraud, misdirected cashback, phishing, or account takeover risk. For receipt images it means exposure of purchase details.
7. **Does the US processing path matter** — was any receipt image implicated while transiting the Anthropic API? Note that the standard Anthropic API is zero-retention (inputs are not used for training and are not retained beyond the request), so an Anthropic-side exposure window is narrow, but the transfer path (EU–US, covered by DPA + DPF/SCC) must still be assessed.

Record conclusions in the incident log. This assessment feeds directly into the risk judgement in Section 6.

---

## 6. Notification decision tree

Work the branches below in order. Document the answer and reasoning for every branch, even a "no".

### 6.1 Is it a personal-data breach at all?

- **No** (e.g. a near-miss with no personal data leaving PackPerks' control, or only fully anonymised/aggregate data) → log as SEV-3/SEV-4, no external notification. Record the reasoning. **Stop.**
- **Yes / uncertain** → continue. Uncertainty resolves toward "yes".

### 6.2 GDPR — notify the Dutch AP? (Art. 33)

- Notify the **AP within 72 hours** of awareness **unless** the breach is **unlikely to result in a risk** to individuals' rights and freedoms.
- For PackPerks, any exposure of **IBAN, email, receipt/cup-scan images, or activity history** is presumed a **risk** → **notify the AP**.
- If the 72-hour deadline will be missed, file anyway **without further delay** and include the reasons for the delay (permitted under Art. 33(1)).
- If facts are incomplete at 72 hours, make a **phased notification** — file what is known, mark it preliminary, and follow up.
- **File via:** AP Meldloket datalekken (contact block, Section 1). Capture the AP reference number in the log.

### 6.3 GDPR — notify affected users? (Art. 34)

- Notify individuals **without undue delay** if the breach is likely to result in a **high risk** to their rights and freedoms.
- For PackPerks this is presumed for **raw IBAN exposure** and for **account-takeover-enabling exposures** (email + session/credential compromise). **Notify affected users.**
- Notification reaches users via their **optional email** where held, and via a prominent **in-app notice** for anonymous/device-linked users who have no email on file.
- User notice must, in plain language: describe the breach, name the Privacy Owner as contact, state likely consequences, and give concrete steps (e.g. watch bank statements for IBAN exposure, re-authenticate, be alert to phishing).
- **Art. 34(3) exemptions** (may avoid individual notice): affected data was rendered unintelligible (e.g. strong encryption/the IBAN was already deleted/masked), subsequent measures ensure the high risk is no longer likely, or individual notice involves disproportionate effort (then use a public communication). Document which exemption applies, if any.

### 6.4 UAE PDPL — is any UAE user affected?

- **No UAE users implicated** → GDPR path only.
- **UAE users implicated** → run the UAE branch **in parallel**:
  - **Notify the UAE Data Office** upon becoming aware of a breach that would prejudice the privacy, confidentiality or security of the personal data. Apply the same 72-hour internal discipline.
  - The filing should include the nature of the breach, its cause, the approximate number of records/data subjects, the likely impact, and the measures taken.
  - **Notify affected UAE data subjects** where the breach prejudices their privacy or security (parallel to the Art. 34 test above).
  - File via the UAE Data Office contact/portal (Section 1); capture the reference in the log.

### 6.5 Notification summary

| Trigger (PackPerks-specific) | AP (72h) | Affected users | UAE Data Office | UAE users |
|---|---|---|---|---|
| Raw IBAN exposed/exfiltrated | Yes | Yes (high risk) | Yes if UAE users | Yes if UAE users |
| Email + session/credential compromise (takeover) | Yes | Yes (high risk) | Yes if UAE users | Yes if UAE users |
| Receipt / cup-scan images exposed | Yes | Assess (often yes) | Yes if UAE users | Assess |
| Activity history / AI verdicts exposed | Yes | Assess | Yes if UAE users | Assess |
| Coarse device label / `device_id` only | Assess (often low risk) | Usually no | Assess | Usually no |
| Non-essential `client_events` analytics only | Assess (often low risk) | Usually no | Assess | Usually no |
| Near-miss, no data left control | No | No | No | No |

---

## 7. Evidence & timeline logging

- **Start logging at first awareness.** Every action — detection, containment step, decision, notification — gets a UTC timestamp and the actor's name in the incident log (Section 8).
- **Apply a legal hold** the moment an incident is declared: flag the relevant admin audit logs and admin login history so the 12-month retention purge skips them, and suspend the 90-day image-deletion and 24-month inactivity sweeps for affected records. The retention schedule already supports "extended only for the duration of an active investigation" for logs — invoke it here explicitly.
- **Snapshot the evidence** rather than working on live data: export the relevant audit-log rows, login history, Supabase/Edge Function logs, Vercel logs, and (if relevant) the state of the payout table and Storage bucket policies. Store snapshots in a restricted location, access-controlled and itself logged.
- **Chain of custody:** record who accessed which evidence and when. The admin audit log (before/after state, admin IP + user agent) is itself primary evidence — do not edit it.
- **Preserve, don't remediate over the top of, the root cause** until it has been captured, unless leaving it live prolongs the exposure (containment always wins).

---

## 8. Incident log template

Copy this block per incident and fill every field. This is the record the AP and the UAE Data Office will expect, and the artefact reviewed in Section 9.

```
INCIDENT ID:            PP-YYYY-NNN
Severity:               SEV-_
Status:                 [Open / Contained / Assessed / Notified / Closed]
Incident Lead:          PackPerks Privacy Owner (name: ____________)
Technical Responder:    ____________

FIRST AWARENESS (UTC):  YYYY-MM-DD HH:MM   <-- starts the 72h clock
72h DEADLINE (UTC):     YYYY-MM-DD HH:MM
Detected via:           [audit log / IBAN signal / storage / RLS / auth abuse / 3rd party / leaked secret / other]
Reported by:            ____________

WHAT HAPPENED / VECTOR: ____________________________________________
ROOT CAUSE:             ____________________________________________
DATA CATEGORIES:        [raw IBAN / IBAN-last-4 / email / display name / receipt img / cup-scan img /
                         activity history / AI verdict+fields / device_id / device label / client_events]
RECORDS AFFECTED:       ~______        DATA SUBJECTS AFFECTED: ~______
POPULATIONS:            [EU/NL ___]  [UAE ___]
EXPOSURE TYPE:          [confidentiality / integrity / availability]
US PATH IMPLICATED?:    [yes/no — Anthropic receipt processing]
LIKELY CONSEQUENCES:    ____________________________________________
```

**Action timeline** (append rows as the incident unfolds):

| Time (UTC) | Actor | Action / Decision | Evidence ref |
|---|---|---|---|
| | | Incident declared, log opened | |
| | | Severity assigned | |
| | | Keys rotated (service-role / anon / JWT / Anthropic) | |
| | | Sessions revoked | |
| | | RLS policies / Edge Functions / signed URLs disabled | |
| | | Payout table locked down | |
| | | Legal hold applied to logs/images | |
| | | Assessment completed | |
| | | AP notification decision + reasoning | |
| | | AP filed (ref: _____) | |
| | | User notification decision + reasoning | |
| | | Users notified (email / in-app) | |
| | | UAE Data Office decision + filing (ref: _____) | |
| | | Root cause remediated | |
| | | Incident closed | |

**Notification record:**

| Regulator / party | Notified? | Date/time (UTC) | Within 72h? | Reference | Notes / reason if not notified |
|---|---|---|---|---|---|
| Dutch AP | | | | | |
| Affected users (EU) | | | | | |
| UAE Data Office | | | | | |
| Affected users (UAE) | | | | | |

---

## 9. Post-incident review

Hold a review within **10 working days** of closing the incident, chaired by the Privacy Owner.

- **Timeline reconstruction** — walk the incident log end to end; confirm the 72-hour clock was honoured and every decision reasoned.
- **Root-cause analysis** — was it a leaked secret, an RLS misconfiguration, an admin-account weakness, a leaked signed URL, or a third-party issue? Fix the underlying cause, not just the symptom.
- **Control improvements** — concrete, PackPerks-specific follow-ups, e.g.: tighten RLS on the implicated table and add a cross-user access test; add alerting on any read of the restricted payout table outside the Edge Function path; shorten Storage signed-URL TTLs; add anomaly alerting on the admin login history; enforce key rotation cadence; add MFA/hardening to the top-admin account.
- **DPA / transfer check** — if the Anthropic US path was implicated, confirm the DPA and EU–US DPF/SCC coverage is in place and current (this is an open action item for PackPerks and should be closed out).
- **Documentation** — file the completed incident log and the AP/UAE references in the breach register (maintained even for incidents not externally notified, per GDPR Art. 33(5)).
- **Runbook feedback** — update this runbook and the contact block for anything that was unclear, missing, or wrong during the response.
- **Owner sign-off** — the Privacy Owner records lessons learned and assigns each follow-up an owner and a due date.
