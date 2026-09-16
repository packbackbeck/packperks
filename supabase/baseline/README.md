# Schema baseline

`2026-09-16_schema.sql` is the whole `public` schema as it stood after
migration 045, generated from the live database's catalog. It exists because
`supabase/migrations/` is incomplete: far more changes were applied to the
database than were saved as files, so replaying the folder cannot rebuild it.

## Rebuilding a database

1. Create a Supabase project (the file expects Supabase's roles: `anon`,
   `authenticated`, `service_role`, and the `auth`, `storage`, `cron` schemas).
2. Run `2026-09-16_schema.sql`.
3. Deploy the app, then run every file in `supabase/migrations/` numbered
   above 045, in order. 046 relies on the `x-device-id` header the app sends;
   without the app, customers can't see their own rows.
4. Load data separately (venue settings live in `app_config`), deploy the
   edge functions and set their secrets: `BREVO_API_KEY`,
   `BREVO_SENDER_NAME`, `BREVO_SENDER_EMAIL` (`docs/EMAIL_SETUP.md`), the
   `TIKKIE_*` values (`docs/TIKKIE_INTEGRATION.md`), `ANTHROPIC_API_KEY`
   (receipt checks), and `APP_BASE_URL`, `ALLOWED_ORIGIN(S)`. Supabase
   provides `SUPABASE_URL` and the keys itself.

Files numbered 045 and below are history: they are already in the baseline.

## Keeping it honest

Every schema change from now on is a numbered file in `supabase/migrations/`,
applied with the Supabase MCP `apply_migration` in the same change. When the
folder has drifted again, regenerate the baseline:

- Follow `snapshot.sql`: it creates a temporary function that assembles the
  DDL from the catalog, guarded by the hash of a one-off token. Call it once
  over REST, save the output, and drop the function straight away.
- Or use `supabase db dump --schema public` once the CLI is logged in.
