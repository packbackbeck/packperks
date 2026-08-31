// ──────────────────────────────────────────────────────────────────────
// send-test-email — preview an automated customer email in a real inbox.
//
// The dashboard's Email Templates page posts the version currently on
// screen (saved or not) and this renders it with SAMPLE values and mails
// it to the signed-in admin. Nothing here can touch a customer:
//   • the caller must be an active admin (admin_profiles), and
//   • the recipient must be an admin's own address — you cannot use this
//     endpoint to mail an arbitrary person.
// The Brevo key stays server-side, which is the whole reason this exists
// rather than the browser calling Brevo directly.
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@packback.network";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "PackPerks";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// Sample values per template — mirrors the dashboard's own preview data.
const SAMPLES: Record<string, Record<string, string>> = {
  refund_ready: {
    link: "https://perks.packback.network/t3/?batch=00000000-0000-4000-8000-000000000000",
    amount: "0.40",
    cups: "4",
  },
  login_code: { code: "481902", minutes: "10" },
};

function render(text: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
    text,
  );
}

// Strip tags for the plain-text part so the mail isn't HTML-only (which
// reads as spam to most filters).
function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── The caller must be an active admin ──
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "missing_token" }, 401);
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);

  const { data: actor } = await supabase
    .from("admin_profiles").select("id, role, status, email")
    .eq("id", userData.user.id).maybeSingle();
  if (!actor || actor.status !== "active") return json({ error: "not_admin" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const templateKey = String(body.template_key || "");
  const subject = String(body.subject || "").slice(0, 300);
  const html = String(body.html || "").slice(0, 100_000);
  const to = String(body.to || "").trim().toLowerCase();

  if (!SAMPLES[templateKey]) return json({ error: "unknown_template" }, 400);
  if (!subject.trim() || !html.trim()) return json({ error: "empty_template" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "invalid_email" }, 400);

  /* The recipient must belong to an admin of this workspace. Without this
   * check the endpoint would be an authenticated open mailer — any admin
   * could send arbitrary HTML to any address from our sending domain. */
  const { data: recipient } = await supabase
    .from("admin_profiles").select("id").ilike("email", to).maybeSingle();
  const ownEmail = (actor.email || userData.user.email || "").toLowerCase();
  if (!recipient && to !== ownEmail) {
    return json({ error: "recipient_not_admin" }, 403);
  }

  if (!BREVO_API_KEY) return json({ error: "email_not_configured" }, 503);

  // Venue name for {{venue}} — the org the admin is testing from.
  let venue = "your venue";
  if (typeof body.org_id === "string" && body.org_id) {
    const { data: org } = await supabase
      .from("organizations").select("name").eq("id", body.org_id).maybeSingle();
    if (org?.name) venue = org.name;
  }
  const values = { ...SAMPLES[templateKey], venue };

  const renderedSubject = render(subject, values);
  const renderedHtml = render(html, values);

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject: `[TEST] ${renderedSubject}`,
        htmlContent: renderedHtml,
        textContent: toText(renderedHtml),
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error(`[send-test-email] brevo ${resp.status}: ${detail.slice(0, 300)}`);
      return json({ error: "send_failed", httpStatus: resp.status }, 502);
    }
  } catch (e) {
    console.error(`[send-test-email] ${String(e)}`);
    return json({ error: "send_failed" }, 502);
  }

  return json({ status: "sent", to });
});
