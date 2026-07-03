# PackPerks — Data Retention & Deletion Schedule

**Privacy owner:** [FILL: privacy owner name] · **Contact:** [FILL: privacy contact email] · **Last updated:** 2026-07-03

**Last updated:** (to be dated on adoption)
**Owner:** PackPerks Privacy Owner

This schedule sets out how long PackPerks keeps each category of personal data, what triggers its deletion, and whether deletion is automated or manual. PackPerks is the sole **controller** for all data described here. Partner venues receive only aggregate statistics via the admin-only dashboard and never see any of the records below at user level.

PackPerks is a reusable-cup loyalty and cashback MVP for the EU (Netherlands), also intended to serve UAE users. All data is stored in Supabase (Postgres + Auth + Storage + Edge Functions) hosted in the EU region (**eu-west-1**), except where noted below (transient processing by the Anthropic API in the United States, and Supabase-managed email delivery for OTP/magic links).

---

## 1. Retention table

| Data | Where stored | Retention period (exact) | Deletion trigger | Method (automated vs manual) |
|---|---|---|---|---|
| **Receipt photos** | Private Supabase Storage bucket (signed URLs) | 90 days after the claim is resolved | Claim reaches a resolved state (approved/rejected/paid) → 90-day clock | **Automated** — scheduled Edge Function scans resolved claims and deletes the linked storage objects past 90 days |
| **Cup-scan photos** | Private Supabase Storage bucket (signed URLs) | 90 days after the scan | Scan `created_at` + 90 days | **Automated** — scheduled Edge Function deletes expired scan objects |
| **Reward claims (accounting record)** | Postgres — claims table | 7 years (NL accounting obligation), retained as amount, date, status and **IBAN last-4 only** | Fixed 7-year statutory period from the claim/payout date | **Automated** — pg_cron purges claim rows older than 7 years; raw IBAN already removed at payout (see below) |
| **Raw IBAN** | Postgres — single restricted payout table, reachable only by Edge Functions; masked everywhere else; full value visible only to the top admin | Deleted immediately after the top admin exports and confirms that claim's payout | Top admin confirms payout for the claim | **Manual trigger, automated deletion** — admin's payout-confirmation action invokes the Edge Function that nulls/deletes the raw IBAN, leaving last-4 on the claim record |
| **AI verdict + AI-extracted receipt fields** (datetime, receipt id, total, decision reason) | Postgres — claim/verification record | Tied to the parent claim — 7 years as part of the accounting record (image itself deleted at 90 days) | Parent claim purge at 7 years | **Automated** — removed with the claim row via pg_cron |
| **Behavioural analytics** (`client_events`: screen views, button taps, reward changes, shares, funnel events) | Postgres — `client_events` table | 14 months, then deleted or anonymised | Event `created_at` + 14 months | **Automated** — pg_cron deletes/anonymises rows older than 14 months |
| **Admin audit logs** (before/after state, admin IP + user agent) | Postgres — audit log table | 12 months (extended only for the duration of an active investigation) | Log `created_at` + 12 months, unless flagged for an active investigation | **Automated** — pg_cron purges expired logs, skipping rows flagged under legal hold |
| **Admin login history** | Postgres — admin login history table | 12 months (extended only for an active investigation) | Log `created_at` + 12 months, unless under investigation hold | **Automated** — pg_cron purge with legal-hold exclusion |
| **Activity history / cup balances / scans** | Postgres — user activity + balances tables | While the account is active; deleted after 24 months of inactivity; deleted on account deletion | Last-activity timestamp + 24 months, or account-deletion request | **Automated** (24-month inactivity sweep via pg_cron) **and Manual/on-request** (account deletion cascade) |
| **Optional email** | Supabase Auth (linked account) | While the account is active; removed on account deletion or via in-app "Data control" | Account deletion or user edit/delete in Data control | **Manual/on-request** — user-initiated; deletion cascade removes it |
| **Random display name** | Postgres — profile record | While the account/anonymous record is active; removed on account deletion | Account deletion or Data-control reset | **Manual/on-request** via Data control or deletion cascade |
| **device_id** (essential; localStorage) | Client device localStorage only | Device-local; persists until the user clears it | User uses "Reset device" / clears data in Data control | **Manual** — user-clearable via Data control (device-local, not server-swept) |
| **Coarse device label** ("iPhone / iOS 17"; essential) | Postgres — device/session record | While the linked account/record is active; removed on account deletion | Account deletion or Data-control reset | **Manual/on-request** via deletion cascade |
| **BYO cup requests** | Postgres — activity history | Same as activity history — while active; 24 months inactivity → deletion; deleted on account deletion | Inactivity sweep or account deletion | **Automated + Manual/on-request** |
| **Other localStorage keys** | Client device localStorage only | Device-local; persists until cleared by the user | User clears via Data control / resets device | **Manual** — user-clearable, device-local |

**Note on "Reject" consent:** choosing "Reject" at the cookie banner blocks continued use of the app but **never deletes cups or claims already earned**. Those balances and claim records remain subject to the retention periods above.

### 1.1 AI verdict & extracted receipt data — derived personal data that dies with the claim

The AI verdict (`ai_verdict`) and the fields our AI extracts from a receipt (datetime, receipt id, total, line items, decision reasons) are **derived personal data** stored on the claim. They are treated the same as any other personal data:

- They are **included in DSAR exports** (a data access request returns them).
- They are **deleted / anonymised together with the claim** on account deletion — they "die with the claim".

**Important nuance — what stays vs what goes.** Even after the receipt **image** and the **raw IBAN** have already been deleted (image at 90 days, raw IBAN at payout confirmation), the **claim record itself is retained as proof that a claim / redemption happened**. On account deletion:

- **Retained** (accounting proof, 7 years NL): claim **amount**, **date**, **`iban_last4`**, and **status**.
- **Removed:** the receipt **image**, the **raw IBAN**, and the **`ai_verdict`** (plus its extracted fields).

So the AI-derived data does not outlive the person's other claim detail: the minimal financial ledger (amount / date / `iban_last4` / status) is what survives, and the verdict, image and raw IBAN are what get removed.

---

## 2. How deletion is enforced

Deletion is enforced through three mechanisms: scheduled database jobs, scheduled Edge Functions for storage and IBAN handling, and an account-deletion cascade. There is no traditional backend — all scheduled logic runs inside Supabase (pg_cron in Postgres, and scheduled Edge Functions).

### 2.1 Scheduled Postgres jobs (pg_cron)

A set of `pg_cron` jobs runs on a recurring schedule (typically daily, off-peak) against the EU (eu-west-1) Postgres instance. Each job filters on a timestamp column and deletes or anonymises rows past the retention window:

- **Analytics sweep** — deletes or anonymises `client_events` rows older than **14 months**.
- **Audit and login-log sweep** — deletes admin audit logs and admin login history older than **12 months**, excluding any rows flagged under an active-investigation legal hold.
- **Claim accounting purge** — deletes reward claim rows older than **7 years** (by which point the raw IBAN has already been removed and only amount/date/status/last-4 remain).
- **Inactivity sweep** — identifies accounts and anonymous records with no activity for **24 months** and triggers the deletion cascade (Section 2.3) for activity history, balances, scans, BYO requests, profile and device records.

Legal holds are honoured by a flag on the relevant rows; the sweeps skip flagged records until the investigation is closed, after which normal retention resumes.

### 2.2 Scheduled Edge Functions (Storage + IBAN)

Storage objects live in **private** Supabase Storage buckets served only via short-lived signed URLs. Because retention here is keyed to claim/scan lifecycle events rather than a single table timestamp, deletion runs through scheduled Edge Functions with the necessary service-role access:

- **Receipt-image cleanup** — an Edge Function runs on a schedule, finds claims that have been in a *resolved* state for more than **90 days**, and deletes their receipt photo objects from Storage. The claim record and its AI-extracted fields remain (subject to the 7-year rule); only the image is removed.
- **Cup-scan-image cleanup** — an Edge Function deletes cup-scan photo objects more than **90 days** past the scan date.
- **IBAN deletion on payout confirmation** — the raw IBAN lives in a single restricted payout table reachable **only** by Edge Functions and visible in full only to the top admin. Manual cashback payout works as follows: the top admin performs a **logged export** of the IBAN(s) for a claim, makes the payment, then confirms the payout in the admin panel. That confirmation invokes an Edge Function that **deletes the raw IBAN** for that claim and writes back only the **last-4** onto the retained claim record. No pg_cron timer is involved — deletion is bound to the admin's confirmation action, so an IBAN never lingers beyond the payout it was collected for.

### 2.3 Account-deletion cascade

When a user requests deletion — via the in-app **"Data control"** section (delete account) or by manual DSAR email to the Privacy Owner — a deletion routine removes all data linked to that user's identifier(s) (Supabase Auth user and/or the `device_id`-linked anonymous record):

1. **Auth/identity** — the Supabase Auth user (optional email) is deleted; the random display name and profile record are removed.
2. **Loyalty data** — cup balances, activity history, cup scans, BYO cup requests and any non-statutory reward data linked to the user are deleted.
3. **Storage** — the user's receipt and cup-scan photos are removed from the private Storage buckets ahead of their normal 90-day expiry.
4. **Device data** — server-side device records (coarse device label, sessions) are removed. Client-side `localStorage` keys, including `device_id`, are **device-local**: the app clears them on the client (and the user can clear them at any time via "Reset device" in Data control), but PackPerks cannot reach them server-side.
5. **Behavioural analytics** — the user's `client_events` are deleted or fully anonymised so they can no longer be tied to the person.

**Statutory exception.** Resolved **reward claims** are retained for the full **7 years** required by NL accounting law, kept in the minimised form only — **amount, date, status and IBAN last-4**, with the raw IBAN already deleted at payout. These records are what remains after an account deletion; everything else in the cascade is removed. When the 7-year period lapses, the pg_cron claim purge (Section 2.1) removes them too.

The Data control section also supports **granular** actions short of full deletion — editing or deleting specific data items and resetting the device — which invoke the same underlying delete routines scoped to the selected data. Manual DSAR requests are handled by the Privacy Owner using these same mechanisms.

---

## 3. Payout exports

Every IBAN export performed for a manual cashback payout is recorded in the **`payout_exports`** table — **who** exported, **when**, and the **count** of records exported. This pairs with the payout SOP and is **partially automated already**: the payout function logs each export as it happens.

- **Raw IBAN purge.** After payment is confirmed, the raw IBAN is purged via **`confirm_payout_and_purge_iban`**, leaving only **`iban_last4`** on the claim record (see §2.2). The `payout_exports` log of the export event is retained as part of the accounting/audit trail.
- **Downloaded export files.** Any export file that is downloaded to make the payment must be stored **only** in [FILL: sanctioned secure location] and **deleted within [FILL: N days]** of payment. Export files must not be left on personal devices, in chat, or in shared drives (see `INTERNAL_DATA_HANDLING.md`).
