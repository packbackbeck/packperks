# Smart bin setup — KFC

For whoever writes the bin's software. The KFC bin needs no PackPerks code,
library, account or connection: it shows **one QR on its screen** and
prints **one receipt** after each customer session. Both QR codes are fixed
links, so the bin works the same with or without internet.

---

## 1. The two QR codes

| QR | Where | Link | What a scan does |
|---|---|---|---|
| **Screen QR** | On the bin's **screen**, all the time | `https://perks.packback.network/kfc/?byo=1` | Opens KFC's PackPerks page and adds **+1 cup**, up to a per-person limit |
| **Receipt QR** | Printed on the **receipt** after every session | `https://perks.packback.network/demo/kfc` | Opens Packback inside the **KFC app** and adds a point |

Neither link ever changes. Generate both QR codes once and keep them in the
bin.

---

## 2. Configuration to put in the bin

| Setting | Value |
|---|---|
| Screen QR link | `https://perks.packback.network/kfc/?byo=1` |
| Receipt QR link | `https://perks.packback.network/demo/kfc` |
| Restaurant name (receipt footer) | The KFC restaurant's name, **27 characters at most**, e.g. `KFC Amsterdam Centraal` |

There is no API to call and no key to store.

---

## 3. What the bin does

- **Always:** show the screen QR on the screen (or at least on the idle and
  "thank you" screens).
- **When a customer's session ends** (they have put their cups in): print
  the receipt in section 5. Nothing is sent anywhere, so print straight
  away, online or offline.

---

## 4. What the customer gets

**Screen QR.** Every scan adds one cup to the customer's balance on KFC's
PackPerks page, up to a per-person limit that PackPerks sets for KFC (two a
day unless changed). A scan past the limit is not lost: it waits for
approval, and the customer is told it is being checked. The bin doesn't
need to know the limit.

**Receipt QR.** Opens Packback inside the KFC app: the customer's points,
the rewards they can redeem with them, and a voucher to scan at the
self-order kiosk. Each time the page is opened counts as one returned cup,
until the customer has enough for their first reward. It runs entirely on
the customer's phone, so nothing reaches KFC's or PackPerks' real numbers.

---

## 5. The receipt design

Drawn for an **80 mm thermal roll at 203 dpi: 512 dots across, 8 dots to
the millimetre**, the same as the PackPerks Epson TM-m30III. The files are
in [`bin-receipts/kfc/`](bin-receipts/kfc/):

| File | What it is |
|---|---|
| `header.png` | The top of the receipt, **512 × 587 dots**, pure black and white. Print it as one raster image, 1:1, centred. Don't scale it |
| `preview-demo.png` | The whole receipt as it should come out, for reference |

The receipt is worded for the **KFC app** it opens, in that app's own
words: a small Packback logo, **GET YOUR FREE REWARD**, *Bring your cup
back, get points in the KFC app.*, the app's three steps as boxes (*Return
your cup*, *Scan for points*, *Redeem at the kiosk*) and **Scan to get your
points**. Under the QR: *1 cup = 1 point.* and *Redeem with points in the
KFC app.* KFC has no deposit, so there is no refund, euro amount or cup
count anywhere on the receipt.

### What the bin prints, top to bottom

A *line* is one line of the printer's Font A: 12 × 24 dots on a 30-dot
pitch (42 characters across 504 dots). A *blank line* is 30 dots (3.75 mm)
of white.

| # | Block | How | Size and spacing |
|---|---|---|---|
| 1 | Header | `header.png`, raster image | 512 × 587 dots, already includes its own top margin, the space between its blocks and 24 dots under the last line |
| 2 | Gap | 1 blank line | 30 dots |
| 3 | QR | The printer's own QR command, model 2, error correction **M**, **11 dots a module**, centred | 29 × 29 modules = 319 dots, about **40 mm** |
| 4 | Gap | 2 blank lines | 60 dots |
| 5 | Two lines, bold, centred | `1 cup = 1 point.` / `Redeem with points in the KFC app.` | Font A, emphasised |
| 6 | Gap | 2 blank lines | 60 dots |
| 7 | Rule | 42 × `-`, left aligned | Font A |
| 8 | Footer, left aligned | `Time:` then `Restaurant:` | Label padded to 15 characters, value after it |
| 9 | Paper before the cut | 2 blank lines, then a feed-and-cut | 60 dots |

Footer values:

| Label | Value | Example |
|---|---|---|
| `Time:` | Day, short month, year, 24-hour time | `10 Nov 2026, 12:07` |
| `Restaurant:` | The restaurant's name, **27 characters at most** so it fits on one line after the label. Shorten it rather than let it wrap | `KFC Amsterdam Centraal` |

On an Epson printer with ePOS-Print the whole receipt is (time filled in by
the bin):

```xml
<text align="center"/>
<image width="512" height="587" color="color_1" mode="mono" align="center">…header.png, 1 bit a dot…</image>
<feed line="1"/>
<symbol type="qrcode_model_2" level="level_m" width="11" height="11">https://perks.packback.network/demo/kfc</symbol>
<feed line="2"/>
<text em="true">1 cup = 1 point.&#10;Redeem with points in the KFC app.&#10;</text>
<text em="false"/>
<feed line="2"/>
<text>------------------------------------------&#10;</text>
<text align="left"/>
<text>Time:          10 Nov 2026, 12:07&#10;</text>
<text>Restaurant:    KFC Amsterdam Centraal&#10;</text>
<feed line="2"/>
<cut type="feed"/>
```

Any other ESC/POS printer does the same with its raster-image, QR and text
commands.

### The screen QR

Show `https://perks.packback.network/kfc/?byo=1` at **at least 4 cm across**
at the screen's real size, black on white, with a white margin of at least
four modules around it. Avoid placing it on a coloured or patterned
background.

---

## 6. Testing

- [ ] The screen shows the screen QR, and scanning it with a phone opens
      KFC's PackPerks page and adds a cup.
- [ ] A finished session prints the receipt, and scanning its QR opens
      `https://perks.packback.network/demo/kfc` (Packback in the KFC app).
- [ ] With the network unplugged, the receipt still prints the same.
- [ ] The printed receipt matches `preview-demo.png`: the header is the same
      size (not scaled) and the gaps are the same.
- [ ] No receipt shows a euro amount or a cup count, and the restaurant
      name fits on one line.
- [ ] The receipt QR scans from about 30 cm away.
