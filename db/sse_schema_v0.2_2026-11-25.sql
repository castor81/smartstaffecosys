-- SmartStaffEcosys schema v0.2 (2026-11-25), PostgreSQL 15+ (tested on 16).
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
create table person (id uuid primary key default gen_random_uuid(), display_name text not null);
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
  primary key (gate_code, option_id)
);

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
create table decision_record (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  hq_id uuid not null,
  person_id uuid not null references person,
  option_id text not null,
  reason text,
  decided_at timestamptz not null default now(),
  foreign key (request_id, hq_id) references decision_request (id, hq_id)
);

create function guard_decision() returns trigger language plpgsql set search_path = sse as $$
declare r decision_request;
begin
  select * into r from decision_request where id = new.request_id for update;
  if r.status not in ('pending', 'escalated') then
    raise exception 'request is not open';
  end if;
  if not exists (select 1 from role_assignment a join gate_definition g on g.role = a.role
                 where g.code = r.gate_code and a.hq_id = new.hq_id and a.person_id = new.person_id) then
    raise exception 'person is not entitled to decide gate %', r.gate_code;
  end if;
  if not exists (select 1 from gate_option where gate_code = r.gate_code and option_id = new.option_id) then
    raise exception 'unknown option % for gate %', new.option_id, r.gate_code;
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

create function close_request() returns trigger language plpgsql set search_path = sse as $$
begin
  update decision_request set status = 'decided' where id = new.request_id;
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
  if (new.id, new.case_id, new.hq_id, new.gate_code, new.subject_version, new.recommendation, new.payload)
     is distinct from
     (old.id, old.case_id, old.hq_id, old.gate_code, old.subject_version, old.recommendation, old.payload) then
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
alter table hq_message enable row level security;
create policy read_own on hq_message for select using (current_hq() in (from_hq, to_hq));
create policy send_own on hq_message for insert with check (from_hq = current_hq());

grant usage on schema sse to sse_app;
grant select on all tables in schema sse to sse_app;
grant insert on planning_case, artifact, artifact_version, artifact_dependency, artifact_invalidation,
  decision_request, decision_record, model_call, hq_message to sse_app;
grant update (status, due_at) on decision_request to sse_app;
grant update (mode) on planning_case to sse_app;

commit;
