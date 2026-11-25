-- SmartStaffEcosys shared exercise v0.5 (2026-11-25). Run after the schema, the seed and the API.
-- A SIMULATION shared by the members of one headquarters: an append-only event log that every browser
-- replays. It is separate from the real decision log (decision_request / decision_record) of the runner.
-- The database checks membership, role, gate option and event order; it does not replay the process, so an
-- event that does not fit the current step is ignored by the browsers.
--   authenticated (a logged-in member):  sse_ex_list, sse_ex_create, sse_ex_poll, sse_ex_post
--   administrator only (SQL editor):     sse.add_member, sse.remove_member
begin;

-- Hardening: a fixed search path for the functions that did not have one.
alter function sse.guard_instance() set search_path = '';
alter function sse.forbid_change() set search_path = '';
alter function sse.current_hq() set search_path = '';

create table sse.exercise (
  id uuid primary key default gen_random_uuid(),
  hq_id uuid not null references sse.hq,
  title text not null check (title = btrim(title) and length(title) between 1 and 80),
  process_version text not null,
  created_by uuid not null references sse.person,
  created_at timestamptz not null default now(),
  unique (id, hq_id)
);
create table sse.exercise_event (
  exercise_id uuid not null,
  hq_id uuid not null,
  seq int not null check (seq > 0),
  kind text not null check (kind in ('advance', 'decide', 'escalate', 'resume', 'chat', 'inject', 'remove')),
  payload jsonb not null,
  person_id uuid not null references sse.person,
  role text not null,
  at timestamptz not null default now(),
  primary key (exercise_id, seq),
  foreign key (exercise_id, hq_id) references sse.exercise (id, hq_id)
);
create trigger exercise_frozen before update or delete on sse.exercise
  for each row execute function sse.forbid_change();
create trigger exercise_no_truncate before truncate on sse.exercise
  for each statement execute function sse.forbid_change();
create trigger exercise_event_frozen before update or delete on sse.exercise_event
  for each row execute function sse.forbid_change();
create trigger exercise_event_no_truncate before truncate on sse.exercise_event
  for each statement execute function sse.forbid_change();
alter table sse.exercise enable row level security;
create policy own_hq on sse.exercise using (hq_id = sse.current_hq()) with check (hq_id = sse.current_hq());
alter table sse.exercise_event enable row level security;
create policy own_hq on sse.exercise_event using (hq_id = sse.current_hq()) with check (hq_id = sse.current_hq());

create function sse.my_roles(p_hq uuid) returns text[] language sql stable set search_path = '' as
$$ select coalesce(array_agg(role order by role), '{}') from sse.role_assignment
   where hq_id = p_hq and person_id = sse.me() $$;
create function sse.require_open() returns void language plpgsql stable set search_path = '' as $$
begin
  if (select profile from sse.instance_config) <> 'open' then
    raise exception 'confidential_plus: the shared exercise is disabled';
  end if;
end $$;

create function public.sse_ex_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform sse.require_open();
  return jsonb_build_object(
    'person', (select display_name from sse.person where id = sse.me()),
    'hqs', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'roles', sse.my_roles(h.id)) order by h.name)
                     from sse.hq h where cardinality(sse.my_roles(h.id)) > 0), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(x.item order by x.created_at desc) from (
        select e.created_at, jsonb_build_object(
                 'id', e.id, 'hq', e.hq_id, 'title', e.title, 'version', e.process_version,
                 'by', p.display_name, 'at', e.created_at,
                 'events', (select count(*) from sse.exercise_event v where v.exercise_id = e.id)) as item
        from sse.exercise e join sse.person p on p.id = e.created_by
        where cardinality(sse.my_roles(e.hq_id)) > 0
        order by e.created_at desc limit 30) x), '[]'::jsonb));
end $$;

create function public.sse_ex_create(p_hq uuid, p_title text, p_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e uuid;
begin
  perform sse.require_open();
  if not coalesce(sse.my_roles(p_hq) && array['commander', 'xo', 'ops_chief'], false) then
    raise exception 'only the command group may start an exercise';
  end if;
  if coalesce(length(btrim(p_title)), 0) not between 1 and 80 or coalesce(length(p_version), 0) not between 1 and 10 then
    raise exception 'invalid title or version';
  end if;
  if (select count(*) from sse.exercise where hq_id = p_hq) >= 100 then
    raise exception 'exercise limit reached';
  end if;
  insert into sse.exercise (hq_id, title, process_version, created_by)
  values (p_hq, btrim(p_title), p_version, sse.me()) returning id into e;
  return jsonb_build_object('id', e);
end $$;

create function public.sse_ex_poll(p_exercise uuid, p_since int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e sse.exercise; mine text[];
begin
  perform sse.require_open();
  select * into e from sse.exercise where id = p_exercise;
  mine := sse.my_roles(e.hq_id);
  if e.id is null or cardinality(mine) = 0 then
    raise exception 'exercise not found';
  end if;
  return jsonb_build_object(
    'title', e.title, 'version', e.process_version,
    'hq', (select name from sse.hq where id = e.hq_id),
    'person', (select display_name from sse.person where id = sse.me()),
    'roles', mine, 'now', now(),
    'events', coalesce((
      select jsonb_agg(x.item order by x.seq) from (
        select v.seq, jsonb_build_object('seq', v.seq, 'kind', v.kind, 'payload', v.payload, 'role', v.role,
                                         'by', p.display_name, 'at', v.at) as item
        from sse.exercise_event v join sse.person p on p.id = v.person_id
        where v.exercise_id = e.id and v.seq > greatest(coalesce(p_since, 0), 0)
        order by v.seq limit 500) x), '[]'::jsonb));
end $$;

-- Appends one event. p_expected is the last sequence number the caller has seen: if somebody else was
-- faster, nothing is written and ok = false is returned.
create function public.sse_ex_post(p_exercise uuid, p_expected int, p_role text, p_kind text,
                                   p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e sse.exercise;
  mine text[];
  last int;
  pl jsonb := coalesce(p_payload, '{}'::jsonb);
  body jsonb := '{}';
  allowed text[];
  sender text;
  addressee text;
  message text;
  reason text;
  x numeric;
  y numeric;
begin
  perform sse.require_open();
  select * into e from sse.exercise where id = p_exercise for update;
  mine := sse.my_roles(e.hq_id);
  if e.id is null or cardinality(mine) = 0 then
    raise exception 'exercise not found';
  end if;
  if p_role is null or not p_role = any (mine) then
    raise exception 'you do not hold this role';
  end if;
  if jsonb_typeof(pl) <> 'object' or length(pl::text) > 3000 then
    raise exception 'invalid payload';
  end if;
  select coalesce(max(seq), 0) into last from sse.exercise_event where exercise_id = e.id;
  if p_expected is distinct from last then
    return jsonb_build_object('ok', false, 'seq', last);
  end if;
  if last >= 3000 then
    raise exception 'event limit reached';
  end if;
  if p_kind in ('advance', 'escalate', 'resume', 'inject', 'remove')
     and not p_role = any (array['commander', 'xo', 'ops_chief']) then
    raise exception 'this role may not control the exercise';
  end if;

  if p_kind in ('advance', 'resume') then
    body := '{}';
  elsif p_kind = 'escalate' then
    if not exists (select 1 from sse.gate_definition where code = pl ->> 'gate') then
      raise exception 'unknown gate';
    end if;
    body := jsonb_build_object('gate', pl ->> 'gate');
  elsif p_kind = 'decide' then
    select coalesce(o.roles, array[g.role]) into allowed
    from sse.gate_option o join sse.gate_definition g on g.code = o.gate_code
    where o.gate_code = pl ->> 'gate' and o.option_id = pl ->> 'option';
    if not found then
      raise exception 'unknown gate option';
    end if;
    if not p_role = any (allowed) then
      raise exception 'this role may not decide gate %', pl ->> 'gate';
    end if;
    if pl ->> 'recommended' is not null and not exists (
         select 1 from sse.gate_option where gate_code = pl ->> 'gate' and option_id = pl ->> 'recommended') then
      raise exception 'unknown recommended option';
    end if;
    reason := btrim(coalesce(pl ->> 'reason', ''));
    if length(reason) > 1000 then
      raise exception 'the reason is too long';
    end if;
    if pl ->> 'recommended' is not null and pl ->> 'recommended' <> pl ->> 'option' and reason = '' then
      raise exception 'a reason is required when deviating from the recommendation';
    end if;
    body := jsonb_strip_nulls(jsonb_build_object('gate', pl ->> 'gate', 'option', pl ->> 'option',
              'reason', reason, 'recommended', pl ->> 'recommended'));
  elsif p_kind = 'chat' then
    message := btrim(coalesce(pl ->> 'text', ''));
    addressee := pl ->> 'to';
    if length(message) not between 1 and 400 then
      raise exception 'a message has 1 to 400 characters';
    end if;
    if addressee is null or addressee !~
       '^(ch:(cmd|staff|intel|ops|sust|higher|subs|excon)|HHQ|CDR|XO|OPS|A0[0-9]|A10|B1|B2|TK3|ART|ENG|LOG|EXCON)$' then
      raise exception 'unknown addressee';
    end if;
    -- The command group speaks as itself; a staff member chooses a staff section or a subunit.
    if p_role = 'staff' then
      sender := pl ->> 'from';
      if sender is null or sender !~ '^(A0[0-9]|A10|B1|B2|TK3|ART|ENG|LOG)$' then
        raise exception 'choose the element you speak for';
      end if;
    else
      sender := case p_role when 'commander' then 'CDR' when 'xo' then 'XO' else 'OPS' end;
    end if;
    body := jsonb_strip_nulls(jsonb_build_object('from', sender, 'to', addressee, 'text', message,
              'quote', case when jsonb_typeof(pl -> 'quote') = 'object' then jsonb_build_object(
                         'name', left(pl #>> '{quote,name}', 40), 'text', left(pl #>> '{quote,text}', 100)) end,
              'incidentRef', left(pl ->> 'incidentRef', 40)));
  elsif p_kind = 'inject' then
    if coalesce(pl ->> 'preset', '') !~ '^[a-z0-9_-]{1,30}$' then
      raise exception 'unknown event';
    end if;
    if jsonb_typeof(pl #> '{at,0}') is distinct from 'number' or jsonb_typeof(pl #> '{at,1}') is distinct from 'number' then
      raise exception 'invalid position';
    end if;
    x := (pl #>> '{at,0}')::numeric;
    y := (pl #>> '{at,1}')::numeric;
    if x not between 0 and 1000 or y not between 0 and 700 then
      raise exception 'invalid position';
    end if;
    body := jsonb_build_object('preset', pl ->> 'preset', 'at', jsonb_build_array(round(x, 1), round(y, 1)));
  elsif p_kind = 'remove' then
    if coalesce(pl ->> 'incident', '') !~ '^[a-z0-9]{1,40}$' then
      raise exception 'unknown incident';
    end if;
    body := jsonb_build_object('incident', pl ->> 'incident');
  else
    raise exception 'unknown event kind';
  end if;

  insert into sse.exercise_event (exercise_id, hq_id, seq, kind, payload, person_id, role)
  values (e.id, e.hq_id, last + 1, p_kind, body, sse.me(), p_role);
  return jsonb_build_object('ok', true, 'seq', last + 1);
end $$;

-- Membership is set by an administrator only. The login user must already exist (Authentication > Users).
create function sse.add_member(p_email text, p_name text, p_roles text[],
                               p_hq uuid default '5e000000-0000-0000-0000-0000000000b1')
returns uuid language plpgsql set search_path = '' as $$
declare login uuid; who uuid;
begin
  select id into login from auth.users where lower(email) = lower(btrim(p_email));
  if login is null then raise exception 'no login user with this e-mail'; end if;
  insert into sse.person (display_name, auth_user_id) values (p_name, login)
  on conflict (auth_user_id) do update set display_name = excluded.display_name
  returning id into who;
  insert into sse.role_assignment (hq_id, person_id, role)
  select p_hq, who, r from unnest(p_roles) r
  on conflict do nothing;
  return who;
end $$;
-- Removes every role of the user; the person row stays, because the logs refer to it.
create function sse.remove_member(p_email text) returns int language sql set search_path = '' as $$
  with gone as (
    delete from sse.role_assignment a using sse.person p, auth.users u
    where a.person_id = p.id and p.auth_user_id = u.id and lower(u.email) = lower(btrim(p_email))
    returning 1)
  select count(*)::int from gone
$$;

-- The fictitious headquarters of the exercise; it has no members until the administrator adds them.
insert into sse.hq (id, name, echelon, staff_prefix)
values ('5e000000-0000-0000-0000-0000000000b1', 'Fiktív 1. gyakorló dandár', 'brigade', 'S')
on conflict (id) do nothing;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sse\_ex\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function sse.my_roles(uuid) from public;
revoke all on function sse.require_open() from public;
revoke all on function sse.add_member(text, text, text[], uuid) from public;
revoke all on function sse.remove_member(text) from public;
commit;
