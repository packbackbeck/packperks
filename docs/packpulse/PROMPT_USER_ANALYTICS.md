# For the Claude that works on PackPulse — User analytics is now shareable

PackPerks has added a fourth page to the connection: **User analytics**. This
is everything you need to surface it. Nothing about the handshake, the link
secret, the ticket flow or the postMessage contract changes — if your side
already shows Dashboard, System health and Reports & alerts, this is a small
, additive change.

## What changed on the PackPerks side

- The page id is **`behaviour`**, and its label is **User analytics**.
- A PackBack master switches it on per connection, exactly like the others.
  Until they do, it behaves like any unshared page: absent from `pages`, and
  the server refuses a ticket for it.
- `packpulse-link` action `status` now returns `behaviour` in its `pages`
  object, and action `embed` accepts `page: "behaviour"`.
- The embed's `ready` message lists it in `pages` when it is shared.

Everything else — `{ overview, behaviour, stats, reports, preview }` — keeps
the shape you already handle. Treat an unknown page id as "not shared"
rather than an error, and you will survive the next one too.

## What to do

1. **Add it to the PackPerks category** in your sidebar, between Dashboard
   and System health. Label it *User analytics*. Drive it from the `pages`
   object you already read; do not hard-code the list.
2. **Open it with `page: "behaviour"`** through the same one-time-ticket
   call you use for the others.
3. **Give it room.** This is the tallest page we share. It has four internal
   sections and two of them render a phone-sized canvas. Expect `size`
   messages well past 2000px and do not cap the iframe height; let it grow
   and let PackPulse's own page scroll.
4. **Do not mirror its internal tabs.** The page carries its own tab strip —
   Programme, User flow, Heatmap, Session replay — inside the iframe. If you
   add your own tabs for those, you will end up with two tab strips that
   disagree. One sidebar entry, one page.
5. **Do not sandbox away nested frames.** The Heatmap and Session replay
   sections draw the venue's real customer app in an iframe *inside* our
   page, so the heat sits on the actual screen rather than a drawing of it.
   If you put a `sandbox` attribute on our iframe, keep at least
   `allow-scripts allow-same-origin`, or those two sections render empty.
6. **Say Beta where we do.** Heatmap and Session replay are marked Beta
   inside the page. If you mention the page in your own copy or release
   notes, carry that word: the capture format is still settling.

## What the page shows, so your copy can be accurate

- **Programme** — how customers find the venue, come back, claim and drop
  off. The same tiles a vendor sees in PackPerks.
- **User flow** — visits captured over time, where customers go next, what
  they tap, how they arrive.
- **Heatmap** — where thumbs actually land, on the venue's own screen, plus
  every control and how long it takes to reach.
- **Session replay** — one visit played back, step by step.

It is read-only, like every shared page. The venue's capture settings (what
the app records, how long it is kept, whether replay is on) are **not**
editable from PackPulse — the button is not rendered for you. The status
line still states the rules in force, e.g. *"Consented visits only · kept 60
days · replay on"*, so a viewer can see the basis of the data.

## What PackPulse can and cannot see through this page

Read-only, one venue, and only what the page needs. The connection's login
reads `packpulse_*` views that filter every row to the venues shared with
it, and the analytics functions behind Heatmap and Session replay now refuse
any organisation the connection was not given.

Available: visit records (device, entry point, duration, screens, taps,
rage/dead taps, scroll depth), the tap coordinates behind the heatmap, the
control names and timings, screen layouts, and the counts behind the
Programme tiles.

Not available, here or anywhere: customer emails, payout links, receipt
photos, IBANs, cup codes, approval notes and AI verdict texts. Customer ids
appear only as opaque internal ids. A session id is ours, not a person.

## How to check it works

Ask PackBack to switch **User analytics** on for a test venue, then:

1. The sidebar entry appears without a reload, from the next `status` poll.
2. Opening it loads inside 5 seconds and the four internal tabs all render.
3. Heatmap draws the venue's app with heat on top; Session replay lists
   visits and plays one back.
4. Switching to another shared page and back does not reload the iframe.
5. Light and dark both follow your `theme` message.
6. Ask PackBack to switch the page **off**: it leaves the sidebar on the next
   status poll, and a ticket for `behaviour` is refused by the server.
7. Confirm no request of yours can widen the scope: the analytics functions
   take an organisation list, and anything outside your shared venues is
   refused server-side.

If a section is empty, that venue may simply have no captured visits yet —
capture is per venue and off until the venue turns it on. "No visits yet" is
a real answer, not a bug.

## One thing to tell PackBack if you hit it

The heatmap needs a screen layout to draw on, which the customer app records
as people use it. A brand-new venue will show heat without a screen
underneath until the app has been opened a few times on that device size.
