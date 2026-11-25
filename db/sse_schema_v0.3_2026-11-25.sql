-- SmartStaffEcosys schema v0.3 (2026-11-25), PostgreSQL 15+.
-- Defence in depth only: a database owner or superuser can bypass triggers and RLS.
-- These rules do not make any installation accredited for classified data.
begin;

create schema sse;
set local search_path = sse;

-- ---------------------------------------------------------------- classification and instance profile
create table classification_level (code text primary key, rank int not null unique);
insert into classification_level values ('NYILT_GYAKORLO', 0), ('VEDETT', 1), ('BIZALMAS_PLUSZ', 2);

create table instance_config (
  id boolean primary key default true check (id),
  profile text not null check (profile in ('open', 'confidential_plus')),
  max_classification text not null references classification_level,
  accreditation_ref text,
  check (max_classification = 'NYILT_GYAKORLO'
         or (profile = 'confidential_plus' and coalesce(trim(accreditation_ref), '') <> ''))
);
insert into instance_config (profile, max_classification) values ('open', 'NYILT_GYAKORLO');

create function guard_instance() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.profile = 'confidential_plus' and new.profile = 'open' then
      raise exception 'profile downgrade is forbidden: create a new instance';
    end if;
    return new;
  end if;
  raise exception 'instance_config cannot be removed';
end $$;
create trigger instance_guard before update or delete on instance_config
  for each row execute function guard_instance();
create trigger instance_no_truncate before truncate on instance_config
  for each statement execute function guard_instance();

create function check_classification(p_code text) returns void language plpgsql
set search_path = sse as $$
begin
  if (select rank from classification_level where code = p_code) >
     (select l.rank from instance_config c join classification_level l on l.code = c.max_classification) then
    raise exception 'classification % exceeds the instance maximum', p_code;
  end if;
end $$;

-- ---------------------------------------------------------------- organisation (multi-echelon)
create table hq (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references hq,
  name text not null,
  echelon text not null check (echelon in ('battalion', 'brigade', 'division', 'corps', 'joint')),
  staff_prefix char(1) not null check (staff_prefix in ('S', 'G')),
  procedure text not null default 'FM 5-0 MDMP',
  check (parent_id is distinct from id)
);
create table person (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  auth_user_id uuid unique  -- login identity; set only by an administrator
);
create table role_assignment (
  hq_id uuid not null references hq,
  person_id uuid not null references person,
  role text not null check (role in ('commander', 'xo', 'ops_chief', 'staff')),
  primary key (hq_id, person_id, role)
);

-- ---------------------------------------------------------------- gates (seeded from process.json)
create table gate_definition (code text primary key, role text not null, title text not null);
create table gate_option (
  gate_code text not null references gate_definition,
  option_id text not null,
  label text not null,
  effect text not null check (effect in ('advance', 'revise', 'rework', 'hold', 'loop', 'new_case')),
  target_substep text,
  roles text[] check (cardinality(roles) > 0),  -- null: only the gate's role
  primary key (gate_code, option_id)
);

-- ---------------------------------------------------------------- process definition (seeded from process.json)
create table substep (
  id text primary key,
  seq int not null unique,
  name text not null,
  run text not null,
  agents text[] not null,
  inputs text[] not null,
  outputs text[] not null,
  qa text,
  human boolean generated always as (run = 'human') stored
);
create table segment (
  id text primary key,
  workflow text not null,
  seq int not null unique,
  substeps text[] not null,
  gate_code text not null references gate_definition,
  gate_substep text not null references substep,
  subject text not null
);
create table prompt_common (id boolean primary key default true check (id), body text not null);
create table agent (id text primary key, name text not null, prompt text not null);

-- ---------------------------------------------------------------- planning data
create table planning_case (
  id uuid primary key default gen_random_uuid(),
  hq_id uuid not null references hq,
  title text not null,
  mode text check (mode in ('full', 'short', 'directed')),
  process_version text not null,
  created_at timestamptz not null default now(),
  unique (id, hq_id)
);
create table artifact (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  hq_id uuid not null,
  code text not null,
  foreign key (case_id, hq_id) references planning_case (id, hq_id),
  unique (case_id, code),
  unique (id, hq_id)
);
create table artifact_version (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  hq_id uuid not null,
  version int not null check (version > 0),
  substep text references substep,  -- null: external input
  content jsonb not null,
  classification text not null references classification_level,
  author_agent text,
  model text,
  created_at timestamptz not null default now(),
  foreign key (artifact_id, hq_id) references artifact (id, hq_id),
  unique (artifact_id, version),
  unique (id, hq_id)
);
create table artifact_dependency (
  version_id uuid not null,
  depends_on uuid not null,
  hq_id uuid not null,
  primary key (version_id, depends_on),
  check (version_id <> depends_on),
  foreign key (version_id, hq_id) references artifact_version (id, hq_id),
  foreign key (depends_on, hq_id) references artifact_version (id, hq_id)
);
create table artifact_invalidation (
  version_id uuid primary key,
  hq_id uuid not null,
  reason text not null,
  at timestamptz not null default now(),
  foreign key (version_id, hq_id) references artifact_version (id, hq_id)
);

-- Marks a version and everything built on it as invalid.
create function invalidate(p_version uuid, p_reason text) returns int language plpgsql
set search_path = sse as $$
declare n int;
begin
  with recursive affected(id) as (
    select p_version
    union
    select d.version_id from artifact_dependency d join affected a on d.depends_on = a.id
  )
  insert into artifact_invalidation (version_id, hq_id, reason)
  select v.id, v.hq_id, p_reason from artifact_version v join affected a on a.id = v.id
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- human decisions
create table decision_request (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  hq_id uuid not null,
  gate_code text not null references gate_definition,
  substep text references substep,
  subject_version uuid,
  recommendation text,
  payload jsonb not null default '{}',
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'escalated', 'decided', 'cancelled')),
  foreign key (case_id, hq_id) references planning_case (id, hq_id),
  foreign key (subject_version, hq_id) references artifact_version (id, hq_id),
  foreign key (gate_code, recommendation) references gate_option (gate_code, option_id),
  unique (id, hq_id)
);
create unique index one_open_request on decision_request (case_id, gate_code, coalesce(substep, ''))
  where status in ('pending', 'escalated');
create table decision_record (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  hq_id uuid not null,
  person_id uuid not null references person,
  option_id text not null,
  reason text,
  guidance text,  -- commander's guidance or intent, written by the human
  decided_at timestamptz not null default now(),
  foreign key (request_id, hq_id) references decision_request (id, hq_id)
);

create function guard_decision() returns trigger language plpgsql set search_path = sse as $$
declare
  r decision_request;
  allowed text[];
  chosen_effect text;
begin
  select * into r from decision_request where id = new.request_id for update;
  if r.status not in ('pending', 'escalated') then
    raise exception 'request is not open';
  end if;
  select coalesce(o.roles, array[g.role]), o.effect into allowed, chosen_effect
  from gate_option o join gate_definition g on g.code = o.gate_code
  where o.gate_code = r.gate_code and o.option_id = new.option_id;
  if not found then
    raise exception 'unknown option % for gate %', new.option_id, r.gate_code;
  end if;
  if not exists (select 1 from role_assignment a
                 where a.role = any (allowed) and a.hq_id = new.hq_id and a.person_id = new.person_id) then
    raise exception 'person is not entitled to decide gate %', r.gate_code;
  end if;
  if chosen_effect = 'advance' and coalesce(trim(new.guidance), '') = ''
     and exists (select 1 from substep where id = r.substep and human) then
    raise exception 'written guidance is required for this decision';
  end if;
  if r.recommendation is distinct from new.option_id and r.recommendation is not null
     and coalesce(trim(new.reason), '') = '' then
    raise exception 'a reason is required when deviating from the recommendation';
  end if;
  if r.subject_version is not null
     and exists (select 1 from artifact_invalidation where version_id = r.subject_version) then
    raise exception 'the subject of this request has been invalidated';
  end if;
  new.decided_at := now();
  return new;
end $$;
create trigger decision_guard before insert on decision_record for each row execute function guard_decision();

-- Adds a new version of a case artifact and links it to the valid inputs of its substep.
create function put_version(p_case uuid, p_hq uuid, p_substep text, p_code text, p_content jsonb,
                            p_agent text default null, p_model text default null)
returns uuid language plpgsql set search_path = sse as $$
declare a uuid; v uuid; n int;
begin
  insert into artifact (case_id, hq_id, code) values (p_case, p_hq, p_code) on conflict (case_id, code) do nothing;
  select id into a from artifact where case_id = p_case and code = p_code;
  perform pg_advisory_xact_lock(hashtext(a::text));
  select coalesce(max(version), 0) + 1 into n from artifact_version where artifact_id = a;
  insert into artifact_version (artifact_id, hq_id, version, substep, content, classification, author_agent, model)
  values (a, p_hq, n, p_substep, p_content, 'NYILT_GYAKORLO', p_agent, p_model) returning id into v;
  insert into artifact_dependency (version_id, depends_on, hq_id)
  select v, l.id, p_hq
  from substep s
  cross join lateral unnest(s.inputs) as i(code)
  cross join lateral (
    select av.id from artifact_version av join artifact ar on ar.id = av.artifact_id
    where ar.case_id = p_case and ar.code = i.code and av.id <> v
      and not exists (select 1 from artifact_invalidation x where x.version_id = av.id)
    order by av.version desc limit 1) l
  where s.id = p_substep
  on conflict do nothing;
  return v;
end $$;

-- Applies the consequences of a human decision.
create function close_request() returns trigger language plpgsql set search_path = sse as $$
declare r decision_request; o gate_option; here substep; back int; code text; item record;
begin
  update decision_request set status = 'decided' where id = new.request_id returning * into r;
  select * into o from gate_option where gate_code = r.gate_code and option_id = new.option_id;
  if r.gate_code = 'D0' and o.effect = 'advance' then
    update planning_case set mode = new.option_id where id = r.case_id;
  end if;
  select * into here from substep where id = r.substep;
  if not found then return null; end if;
  if o.effect = 'advance' and here.human then
    foreach code in array here.outputs loop
      perform put_version(r.case_id, r.hq_id, here.id, code,
        jsonb_build_object('gate', r.gate_code, 'option', new.option_id, 'guidance', new.guidance));
    end loop;
  elsif o.effect in ('rework', 'loop', 'revise') then
    if o.effect = 'revise' then
      back := here.seq - case when here.human then 1 else 0 end;
    else
      select seq into back from substep where id = o.target_substep;
    end if;
    for item in
      select v.id from artifact_version v
      join artifact a on a.id = v.artifact_id
      join substep s on s.id = v.substep
      where a.case_id = r.case_id and s.seq between back and here.seq
    loop
      perform invalidate(item.id, r.gate_code || ' ' || new.option_id);
    end loop;
  end if;
  return null;
end $$;
create trigger decision_close after insert on decision_record for each row execute function close_request();

-- A request is born open, becomes "decided" only through a record, and never changes afterwards.
create function guard_request() returns trigger language plpgsql set search_path = sse as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'a new request must be pending'; end if;
    return new;
  end if;
  if old.status in ('decided', 'cancelled') then raise exception 'request is closed'; end if;
  if (new.id, new.case_id, new.hq_id, new.gate_code, new.substep, new.subject_version, new.recommendation, new.payload)
     is distinct from
     (old.id, old.case_id, old.hq_id, old.gate_code, old.substep, old.subject_version, old.recommendation, old.payload) then
    raise exception 'only status and deadline may change';
  end if;
  if new.status = 'decided' and not exists (select 1 from decision_record where request_id = new.id) then
    raise exception 'no automatic approval: a decision record is required';
  end if;
  return new;
end $$;
create trigger request_guard before insert or update on decision_request for each row execute function guard_request();

-- ---------------------------------------------------------------- model calls and inter-HQ messages
create table model_call (
  id bigint generated always as identity primary key,
  case_id uuid not null,
  hq_id uuid not null,
  agent_id text not null,
  model text not null,
  location text not null check (location in ('cloud', 'local')),
  classification text not null references classification_level,
  at timestamptz not null default now(),
  foreign key (case_id, hq_id) references planning_case (id, hq_id)
);
create table hq_message (
  id bigint generated always as identity primary key,
  from_hq uuid not null references hq,
  to_hq uuid not null references hq,
  kind text not null check (kind in ('WARNORD', 'OPORD', 'FRAGORD', 'REPORT')),
  payload jsonb not null,
  classification text not null references classification_level,
  sent_at timestamptz not null default now()
);

-- The gateway must insert the row BEFORE it calls a model; a rejected insert means no call.
create function guard_model_call() returns trigger language plpgsql set search_path = sse as $$
begin
  perform check_classification(new.classification);
  if new.location = 'cloud' and (select profile from instance_config) = 'confidential_plus' then
    raise exception 'cloud models are disabled in the confidential_plus profile';
  end if;
  return new;
end $$;
create trigger model_call_guard before insert on model_call for each row execute function guard_model_call();

create function guard_classified_row() returns trigger language plpgsql set search_path = sse as $$
begin
  perform check_classification(new.classification);
  return new;
end $$;
create trigger version_class before insert on artifact_version for each row execute function guard_classified_row();
create trigger message_class before insert on hq_message for each row execute function guard_classified_row();

create function guard_message_route() returns trigger language plpgsql set search_path = sse as $$
begin
  if new.kind = 'REPORT' then
    if not exists (select 1 from hq where id = new.from_hq and parent_id = new.to_hq) then
      raise exception 'a report goes to the parent headquarters';
    end if;
  elsif not exists (select 1 from hq where id = new.to_hq and parent_id = new.from_hq) then
    raise exception 'an order goes to a subordinate headquarters';
  end if;
  return new;
end $$;
create trigger message_route before insert on hq_message for each row execute function guard_message_route();

-- ---------------------------------------------------------------- append-only history
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
do $$
declare t text;
begin
  foreach t in array array['artifact_version', 'artifact_dependency', 'artifact_invalidation',
                           'decision_record', 'model_call', 'hq_message'] loop
    execute format('create trigger %I before update or delete on sse.%I for each row execute function sse.forbid_change()', t || '_frozen', t);
    execute format('create trigger %I before truncate on sse.%I for each statement execute function sse.forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- access: one headquarters sees its own data
-- The backend sets, per transaction:  set local sse.hq_id = '<uuid>';
create function current_hq() returns uuid language sql stable as
$$ select nullif(current_setting('sse.hq_id', true), '')::uuid $$;

do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'sse_app') then
    create role sse_app nologin;
  end if;
  foreach t in array array['planning_case', 'artifact', 'artifact_version', 'artifact_dependency',
                           'artifact_invalidation', 'decision_request', 'decision_record', 'model_call'] loop
    execute format('alter table sse.%I enable row level security', t);
    execute format('create policy own_hq on sse.%I using (hq_id = sse.current_hq()) with check (hq_id = sse.current_hq())', t);
  end loop;
end $$;
-- Organisation tables: own headquarters, its direct subordinates and its parent.
create function parent_hq(p_hq uuid) returns uuid language sql stable security definer set search_path = sse as
$$ select parent_id from sse.hq where id = p_hq $$;
revoke all on function parent_hq(uuid) from public;
alter table hq enable row level security;
create policy near_hq on hq for select
  using (id = current_hq() or parent_id = current_hq() or id = parent_hq(current_hq()));
alter table role_assignment enable row level security;
create policy own_roles on role_assignment for select using (hq_id = current_hq());
alter table person enable row level security;
create policy own_people on person for select
  using (exists (select 1 from role_assignment a where a.person_id = person.id));

-- Reference tables: readable by the application, writable only by an administrator.
do $$
declare t text;
begin
  foreach t in array array['classification_level', 'instance_config', 'gate_definition', 'gate_option',
                           'substep', 'segment', 'prompt_common', 'agent'] loop
    execute format('alter table sse.%I enable row level security', t);
    execute format('create policy read_all on sse.%I for select using (true)', t);
  end loop;
end $$;

alter table hq_message enable row level security;
create policy read_own on hq_message for select using (current_hq() in (from_hq, to_hq));
create policy send_own on hq_message for insert with check (from_hq = current_hq());

grant usage on schema sse to sse_app;
grant execute on function parent_hq(uuid) to sse_app;
grant select on all tables in schema sse to sse_app;
grant insert on planning_case, artifact, artifact_version, artifact_dependency, artifact_invalidation,
  decision_request, decision_record, model_call, hq_message to sse_app;
grant update (status, due_at) on decision_request to sse_app;
grant update (mode) on planning_case to sse_app;

commit;
