# Smart bin → PackPerks integration

How a physical smart bin turns a customer's deposit session into a printed
QR receipt that pays out.

The bin makes **one HTTP call per customer session**. Everything else —
which organisation the cups belong to, what they're worth, whether the QR
pays out via Tikkie or opens the app — is decided server-side. The bin
never needs to know, and never needs a firmware change when any of it
changes.

---

## The flow

```
customer deposits cups
        │
        ▼
  bin session ends  ──POST /bin-mint-batch──▶  PackPerks
   (cups = 4)         X-Bin-Key: <secret>       · mints 4 cup tokens
                      {cups, session_id}        · creates one batch UUID
        ◀──────────── {url, amount_eur} ────────┘
        │
        ▼
  bin prints QR of `url`   ← the QR is valid from this moment
        │
        ▼
  customer scans it → https://perks.packback.network/t3/?batch=<uuid>
        │
        ▼
  Redirect Refund org → Tikkie cashback link (bin-tikkie)
  Deposit org         → the PackPerks app (claim-cups)
```

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

```json
{
  "cups": 4,
  "session_id": "bin7-2026-08-25T14:03:11Z-0042"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `cups` | integer 1–50 | yes | Cups counted in this session. (`count` is accepted as a legacy alias.) |
| `session_id` | string ≤128 chars | **strongly recommended** | The bin's own session identifier. Makes retries safe — see below. |

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

**Print `url` as the QR code.** Do not build the URL yourself — the slug
changes when a bin is pointed at a different organisation, and the server
already knows the current one.

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

- Unique per customer session on that machine (a timestamp plus a counter
  is fine). Never reuse one for a different session.
- Keep it stable across retries of the *same* session — that's the point.
- Generate it before the first attempt, not per attempt.

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

## Current wiring (as of 2026-08-25)

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
2. For a **Redirect Refund** org the app shows a one-second redirect screen
   and calls `bin-tikkie`, which atomically claims the batch's cups,
   creates one anonymous claim, mints a Tikkie cashback link, and redirects.
   Re-scanning the same receipt always returns the **same** link — never a
   second payout.
3. For a **Deposit Rewards** org the app boots normally and `claim-cups`
   credits the cups to the customer's balance.

A receipt can therefore be scanned safely more than once, and a customer
who closes the tab can re-scan to get their link back.

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
  -d '{"cups":4,"session_id":"manual-test-1"}'
```

Send the same `session_id` twice — the second response must come back with
`"reused": true` and the same `batch_id`.

⚠️ Scanning a real receipt for a Redirect Refund org **spends real money**
(the payout plus the Tikkie fee). Use a small `cups` value when testing.
