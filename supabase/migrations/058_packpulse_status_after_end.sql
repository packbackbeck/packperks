-- 058 — PackPulse can still ask how a connection ended.
--
-- 057 cleared the link secret when a master declined or disconnected a
-- connection, so PackPulse's next status call answered `unknown_link` and
-- PackPulse could not tell its people what happened. The secret now stays:
-- an ended link answers status with `declined` or `revoked` (and who ended
-- it), and nothing else. Embed URLs and the data views need `active`.

create or replace function public.packpulse_admin_update(p_link uuid, p_action text, p_pages jsonb default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  l       packpulse_links%rowtype;
  v_pages jsonb;
  v_from  text;
  v_next  text;
begin
  if not is_master() then raise exception 'masters_only' using errcode = '42501'; end if;
  select * into l from packpulse_links where id = p_link for update;
  if not found then raise exception 'link_not_found' using errcode = 'P0002'; end if;

  if p_action = 'cancel' then
    if l.status <> 'awaiting' then raise exception 'not_awaiting'; end if;
    update packpulse_links set status = 'cancelled', code_hash = null, ended_by = 'packperks', ended_at = now(), updated_at = now() where id = l.id;
  elsif p_action = 'approve' then
    if l.status <> 'pending' then raise exception 'not_pending'; end if;
    update packpulse_links set status = 'active', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = l.id;
  elsif p_action = 'decline' then
    if l.status <> 'pending' then raise exception 'not_pending'; end if;
    update packpulse_links set status = 'declined', ended_by = 'packperks', ended_at = now(), updated_at = now() where id = l.id;
  elsif p_action in ('pause', 'resume') then
    v_from := case p_action when 'pause' then 'active' else 'paused' end;
    v_next := case p_action when 'pause' then 'paused' else 'active' end;
    if l.status <> v_from then raise exception 'wrong_status'; end if;
    update packpulse_links set status = v_next, updated_at = now() where id = l.id;
  elsif p_action = 'pages' then
    if p_pages is null or jsonb_typeof(p_pages) <> 'object' then raise exception 'bad_pages'; end if;
    select jsonb_object_agg(k, coalesce((p_pages ->> k)::boolean, (l.pages ->> k)::boolean, false))
      into v_pages from unnest(array['overview', 'stats', 'reports', 'preview']) k;
    update packpulse_links set pages = v_pages, updated_at = now() where id = l.id;
  elsif p_action = 'disconnect' then
    if l.status not in ('pending', 'active', 'paused') then raise exception 'not_connected'; end if;
    update packpulse_links
       set status = 'revoked', auth_user_id = null,
           ended_by = 'packperks', ended_at = now(), updated_at = now()
     where id = l.id;
    -- The connection's own login goes with it (sessions and all).
    if l.auth_user_id is not null then delete from auth.users where id = l.auth_user_id; end if;
    delete from packpulse_tickets where link_id = l.id;
  else
    raise exception 'unknown_action';
  end if;

  insert into packpulse_link_events (link_id, action, actor, detail)
  values (l.id, case p_action when 'cancel' then 'code_cancelled' when 'approve' then 'approved' when 'decline' then 'declined'
                              when 'pause' then 'paused' when 'resume' then 'resumed' when 'pages' then 'pages_changed'
                              else 'disconnected' end,
          packpulse_actor(), case when p_action = 'pages' then jsonb_build_object('pages', v_pages) end);
  return jsonb_build_object('ok', true);
end $$;
