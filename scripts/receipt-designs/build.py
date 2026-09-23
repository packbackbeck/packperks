#!/usr/bin/env python3
"""Turn the four Figma receipt artworks into printable templates.

The Figma exports in ./source are pure vector — the designer already
converted every word to outlines, so nothing in them can change. This
script takes each one and cuts out only the parts that HAVE to change per
batch (the amount, the time/cup line, the ticket stub, the QR placeholder),
leaving a named slot behind. Everything else stays byte-for-byte as it was
exported, which is what keeps the printed sheet identical to the mock.

The slots are `<text data-pp-slot="…">__PP_SLOT__</text>` placeholders;
`src/admin/cupqr/receiptDesigns.js` fills them at print time and reads the
`data-pp-*` attributes to fit the value to the space it has.

Run it from the repo root after changing a source artwork:

    python3 scripts/receipt-designs/build.py

Output: public/receipt-designs/<id>.svg (committed — the app fetches them).

Picking the numbers again: every geometry figure below was measured off the
source by bounding box, and each font size is `ink height / (the font's ink
height at 100px) `. `ls` (letter-spacing) and `scalex` make the replacement
cover the same width as the outlines it replaces — the designer tracked
these lines out (or squeezed them) in Figma, and a stock font does not.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source')
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'receipt-designs'))

# Family names the app maps to self-hosted woff2 in receiptDesigns.js. They
# are deliberately not the bare font names, so nothing picks up a same-named
# font that happens to be installed on the admin's machine.
FIG = 'PackPerks Figtree'
PLAY = 'PackPerks Playfair'
BEVAN = 'PackPerks Bevan'

DESIGNS = {
    'banknote-simple': dict(
        source='banknote-simple.source.svg',
        # x, y, size of the rect the export uses as a QR placeholder.
        qr=(1247.82, 304.038, 204.803),
        # Every path whose bounding box sits inside one of these is dropped.
        cut=[(690, 63, 1100, 100), (635, 640, 1150, 690)],
        slots=[
            dict(slot='strip', x=894.45, y=94.3, size=33.7, ls=0,
                 family=FIG, weight=500, fill='#FFFFFF', anchor='middle', maxw=520),
            dict(slot='amount', x=892.3, y=685.5, size=49.9, ls=2.7,
                 family=BEVAN, weight=400, fill='#FFFFFF', anchor='middle', maxw=530),
        ],
    ),
    'banknote-full': dict(
        source='banknote-full.source.svg',
        qr=(1361, 299, 225),
        cut=[(745, 34, 1170, 68), (570, 655, 1345, 745)],
        slots=[
            dict(slot='strip', x=957.5, y=63.6, size=34.6, ls=2.2,
                 family=PLAY, weight=700, fill='#000000', anchor='middle', maxw=440),
            dict(slot='amount', x=957.9, y=728.4, size=80.7, ls=0,
                 family=BEVAN, weight=400, fill='#FFFFFF', anchor='middle', maxw=790),
        ],
    ),
    'ticket': dict(
        source='ticket.source.svg',
        qr=(892, 194, 295),
        cut=[(185, 570, 660, 710), (1380, 195, 1655, 275)],
        slots=[
            dict(slot='amount', x=422.65, y=701, size=172.8, ls=0,
                 family=FIG, weight=800, fill='#000000', anchor='middle', maxw=500),
            dict(slot='amountStub', x=1516.75, y=270.2, size=97.8, ls=0,
                 family=FIG, weight=800, fill='#000000', anchor='middle', maxw=320),
            # Values written on the stub's four ruled lines.
            dict(slot='time', x=1410, y=395.6, size=30, ls=0,
                 family=FIG, weight=400, fill='#000000', anchor='start', maxw=300),
            dict(slot='cups', x=1410, y=450.5, size=30, ls=0,
                 family=FIG, weight=400, fill='#000000', anchor='start', maxw=300),
            dict(slot='total', x=1410, y=505.2, size=30, ls=0,
                 family=FIG, weight=400, fill='#000000', anchor='start', maxw=300),
            dict(slot='session', x=1410, y=560.8, size=30, ls=0,
                 family=FIG, weight=400, fill='#000000', anchor='start', maxw=300),
        ],
    ),
    'willi-wonka': dict(
        source='willi-wonka.source.svg',
        qr=(1504, 342, 225),
        cut=[(1500, 215, 1730, 312)],
        slots=[
            # The artwork's amount is a condensed fat Didone; Playfair is the
            # nearest open face, squeezed to the same width.
            dict(slot='amount', x=1617, y=308.9, size=118.6, ls=0, scalex=0.68,
                 family=PLAY, weight=900, fill='#000000', anchor='middle', maxw=240),
        ],
    ),
}


# ── A bounding box for an SVG path, from its control points ──────────────
# Control points bound the curve they describe, so this over-estimates by a
# hair and never under-estimates — which is what we want when deciding
# whether a path belongs to the run of text being cut out.
NUM = r'-?\d*\.?\d+(?:[eE]-?\d+)?'


def path_bbox(d):
    toks = re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|' + NUM, d)
    x = y = sx = sy = 0.0
    cmd = None
    i = 0
    xs, ys = [], []

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t
            i += 1
            if cmd in 'Zz':
                x, y = sx, sy
                continue
        if cmd is None:
            i += 1
            continue
        c, rel = cmd.upper(), cmd.islower()
        try:
            if c == 'M':
                nx, ny = num(), num()
                x, y = (x + nx if rel else nx), (y + ny if rel else ny)
                sx, sy = x, y
                xs.append(x); ys.append(y)
                cmd = 'l' if rel else 'L'   # implicit lineto after a moveto
            elif c == 'L':
                nx, ny = num(), num()
                x, y = (x + nx if rel else nx), (y + ny if rel else ny)
                xs.append(x); ys.append(y)
            elif c == 'H':
                nx = num()
                x = x + nx if rel else nx
                xs.append(x); ys.append(y)
            elif c == 'V':
                ny = num()
                y = y + ny if rel else ny
                xs.append(x); ys.append(y)
            elif c in ('C', 'S', 'Q', 'T'):
                n = {'C': 3, 'S': 2, 'Q': 2, 'T': 1}[c]
                px, py = x, y
                for _ in range(n):
                    nx, ny = num(), num()
                    px, py = (x + nx if rel else nx), (y + ny if rel else ny)
                    xs.append(px); ys.append(py)
                x, y = px, py
            elif c == 'A':
                for _ in range(5):
                    num()
                nx, ny = num(), num()
                x, y = (x + nx if rel else nx), (y + ny if rel else ny)
                xs.append(x); ys.append(y)
            else:
                i += 1
        except (IndexError, ValueError):
            break
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def inside(box, rect):
    if not box:
        return False
    return (box[0] >= rect[0] - 1 and box[1] >= rect[1] - 1
            and box[2] <= rect[2] + 1 and box[3] <= rect[3] + 1)


def build(key, cfg):
    doc = open(os.path.join(SRC, cfg['source'])).read()

    # 1. Drop the outlined text we are about to replace with a live value.
    kept, last, cut = [], 0, 0
    for m in re.finditer(r'<path\b[^>]*?\bd="([^"]*)"[^>]*>', doc):
        box = path_bbox(m.group(1))
        if any(inside(box, r) for r in cfg['cut']):
            kept.append(doc[last:m.start()])
            cut += 1
        else:
            kept.append(doc[last:m.end()])
        last = m.end()
    kept.append(doc[last:])
    doc = ''.join(kept)

    # 2. The QR placeholder is a rect filled with an embedded raster. Swap it
    #    for a slot and bin the raster, which would otherwise ride along in
    #    every print as ~4 KB of a QR code nobody can scan.
    qx, qy, qs = cfg['qr']
    rect = re.search(r'<rect[^>]*fill="url\(#pattern0[^"]*\)"[^>]*/>', doc)
    if not rect:
        sys.exit(f'{key}: no QR placeholder rect found')
    doc = (doc[:rect.start()]
           + f'<image data-pp-slot="qr" x="{qx}" y="{qy}" width="{qs}" height="{qs}"'
             f' preserveAspectRatio="none" href="__PP_QR__"/>'
           + doc[rect.end():])
    doc = re.sub(r'<pattern id="pattern0[^>]*>.*?</pattern>', '', doc, flags=re.S)
    doc = re.sub(r'<image id="image0[^>]*/>', '', doc, flags=re.S)

    # 3. Append the live slots last, so they paint over the artwork.
    texts = []
    for s in cfg['slots']:
        scalex = s.get('scalex', 1)
        attrs = [
            f'data-pp-slot="{s["slot"]}"',
            f'data-pp-size="{s["size"]}"',
            f'data-pp-maxw="{s["maxw"]}"',
            f'data-pp-scalex="{scalex}"',
            f'x="{s["x"]}"', f'y="{s["y"]}"',
            f'font-family="{s["family"]}"', f'font-weight="{s["weight"]}"',
            f'font-size="{s["size"]}"', f'letter-spacing="{s["ls"]}"',
            f'fill="{s["fill"]}"', f'text-anchor="{s["anchor"]}"',
            'xml:space="preserve"',
        ]
        text = f'<text {" ".join(attrs)}>__PP_{s["slot"].upper()}__</text>'
        if scalex != 1:
            # Squeeze horizontally about the anchor, so x still means x.
            texts.append(
                f'<g transform="translate({round(s["x"] * (1 - scalex), 3)} 0)'
                f' scale({scalex} 1)">{text}</g>')
        else:
            texts.append(text)
    end = doc.rindex('</svg>')
    doc = doc[:end] + ''.join(texts) + doc[end:]

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, key + '.svg'), 'w') as fh:
        fh.write(doc)
    print(f'{key}: cut {cut} outlined paths, {len(cfg["slots"])} slots, {len(doc) // 1024} KB')


if __name__ == '__main__':
    for k, c in DESIGNS.items():
        build(k, c)
