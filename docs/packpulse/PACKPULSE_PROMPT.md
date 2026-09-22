# Prompt for the Claude that works on PackPulse

Copy everything below the line into a new session in the PackPulse
repository.

---

You are working on **PackPulse**, PackBack's analytics dashboard
(production: `https://pack-pulse-v1-5.vercel.app`). Your task is to add a
**PackPerks connection**: a PackPulse organisation can show one or more
**PackPerks venues'** pages inside PackPulse, read-only, after a PackPerks
master has approved it.

PackPerks (`https://perks.packback.network`) is PackBack's reusable-cup
rewards product. Its side of this connection is **already built and
deployed**: an API (a Supabase edge function) and an embeddable page that
renders PackPerks' own Dashboard, System health and Reports & alerts. You
build only PackPulse's side. **Do not change anything in PackPerks, and do
not try to read PackPerks' database.** Everything goes through the API
below.

Before writing code, study PackPulse's codebase: its stack, its router, how
the sidebar and Master settings are built, how organisations and roles work,
how server routes authenticate, its design system and copy style. Follow
those conventions everywhere. Where this prompt and PackPulse's conventions
seem to disagree on style, follow PackPulse; where they disagree on
**security**, follow this prompt.

## 1. What the user sees when it is done

1. A PackPulse **master** opens *Master settings → PackPerks* (a new tab).
   They paste a connection code they got from PackBack
   (`PPK-XXXXX-XXXXX-XXXXX-XXXXX`), choose which **PackPulse organisation**
   it is for, and press *Connect*.
2. PackPulse shows *Waiting for PackPerks to approve* with a 4-character
   **confirmation code** (for example `K7Q2`), large and easy to read aloud.
   The PackPerks master sees the same code on their side and approves.
3. Once approved (PackPulse notices within seconds by polling), the
   PackPulse organisation's sidebar gets a new category **PackPerks** with
   the pages PackPerks shares: **Dashboard**, **System health**,
   **Reports & alerts**, and a **Preview** button. The pages look exactly
   like PackPerks' own, because they are PackPerks' own pages in an iframe.
4. *Master settings → PackPerks* shows a **diagram** of which PackPerks venue
   is connected to which PackPulse organisation, the list of connections
   with their status, and lets a PackPulse master **disconnect** a venue or
   **hide** pages from PackPulse's sidebar (and hide the whole PackPerks
   category).

## 2. Security rules (not negotiable)

- The **link secret** (`ppl_…`) that PackPerks returns when a code is used
  is a credential. It is shown to PackPulse **once**. Store it **only on the
  server**, encrypted at rest (AES-256-GCM with a key from an environment
  variable such as `PACKPERKS_LINK_KEY`, or the database's vault if
  PackPulse already uses one). It must never reach a browser, a client
  bundle, a log line, an error message or an analytics event.
- Every call to PackPerks happens in a **PackPulse server route**, after
  that route has checked the signed-in PackPulse user:
  - connect, disconnect and page/sidebar settings: a PackPulse **master**
    (or whatever PackPulse's highest admin role is called);
  - viewing a page (asking for an embed URL) and reading a connection's
    status: any user who may see that **PackPulse organisation**.
- Never cache or copy PackPerks data into PackPulse's database. PackPulse
  stores only the connection (ids, secret, names for display, status).
- Embed URLs contain a one-time ticket. Get a **fresh one for every iframe
  load**, never reuse one, never log it, never put it in PackPulse's own URL.
- Only accept `postMessage` events whose `event.origin` is exactly
  `https://perks.packback.network`, and only messages with
  `source: "packperks"`. Send messages to the iframe with that exact target
  origin, never `"*"`.
- Codes are case-insensitive and may be pasted with spaces or dashes; send
  them as typed (PackPerks normalises them). Do not log codes.

## 3. The PackPerks API

`POST https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/packpulse-link`
with a JSON body. `Content-Type: application/json`. No Supabase key is
needed. After a code is used, authenticate with the header
`x-packpulse-secret: <the link secret>`.

Put the base URL in an environment variable (`PACKPERKS_API_URL`) with the
URL above as the default.

### 3.1 `claim`: use a connection code (no secret yet)

```json
{
  "action": "claim",
  "code": "PPK-7GUM6-YQ79J-4WEFU-YVNE2",
  "packpulse": {
    "org_id": "<PackPulse organisation id>",
    "org_name": "<PackPulse organisation name, shown to the PackPerks master>",
    "app_origin": "https://pack-pulse-v1-5.vercel.app",
    "requested_by": { "email": "<the PackPulse master's email>", "name": "<their name>" }
  }
}
```

`app_origin` is PackPulse's own origin (in development
`http://localhost:<port>`). Answer (200):

```json
{
  "link_id": "d7f20f68-…",
  "secret": "ppl_VZZI9vmiQgjk…",
  "status": "pending",
  "confirm_code": "XC2C",
  "packperks": {
    "org_id": "…", "name": "Unknown Campus", "brand_name": "Titaan", "slug": "t3",
    "country": "Netherlands", "brand_color": "#E24400",
    "logo_url": "https://perks.packback.network/brand/unknown-campus.png",
    "mode": "tikkie_only", "mode_label": "Deferred Tikkie",
    "app_url": "https://perks.packback.network/t3/", "archived": false
  }
}
```

Store `link_id`, the encrypted `secret`, the PackPulse org id, the venue info
(for display) and `confirm_code`.

### 3.2 `status` (secret)

```json
{ "action": "status" }
```

```json
{
  "link_id": "…",
  "status": "active",
  "confirm_code": null,
  "pages": { "overview": true, "stats": false, "reports": true, "preview": true },
  "packperks": { "…the Venue object above…" },
  "packpulse": { "org_id": "…", "org_name": "…" },
  "preview_url": "https://perks.packback.network/t3/",
  "approved_at": "2026-09-22T11:40:00Z",
  "ended_at": null,
  "ended_by": null
}
```

`status` is `pending` (waiting for PackPerks), `active`, `paused` (PackPerks
paused it; show nothing but say so), `declined` or `revoked` (ended;
`ended_by` is `"packperks"` or `"packpulse"`). `pages` is all `false` unless
`active`. `confirm_code` is only set while `pending`. `preview_url` is
`null` unless Preview is shared. A `401 { "error": "unknown_link" }` means
the secret is no longer known: treat the connection as ended.

### 3.3 `embed` (secret): a URL for one page view

```json
{
  "action": "embed",
  "page": "overview",
  "theme": "light",
  "parent_origin": "https://pack-pulse-v1-5.vercel.app",
  "viewer": { "email": "<viewer's email>", "name": "<viewer's name>" }
}
```

`page` is `overview` (Dashboard), `stats` (System health) or `reports`
(Reports & alerts). `viewer` is recorded in PackPerks' activity log for that
connection ("jane@… opened Dashboard"). Answer:

```json
{ "url": "https://perks.packback.network/packpulse-embed#t=…&p=overview&theme=light&o=https%3A%2F%2Fpack-pulse-v1-5.vercel.app", "expires_at": "…" }
```

The URL works **once**, within **2 minutes**. Put it straight into the
iframe's `src`.

### 3.4 `disconnect` (secret)

```json
{ "action": "disconnect" }
```

Ends the connection from PackPulse's side (`{ "ok": true, "status": "revoked" }`).
Delete or mark the connection ended in PackPulse after this succeeds, and
wipe the stored secret.

### 3.5 Errors

`{ "error": "<code>" }` with these HTTP statuses. Show the friendly text,
never the raw code:

| Code | Status | Show |
|---|---|---|
| `invalid_code` | 400/404 | "That code doesn't work. Check it, or ask PackBack for a new one." |
| `code_expired` | 410 | "That code has expired. Ask PackBack for a new one." |
| `already_connected` | 409 | "This venue is already connected to that organisation." |
| `missing_packpulse_org` | 400 | (a bug on our side: the org id or name was empty) |
| `unknown_link` | 401 | "This connection has ended in PackPerks." |
| `not_active` | 403 (+ `status`) | paused: "PackBack paused this venue."; otherwise "This connection has ended." |
| `page_off` | 403 | "PackBack doesn't share this page." |
| `rate_limited` | 429 | "Too many tries. Wait a moment and try again." |
| `server_error`, `db_error`, `login_failed` | 500 | "PackPerks didn't answer. Try again in a minute." |

## 4. What to build in PackPulse

### 4.1 Storage

A table (name it in PackPulse's style), for example `packperks_connections`:

| column | |
|---|---|
| `id` | PackPulse's id |
| `packpulse_org_id` | which PackPulse organisation |
| `link_id` | PackPerks' `link_id` (unique) |
| `secret_ciphertext`, `secret_iv` (or a vault reference) | the encrypted link secret |
| `status` | last known status |
| `pages` | last known `pages` object |
| `venue` | last known `packperks` Venue object (name, logo, colour, app URL…) |
| `confirm_code` | while pending |
| `preview_url` | last known |
| `hidden_pages` | pages a PackPulse master chose to hide (PackPulse-side only) |
| `show_in_sidebar` | the PackPulse-side switch for the whole category (default true) |
| `created_by`, `created_at`, `updated_at`, `status_checked_at`, `ended_at` | |

No client (browser) access to this table at all: if PackPulse uses
Supabase row-level security, enable it with **no** policies for
browser roles, and read/write it only from server routes with the service
role. The secret columns must never be selected into anything that goes to
a browser.

### 4.2 Server routes

Add server routes in PackPulse's style (for a Vercel `/api` app, for
example `/api/packperks/...`). Each checks the session first.

- `POST connect { code, packpulseOrgId }` (master): calls `claim` with the
  org's id and name, the master's email and name, and PackPulse's origin;
  stores the connection; returns `{ id, status, confirmCode, venue }`
  (**not** the secret).
- `GET connections?org=…` (members of that org; masters see all): returns
  the stored connections without secrets. If a connection's
  `status_checked_at` is older than ~30 seconds, refresh it with `status`
  first (in parallel for several), and store the result. While a connection
  is `pending`, the connect screen polls this every 5 seconds.
- `POST embed { connectionId, page, theme }` (members of that org): checks
  the page is shared (`pages[page]` true) and not hidden on PackPulse's side,
  calls `embed` with `parent_origin` = PackPulse's origin and the viewer's
  email/name, and returns `{ url }`. Never cache this URL.
- `POST disconnect { connectionId }` (master): calls `disconnect`, then marks
  the connection ended and deletes the secret.
- `POST settings { connectionId, hiddenPages, showInSidebar }` (master):
  PackPulse-side only, no PackPerks call.

Use a 10-second timeout on calls to PackPerks and map errors as in 3.5.

### 4.3 Master settings → PackPerks (new tab, masters only)

Build it with PackPulse's own components, in the same style as its other
Master settings tabs:

1. **Connect a PackPerks venue**: a text field for the code
   (monospace, placeholder `PPK-XXXXX-XXXXX-XXXXX-XXXXX`, accepts paste with
   spaces or dashes), a picker for the PackPulse organisation, and a
   *Connect* button. One line of help: "Ask PackBack for a connection code.
   It works once, for 48 hours."
2. After *Connect*: a waiting card: "Waiting for PackPerks to approve",
   the venue's name and logo, and the **confirmation code** in large
   monospace with the line "PackBack sees the same code. It confirms this
   request is yours." Poll until `active`, then show "Connected" and the
   PackPerks pages appear in the sidebar without a reload. If it becomes
   `declined`: "PackBack declined this request."
3. **Diagram**: which PackPerks venue is connected to which PackPulse
   organisation. Same visual language as PackPerks' own diagram: PackPerks
   venues on the left, PackPulse organisations on the right, one line per
   connection, **solid** for active, **dashed** for waiting or paused, with a
   small legend under it. Draw it as inline SVG with the design system's
   colours; it must work in light and dark themes and scroll sideways in its
   own box on a phone.
4. **Connections list**: each connection with the venue (logo, name,
   programme type from `mode_label`), the PackPulse organisation, the status
   badge (Connected / Waiting for approval / Paused by PackBack / Ended), when
   it was connected, and:
   - switches to **hide** Dashboard, System health, Reports & alerts and
     Preview from PackPulse's sidebar. A page PackPerks doesn't share shows a
     disabled switch with "Not shared by PackBack". Hiding is PackPulse-side
     only and must also be enforced by the `embed` route;
   - a switch **Show PackPerks in the sidebar** for the whole category;
   - **Disconnect**, with a confirmation dialog: "Disconnect {venue}? It
     disappears from PackPulse right away. To connect it again you need a new
     code from PackBack."
5. Empty state: "No PackPerks venues connected yet."

### 4.4 The sidebar category **PackPerks**

- Shown for a PackPulse organisation only when it has at least one
  **active** connection with at least one visible page, and *Show PackPerks
  in the sidebar* is on.
- Items: **Dashboard**, **System health**, **Reports & alerts** (each only
  if shared and not hidden), and a **Preview** button that opens
  `preview_url` in a new tab (`rel="noopener noreferrer"`). Use the icons
  PackPulse uses for similar pages; the category may carry a small PackPerks
  mark.
- More than one connected venue: show a compact venue switcher at the top
  of the category (logo + name), remembered per browser, and keep the page
  when switching venues if that venue shares it.
- A paused connection stays in the list with a muted "Paused by PackBack"
  note instead of the pages.
- Routes, for example `/packperks/:connectionId/:page` with `page` in
  `dashboard | health | reports` (map to `overview | stats | reports`).

### 4.5 The page frame

One component, for example `<PackPerksFrame connectionId page />`, used by
all three routes:

- Fills PackPulse's content area (full width, `height: calc(100vh - <top
  bar>)`), no border, the page background behind it matching PackPulse's.
- On mount: `POST embed` → set the iframe `src` to the returned `url`.
  Attributes: `title="PackPerks {page label} for {venue}"`,
  `referrerpolicy="no-referrer"`, `allow="clipboard-write"`, `loading="eager"`.
  **No `sandbox`** attribute (the page needs scripts, its own origin and file
  downloads for exports).
- **Keep one frame per connection mounted** while the user moves between the
  PackPerks pages, and switch pages by sending
  `{ source: "packpulse", type: "navigate", page: "stats" }` instead of
  loading a new URL. Load a new URL only when the frame isn't loaded yet or
  after `session_ended`.
- Theme: pass PackPulse's current theme (`light`/`dark`) to `embed`, and on
  every theme change send `{ source: "packpulse", type: "theme", theme }`.
- Listen for messages (check `event.origin === "https://perks.packback.network"`
  and `event.data.source === "packperks"`):
  - `ready` → hide the loading state. It includes `pages` and `venue`.
  - `page` → keep PackPulse's sidebar selection in step.
  - `size` → optional; you may ignore it (the frame fills the area and
    scrolls inside).
  - `session_ended` with `reason`:
    - `expired` → fetch a new embed URL and reload the frame once
      (no more than once per 30 seconds; after that show "This view has
      expired. Reload" with a button);
    - `paused` → show "PackBack paused this venue" and refresh the
      connections list;
    - `ended` → show "This connection has ended" and refresh the list (the
      category disappears);
    - `page_off` → refresh the list and go to the first page still shared.
- Loading state: PackPulse's usual skeleton or spinner until `ready` (time
  out after 20 seconds with a retry button).
- PackPulse's Content-Security-Policy (if it has one) must allow
  `frame-src https://perks.packback.network`.

## 5. Local development

- PackPerks allows its embed page to be framed from `http://localhost:*` and
  `http://127.0.0.1:*`, so you can test against the real PackPerks from
  your dev server. Pass `http://localhost:<port>` as `app_origin` and
  `parent_origin` there. It also allows `https://pack-pulse-v1-5.vercel.app`
  and `https://*.packback.network`. **Vercel preview deployments
  (`*.vercel.app` other than production) are not allowed**; if you need
  them, tell the user, who can ask for them to be added in PackPerks.
- To build the screens before a real code exists, add a mock driver behind
  an env flag (`PACKPERKS_MOCK=1`) that answers `claim`, `status`, `embed`
  and `disconnect` with the shapes above (the mock embed URL can point to a
  local placeholder page that posts `ready`). Remove nothing from the real
  path to do this.
- **You need the user for two steps**, so ask them when you get there:
  1. a **connection code**: they create it in PackPerks
     (`https://perks.packback.network/admin` → Master settings →
     PackPulse → Connect a venue); and
  2. the **approval**: after you press *Connect*, they approve the request
     in the same PackPerks tab, checking the confirmation code.
  If a browser login to PackPulse or PackPerks is needed, open the page and
  let the user sign in or type the code themselves. Never type passwords.
- If an embed URL opens PackPerks' customer app or a 404 instead of a
  dashboard page, PackPerks' latest version isn't deployed yet: tell the
  user.

## 6. Check before you say it's done

- [ ] A code connects, the confirmation code is shown, and after the user
      approves in PackPerks the PackPerks category appears without a reload.
- [ ] Dashboard, System health and Reports & alerts load in the frame, switch
      without reloading the frame, and follow PackPulse's light/dark theme.
- [ ] Preview opens the venue's customer app in a new tab.
- [ ] When PackPerks switches a page off, it disappears from the sidebar
      within ~30 seconds and its route redirects to a page still shared.
- [ ] When PackPerks pauses the connection, the frame shows the paused
      state; after resume, the pages work again.
- [ ] Disconnect in PackPulse ends it on both sides (PackPerks shows
      "Disconnected by PackPulse").
- [ ] The link secret appears nowhere in the browser (network tab, page
      source, local storage), in logs or in error messages. Grep the client
      bundle for `ppl_` to prove it.
- [ ] Non-masters can't reach the connect/disconnect routes (403), and a
      user outside the PackPulse organisation can't get an embed URL for it.
- [ ] The diagram and lists work in light and dark themes and at phone width.
- [ ] Nothing in PackPerks was changed.

When you finish, report what you built, which files changed, the
environment variables to set in production (`PACKPERKS_LINK_KEY`,
optionally `PACKPERKS_API_URL`), and anything you could not test.
