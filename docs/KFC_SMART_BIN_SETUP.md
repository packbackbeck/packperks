# Connecting a smart bin to PackPerks — KFC

For whoever writes the bin's software. The bin needs no PackPerks code or
library: it shows **one QR on its screen**, makes **one HTTPS call per
customer session**, and prints **one QR on the receipt**. Everything else
(which venue, what the cups are worth, what the customer sees) is decided on
the PackPerks side.

---

## 1. The three QR codes

| QR | Where | Link | What a scan does | Calls PackPerks? |
|---|---|---|---|---|
| **Receipt QR** | Printed after each session (normal mode) | `https://perks.packback.network/kfc/?batch=<session_id>` | Adds that session's cups to the customer's KFC balance, once | Yes, one call per session (section 3) |
| **Static QR** | On the bin's **screen**, all the time; also printed on the receipt when the bin is **offline** | `https://perks.packback.network/kfc/?byo=1` | Adds **+1 cup** on every scan, up to a per-person limit | No, it never changes |
| **Demo receipt QR** | Printed instead of the receipt QR when **demo mode** is on | `https://perks.packback.network/demo/kfc` | Opens the Packback demo inside the KFC app | No |

The static QR and the demo link are fixed: generate them once and keep them
in the bin. Only the receipt QR is different every session.

---

## 2. Configuration to put in the bin

| Setting | Value |
|---|---|
| Endpoint | `POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/bin-mint-batch` |
| Bin key (`X-Bin-Key` header) | **sent to you separately** — treat it like a password |
| Receipt URL prefix | `https://perks.packback.network/kfc/` |
| Static QR | `https://perks.packback.network/kfc/?byo=1` |
| Demo receipt QR | `https://perks.packback.network/demo/kfc` |
| Receipt mode | `packperks` (default) or `demo` — a switch on the bin, see section 5 |

The bin key is the only authentication (no API key, no login), and it is
also what tells PackPerks this bin belongs to KFC. Keep it out of logs,
screenshots and source control.

---

## 3. What the bin does each session (receipt mode `packperks`)

1. **Session opens** → generate a fresh **UUID v4**: the `session_id`.
2. **Each cup counted** → generate a UUID v4 for that cup (`cup_uuids`).
   Optional for KFC, but recommended: it makes every cup traceable on both
   sides and is a second guard against double counting.
3. **Session closes** → send the call below. If it fails with a network
   error, `5xx` or `429`, retry straight away with the **same**
   `session_id` and `cup_uuids` (the same session is never counted twice).
   Keep trying for up to **5 seconds** in total.
4. **On `200`** → print the receipt with a QR of the `url` from the
   response (it is always `https://perks.packback.network/kfc/?batch=<session_id>`).
5. **No `200` within 5 seconds, or any `4xx`** → the bin is offline or
   misconfigured. Print the **offline receipt** instead (section 4), stop
   retrying, and drop the session: don't send it later. The customer's cup
   already reaches them through the static QR, so sending the session
   afterwards would only create cups nobody can claim. Log any `4xx`: it
   means a bug or a wrong key, not a bad connection.

> **Why the bin waits for the `200` before printing the receipt QR:** at
> KFC, a receipt QR scanned before PackPerks has received its session is
> shown to the customer as *not valid*. The call normally answers in well
> under a second.

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
| `401` | `missing_bin_key` / `invalid_bin_key` | Wrong key. Print the offline receipt and show a fault |
| `400` | `invalid_cups`, `missing_session_id`, `invalid_session_id`, `cup_uuids_mismatch`, `invalid_cup_uuids`, `duplicate_cup_uuids` | A bug in the request. Print the offline receipt and log it |
| `409` | `cup_uuids_conflict` | Some cup ids were already used in another session in the last 8 hours. Print the offline receipt and log it |
| `429` | `rate_limited` | More than 120 sessions an hour from this bin. Retry within the 5 seconds, then the offline receipt |
| `500` | `mint_failed` (or any `5xx`) | Retry within the 5 seconds, then the offline receipt |

---

## 4. The static QR (screen, and offline receipts)

`https://perks.packback.network/kfc/?byo=1` never changes and needs no call,
so it works even when the bin has no connection at all.

- **On the bin's screen:** show it all the time (or on the idle and
  "thank you" screens). Scanning it opens KFC's PackPerks page and adds one
  cup.
- **On the offline receipt:** when step 5 above applies, print this QR
  instead of the receipt QR, with a line such as "Scan to add your cup".
  Don't print a cup count: the static QR adds **one cup per scan**, however
  many cups went in.

Every scan adds +1 cup, up to a per-person limit that PackPerks sets for
KFC (two a day unless changed). A scan past the limit is not lost: it waits
for KFC or PackPerks to approve it, and the customer is told it is being
checked. Nothing on the bin needs to know the limit.

---

## 5. Demo mode (this bin only)

For sales demos the bin can print a receipt that opens the **Packback demo
inside the KFC app** instead of the real KFC rewards.

- A switch in the bin's settings: receipt mode `packperks` (default) or
  `demo`.
- In `demo` mode, at the end of every session the bin prints a receipt with
  a QR of `https://perks.packback.network/demo/kfc` and makes **no call to
  PackPerks**. The demo runs entirely on the customer's phone: each time
  the page is opened counts as one returned cup, and nothing reaches KFC's
  real numbers.
- The **screen keeps showing the static QR** to KFC's real PackPerks page in
  both modes.
- Keep demo mode off for real customers: their cups are not saved anywhere
  in demo mode.

---

## 6. The receipt

| | Receipt QR (`packperks`) | Offline receipt | Demo receipt (`demo`) |
|---|---|---|---|
| QR | `url` from the response | `…/kfc/?byo=1` | `…/demo/kfc` |
| Text | "3 cups returned" + "Scan to add your cups to KFC rewards" | "Scan to add your cup" | "Scan to try Packback in the KFC app" |
| Euro amount | No | No | No |

Make each QR big enough for a phone camera to read from a crumpled receipt
(keep it well above 20 mm square; around 30 mm is comfortable on an 80 mm
roll), with a white margin around it. The same goes for the QR on the
screen: aim for at least 4 cm across at the screen's real size.

What the customer sees when they scan a receipt QR: the KFC rewards app
opens and the cups are added to their balance. One receipt credits once;
scanning it again shows that it was already used.

---

## 7. Testing

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
- [ ] The screen shows the static QR, and scanning it opens KFC's page and
      adds a cup.
- [ ] With the network unplugged, the bin prints the offline receipt within
      about 5 seconds, and its QR is the static one.
- [ ] A wrong key gives `401`, the bin prints the offline receipt and shows a
      fault.
- [ ] With receipt mode `demo`, the receipt opens
      `https://perks.packback.network/demo/kfc` and no call is made.
- [ ] No receipt shows a euro amount.
