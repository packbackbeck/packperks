// ──────────────────────────────────────────────────────────────────────────
// PackPerks — ux-ingest Edge Function
//
// The one way taps, scrolls and screen views reach the database. The
// customer app buffers them (src/lib/uxCapture.js) and posts a batch here;
// User analytics → User flow reads what lands.
//
// Why a function and not an anon insert: client_events was given an open
// "insert anything" policy for the sandbox and that is the mistake this
// table is not repeating (CLAUDE.md → Landmines). Here the service role
// writes, and only after the payload has been checked: the venue has to
// have capture switched on, coordinates have to be fractions, a batch is
// capped, and one visit can never write more than MAX_SESSION_EVENTS rows
// however long it stays open.
//
// Body (JSON), one of:
//   { action: "config", org_id }
//     → { enabled, sample, clicks, scroll, replay, layouts, retentionDays }
//       The venue's Capture settings. The app asks once per visit and
//       keeps nothing if capture is off.
//
//   { action: "flush", org_id, session_id, user_id?, mode?, device?, entry?,
//     started_at?, duration_ms?, screens?, screen_list?, clicks?, rage?,
//     dead?, max_scroll?, first_tap_ms?, last_screen?, events: [...],
//     layouts: [...] }
//     → { stored }
//
// CONSENT is the app's job and the app's alone: it posts nothing unless the
// customer turned the Analytical cookie category on. Nothing here identifies
// a person beyond the user_id the app already owns — no IP, no text typed,
// no element contents.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN   = Deno.env.get("ALLOWED_ORIGIN") ?? null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

const MAX_BATCH          = 300;    // rows in one post
const MAX_SESSION_EVENTS = 3000;   // rows one visit may ever store
const MAX_LAYOUT_ELEMS   = 120;    // controls remembered per screen
const KINDS   = new Set(["view", "click", "rage", "dead", "scroll", "leave", "move"]);
const DEVICES = new Set(["mobile", "tablet", "desktop"]);

// What a venue gets before anyone opens Capture settings. Heat is on,
// because it is anonymous and aggregated and the customer already agreed to
// behavioural analytics. Replay is off, because watching one visit back is
// a different promise and a venue should have to make it deliberately.
const DEFAULTS = {
  enabled: true,
  sample: 100,
  clicks: true,
  scroll: true,
  replay: false,
  layouts: true,
  retentionDays: 60,
};

type Config = typeof DEFAULTS;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow  = ALLOWED_ORIGIN ? (origin === ALLOWED_ORIGIN ? origin : null) : "*";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

/* ── Small sanitisers. Everything the app sends is a suggestion. ── */
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const frac = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
};
const int = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/* The venue's Capture settings (`ux:capture:<orgId>`), merged over the
 * defaults. Its own app_config row, like `byo:cap:<orgId>`, so publishing
 * the design draft can never wipe it. */
async function readConfig(orgId: string): Promise<Config> {
  const { data } = await supabase
    .from("app_config").select("value").eq("key", `ux:capture:${orgId}`).maybeSingle();
  const v = (data?.value ?? {}) as Partial<Config>;
  return {
    enabled:       bool(v.enabled, DEFAULTS.enabled),
    sample:        int(v.sample, 1, 100) ?? DEFAULTS.sample,
    clicks:        bool(v.clicks, DEFAULTS.clicks),
    scroll:        bool(v.scroll, DEFAULTS.scroll),
    replay:        bool(v.replay, DEFAULTS.replay),
    layouts:       bool(v.layouts, DEFAULTS.layouts),
    retentionDays: int(v.retentionDays, 1, 400) ?? DEFAULTS.retentionDays,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST")    return json(req, { error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "bad_json" }, 400);
  }

  const orgId = str(body.org_id, 64);
  if (!orgId || !UUID_RE.test(orgId)) return json(req, { error: "org_id_required" }, 400);

  const config = await readConfig(orgId);
  const action = str(body.action, 16) ?? "flush";

  if (action === "config") return json(req, config);
  if (action !== "flush")  return json(req, { error: "unknown_action" }, 400);

  // Capture off: say so and store nothing. The app stops asking for the
  // rest of the visit.
  if (!config.enabled) return json(req, { stored: 0, enabled: false });

  const sessionId = str(body.session_id, 64);
  if (!sessionId || !SESSION_RE.test(sessionId)) return json(req, { error: "session_required" }, 400);

  const rawUser = str(body.user_id, 64);
  const userId  = rawUser && UUID_RE.test(rawUser) ? rawUser : null;

  // How much this visit has already written, so a page left open all day
  // can't fill the table.
  const { data: existing } = await supabase
    .from("ux_sessions").select("events, started_at").eq("session_id", sessionId).maybeSingle();
  const already = Number(existing?.events ?? 0);
  const room    = Math.max(0, MAX_SESSION_EVENTS - already);

  const inEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const rows: Record<string, unknown>[] = [];
  for (const raw of inEvents) {
    if (rows.length >= room) break;
    const e = raw as Record<string, unknown>;
    const kind = str(e.kind, 12);
    if (!kind || !KINDS.has(kind)) continue;
    if (!config.clicks && (kind === "click" || kind === "rage" || kind === "dead")) continue;
    if (!config.scroll && kind === "scroll") continue;
    const screen = str(e.screen, 64);
    const seq = int(e.seq, 0, 1_000_000);
    if (!screen || seq == null) continue;
    rows.push({
      org_id: orgId,
      session_id: sessionId,
      user_id: userId,
      seq,
      kind,
      screen,
      target: str(e.target, 120),
      label:  str(e.label, 80),
      x:  frac(e.x),
      y:  frac(e.y),
      yv: frac(e.yv),
      vw: int(e.vw, 0, 32000),
      vh: int(e.vh, 0, 32000),
      dh: int(e.dh, 0, 2_000_000),
      depth: frac(e.depth),
      t_ms: int(e.t_ms, 0, 7_200_000),
      at: str(e.at, 40) ?? new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("ux_events").insert(rows);
    if (error) return json(req, { error: error.message }, 500);
  }

  // The visit's own row. Counters are the app's running totals for the
  // visit, not this batch, so a dropped batch never double-counts and a
  // capped batch still leaves the tiles right.
  const startedAt = str(body.started_at, 40) ?? existing?.started_at ?? new Date().toISOString();
  const screenList = Array.isArray(body.screen_list)
    ? [...new Set(body.screen_list.map(s => str(s, 64)).filter(Boolean) as string[])].slice(0, 60)
    : [];
  const session = {
    session_id: sessionId,
    org_id: orgId,
    user_id: userId,
    mode: str(body.mode, 24),
    device: DEVICES.has(String(body.device)) ? String(body.device) : null,
    entry: str(body.entry, 40),
    started_at: startedAt,
    last_at: new Date().toISOString(),
    duration_ms: int(body.duration_ms, 0, 86_400_000) ?? 0,
    screens: int(body.screens, 0, 10_000) ?? 0,
    screen_list: screenList,
    clicks: int(body.clicks, 0, 100_000) ?? 0,
    rage: int(body.rage, 0, 100_000) ?? 0,
    dead: int(body.dead, 0, 100_000) ?? 0,
    max_scroll: frac(body.max_scroll),
    first_tap_ms: int(body.first_tap_ms, 0, 7_200_000),
    last_screen: str(body.last_screen, 64),
    replay: config.replay,
    events: already + rows.length,
  };
  const { error: sErr } = await supabase
    .from("ux_sessions").upsert(session, { onConflict: "session_id" });
  if (sErr) return json(req, { error: sErr.message }, 500);

  // Where the controls sat on the screen. One row per screen and device
  // class; the newest wins, which is all a wireframe backdrop needs.
  if (config.layouts && Array.isArray(body.layouts) && body.layouts.length) {
    const layouts = body.layouts.slice(0, 20).map((raw) => {
      const l = raw as Record<string, unknown>;
      const screen = str(l.screen, 64);
      const device = DEVICES.has(String(l.device)) ? String(l.device) : null;
      if (!screen || !device) return null;
      const els = Array.isArray(l.elements) ? l.elements.slice(0, MAX_LAYOUT_ELEMS) : [];
      const elements = els.map((rawEl) => {
        const el = rawEl as Record<string, unknown>;
        const k = str(el.k, 120);
        if (!k) return null;
        return {
          k,
          l: str(el.l, 80),
          x: frac(el.x), y: frac(el.y),
          w: frac(el.w), h: frac(el.h),
        };
      }).filter(Boolean);
      if (!elements.length) return null;
      return {
        org_id: orgId, screen, device, elements,
        vw: int(l.vw, 0, 32000), vh: int(l.vh, 0, 32000), dh: int(l.dh, 0, 2_000_000),
        seen: 1, updated_at: new Date().toISOString(),
      };
    }).filter(Boolean);
    if (layouts.length) {
      await supabase.from("ux_layouts").upsert(layouts, { onConflict: "org_id,screen,device" });
    }
  }

  return json(req, { stored: rows.length, capped: rows.length < inEvents.length });
});
