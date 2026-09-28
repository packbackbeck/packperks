# For the Claude that works on PackPulse: how PackPerks builds its heatmap and session replay

PackPerks rebuilt the **Heatmap** and **Session replay** sections of User
analytics. This prompt covers two things:

- **Part 1** is what changed for the page PackPulse already embeds
  (`page: "behaviour"`). It is short, and most of it needs no code.
- **Part 2** is the whole design, in enough detail to build the same thing
  natively in PackPulse: capture, storage, the device frame, the heat, and
  the player. Use it if PackPulse wants its own heatmap and replay rather
  than only showing ours in the iframe.

Read Part 1 first either way. Do not change anything about the handshake,
link secret, tickets or postMessage contract: none of it changed.

---

## Part 1: what changed in the embedded page

### Nothing to change in the contract

Same page id (`behaviour`), same ticket call, same `ready` / `size` /
`navigate` / `theme` messages. If User analytics already shows in PackPulse,
the new version arrives on its own with the next PackPerks deploy.

### What a PackPulse viewer now sees

**Heatmap.** The venue's real customer app runs in a phone, and the heat is
drawn on it. Three views: *Taps* (heat), *Scroll* (how far down visits got,
as bands) and *Controls* (each button shaded by use; the ones nobody touches
stay cold). Taps are now pinned to the button they hit rather than to a spot
on the page, so heat sits on the button it belongs to (see Part 2, section 3).

**Session replay.** Three parts, all on one clock:

- the phone, playing the visit;
- **What they did**: a list of every screen opened, tap, scroll and exit,
  with its time. The current one is highlighted as it plays, and clicking
  one jumps there and plays it;
- one control bar under the phone: play/pause, a scrubber with a mark for
  each action, 1x/2x/4x, and *Skip pauses*.

Every tap is drawn as a pulse where the finger landed, with the button's
name in a label beside it.

### What is different for a PackPulse connection, on purpose

**PackPulse never receives recordings.** A recording (the rrweb copy of the
customer's screen) is the most sensitive thing PackPerks stores. It lives in
`ux_replays`, which has no `packpulse_*` view and never will. Inside
PackPulse the replay therefore always uses its fallback: the same *What they
did* list and taps, played over the venue's app as it looks today rather
than over the customer's own screen. Say so in your copy if you describe
the feature ("steps and taps, not a screen recording"). Do not report it as
a bug.

Everything else behind these sections (visits, taps, control names, scroll
depth, layouts) is readable by the connection through the views and guarded
functions described in `PROMPT_USER_ANALYTICS.md`.

### Layout notes for your iframe

- The page is still one sidebar entry. Do not mirror its internal tabs.
- Keep `allow-scripts allow-same-origin` if you sandbox our iframe. The
  phone is a nested iframe of the customer app, and without those it renders
  blank.
- Below about 1240px of iframe width, the *What they did* list moves under
  the phone instead of beside it. Below 860px the visit list becomes a
  horizontal strip. So the page can get taller as your content column gets
  narrower. Keep honouring `size` messages and never cap the height.
- The replay player runs on `requestAnimationFrame`. In a background tab the
  browser pauses that, so playback stands still until the tab is visible
  again. That is expected browser behaviour.

### How to check it

1. Open User analytics for a shared test venue and go to **Heatmap**. The
   phone must show the whole app width: the account button at the top
   right is fully visible, nothing is cut off on the right. (It used to be
   cropped by 24px; see Part 2, section 5.)
2. Switch between Taps, Scroll and Controls. Heat and bands sit on the app's
   buttons, not beside them.
3. Go to **Session replay** and pick a visit. The *What they did* list fills,
   Play moves the highlight down the list, and a tap shows a pulse and the
   button's name.
4. Click a step in the list: playback jumps to just before it and plays it.
5. Confirm the note under the list reads that there is no recording for the
   visit. That is correct for a connection.

---

## Part 2: how it is built, so PackPulse can build its own

Everything below is how PackPerks does it, including the mistakes worth not
repeating. File names are PackPerks paths, for reference only.

### 1. What gets captured, and when

Capture runs in the customer app (`src/lib/uxCapture.js`) and **only** for
visitors who switched on the *Analytical* cookie category. Nothing typed,
no field contents, no pointer trail.

Four event kinds go to `ux_events`, one row each:

| kind | when | carries |
|---|---|---|
| `view` | a screen or sheet opens | `screen` |
| `click` / `rage` / `dead` | a tap | the anchor fields below |
| `scroll` | the furthest point reached grows by a step | `depth` 0..1 |
| `leave` | the page is hidden or closed | nothing extra |

A **rage** tap is three taps within about a second inside a small radius. A
**dead** tap is one that hit no control at all. Every row has `at` (the
browser's clock, ISO), `seq`, `session_id`, `screen`, `vw`, `vh`, `dh`.

`screen` is not the URL. It is whatever the app says is on top: the home, or
the name of the sheet or modal currently open. That is what gives popups
their own heatmap instead of smearing them over the page underneath.

A per-venue config row decides what is captured (`enabled`, `sample`,
`clicks`, `scroll`, `replay`, `layouts`, `retentionDays`). The ingest
function reads the same row before storing anything, so switching something
off stops it at the server, not just in the UI.

Ingest is one edge function, the only writer. Caps: 300 rows per batch,
3,000 per visit, 300 new visits per IP per hour. A visit already under way
is never cut off mid-flow.

### 2. Naming a control (the key)

A tap is only useful if you know *which button* it hit, in a way that is the
same tomorrow and on someone else's account. `src/lib/uxKeys.js` is used by
**both** the customer app (when writing a tap) and the dashboard (when
finding that button again). One module, so the two can never disagree.

**Finding the control under the finger:** walk up from the tapped element to
the nearest native control (`button, a[href], [role=button], input, label,
…`). If there is none, take the **outermost** element of the run of
ancestors with `cursor: pointer`. Half of this app's buttons are card-shaped
divs with an onClick, and `cursor: pointer` is how the stylesheet already
marks them pressable. The *outermost* matters because `cursor` inherits: the
innermost element is just whichever label was under the thumb.

**The key** is:

1. `data-ppk="…"` when a component sets one (the reliable way);
2. otherwise `tag:first-meaningful-class:name`, where *name* is the
   `aria-label` if there is one, else **the first three words of the visible
   text with every digit removed**.

Why three words and no digits: the wallet tile reads "Available to collect
€0.90" for one customer and "Available to collect €1.80 Collect it all
below…" for another. Keyed on the full text, one button had a different
identity per customer and matched nothing. Three words without numbers
survives both.

**The label** (what the dashboard shows) is separate from the key. It joins
the control's pieces of text with spaces ("2 cups returned 16 Sept + €0.20").
The key still uses the run-together `textContent`. **A key must never change
when you improve a label**: every stored tap carries the old key, and a
changed key stops matching its own button. PackPerks checked all 53 controls
of one screen after changing the label: zero keys changed.

**Privacy:** anything inside `[data-ppk-private]` (the profile block) is
never named. Labels that look personal (an email, an IBAN, a long number)
are masked before they leave the browser.

### 3. Where a tap is: anchor it to the button, not the page

**The mistake to avoid.** The first version stored `y = pageY / pageHeight`,
a fraction of the page height *of that visit*. On one screen the page ran
from 1153px to 1947px tall between visits, so one button's taps spread over
a sixth of the screen: 154px of spread on a button 48px tall. Worse, sheets
and modals are `position: fixed`, and the scroll position behind them was
being added to their taps, so every popup's heat slid down the page.

**What replaced it** is what Microsoft Clarity and PostHog's clickmap do:
anchor to the element. Each tap stores:

| field | meaning |
|---|---|
| `target` | the control's key (section 2) |
| `ox`, `oy` | where inside **that control's own box** the finger landed, 0..1 |
| `px`, `py` | page pixels as measured, for a tap that hit no control |
| `pinned` | the control is `fixed`/`sticky`: `py` is viewport-relative and the scroll was never added |
| `x`, `y`, `yv` | the old fractions, kept only so old rows still draw |

To draw a tap, the dashboard needs the control's rectangle **on the screen
it is drawing over** (section 4), then:

```
if the control is found and ox/oy exist:  x = box.left + ox * box.width
                                          y = box.top  + oy * box.height
else if the control is found:             the centre of its box
else if px/py and vw exist:               x = px * (drawWidth / vw)
                                          y = pinned ? py : py * (drawWidth / vw)
else (old rows):                          x = x * drawWidth, y = y * pageHeight
```

The page can now be any height on any visit and the heat still lands on the
button. The server returns raw points (`ux_points`, newest first, capped at
4,000) rather than pre-binned cells: binning into a 36x64 grid quantised
every tap to roughly 10x30px on a phone.

### 4. The screen under the heat is the real app

Two earlier attempts failed and are worth not repeating:

- a wireframe of grey boxes: nobody recognised their own app;
- a repaint from measured colours and fonts: text wrapped differently in
  the dashboard's font and headings collided.

What works: **embed the actual customer app** in an iframe at
`/<slug>/?uxpreview=<screen>`. That URL boots the app read-only:

- no sign-in, no account, no writes;
- no cookie banner, no maintenance screen;
- capture is switched off, so a preview can never record itself into the
  numbers it is showing;
- **the camera never opens.** Any screen that uses the camera checks one
  shared `isAppPreview()` function first, or a heatmap of the scanner screen
  would ask the person reading it for their webcam;
- sample data where a screen needs some (the wallet shows a sample balance
  and activity);
- the `<screen>` value opens that screen or sheet directly.

The iframe is same-origin, so the dashboard can reach into it:

1. **Measure the page.** Read `scrollHeight` a few times after load (200,
   600, 1200, 2400, 4000 ms), because images arriving change the length.
   Size the iframe to the full page height and let the *phone's screen*
   scroll, not the iframe. The overlay is a sibling of the iframe with the
   same page size, so the heat scrolls with the app.
2. **Measure the controls.** Run the same `uxKeys` sweep inside the iframe's
   document and record every control's rectangle in page pixels (adding the
   scroll offset unless the control is pinned). The first match of a key
   wins. That map is what section 3 anchors taps to.

### 5. The device frame

One component draws a phone, tablet or laptop around a screen of an exact
size, and every place that shows a device uses it (the heatmap, the replay,
PackPerks' own app-design preview).

- The screen is **exactly** the device viewport: 375x812 for a phone,
  834x1024 for a tablet, 1280x800 for a laptop. The app lays out at its
  real width and the whole device is scaled down as one piece with
  `transform: scale()`. Never ask the app to lay out at a smaller width.
- **The bezel goes around the screen, never inside it.** The bug this
  prevents, which shipped for a while: the bezel was 12px of padding inside
  a 375px box, which left a 351px screen showing a 375px app, and the right
  24px of every screen was cut off. Outer size = screen + 2 x bezel; scale
  against the outer size.
- Scale = `min(1, roomHeight / outerHeight, roomWidth / outerWidth)`, where
  the room is the parent box, watched with a `ResizeObserver`.
- **The device is placed absolutely inside a box of a definite height.**
  Its size is decided by that box and never feeds back into it. Two failures
  came from breaking this: a device that grew its own section past the
  window, and, when the box was `height: auto`, a collapsed box that gave
  the device nothing to measure, so it rendered at a fallback size and hung
  out of its card. Ignore a measured room under about 120px as "not laid out
  yet".
- The section's own height is measured, not guessed: from the top of the
  section to the bottom of the window. A constant left the card 180px below
  the fold on a real dashboard, because what sits above it differs by venue,
  role and how a subtitle wraps.
- The device keeps its own colours in both themes. It stands in for the
  customer's phone, which has no dark mode because the dashboard does.
- **Prefix your CSS classes with something that is really yours.** PackPerks
  first used `sf-`, which the customer app's support form already owned
  with `min-height: 100dvh`. Both apps' CSS ship in one bundle, so the phone
  inherited a 900px minimum. PackPerks now uses `ufs-`.

**One device per heatmap.** A phone page and a desktop page are different
shapes, so taps from both drawn over one of them land on the wrong things.
With no device filter, the heatmap picks the device most of that screen's
visits were on and says which in the subtitle.

### 6. Drawing the heat

The library is **simpleheat** (BSD-2, about 2 KB). It is used only for its
alpha surface; the colours are the dashboard's own:

1. A canvas the size of the page, at `devicePixelRatio` capped at 2.
2. Anchor the points (section 3). A rage tap counts 3, others 1.
3. `radius = max(10, width / 11 * intensity)` (roughly a thumb), blur
   `0.7 x radius`, `max = max(2, ceil(points / 12))` so one tap is still
   visible and a busy spot does not wash out the rest.
4. Draw with a black gradient (alpha only), then walk the pixels and replace
   each colour with the heat ramp at that alpha, alpha x 1.25, capped at
   about 0.88 opacity.

**One heat ramp** shared by the heat, the scroll bands and the control
shading: blue `#4C6FFF` at 0, teal `#0F8A7E` at 0.35, amber `#E8930C` at
0.62, red `#E0343F` at 1. It is a data scale, not a theme colour, so it is
the same in light and dark. Three places drawing three different reds made
the first version read as three unrelated charts.

- **Scroll view:** the page in twenty bands, each shaded by the share of
  visits that got that far, with a label at 25/50/75/100% ("50% down · seen
  by 41%").
- **Controls view:** a box over every measured control, shaded by its share
  of taps, the unused ones dashed and cold, each with its count.
- Put a small white veil over the app (about 50%) so the heat reads.

### 7. Session replay: the recording

PackPerks records with **rrweb 2** (MIT): a snapshot of the DOM, then every
change to it. It runs only when the venue has replay on, and only behind
the same Analytical consent.

Recorder options that matter:

```js
record({
  maskAllInputs: true,                  // field values are replaced before they leave
  maskTextSelector: '[data-ppk-private]',
  blockSelector: '[data-ppk-private]',  // the profile block is not recorded at all
  recordCanvas: false,
  collectFonts: false,
  sampling: { scroll: 150, media: 800, input: 'last' },
  packFn: (event) => btoa(pack(event)), // @rrweb/packer, then base64
});
```

**Pack, then base64.** A snapshot of this app is about 750 KB of JSON, most
of it inlined stylesheet (kept so the recording still renders after the next
deploy renames every asset). Packed it is a fraction of that. But the packer
deflates to a *binary* string full of NUL bytes, and Postgres `jsonb`
refuses those ("unsupported Unicode escape sequence"): every chunk came back
500 until the base64 step was added. The player reverses it:
`unpack(atob(raw))`.

Events are flushed in chunks with a plain `fetch` (a chunk can be 100 KB,
past what `sendBeacon` carries) to the same ingest function, which stores
them in `ux_replays (org_id, session_id, user_id, seq, events jsonb)`. Per
visit there is a ceiling on count and bytes; past it the recorder stops.

Treat recordings as the most sensitive thing you store: written only by the
ingest function, readable only by the venue's own dashboard accounts, never
shared with a third party, deleted on the same retention clock as the taps
and with the customer when they are deleted.

A visit is listed for replay only if replay was on **at the moment it was
captured**. Turning replay off leaves a permanent gap rather than one that
fills in later.

### 8. Session replay: the player

**Do not use rrweb-player.** Its controller is sized for a desktop page, it
draws a mouse cursor on a phone, and it says nothing about what was tapped.
PackPerks tried it and users could not see what anyone did. Drive rrweb's
`Replayer` yourself and build three parts on one clock.

**The stage** (`RecordingStage`):

```js
const events = raw.map(r => unpack(atob(r))).sort((a, b) => a.timestamp - b.timestamp);
const meta = events.find(e => e.type === 4);           // Meta: the recorded viewport
const rep = new Replayer(events, {
  root, speed, skipInactive: true,
  mouseTail: false, showWarning: false, triggerFocus: false,
});
rep.pause(0);                                          // shows the first frame
```

- Put `rep`'s root inside the device frame (section 5) at the **recorded**
  viewport size from the Meta event (`data.width`, `data.height`), and listen
  for the Replayer's `resize` event in case it changes. That is the
  customer's real viewport, not a phone you chose.
- Hide rrweb's own touch ring (`.replayer-mouse.touch-device { display:
  none }`); you draw taps yourself. A desktop visit can keep its cursor.
- Load rrweb, the unpacker and `rrweb/dist/style.css` lazily, only when a
  recording is opened.

**The clock.** Keep your own position in milliseconds from the start.

- Play: `rep.play(position)`. If the position is at the end, start from 0.
- Pause: `rep.pause(position)`.
- Seek: set the position, then `play(t)` or `pause(t)` depending on state.
- Speed and skip-pauses: `rep.setConfig({ speed })`,
  `rep.setConfig({ skipInactive })`.
- While playing, a `requestAnimationFrame` loop reads
  `rep.getCurrentTime()` and tells the rest of the page about 10 times a
  second (not 60: the list re-renders on every update).
- Listen for `finish` to stop.
- **Test in a foreground tab.** In a background tab the browser stops
  animation frames and the clock freezes. PackPerks lost time thinking the
  player was broken.

**Taps on the recording.** Before playing, pull every tap out of the events:
IncrementalSnapshot (`type 3`) with MouseInteraction source (`data.source
2`), `data.type` Click (2), or TouchStart (7) where no click follows within
about 900 ms. Each has `x`, `y` (viewport pixels, the same space as the
overlay) and `id` (the node). In the clock loop, draw every tap whose time
was passed since the last frame:

- a pulse circle at `x, y` (about 52px, scales in and fades over 1.4 s);
- the control's name in a dark pill just under it, centred across the
  screen so it never runs off the edge. Get the name from the replay's own
  DOM: `rep.getMirror().getNode(id)`, walk up to the control with the same
  `uxKeys` rule, and take its label;
- an outline on the control, **but only if its rectangle still contains the
  tap point.** By the time you look, the replay has already applied what the
  tap did; a sheet that locks the page can move the control, and an outline
  somewhere else points at the wrong thing.

Detect taps by the clock passing them, not by the Replayer's `event-cast`
events: a seek replays events synchronously, and you would pulse every tap
you skipped over.

**What they did** (`ReplayPlayer`). Build the list from `ux_events`, not
from the recording: those rows carry the control's label, which the
recording does not. Place each at `Date.parse(at) - firstRecordingTimestamp`
(both are the same browser's clock), clamped to the recording. Merge a run
of scrolls on one screen into one row, at its furthest depth. Rows:

- "Opened **Home**"
- "Tapped **Collect via Tikkie**"
- "Tapped **X** again and again" (rage)
- "Tapped something that does nothing" (dead)
- "Scrolled 64% down"
- "Left the app"

Each row shows its time (m:ss) and an icon by kind. The current row is the
last one whose time has passed; highlight it and keep it in view by
scrolling the list box itself (never `scrollIntoView`, which scrolls the
whole dashboard). Clicking a row seeks to 700 ms before it and plays, so the
action is seen happening. If the capture rows are missing (clicks switched
off) but the recording has taps, list those as "Tapped the screen".

**The transport**, under the phone, two rows so it never wraps awkwardly:

- row 1: the scrubber. A thin rail and progress fill, a dot per tap (red for
  rage, orange for dead), a thin tick per screen change and exit. Put a
  transparent native `<input type="range">` on top for dragging and keyboard
  access, and style only its thumb;
- row 2: a round play/pause button (becomes "play again" at the end), the
  time as `0:12 / 1:03` with tabular numbers, then *Skip pauses* and the
  1x/2x/4x speed.

**Layout.** Visit list on the left (about 250px), phone in the middle, the
*What they did* list on the right (about 280px) with the transport under the
phone. Below about 1240px the list goes under the transport; below about
860px the visit list becomes a horizontal strip. Wait for both the steps
and the recording to load before mounting the player, or it starts stepping
through and then swaps to the recording under the viewer. Mount the player
with `key={visitId}` so a new visit starts fresh.

**A visit with no recording** (captured before recording existed, replay
off, or any PackPulse connection) uses the same list and transport over the
embedded app from section 4. The clock is virtual: gaps between steps are
squeezed to between 0.5 and 2.2 seconds, so nobody watches a 90-second
pause. The screen follows the last `view`, the page scrolls to the last
`scroll` depth, and a tap is anchored with section 3 and shown for 1.4
seconds with its label. Say plainly under the list which of the two the
viewer is watching.

### 9. What the dashboard reads

PackPerks keeps taps out of the browser where it can: the dashboard reads
sums from SECURITY DEFINER functions (`ux_screen_summary`, `ux_heatmap`,
`ux_scroll_curve`, `ux_targets`, `ux_target_series`, `ux_flow`) and the raw
points only for the screen on show (`ux_points`). Each takes an organisation
list and goes through a guard that checks the caller may see those venues.

Two security lessons, both learned the hard way:

- **A function that takes the caller's organisation list must check it
  itself.** Row-level security does not apply inside a definer function.
- **A guard in a CTE may never run.** The readers opened with
  `with guard as (select guard())` and joined it in, but nothing read the
  CTE's column, so Postgres pruned it and the guard never executed: the
  public key could read every venue's screens and taps. Mark the guard
  `volatile` and the CTE `materialized`, and test it as the anonymous role
  against a venue that **has** rows (with no rows, an unguarded call looks
  exactly like an empty one).

### 10. Checklist if you build it

1. A tap on a button lands on that button in the heatmap on a short page and
   on a long page.
2. A tap inside a popup lands on the popup, whatever the page behind it was
   scrolled to.
3. The phone shows the app's full width: nothing cut off on the right.
4. The camera never opens from a preview.
5. A preview never records itself.
6. Keys do not change when labels change: sweep a screen before and after.
7. A recording contains no typed values and no profile block.
8. Seeking does not pulse the taps it skipped.
9. The outline never appears on a control away from the tap.
10. Your guard refuses the anonymous role against a venue with rows.
