# Smart bin → PackPerks integration

How a physical smart bin turns a customer's deposit session into a printed
QR receipt that pays out.

The bin makes **one HTTP call per customer session**, sending exactly two
values: the cup count and a session UUID. Everything else — which
organisation the cups belong to, what they're worth, whether the QR pays
out via Tikkie or opens the app — is decided server-side. The bin never
needs to know, and never needs a firmware change when any of it changes.

> **Changed 26 Aug 2026:** `session_id` is now **required** and must be a
> **UUID v4**. Calls without it, or with a free-text id, are rejected with
> `400`. Earlier integration tests that sent a plain string (or no session
> at all) need updating before they will mint.

---

## The flow

```
customer deposits cups
        │
        ▼
  bin session ends  ──POST /bin-mint-batch──▶  PackPerks
   cups        = 4     X-Bin-Key: <secret>       · mints 4 cup tokens
   session_id  = UUID  {cups, session_id}        · creates one batch UUID
        ◀──────────── {url, amount_eur} ────────┘
        │
        ▼
  bin encodes `url` as a QR code and prints it
        │                    ↑ the bin draws the QR; we return only the
        │                      string to encode, never an image
        ▼
  customer scans it → https://perks.packback.network/t3/?batch=<uuid>
        │
        ▼
  Redirect Refund org → Tikkie cashback link (bin-tikkie)
  Deposit org         → the PackPerks app (claim-cups)
```

The QR is valid from the moment the response comes back.

---

## The endpoint

```
POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/bin-mint-batch
```

### Headers

| Header | Value |
|---|---|
| `X-Bin-Key` | The bin's device secret (see **Provisioning** below) |
| `Content-Type` | `application/json` |

No Supabase API key, no JWT, no user login. The bin key is the entire
authentication, and it is also what maps the bin to an organisation.

### Request body

Exactly two properties:

```json
{
  "cups": 4,
  "session_id": "e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `cups` | integer 1–50 | **yes** | Cups counted in this session. |
| `session_id` | **UUID v4** | **yes** | The bin's own id for this customer session. Generate a fresh one when the session opens. Makes retries safe — see below. |

`session_id` must be a real UUID v4 (the version nibble is checked, so a v1
UUID is rejected). Anything else is refused rather than accepted quietly:
this field is the only thing standing between a retried request and a
second payout for the same cups.

### Response `200`

```json
{
  "batch_id": "22226466-533b-4c08-bc2d-a8c6da05fb1b",
  "url": "https://perks.packback.network/t3/?batch=22226466-533b-4c08-bc2d-a8c6da05fb1b",
  "cups": 4,
  "amount_eur": 0.40,
  "currency": "EUR",
  "slug": "t3",
  "reused": false
}
```

**Encode `url` as a QR code and print it.** The bin draws the QR itself;
we return only the string to put inside it, never an image.

Do not build the URL yourself — the slug changes when a bin is pointed at
a different organisation, and the server already knows the current one.

`amount_eur` is what the customer will actually receive, computed with the
same rate and the same caps the payout applies. Print it on the receipt if
you want the amount visible before scanning; it will never disagree with
what Tikkie pays.

`reused: true` means this session had already been minted and you are
getting the original batch back (see below).

### Errors

| Status | Body | Meaning |
|---|---|---|
| `401` | `{"error":"missing_bin_key"}` | No `X-Bin-Key` header |
| `401` | `{"error":"invalid_bin_key"}` | Unknown key, or the bin has been deactivated |
| `400` | `{"error":"invalid_cups"}` | `cups` missing or outside 1–50 |
| `400` | `{"error":"missing_session_id"}` | No `session_id` in the body |
| `400` | `{"error":"invalid_session_id"}` | `session_id` is not a UUID v4 |
| `429` | `{"error":"rate_limited"}` | More than 120 mints/hour from one bin |
| `500` | `{"error":"mint_failed"}` | Database write failed — safe to retry |

---

## Retries: use `session_id`

A bin on venue wifi will sometimes send the request successfully and lose
the response. Without a dedupe key, retrying mints a **second** batch for
the same physical cups — and the customer can then claim both.

Send the bin's session identifier as `session_id` and this is solved: the
first call mints, and every later call with the same `session_id` from the
same machine returns the **same** batch with `reused: true`. Nothing is
minted twice.

Rules for `session_id`:

- A fresh **UUID v4** per customer session, generated when the session
  opens — before the first attempt, not per attempt.
- Keep it stable across retries of the *same* session. That is the point.
- Never reuse one for a different session.

Recommended client behaviour: retry on network error / `5xx` / `429` with
backoff, using the same `session_id`, and only print once you have a `url`.
If you can't reach the server at all, do **not** print a QR — an unminted
UUID is not valid and would show the customer an error.

---

## Provisioning a bin

Each bin has a row in the `smartbin_keys` table:

| Column | Meaning |
|---|---|
| `bin_key` | The device secret sent in `X-Bin-Key` |
| `org_id` | Which organisation this bin's cups belong to |
| `machine_id` | Stable machine identifier (used for rate limiting + session dedupe) |
| `label` | Human description, shown in ops queries |
| `active` | `false` instantly disables the bin |

To create one, run in the Supabase SQL editor:

```sql
insert into smartbin_keys (bin_key, org_id, machine_id, label, active)
values (encode(gen_random_bytes(24), 'hex'),
        '<org uuid>', '<machine id>', 'Venue — bin 1', true)
returning bin_key;
```

Copy the returned `bin_key` into the bin's config. Treat it like a
password: it mints spendable value. If it leaks, set `active = false` and
issue a new one — no code deploy needed.

**Pointing a bin at a different organisation is a one-row change:**

```sql
update smartbin_keys set org_id = '<new org uuid>' where machine_id = '<machine id>';
```

The next receipt the bin prints carries the new organisation's slug
automatically. This is exactly how the Titaan bin was moved from `t2` to
the Redirect Refund org `t3` — with no change to the bin.

---

## Current wiring (as of 2026-08-26)

| Machine | Organisation | Mode | Prints |
|---|---|---|---|
| `cc1346074f8f446babf62503028fe040` | Titaan 3 — slug `t3` | Redirect Refund | `…/t3/?batch=<uuid>` → Tikkie |
| `5c1ea491d2a746938d305c19a46a1ed1` | Titaan — slug `titaan` | Deposit Rewards | `…/titaan/?batch=<uuid>` → app |

Rate for `t3`: **€0.10 per cup** (Settings → Payout rates → Refund rate).
Each Tikkie link issued carries a fixed transaction fee of roughly €0.50,
so single-cup receipts cost more to pay out than they pay.

---

## What the server does on scan

Not the bin's problem, but useful context when debugging a receipt:

1. The QR opens `/<slug>/?batch=<uuid>` in the phone's browser.
2. For a **Redirect Refund** org the app shows a short redirect screen and
   calls `bin-tikkie`, which atomically claims the batch's cups, creates
   one anonymous claim, mints a Tikkie cashback link, and redirects.
3. For a **Deposit Rewards** org the app boots normally and `claim-cups`
   credits the cups to the customer's balance.

A receipt can be scanned more than once without minting a second payout —
the same link comes back every time. On a re-scan the Redirect Refund
screen stops instead of redirecting, checks the live status with Tikkie,
and tells the customer the link has most likely already been used (and
that entering bank details a second time will not pay out again).

---

## Testing without a bin

Any admin can mint the identical batch from the dashboard: **Receipt
Generator → QR Cup Receipts**. It produces the same batch/QR the bin does,
so the whole scan-to-payout path can be exercised from a desk.

To exercise the endpoint itself:

```bash
curl -X POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/bin-mint-batch \
  -H "X-Bin-Key: <bin key>" \
  -H "Content-Type: application/json" \
  -d '{"cups":4,"session_id":"e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14"}'
```

Send the same `session_id` twice — the second response must come back with
`"reused": true` and the same `batch_id`.

⚠️ Scanning a real receipt for a Redirect Refund org **spends real money**
(the payout plus the Tikkie fee). Use a small `cups` value when testing.
