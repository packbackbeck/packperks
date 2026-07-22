# PackPerks UAE: Payments + Data Protection — Plain-Language Summary

**Date:** 20 July 2026
**What this covers:** how we built the app to be ready for a UAE payout provider (without picking one yet), and where we stand on complying with both EU and UAE data rules.

---

## 1. What we need (requirements)

### For paying cashback in the UAE
We looked at three UAE options (kept unnamed in the app for now). To pay someone cashback, they all work in one of two ways:

- **A collect link** — we create a link, the customer taps it, the money lands in their account. (This is exactly how the Netherlands one, Tikkie, works.)
- **An instant push** — we send money straight to the customer using their phone number, email, or a QR code, with no link.

So the requirements are: send money in **AED**, get a **link or a push**, know the **status** (paid / pending / failed), and see how much **float** is left. All three providers give us these; they differ mainly in their API details and secrets.

### For data protection (EU + UAE together)
Because the app now serves both regions, we must satisfy **both** GDPR (EU) and the UAE's PDPL. In plain terms, for both we need: a clear privacy notice, a good reason for every piece of data, strong security, a way for users to see/delete their data, a breach plan, honest handling of data crossing borders, sensible retention, and contracts with our vendors.

---

## 2. Where the requirements overlap (the good news)

**The three UAE providers overlap almost completely.** They all boil down to "create a payout → get a link or push → check status." That means we can build **one** UAE payout piece that fits **any** of them, and only swap in the specific provider's details later. We don't have to commit now.

**EU and UAE rules also overlap a lot.** The UAE's law is modelled on the EU's, so the app was already ~80% of the way there from being built EU-first. The shared parts — privacy notice, lawful basis, security, user rights, breach handling, retention — are done once and count for both.

The parts that are **extra** for the UAE are mostly wording and paperwork (who the controller is, telling users their data goes to the EU/US, which authority to complain to), not a rebuild.

---

## 3. What we've now built (implemented)

**Payment side — the app is now "built around" a future UAE provider:**
- A **region system**: each café belongs to a region (NL or UAE), and the region decides the **currency**, the **map focus**, and **which payout method** is used.
- A new **UAE payout module** (`uae-payout`) that mirrors the Netherlands one but is **provider-neutral**. It already handles both a **link** and a **push**, in **AED**, with create/status/balance actions. It's fully wired — approving a UAE cashback claim routes here automatically. Until we pick and plug in a provider, it safely says **"not configured"** instead of paying the wrong way.
- The customer's **"collect your cashback"** button no longer says "Tikkie" in the UAE — it's region-aware, so we never show a Dutch brand to a UAE user.
- **Guardrail:** a UAE (AED) claim can never accidentally be paid through the Dutch (EUR) rail, and vice-versa.

**Data-protection side — we progressed the plan and wrote the artifacts:**
- A **compliance pack** (`docs/UAE-EU-Compliance-Pack.md`) with the real deliverables: a **record of processing**, a **cross-border transfer register** (UAE→EU hosting, EU→US AI), a one-page **breach runbook**, and a **DPIA-lite** (privacy risk assessment for receipts, AI, payouts, transfers).
- A phase-by-phase status (P0/P1/P2) with each task marked done / partial / blocked.

---

## 4. What we deliberately did NOT finish (blocked on the provider choice)

These wait until we pick the UAE provider, because the answer changes with it:
- **What identifier we collect to pay someone** (IBAN vs phone vs email vs QR) — and therefore the just-in-time privacy notice and admin masking for it.
- The **contract (DPA)** with the UAE provider and confirming where it stores data.
- The final **payout privacy wording** for UAE users.

They're clearly marked in the compliance pack so nothing is forgotten.

---

## 5. The trade-offs (the choices we made and why)

- **Build one neutral adapter instead of picking a provider now.** Trade-off: a bit of extra abstraction up front, but we stay flexible and can choose on price/coverage later without reworking the app. Worth it.
- **Keep hosting in the EU and document the transfers, rather than moving data into the UAE.** The UAE law doesn't require local storage for an app like ours, so this is simpler. Trade-off: if a UAE regulator or partner later demands UAE-resident data, we'd have to split storage by region — a bigger change we're deliberately deferring until it's actually required.
- **Reuse the existing payout database fields** for the UAE link/status instead of adding new ones. Trade-off: the columns are still named after the Dutch provider internally (a tidy-up for later), but it avoids a database migration now and everything works.
- **Prefer a "customer supplies their own details" payout** (like the link model) so we store **no bank details**. This is the single biggest risk-reducer under both EU and UAE rules. Trade-off: depends on the chosen provider supporting it; if the only good UAE option needs us to hold an identifier, we've already planned the extra controls (mask, restrict, log, delete).
- **Manual privacy requests and breach handling for now.** Cheap and fine for a pilot; we'd automate later as volume grows.

---

## 6. One-line status

**Payments:** ready and wired for a UAE provider; just needs the provider chosen + credentials. **Data protection:** ~80% shared with what we already had; core artifacts written; the few provider-specific items are blocked and clearly marked. **No contradictions** between EU and UAE — we just do the stricter of the two.
