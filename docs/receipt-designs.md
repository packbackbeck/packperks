# Receipt designs — the format, and printing them on anything

**Generate → Dynamic QR code → Design** offers the tall thermal receipt plus
four landscape artworks: Banknote Simple, Banknote Full, Willy Wonka, Ticket.

None of the artwork is tied to a printer. The Epson is one consumer of it; a
print shop, a label printer or a different receipt printer are all the same
job with a different last step. This is what the format is and how to feed
something else with it.

---

## Three layers

```
scripts/receipt-designs/source/<id>.source.svg   the Figma export, untouched
        │  python3 scripts/receipt-designs/build.py
        ▼
public/receipt-designs/<id>.svg                  template: slots, no values
        │  renderDesign(id, values, qrDataUrl)   ← src/admin/cupqr/receiptDesigns.js
        ▼
one self-contained SVG string                    the printable sheet
```

The third layer is the deliverable. It carries the artwork as vector, the live
values as real text, and **the fonts inside it as base64**, so it renders the
same anywhere with nothing installed. Every output the app produces —
preview, JPG, PDF, browser print, thermal — is that one string drawn a
different way. That is what makes them agree.

| Design id | px | at 180 mm wide |
|---|---|---|
| `banknote-simple` | 1782 × 771 | 180 × 77.9 mm |
| `banknote-full` | 1916 × 821 | 180 × 77.1 mm |
| `willi-wonka` | 1821 × 740 | 180 × 73.2 mm |
| `ticket` | 1774 × 764 | 180 × 77.5 mm |

## The slots

`qr` in all four, plus:

| Design | Slots |
|---|---|
| `banknote-simple`, `banknote-full` | `strip` (the TIME/CUPS line), `amount` |
| `willi-wonka` | `amount` |
| `ticket` | `amount`, `amountStub`, `time`, `cups`, `total`, `session` |

`designValues({ symbol, total, cups, when, session })` fills all four at once.
Each slot shrinks itself if the value is wider than the space the artwork left
it — `data-pp-maxw` on the element is that space. At €2.00 the two banknotes
already shrink about 10%, because the mock was drawn with a whole-euro amount.

Everything else on a sheet is outlined vector and **cannot** be changed from
the app. To change fixed wording, redraw it in Figma, replace the file in
`scripts/receipt-designs/source/`, adjust the `cut`/`slots` tables at the top
of `build.py` if anything moved, and re-run it.

## Printing on something else

### A normal printer or a print shop

Export a PDF from the page (Receipt preview → **PDF**), or render the SVG at
whatever size. It is vector; scale freely.

### Another receipt printer

Three steps, and only the third is vendor-specific:

1. **Turn it a quarter turn** — `rasteriseForThermal()`. These are landscape
   notes about 2.3:1. Upright on an 80 mm roll their QR lands around 10 mm and
   will not scan; sideways it is about 25 mm.
2. **Scale to the paper's dot width and threshold to 1 bit.** 80 mm at 203 dpi
   is **512 dots**, 58 mm is **384**. Must be a multiple of 8. The QR is drawn
   nearest-neighbour (`image-rendering="pixelated"`) — a smoothed module edge
   does not survive thresholding and the code stops scanning.
3. **Send it as one raster image.**

| Printer | Step 3 |
|---|---|
| Epson, ePOS-Print | `printDesignSheet()` — `<image mode="mono">` POSTed to `/cgi-bin/epos/service.cgi`. See [printer-setup.md](printer-setup.md) |
| Raw ESC/POS on port 9100 | `GS v 0` raster bit image, then `GS V` to cut |
| Star (StarPRNT / CloudPRNT) | `ESC k` raster, or hand CloudPRNT a PNG |
| Brother / Zebra labels | PNG or PDF through the vendor SDK; no rotation if the label is landscape |

`canvasToEposImage()` in `src/admin/lib/eposPrint.js` is the 1-bit packer
(MSB first, 1 = black) — the same bit layout `GS v 0` wants, so a raw ESC/POS
path can reuse it and change only the envelope.

Below roughly 400 dots of paper width the QR gets marginal on these designs.
Judge that by scanning a real print, not by looking at it.

## Fonts

The artwork is outlines and needs none. The live values use three fonts, all
SIL OFL, self-hosted in `public/fonts/` and embedded in every sheet:

- **Figtree** — Ticket amounts and stub, Banknote Simple's TIME line
- **Bevan** — both banknote amounts
- **Playfair Display** — Banknote Full's TIME line, Willy Wonka's amount

Near matches for the faces in the original artwork, not the originals.

## Caveat

All four are worded for a deposit refund paid through Tikkie — *scan QR to
open Tikkie*, *enter your IBAN*. That text is vector, so it does not follow
the venue's mode. On a Deposit Rewards venue it is wrong.
