-- API tests: who may call what, and a full WF-01 / WF-02 round with human decisions.
\set ON_ERROR_STOP on
\o /dev/null
create function public.must_fail(q text, expected text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if position(expected in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', q, sqlerrm; end if;
    raise notice 'PASS blocked: %', expected;
    return;
  end;
  raise exception 'FAIL, statement was allowed: %', q;
end $$;
grant execute on function public.must_fail(text, text) to anon, authenticated, service_role;

create table public.t (k text primary key, v text);
grant all on public.t to anon, authenticated, service_role;

insert into auth.users values
  ('10000000-0000-0000-0000-000000000001', 'cdr@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'xo@example.test'),
  ('10000000-0000-0000-0000-000000000004', 'outsider@example.test');
insert into sse.hq (id, name, echelon, staff_prefix) values
  ('00000000-0000-0000-0000-0000000000b1', 'Fiktív dandár', 'brigade', 'S'),
  ('00000000-0000-0000-0000-0000000000b2', 'Másik fiktív dandár', 'brigade', 'S');
insert into sse.person (id, display_name, auth_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Teszt parancsnok', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c2', 'Teszt törzsfőnök', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000c4', 'Kívülálló', '10000000-0000-0000-0000-000000000004');
insert into sse.role_assignment values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'commander'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'xo'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c4', 'commander');

-- Produces fictitious outputs for the listed substeps, as the engine would.
create function public.fill(p_case uuid, p_substeps jsonb) returns void language plpgsql security definer as $$
declare s sse.substep;
begin
  for s in select * from sse.substep where id in (select jsonb_array_elements_text(p_substeps)) order by seq loop
    perform public.sse_engine_put(p_case, s.id,
      (select jsonb_object_agg(o, to_jsonb('fiktív ' || o)) from unnest(s.outputs) o), 'A00', 'teszt');
  end loop;
end $$;
-- One engine round: run the segment that is due and open its gate.
create function public.round(p_wf text, p_subject text, p_rec text) returns uuid language plpgsql as $$
declare c uuid := (select v::uuid from public.t where k = 'case'); n jsonb;
begin
  n := public.sse_engine_next(c, p_wf);
  assert n ->> 'action' = 'run', 'expected run, got ' || n::text;
  perform public.fill(c, n -> 'substeps');
  assert n ->> 'subject' = p_subject, 'unexpected subject';
  assert jsonb_array_length(n -> 'plan') = jsonb_array_length(n -> 'substeps'), 'plan covers the segment';
  assert n -> 'plan' -> -1 -> 'agents' -> 0 ->> 'system' like 'SZEREP:%', 'agent prompt is delivered';
  assert n ->> 'coordinator_prompt' not like '%{agent_id}%', 'placeholders are filled';
  return (public.sse_engine_request(c, n ->> 'gate', n ->> 'gate_substep', p_rec, '{}', p_subject, 30) ->> 'request')::uuid;
end $$;

-- ---------------- access to the functions
set role anon;
select public.must_fail($q$select public.sse_inbox()$q$, 'permission denied');
select public.must_fail($q$select public.sse_engine_escalate()$q$, 'permission denied');
select public.must_fail($q$select * from sse.person$q$, 'permission denied');
set role authenticated;
select public.must_fail($q$select public.sse_engine_start('00000000-0000-0000-0000-0000000000b1', 'x', '{}')$q$, 'permission denied');
select public.must_fail($q$select * from sse.decision_record$q$, 'permission denied');
set role service_role;
select public.must_fail($q$select public.sse_decide(gen_random_uuid(), 'x')$q$, 'permission denied');

-- ---------------- WF-01
select public.must_fail($q$select public.sse_engine_start('00000000-0000-0000-0000-0000000000b1', 'Rossz', '{"COA_SET":"x"}')$q$, 'HQ_ORDER is required');
insert into public.t select 'case', public.sse_engine_start('00000000-0000-0000-0000-0000000000b1', 'Gyakorlat', '{"HQ_ORDER":"fiktív parancs","TERRAIN":"fiktív terep"}') ->> 'case';
do $$ begin
  assert not (public.sse_engine_start('00000000-0000-0000-0000-0000000000b1', 'Gyakorlat', '{}') ->> 'created')::boolean, 'start is idempotent';
end $$;
do $$ begin
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-02') ->> 'action' = 'blocked';
end $$;
select public.must_fail($q$select public.sse_engine_put((select v::uuid from public.t where k='case'), 'S1.4', '{"ASSESSMENT":"x"}')$q$, 'missing output');
select public.must_fail($q$select public.sse_engine_put((select v::uuid from public.t where k='case'), 'S1.5', '{"GUIDANCE_0":"x"}')$q$, 'only a human decision');
select public.sse_engine_model_call((select v::uuid from public.t where k='case'), 'A03', 'teszt');
insert into public.t select 'd0', public.round('WF-01', 'ASSESSMENT', 'full');
do $$ begin
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-01') ->> 'action' = 'wait';
end $$;
select public.must_fail($q$select public.sse_engine_request((select v::uuid from public.t where k='case'), 'D0', 'S1.5', 'full', '{}', 'ASSESSMENT')$q$, 'one_open_request');

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
do $$ begin assert jsonb_array_length(public.sse_inbox()) = 0, 'outsider sees nothing'; end $$;
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d0'), 'full', null, 'x')$q$, 'request not found');
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$ begin
  assert jsonb_array_length(public.sse_inbox()) = 1;
  assert not (public.sse_inbox() -> 0 -> 'options' -> 0 ->> 'allowed')::boolean, 'XO may look, not decide D0';
end $$;
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d0'), 'full', null, 'x')$q$, 'not entitled');
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d0'), 'full')$q$, 'guidance is required');
select public.sse_decide((select v::uuid from public.t where k='d0'), 'full', null, 'Fiktív kezdeti iránymutatás');

set role service_role;
insert into public.t select 'd1', public.round('WF-01', 'WARNORD_1', 'release');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d1'), 'revise')$q$, 'reason is required');
select public.sse_decide((select v::uuid from public.t where k='d1'), 'revise', 'Hiányzó időpont');
set role service_role;
insert into public.t select 'd1b', public.round('WF-01', 'WARNORD_1', 'release');
set role authenticated;
select public.sse_decide((select v::uuid from public.t where k='d1b'), 'release');
set role service_role;
do $$ begin
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-01') ->> 'action' = 'done';
end $$;

-- ---------------- WF-02, with one rework
insert into public.t select 'd2', public.round('WF-02', 'MA_BRIEF', 'approve');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.sse_decide((select v::uuid from public.t where k='d2'), 'more', 'Gyenge feltételezések');
set role service_role;
do $$
declare a jsonb := public.sse_engine_context((select v::uuid from public.t where k='case')) -> 'artifacts';
begin
  assert not a ? 'MA_BRIEF' and not a ? 'MISSION', 'rework invalidates mission analysis';
  assert a ? 'GUIDANCE_0' and a ? 'WARNORD_1' and a ? 'HQ_ORDER', 'earlier approvals stay';
end $$;
insert into public.t select 'd2b', public.round('WF-02', 'MA_BRIEF', 'approve');

-- a missed deadline escalates and nothing else
reset role;
update sse.decision_request set due_at = now() - interval '1 minute' where id = (select v::uuid from public.t where k='d2b');
set role service_role;
do $$ begin
  assert public.sse_engine_escalate() = 1;
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-02') ->> 'action' = 'wait';
end $$;
set role authenticated;
select public.sse_decide((select v::uuid from public.t where k='d2b'), 'approve', null, 'Fiktív parancsnoki szándék');
set role service_role;
insert into public.t select 'd1c', public.round('WF-02', 'WARNORD_2', 'release');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select public.sse_decide((select v::uuid from public.t where k='d1c'), 'release');
do $$ begin
  assert jsonb_array_length(public.sse_history()) = 6;
  assert public.sse_whoami() ->> 'person' = 'Teszt törzsfőnök';
end $$;
reset role;
do $$ begin
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-02') ->> 'action' = 'done';
  assert (select mode from sse.planning_case) = 'full';
  assert exists (select 1 from sse.artifact_dependency), 'dependencies are recorded';
end $$;

-- D9: only the commander may choose a change of direction
do $$ begin
  assert (select roles from sse.gate_option where gate_code='D9' and option_id='adjust') = array['commander'];
  assert (select roles from sse.gate_option where gate_code='D9' and option_id='none') = array['ops_chief', 'commander'];
end $$;

-- D9 through the API: the chief of operations cannot change the direction of the unit
reset role;
insert into auth.users values ('10000000-0000-0000-0000-000000000003', 'ops@example.test');
insert into sse.person (id, display_name, auth_user_id) values
  ('00000000-0000-0000-0000-0000000000c3', 'Teszt műveleti főnök', '10000000-0000-0000-0000-000000000003');
insert into sse.role_assignment values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c3', 'ops_chief');
set role service_role;
insert into public.t select 'd9', public.sse_engine_request((select v::uuid from public.t where k='case'), 'D9', 'S8.2', 'adjust', '{}', 'WARNORD_2') ->> 'request';
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d9'), 'adjust')$q$, 'not entitled');
select public.must_fail($q$select public.sse_decide((select v::uuid from public.t where k='d9'), 'newplan', 'x')$q$, 'not entitled');
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.sse_decide((select v::uuid from public.t where k='d9'), 'adjust');
reset role;

-- confidential+ stops the engine
update sse.instance_config set profile = 'confidential_plus';
set role service_role;
do $$ begin
  assert public.sse_engine_next((select v::uuid from public.t where k='case'), 'WF-01') ->> 'action' = 'blocked';
end $$;
select public.must_fail($q$select public.sse_engine_model_call((select v::uuid from public.t where k='case'), 'A03', 'x')$q$, 'cloud models are disabled');
\o
\echo ALL API TESTS PASSED
