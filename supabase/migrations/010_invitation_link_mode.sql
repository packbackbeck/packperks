-- Invite teammate by email OR by shareable link.
--
-- The InviteModal in AdminOrg now offers two methods:
--
--   • email — Supabase sends the invite email (current behaviour).
--             The teammate clicks the magic link → bootstrap-admin
--             consumes the invitation row, assigns the role, marks
--             accepted_at.
--   • link  — Admin copies a URL like `…/admin?invite=<token>` and
--             shares it manually (Slack, WhatsApp, etc.). Same
--             token → same bootstrap flow.
--
-- single_use defaults to TRUE: the invite is consumed on first
-- successful sign-in. Admins can flip it off when generating a link
-- that should let multiple teammates onboard against the same URL
-- (e.g. "everyone on the BK Amsterdam Damrak team — sign yourselves
-- up").
alter table admin_invitations
  add column if not exists single_use boolean not null default true,
  add column if not exists method text not null default 'email'
    check (method in ('email', 'link'));
