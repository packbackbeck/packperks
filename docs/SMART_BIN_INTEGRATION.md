# Smart bin → PackPerks integration

How a physical smart bin turns a customer's deposit session into a printed
QR receipt that pays out.

The bin makes **one HTTP call per customer session**, sending the cup
count, a session UUID, and one UUID per cup. Everything else — which
organisation the cups belong to, what they're worth, whether the QR pays
out via Tikkie or opens the app — is decided server-side. The bin never
needs to know, and never needs a firmware change when any of it changes.

> **Changed 26 Aug 2026 — two breaking changes:**
> 1. `session_id` is now **required** and must be a **UUID v4**.
> 2. `cup_uuids` is new: one **UUID v4 per cup**, minted by the bin. It is
>    **required for Redirect Refund bins** (currently Titaan 3 / `t3`) and
>    optional elsewhere. We store each id verbatim as the cup's primary
>    key, so the bin and PackPerks name the same cup identically.
>
> Earlier integration tests that sent a free-text session id, or no cup
> ids, are rejected with `400` and need updating before they will mint.

---

## The flow

```
customer deposits cups
        │  bin mints a UUID v4 per cup as it counts them
        ▼
  bin session ends  ──POST /bin-mint-batch──▶  PackPerks
   cups        = 4     X-Bin-Key: <secret>       · stores those 4 cup ids
   session_id  = UUID  {cups, session_id,        · creates one batch UUID
   cup_uuids   = [4]    cup_uuids}
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

```json
{
  "cups": 3,
  "session_id": "e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14",
  "cup_uuids": [
    "7b1d9a52-4e33-4c07-9a61-2f8b5d0e14aa",
    "a3f6e281-9c4d-4b52-8e07-16d9f3a70b8c",
    "c58a04f7-2b6e-4d19-b743-90e5c1f82d6b"
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `cups` | integer 1–50 | **yes** | Cups counted in this session. |
| `session_id` | **UUID v4** | **yes** | The bin's own id for this customer session. Generate a fresh one when the session opens. Makes retries safe — see below. |
| `cup_uuids` | array of **UUID v4** | **yes** for Redirect Refund bins | One id per physical cup, minted by the bin. The array length must equal `cups`, and the ids must be unique. |

Both UUID fields must be real v4 UUIDs — the version nibble is checked, so
a v1 UUID is rejected. Anything else is refused rather than accepted
quietly: these fields are what stand between a retried request and a
second payout for the same cups.

**What happens to `cup_uuids`:** each id is stored verbatim as the primary
key of its row in the `cups` table. The bin and PackPerks therefore refer
to the same physical cup by the same id, which is what makes a bin-side
record reconcilable against ours. We do not renumber them, and we never
return different ids than the ones you sent.

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
| `400` | `{"error":"missing_cup_uuids"}` | This bin's org requires per-cup ids and none were sent |
| `400` | `{"error":"cup_uuids_mismatch"}` | `cup_uuids` length doesn't equal `cups` |
| `400` | `{"error":"invalid_cup_uuids"}` | Not an array, or an entry isn't a UUID v4 |
| `400` | `{"error":"duplicate_cup_uuids"}` | The same id appears twice in `cup_uuids` |
| `409` | `{"error":"cup_uuids_conflict"}` | Some of those cup ids already exist under a different batch |
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

`cup_uuids` is a **second** safety net for the same problem. If a retry
somehow carries a new `session_id` but the same cup ids, we recognise the
cups and return the original batch with `reused: true` rather than minting
a parallel one. Keep the cup ids stable across retries too, for the same
reason. If only *some* of the ids are already known we refuse the call
outright (`cup_uuids_conflict`) — a half-overlapping batch is a bug worth
surfacing, not something to guess at.

Recommended client behaviour: retry on network error / `5xx` / `429` with
backoff, using the same `session_id`, and only print once you have a `url`.
If you can't reach the server at all, do **not** print a QR — an unminted
UUID is not valid and would show the customer an error.

---

## Backup cups (Redirect Refund bins)

The bin always prints a receipt — including when it can't reach us. For
that case it holds a short list of **reserved cup ids** in its own config
and prints one (or several) instead of calling the API.

Nothing needs configuring on our side and there is no separate endpoint:
the bin just puts the ids in the QR as a comma-separated `cups` parameter
instead of a `batch`:

```
https://perks.packback.network/t3/?cups=<uuid>[,<uuid>…]
```

These ids never expire and mint a **new** Tikkie link on every scan —
they have to, because the same list is handed to many customers over the
bin's life. The customer sees exactly the same screen as a normal
receipt and is never told it came from the fallback.

Because they keep paying, they are fenced on our side: a per-cup cooldown,
a daily ceiling per venue, a full use log, and an **email alert on every
single use** — a backup scan means the bin was offline, which is worth
knowing immediately. All of that lives in the dashboard under
**Backup Cups**, which is also where the current list of ids is shown for
copying into the bin.

Ask a PackPerks admin for the list; it is deliberately not reproduced here.

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
  -d '{"cups":2,"session_id":"e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14",
       "cup_uuids":["7b1d9a52-4e33-4c07-9a61-2f8b5d0e14aa",
                    "a3f6e281-9c4d-4b52-8e07-16d9f3a70b8c"]}'
```

Send the same `session_id` twice — the second response must come back with
`"reused": true` and the same `batch_id`.

⚠️ Scanning a real receipt for a Redirect Refund org **spends real money**
(the payout plus the Tikkie fee). Use a small `cups` value when testing.
