# PackPerks — UAE PDPL Cross-Border Transfer & Notice

**Privacy owner:** [FILL: privacy owner name] · **Contact:** [FILL: privacy contact email] · **Last updated:** 2026-07-03

**Last updated: (to be dated on adoption)**
**Owner: PackPerks Privacy Owner**

**Scope:** This document covers PackPerks' handling of personal data belonging to **UAE-based users** under the UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (the **UAE PDPL**) and its Executive Regulations. It focuses on the one area where PackPerks routinely moves UAE user data across borders: **storage in the EU (Supabase, eu-west-1)** and the **transfer of receipt images to the United States (Anthropic/Claude)** for AI verification.

PackPerks' primary market is the Netherlands, and the app is GDPR-first. This document exists so that when a UAE user uses PackPerks, we can point to a concrete, honest account of where their data goes and on what basis. It is deliberately practical for a four-person startup — it does not pretend to be a large-enterprise transfer-impact assessment.

For the full data inventory, retention periods and lawful-basis analysis, see the companion documents in this folder: `PRIVACY_POLICY.md`, `RETENTION_SCHEDULE.md`, `LAWFUL_BASIS.md` and `DPIA_LITE.md`. This document does not restate them; it addresses only the cross-border and UAE-notice dimensions.

---

## 1. Why this is a cross-border transfer under the PDPL

PackPerks does not host any data inside the UAE. For a UAE user, personal data leaves the UAE in two ways from the moment they use the app:

1. **Primary storage in the EU.** All PackPerks data lives in **Supabase, EU region `eu-west-1`** (Postgres, Auth, Storage, Edge Functions). This includes the UAE user's cup balances, activity history, reward claims, optional email, IBAN, and their receipt and cup-scan images in private Storage. So a UAE user's data is **stored in the EU (Ireland), not the UAE** — a cross-border transfer in itself.

2. **Onward transfer of receipt images to the US.** When a UAE user submits a receipt, the **receipt photo** and the AI-extracted fields (receipt date/time, receipt ID, total, decision reason) are processed by the **Anthropic Claude API in the United States** for automated verification. PackPerks uses the **standard Anthropic API**: inputs are **not used for model training** and are **not retained beyond the request** (zero-retention default). This is a second, onward cross-border transfer (EU/UAE → US).

Under Articles 22–23 of the PDPL, transferring the personal data of UAE data subjects **outside the UAE** requires a lawful transfer basis. Both of the flows above are in scope. Nothing about PackPerks' architecture is UAE-resident, so **every UAE user necessarily triggers a cross-border transfer** — this is not an edge case, it is the default path.

### 1.1 What is *not* transferred where partners can see it

Consistent with our controller decisions elsewhere: **partner stores never receive UAE user-level data.** Partners see only **aggregate statistics** via the admin-only dashboard — never emails, IBANs, receipts, activity histories or behavioural profiles. So the cross-border question is strictly about PackPerks' own processors (Supabase EU, Anthropic US), not about partners.

---

## 2. Transfer basis under Articles 22–23 PDPL

The PDPL permits transfers outside the UAE on one of three broad footings: (a) an **adequate-jurisdiction** determination by the UAE Data Office; (b) appropriate **contractual safeguards** where no adequacy exists; or (c) specific **derogations**, including the **explicit consent** of the data subject. PackPerks relies on a layered position rather than a single basis:

### 2.1 Adequacy — relied on where available, not assumed

The PDPL allows transfers to jurisdictions the UAE Data Office recognises as providing an **adequate level of protection**. The **EU/EEA is a strong candidate** for adequacy given its GDPR regime, and PackPerks' EU storage (Supabase `eu-west-1`) is designed to benefit from this where the UAE Data Office recognises it.

**Action / TO BE CONFIRMED:** PackPerks must check the **current UAE Data Office adequacy list** at adoption and record whether the EU/EEA (and the US, or the specific US transfer mechanism) is listed. Adequacy is **not assumed** for the US leg. Where adequacy is confirmed, it is our primary basis for that leg; where it is not, we fall back to safeguards and/or consent below.

### 2.2 Appropriate safeguards — the primary basis for the US (Anthropic) leg

Because US adequacy cannot be assumed, PackPerks relies on **appropriate contractual safeguards** for the transfer of receipt images to Anthropic in the US:

- A **Data Processing Agreement (DPA)** with Anthropic binding it as processor, including the **zero-retention / no-training** commitment already in effect on the standard API.
- Transfer clauses appropriate to the flow. PackPerks already treats the **EU–US Data Privacy Framework (DPF) and/or EU Standard Contractual Clauses (SCCs)** as the mechanism for the same US transfer under GDPR; the **same executed instruments are used to evidence "appropriate safeguards" for the PDPL leg**, supplemented by PDPL-specific wording where a DPF/SCC package alone is not sufficient for UAE purposes.

**Action / TO BE CONFIRMED:**
- Execute (or confirm on file) the **Anthropic DPA + DPF/SCC package**. This is the same open action tracked for GDPR — it discharges both regimes.
- Confirm with **Supabase** that its EU-region DPA and sub-processor terms are on file and cover UAE-origin data at rest in `eu-west-1`.

### 2.3 Explicit consent — the safety-net derogation

Where neither adequacy nor safeguards fully cover a leg at the time of processing, PackPerks relies on the **explicit consent** derogation. For a UAE user this is practical and honest: **a UAE user cannot use PackPerks at all without their data going to the EU, and cannot get a receipt verified without it going to the US.** The UAE notice in Section 3 makes both destinations explicit **before** the user proceeds, so that consent — where relied on — is **informed and specific** to these transfers, not buried.

Consent is a fallback, not a substitute for doing the safeguards work in §2.2. We do not treat "the user tapped Accept" as a reason to skip the DPA/SCC actions.

### 2.4 Basis summary

| Transfer leg | Destination | Data | Primary basis | Fallback |
|---|---|---|---|---|
| Primary storage | Supabase EU (`eu-west-1`) | All PackPerks data for the user | Adequacy (EU), if confirmed | Safeguards (Supabase DPA) + notice/consent |
| Receipt AI verification | Anthropic US (Claude API) | Receipt image + extracted fields | Appropriate safeguards (DPA + DPF/SCC) | Explicit consent via UAE notice |

---

## 3. Notice wording for UAE users

The following notice is the **UAE-specific cross-border disclosure**. It should be surfaced to a UAE user (a) within the privacy notice and (b) at the point of first use / first receipt submission, so the transfer is disclosed **before** it happens. It is written in plain British English to match our privacy policy.

> **Where your data goes (notice for users in the UAE)**
>
> PackPerks does not store your data inside the UAE. To use PackPerks, your personal data is transferred outside the UAE:
>
> - **Stored in the European Union.** Your account, cup balances, reward claims, and any receipt or cup-scan photos are stored securely with our data provider **Supabase in the EU (Ireland region, `eu-west-1`)**. The EU has strong data-protection laws (the GDPR).
> - **Receipt checks happen in the United States.** When you submit a receipt, the photo and the details read from it are sent to **Anthropic (the Claude AI service) in the United States** to check your reward automatically. Anthropic **does not** use your receipt to train its AI and **does not** keep it after the check is done.
> - **Your bank details.** If you add an **IBAN** for cashback, it is held in a restricted payout store in the EU, shown only in masked form except to our top administrator for the payout, and the full IBAN is **deleted** once your payout is confirmed. See our Privacy Policy for the full detail.
>
> We rely on the EU's data-protection standards, on written data-processing agreements with our providers, and — where needed — on **your consent** to these transfers. If you do not agree to your data being transferred outside the UAE in this way, you will not be able to use PackPerks, because the app cannot run without them.
>
> You can exercise your rights (see below) or ask us anything about these transfers at **privacy@packperks**.
> **Owner:** PackPerks Privacy Owner.

**Implementation note:** PackPerks does not currently geolocate users, so the simplest compliant approach is to make this UAE-facing wording **part of the standard privacy notice shown to everyone**, with the EU/US destinations stated plainly. If geo-targeting is added later, this block can be shown specifically to UAE users. Do not gate essential app data on a separate "analytics" consent — the app-use transfers described here are covered by the same "Essential only" path as our cookie banner (essential cookies/data are required to use the app; behavioural analytics remain a separate "Accept all" choice).

---

## 4. Data-subject rights for UAE users (Articles 13–17 PDPL)

UAE users have rights under the PDPL that map closely to the rights we already offer under GDPR. PackPerks serves them through the **same mechanisms**, so there is no separate UAE process to maintain:

| PDPL right | How PackPerks delivers it |
|---|---|
| **Right to information** (Art. 13) | This document + the Privacy Policy + the in-app notice at Section 3. |
| **Right of access** (Art. 13) | In-app **"Data control"** section, plus a manual DSAR by email to **privacy@packperks**. |
| **Right to correction** (Art. 15) | Edit specific data in **"Data control"** (e.g. change email, update IBAN); DSAR email for anything not self-service. |
| **Right to erasure / deletion** (Art. 15) | **"Data control"** lets a user delete specific data, reset their device, or **delete their account**; deletion cascades to activity history, balances and scans. Receipt/cup images are already on automatic deletion timers (see below). |
| **Right to restrict / stop processing** (Art. 16) | Choose **"Essential only"** (no behavioural analytics), or **"Reject"** which blocks app use but **never deletes cups/claims already earned**. |
| **Right to object to automated processing** (Art. 17) | The AI receipt verdict is **not a solely-automated final decision with legal effect** — a receipt can be re-reviewed manually, and cashback payout is a **manual** admin step, not automated. A user can contact us to have a verdict reviewed by a person. |
| **Right to data portability** | Fulfilled via the DSAR export on request. |

### 4.1 Correction and deletion route (concrete)

1. **Self-service first.** UAE users use the in-app **"Data control"** section: correct email/IBAN, reset the local `device_id`, clear device-local `localStorage` keys, or delete the account.
2. **Manual DSAR.** For anything beyond self-service, email **privacy@packperks**. The PackPerks Privacy Owner handles UAE DSARs on the **same timeline and log** as GDPR requests.
3. **Automatic deletion already running.** Even without a request: **receipt images** are deleted **90 days after the claim is resolved**; **cup-scan images** **90 days after the scan**; **behavioural analytics** at **14 months**; inactive accounts (**24 months** inactivity) are deleted. Reward claims are kept **7 years** for NL accounting as amount/date/status + **IBAN last-4 only** (raw IBAN deleted on payout confirmation). These same timers apply to UAE users' data held in the EU.

### 4.2 Complaints

A UAE user who is unsatisfied may complain to the **UAE Data Office** (the supervisory authority under the PDPL), in addition to contacting PackPerks. PackPerks will not obstruct or retaliate against such a complaint.

---

## 5. Security in transit and at rest

Applies to UAE user data on both legs:

- **In transit:** TLS/HTTPS for all traffic to Supabase and to the Anthropic API. Receipt/cup images in Supabase Storage are **private** and only reachable via **short-lived signed URLs**.
- **At rest (EU):** Supabase-managed encryption; Row-Level Security so users reach only their own rows; IBAN consolidated into **one restricted payout table** reachable only by **Edge Functions**, with full IBANs visible only to the **top admin** and masked everywhere else, then **deleted after payout confirmation**.
- **US processing:** ephemeral — the receipt is processed for the verification request only and **not retained** by Anthropic beyond it.
- **Admin accountability:** admin actions (including IBAN export) are captured in **audit logs** (before/after state, admin IP + user agent) kept **12 months**. IBAN export is a **logged, top-admin-only** operation.

---

## 6. DIFC / ADGM applicability — TO BE CONFIRMED

The UAE has separate data-protection regimes inside its financial free zones that **displace the federal PDPL** for entities established there:

- **DIFC Data Protection Law No. 5 of 2020** (Dubai International Financial Centre).
- **ADGM Data Protection Regulations 2021** (Abu Dhabi Global Market).

These are **GDPR-style regimes** with their **own** cross-border transfer rules, adequacy lists and (in DIFC's case) SCC-equivalent instruments. Which regime applies to PackPerks depends on **where the operating entity or a partner is established**, not on where the user sits.

> **ACTION — DIFC / ADGM applicability: TO BE CONFIRMED per operating entity/partner.**
> Before onboarding any UAE operating entity, UAE-established partner, or free-zone-registered counterparty, PackPerks must confirm **which regime governs** (federal PDPL vs DIFC vs ADGM) and, if DIFC/ADGM applies, map the transfers in Sections 1–2 onto **that** regime's transfer mechanism (its own adequacy determination and/or SCC-equivalent). Until confirmed, PackPerks treats UAE users under the **federal PDPL** analysis in this document.

Owner for this action: **PackPerks Privacy Owner**.

---

## 7. Open actions checklist

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Execute / confirm on file **Anthropic DPA + EU–US DPF or SCCs** (covers GDPR + PDPL US leg) | PackPerks Privacy Owner | **Open** |
| 2 | Confirm **Supabase EU DPA** and sub-processor list on file for UAE-origin data at rest | PackPerks Privacy Owner | **Open** |
| 3 | Check **UAE Data Office adequacy list** for EU/EEA and US; record outcome here | PackPerks Privacy Owner | **Open** |
| 4 | Surface the **Section 3 UAE notice** in the privacy notice and at first receipt submission | PackPerks Privacy Owner | **Open** |
| 5 | **DIFC / ADGM applicability** confirmed per operating entity/partner (Section 6) | PackPerks Privacy Owner | **Open** |
| 6 | Re-review this document if PackPerks adds UAE-resident hosting, a new US/third-country sub-processor, or geo-targeted flows | PackPerks Privacy Owner | **Open** |

---

## 8. Free-zone applicability (DIFC / ADGM)

Section 6 flags this as an open action; this section makes the determination concrete and records the result.

**Why the free zones matter.** The DIFC (Dubai International Financial Centre) and ADGM (Abu Dhabi Global Market) are UAE **financial free zones** that operate their **own** data-protection laws, separate from the federal PDPL:

- **DIFC Data Protection Law No. 5 of 2020** (with its own regulations); and
- **ADGM Data Protection Regulations 2021**.

These free-zone laws can apply **instead of** the federal PDPL — or, for a group operating both onshore and in a free zone, **in addition to** it — when an entity is **established in**, or **processes personal data in**, that free zone. In practice the federal PDPL governs the UAE mainland and most non-financial free zones but **does not apply** to a free zone that has its own data-protection legislation; for an entity established there, the DIFC or ADGM regime governs that entity's activities instead. A company with **both** an onshore UAE establishment **and** a DIFC/ADGM establishment can be subject to **both** regimes — each for the activities carried out under it. Which regime applies turns on **where the entity (or a partner) is established and where processing happens**, **not** on where the individual user sits.

Both free-zone regimes are **GDPR-style** (each recognises legitimate interests as a basis and each has its own cross-border transfer rules, adequacy lists, and SCC-equivalent instruments), so a GDPR-first posture maps across reasonably well — but the transfer mechanism must be re-grounded in **that** regime, not assumed from the PDPL analysis in Sections 1–2.

**Determination checklist.** Work through these to decide which regime governs PackPerks:

1. **Where is the PackPerks operating entity registered?** UAE mainland, DIFC, ADGM, another UAE free zone, or outside the UAE entirely?
2. **Is any PackPerks entity established inside the DIFC or ADGM** (a registered presence in the free zone), even if the main entity is elsewhere?
3. **Is personal data processed inside the DIFC or ADGM** (staff, infrastructure, or operations physically/legally in the zone)?
4. **Is any UAE partner or counterparty** you share data with (or that acts for you) established in the DIFC or ADGM?
5. **If yes to 2–4:** apply that free zone's data-protection law to those activities, and map the Section 1–2 transfers onto **its** cross-border mechanism (its own adequacy determination and/or SCC-equivalent). **If no to 2–4:** the **federal PDPL** analysis in this document governs.

**Result (record on adoption):**

- **Operating entity:** [FILL: PackPerks operating entity name]
- **Registration jurisdiction:** [FILL: entity registration jurisdiction — mainland / DIFC / ADGM / other]
- **DIFC / ADGM applicability determination:** [FILL: DIFC-or-ADGM applicability determination + date]

Until this determination is recorded, PackPerks continues to treat UAE users under the **federal PDPL** analysis in Sections 1–2.

---

*This document reflects PackPerks' actual MVP architecture: EU-resident Supabase (`eu-west-1`), US receipt AI via the standard zero-retention Anthropic API, no UAE-resident hosting, sole-controller model, and manual cashback payout. It should be revisited whenever any of those facts change.*
