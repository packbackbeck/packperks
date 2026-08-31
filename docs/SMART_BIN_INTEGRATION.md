# Smart bin → PackPerks integration

How a physical smart bin turns a customer's deposit session into a printed
QR receipt that pays out.

The bin makes **one HTTP call per customer session**, sending the cup
count, a session UUID, and one UUID per cup — and it **prints the receipt
immediately, without waiting for the response**: the QR encodes the bin's
own session UUID, so there is nothing to wait for. The HTTP call registers
(validates) that session with PackPerks, and may land before or after the
customer scans. Everything else — which organisation the cups belong to,
what they're worth, whether the QR pays out via Tikkie or opens the app —
is decided server-side.

> **Changed 28 Aug 2026 — print-first.** The bin no longer waits for
> the response before printing. The server now uses the bin's
> `session_id` **verbatim as the batch id**, so the QR
> (`?batch=<session_id>`) can be printed the moment the session closes.
> The API call becomes the **validation**: until it arrives, a scanned
> receipt shows a "we're checking your receipt" screen where the customer
> can leave an email; once the call lands the link pays out and anyone
> who left an email is notified. Build the URL from the bin's configured
> prefix — see below. The old behaviour (print the `url` from the
> response) still works unchanged.

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
        │  bin mints a UUID v4 per cup as it counts them,
        │  plus one session UUID v4 for the whole session
        ▼
  bin session ends
        │
        ├─▶ print IMMEDIATELY:  QR = <url prefix>?batch=<session_id>
        │     (no waiting — the session UUID *is* the batch id)
        │
        └─▶ POST /bin-mint-batch        (send now; queue + retry until it lands)
              X-Bin-Key: <secret>  {cups, session_id, cup_uuids}
                   │
                   ▼
             PackPerks validates the session:
              · stores the cup ids      · batch_id = session_id
              · resolves earlier "pending" scans and emails anyone waiting

  customer scans it → https://perks.packback.network/t3/?batch=<session_id>
        │
        ├─ session validated   → Redirect Refund page → Tikkie link (bin-tikkie)
        │                        Deposit org → the PackPerks app (claim-cups)
        └─ call not landed yet → "we're checking your receipt" screen
                                 (customer may leave an email and gets the
                                  link once the bin's call arrives)
```

The receipt can be scanned before the call lands — that scan is *pending*,
not an error. It pays out from the moment the session is validated.

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
| `session_id` | **UUID v4** | **yes** | The bin's own id for this customer session. Generate a fresh one when the session opens. Used **verbatim as the batch id**, so the QR you print before calling already contains it. Makes retries safe — see below. |
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

`batch_id` always equals the `session_id` you sent, and `url` is the same
string a print-first bin has already put in the QR. A bin that still
prints after the response (fine for Deposit orgs) should keep encoding
`url` verbatim.

Print-first bins build the URL themselves:

```
<url prefix>?batch=<session_id>
e.g. https://perks.packback.network/t3/?batch=e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14
```

The prefix — including the org slug — is part of the bin's configuration.
One caveat the server used to handle for you: when a bin is repointed at a
different organisation (see **Provisioning**), the configured prefix must
be updated at the same time, because the server can no longer inject the
current slug into a receipt it never saw before printing.

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

Recommended client behaviour: print immediately, then send the call and
retry on network error / `5xx` / `429` with backoff, always with the same
`session_id`. Keep undelivered sessions in a store-and-forward queue that
survives reboots and drain it whenever connectivity returns — the printed
receipt only pays out once its call has landed. A session delivered hours
late is still honoured in full, and anyone who left their email on the
waiting screen is mailed their link the moment it is.

---

## When the call hasn't landed yet (pending receipts)

Print-first means a customer can scan a receipt PackPerks has never heard
of. That scan is treated as **not validated yet**, never as invalid:

- The page says we're checking the receipt (it can take up to ~30
  minutes) and offers an email field — "email me when it's ready" — plus
  an OPTIONAL "also create a PackPerks account" toggle (which carries the
  privacy-policy consent). Email without the toggle is stored as a
  notification-only contact; with it, a refund account is created and the
  customer lands on their refunds home immediately.
- While the customer stays on the screen, the page quietly polls; the
  moment the bin's session lands, it switches to the normal refund page
  by itself — no re-scan needed.
- The unknown batch id is recorded server-side as a *pending* sighting.
- The moment the bin's `/bin-mint-batch` call arrives with that
  `session_id`, the batch mints as normal, the pending sighting is
  resolved, and anyone who left an email gets a "your refund is ready to
  collect" message with the link. If they pre-registered, the payout is
  attached to their PackPerks refund account automatically.

Nothing is required from the bin beyond eventually delivering the queued
call. If a session can never be delivered (dead bin, lost queue), the
receipt stays pending — which is what the backup cups below are for.

---

## Backup cups (Redirect Refund bins)

Print-first plus a delivery queue covers temporary outages. Backup cups
are the **last resort** for when the bin knows the session may never be
delivered at all (no queue, storage failure, key trouble): it holds a
short list of **reserved cup ids** in its own config and prints one (or
several) instead of a session id.

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
Each link is paid straight out of the venue's Tikkie cashback account;
there is no per-link charge for issuing one.

---

## What the server does on scan

Not the bin's problem, but useful context when debugging a receipt:

1. The QR opens `/<slug>/?batch=<uuid>` in the phone's browser.
2. For a **Redirect Refund** org the app calls `bin-tikkie`, which
   atomically claims the batch's cups, creates one claim, and mints a
   Tikkie cashback link. The page then explains how Tikkie works (IBAN +
   last name — no Visa/Mastercard) and offers two actions: **Open
   Tikkie**, or leave an email to save the refund for later, which
   creates a PackPerks refund account with its own home page and history.
   It no longer auto-redirects.
   If the bin's session hasn't been delivered yet, the same scan shows
   the pending "we're checking your receipt" screen instead.
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
