-- Negative and positive tests. Run on a scratch database after the schema and the gate seed.
\set ON_ERROR_STOP on
\o /dev/null
set search_path = sse;

create or replace function public.must_fail(q text, expected text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'wrong error for [%]: %', q, sqlerrm;
    end if;
    raise notice 'PASS blocked: %', expected;
    return;
  end;
  raise exception 'FAIL, statement was allowed: %', q;
end $$;
grant execute on function public.must_fail(text, text) to sse_app;

insert into hq (id, name, echelon, staff_prefix) values
  ('00000000-0000-0000-0000-0000000000d1', 'Fiktív hadosztály', 'division', 'G');
insert into hq (id, parent_id, name, echelon, staff_prefix) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'Fiktív dandár', 'brigade', 'S'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'Másik fiktív dandár', 'brigade', 'S');
insert into person values
  ('00000000-0000-0000-0000-0000000000c1', 'Teszt parancsnok'),
  ('00000000-0000-0000-0000-0000000000c2', 'Teszt törzsfőnök');
insert into role_assignment values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'commander'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'xo');

set role sse_app;
set sse.hq_id = '00000000-0000-0000-0000-0000000000b1';

insert into planning_case (id, hq_id, title, process_version) values
  ('00000000-0000-0000-0000-0000000000a1', current_hq(), 'Teszteset', '0.2');
insert into artifact (id, case_id, hq_id, code) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', current_hq(), 'MA_BRIEF'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', current_hq(), 'COA_SET');
insert into artifact_version (id, artifact_id, hq_id, version, content, classification) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', current_hq(), 1, '{}', 'NYILT_GYAKORLO'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', current_hq(), 1, '{}', 'NYILT_GYAKORLO');
insert into artifact_dependency values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', current_hq());

select public.must_fail($q$insert into sse.artifact_version (artifact_id, hq_id, version, content, classification)
  values ('00000000-0000-0000-0000-0000000000e1', sse.current_hq(), 2, '{}', 'VEDETT')$q$, 'exceeds the instance maximum');
select public.must_fail($q$update sse.artifact_version set content = '{"x":1}'$q$, 'permission denied');
select public.must_fail($q$update sse.instance_config set profile = 'confidential_plus'$q$, 'permission denied');

insert into decision_request (id, case_id, hq_id, gate_code, subject_version, recommendation) values
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000a1', current_hq(), 'D2',
   '00000000-0000-0000-0000-0000000000f1', 'approve');
select public.must_fail($q$update sse.decision_request set status = 'decided'$q$, 'no automatic approval');
select public.must_fail($q$insert into sse.decision_record (request_id, hq_id, person_id, option_id)
  values ('00000000-0000-0000-0000-000000000091', sse.current_hq(), '00000000-0000-0000-0000-0000000000c2', 'approve')$q$,
  'not entitled');
select public.must_fail($q$insert into sse.decision_record (request_id, hq_id, person_id, option_id)
  values ('00000000-0000-0000-0000-000000000091', sse.current_hq(), '00000000-0000-0000-0000-0000000000c1', 'modify')$q$,
  'reason is required');
update decision_request set status = 'escalated' where id = '00000000-0000-0000-0000-000000000091';
insert into decision_record (request_id, hq_id, person_id, option_id) values
  ('00000000-0000-0000-0000-000000000091', current_hq(), '00000000-0000-0000-0000-0000000000c1', 'approve');
do $$ begin
  assert (select status from sse.decision_request) = 'decided', 'request should be decided';
end $$;
select public.must_fail($q$insert into sse.decision_record (request_id, hq_id, person_id, option_id)
  values ('00000000-0000-0000-0000-000000000091', sse.current_hq(), '00000000-0000-0000-0000-0000000000c1', 'approve')$q$,
  'request is not open');

do $$ begin
  assert sse.invalidate('00000000-0000-0000-0000-0000000000f1', 'changed assumption') = 2, 'dependent version must follow';
end $$;
insert into decision_request (id, case_id, hq_id, gate_code, subject_version) values
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-0000000000a1', current_hq(), 'D3',
   '00000000-0000-0000-0000-0000000000f2');
select public.must_fail($q$insert into sse.decision_record (request_id, hq_id, person_id, option_id, reason)
  values ('00000000-0000-0000-0000-000000000092', sse.current_hq(), '00000000-0000-0000-0000-0000000000c1', 'select', 'x')$q$,
  'has been invalidated');

insert into hq_message (from_hq, to_hq, kind, payload, classification) values
  (current_hq(), '00000000-0000-0000-0000-0000000000d1', 'REPORT', '{}', 'NYILT_GYAKORLO');
select public.must_fail($q$insert into sse.hq_message (from_hq, to_hq, kind, payload, classification)
  values (sse.current_hq(), '00000000-0000-0000-0000-0000000000b2', 'OPORD', '{}', 'NYILT_GYAKORLO')$q$,
  'subordinate headquarters');

set sse.hq_id = '00000000-0000-0000-0000-0000000000b2';
do $$ begin
  assert (select count(*) from sse.planning_case) = 0, 'other HQ must not see the case';
  assert (select count(*) from sse.decision_record) = 0, 'other HQ must not see decisions';
  assert (select count(*) from sse.hq_message) = 0, 'other HQ must not see the message';
end $$;

reset role;
select public.must_fail($q$delete from sse.decision_record$q$, 'append-only');
select public.must_fail($q$truncate sse.decision_record$q$, 'append-only');
select public.must_fail($q$update sse.instance_config set max_classification = 'VEDETT'$q$, 'violates check constraint');
update instance_config set profile = 'confidential_plus';
select public.must_fail($q$insert into sse.model_call (case_id, hq_id, agent_id, model, location, classification)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'A03', 'x', 'cloud', 'NYILT_GYAKORLO')$q$,
  'cloud models are disabled');
insert into model_call (case_id, hq_id, agent_id, model, location, classification) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'A03', 'local-model', 'local', 'NYILT_GYAKORLO');
select public.must_fail($q$update sse.instance_config set profile = 'open'$q$, 'downgrade is forbidden');
select public.must_fail($q$delete from sse.instance_config$q$, 'cannot be removed');
\o
\echo ALL SCHEMA TESTS PASSED
