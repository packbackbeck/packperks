# Connecting a smart bin to PackPerks — KFC

For whoever writes the bin's software. The bin needs no PackPerks code or
library: it makes **one HTTPS call per customer session** and prints **one
QR code** on the receipt. Everything else (which venue, what the cups are
worth, what the customer sees) is decided on the PackPerks side.

---

## 1. Configuration to put in the bin

| Setting | Value |
|---|---|
| Endpoint | `POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/bin-mint-batch` |
| Bin key (`X-Bin-Key` header) | **sent to you separately** — treat it like a password |
| Receipt URL prefix | `https://perks.packback.network/kfc/` |

The bin key is the only authentication (no API key, no login), and it is
also what tells PackPerks this bin belongs to KFC. Keep it out of logs,
screenshots and source control.

---

## 2. What the bin does each session

1. **Session opens** → generate a fresh **UUID v4**: the `session_id`.
2. **Each cup counted** → generate a UUID v4 for that cup (`cup_uuids`).
   Optional for KFC, but recommended: it makes every cup traceable on both
   sides and is a second guard against double counting.
3. **Session closes** → send the call below.
4. **On `200`** → print the receipt with a QR of the `url` from the
   response (it is always `https://perks.packback.network/kfc/?batch=<session_id>`).
5. **On a network error, `5xx` or `429`** → retry with backoff, always with
   the **same** `session_id` and the same `cup_uuids`. Retries are safe:
   the same session is never counted twice.

> **Print after the response, not before.** For KFC, a receipt scanned
> before PackPerks has received the call is shown to the customer as *not
> valid*. Wait for the `200` (normally well under a second) and then print.
> If the bin cannot reach PackPerks at all, keep the session in a queue
> that survives a reboot and send it when the connection is back — but do
> not hand out a receipt for it until it has gone through.

### The call

```http
POST /functions/v1/bin-mint-batch
Host: ozvcpbthnauitaphosfb.supabase.co
X-Bin-Key: <bin key>
Content-Type: application/json

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

| Field | Rule |
|---|---|
| `cups` | Whole number, 1–50 |
| `session_id` | UUID **v4** (the version is checked; v1 is refused). New per session, the same on every retry, never reused |
| `cup_uuids` | Optional. If sent: one UUID v4 per cup, as many as `cups`, no duplicates, and no id sent twice within 8 hours |

### The response (`200`)

```json
{
  "batch_id": "e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14",
  "url": "https://perks.packback.network/kfc/?batch=e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14",
  "cups": 3,
  "slug": "kfc",
  "reused": false
}
```

`reused: true` means this session had already been received and you are
getting the same batch back — print it as normal. The response also
carries `amount_eur` and `currency`: **ignore them at KFC**. KFC customers
redeem cups for rewards in the app, not for money, so a euro amount on the
receipt would be wrong.

### Errors

| Status | `error` | What to do |
|---|---|---|
| `401` | `missing_bin_key` / `invalid_bin_key` | Configuration problem — check the key. Don't retry |
| `400` | `invalid_cups`, `missing_session_id`, `invalid_session_id`, `cup_uuids_mismatch`, `invalid_cup_uuids`, `duplicate_cup_uuids` | A bug in the request. Don't retry; log it |
| `409` | `cup_uuids_conflict` | Some cup ids were already used in another session in the last 8 hours. Don't retry; log it |
| `429` | `rate_limited` | More than 120 sessions an hour from this bin. Retry later |
| `500` | `mint_failed` (or any `5xx`) | Retry with the same `session_id` |

---

## 3. The receipt

- A **QR code** of the `url`. Make it big enough for a phone camera to read
  from a crumpled receipt (keep it well above 20 mm square; around 30 mm is
  comfortable on an 80 mm roll), with a white margin around it.
- The **number of cups** returned, e.g. "3 cups returned".
- A short line such as "Scan to add your cups to KFC rewards".
- **No euro amount** (see above).

What the customer sees when they scan: the KFC rewards app opens and the
cups are added to their balance. One receipt credits once; scanning it
again shows that it was already used.

---

## 4. Testing

Every successful call adds **real cups** to KFC's app, so keep test calls
small and tell PackPerks when you are testing.

```bash
curl -X POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/bin-mint-batch \
  -H "X-Bin-Key: <bin key>" \
  -H "Content-Type: application/json" \
  -d '{"cups":1,"session_id":"<a new UUID v4>"}'
```

Checks before going live:

- [ ] A normal session returns `200` and the QR on the printed receipt opens
      `https://perks.packback.network/kfc/?batch=…` on a phone.
- [ ] Sending the same `session_id` twice returns the same `batch_id` with
      `"reused": true`.
- [ ] With the network unplugged, the session is queued, nothing is printed
      until it goes through, and it is sent once the network is back —
      including after a reboot.
- [ ] A wrong key gives `401` and the bin shows a fault rather than printing.
- [ ] The receipt shows the cup count and no euro amount.
