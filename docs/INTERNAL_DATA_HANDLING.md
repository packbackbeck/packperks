# PackPerks — Internal Data-Handling Rule (Staff)

**Privacy owner:** [FILL: privacy owner name] · **Contact:** [FILL: privacy contact email] · **Last updated:** 2026-07-03

This is a one-page internal rule for everyone who works on PackPerks. It exists to keep customer personal data inside the systems built to protect it, and out of the tools where it leaks — chat, screenshots, notes and spreadsheets. If in doubt, don't paste it; ask.

---

## The rule

- **Never put customer PII into everyday tools.** Do **not** paste or upload customer personal data — **IBAN, email address, receipt images, or claim details** — into **Slack, screenshots, Notion, spreadsheets, or support messages**. These are not authorised stores for customer PII.
- **Always mask.** When you need to discuss a customer's payment details, use **masked values only** — e.g. the **IBAN last-4 (`iban_last4`)**, never the full IBAN. The same goes for anything else that identifies a person where a reference or masked value would do.
- **Payout exports go through the sanctioned tool only.** Customer payout exports may be produced **only** via the sanctioned **`payout` export tool**. Do not hand-build payout spreadsheets or copy IBANs out by hand. Each export is logged (see `RETENTION_SCHEDULE.md` §3). Any downloaded export file must be **deleted after payment** and kept only in the sanctioned secure location.
- **Signed URLs are short-lived and secret.** Signed URLs for **receipt / cup-scan images** are **short-lived** and **MUST NOT** be pasted into **chat, tickets, or logs**. Treat a signed URL like a temporary key to a private image — sharing it shares the image. Open the image through the admin tooling instead of forwarding a link.

## Why

Customer trust and our GDPR/PDPL obligations depend on personal data staying in Supabase (EU) behind Row-Level Security and private storage, with IBANs isolated in the restricted payout table and images reachable only via short-lived signed URLs. The moment PII lands in Slack or a screenshot, it escapes those controls, becomes impossible to retention-sweep, and turns an ordinary tool into an unmanaged copy of customer data. See `PRIVACY_POLICY.md`, `RETENTION_SCHEDULE.md`, and `DPA_STATUS.md` for the controls this rule protects.

## If something goes wrong

If customer PII has already been posted somewhere it shouldn't be (a full IBAN in Slack, a receipt image in a ticket, a signed URL in a log), **do not ignore it**: remove it if you can, and **escalate immediately** to **[FILL: internal escalation contact]** and the privacy owner ([FILL: privacy contact email]). Accidental exposure may be a reportable data breach — see `BREACH_RUNBOOK.md`. It is always better to flag it early.
