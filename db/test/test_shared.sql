-- Shared exercise: membership, roles, event order, payload rules, append-only log.
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
  ('10000000-0000-0000-0000-000000000003', 's2@example.test'),
  ('10000000-0000-0000-0000-000000000004', 'outsider@example.test'),
  ('10000000-0000-0000-0000-000000000005', 'nobody@example.test');
insert into sse.hq (id, name, echelon, staff_prefix)
values ('00000000-0000-0000-0000-0000000000b2', 'Másik fiktív dandár', 'brigade', 'S');
select sse.add_member('CDR@example.test', 'Teszt parancsnok', array['commander']);
select sse.add_member('xo@example.test', 'Teszt törzsfőnök', array['xo', 'ops_chief']);
select sse.add_member('s2@example.test', 'Teszt törzstag', array['staff']);
select sse.add_member('outsider@example.test', 'Kívülálló', array['commander'], '00000000-0000-0000-0000-0000000000b2');
select public.must_fail($q$select sse.add_member('nincs@example.test', 'x', array['xo'])$q$, 'no login user');
select public.must_fail($q$select sse.add_member('s2@example.test', 'x', array['admin'])$q$, 'violates check constraint');

create function public.post(p_expected int, p_role text, p_kind text, p_payload jsonb default '{}') returns jsonb language sql as
$$ select public.sse_ex_post((select v::uuid from public.t where k = 'ex'), p_expected, p_role, p_kind, p_payload) $$;
grant execute on function public.post(int, text, text, jsonb) to anon, authenticated, service_role;

-- ---------------- who may call
set role anon;
select public.must_fail($q$select public.sse_ex_list()$q$, 'permission denied');
select public.must_fail($q$select public.sse_ex_post(gen_random_uuid(), 0, 'xo', 'advance')$q$, 'permission denied');
set role service_role;
select public.must_fail($q$select public.sse_ex_list()$q$, 'permission denied');
set role authenticated;
select public.must_fail($q$select * from sse.exercise_event$q$, 'permission denied');
select public.must_fail($q$select sse.add_member('s2@example.test', 'x', array['commander'])$q$, 'permission denied');

-- A signed-in user of the same project without membership sees nothing and can do nothing.
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
select public.must_fail($q$select public.sse_ex_create('5e000000-0000-0000-0000-0000000000b1', 'x', '0.5')$q$, 'only the command group');
do $$ begin
  assert public.sse_ex_list() -> 'hqs' = '[]'::jsonb and public.sse_ex_list() -> 'exercises' = '[]'::jsonb;
  assert public.sse_whoami() -> 'roles' = '[]'::jsonb and public.sse_inbox() = '[]'::jsonb and public.sse_history() = '[]'::jsonb;
end $$;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select public.must_fail($q$select public.sse_ex_create('5e000000-0000-0000-0000-0000000000b1', 'x', '0.5')$q$, 'only the command group');

set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.must_fail($q$select public.sse_ex_create('5e000000-0000-0000-0000-0000000000b1', '   ', '0.5')$q$, 'invalid title');
select public.must_fail($q$select public.sse_ex_create('00000000-0000-0000-0000-0000000000b2', 'x', '0.5')$q$, 'only the command group');
insert into public.t select 'ex', public.sse_ex_create('5e000000-0000-0000-0000-0000000000b1', ' Közös gyakorlat 1 ', '0.5') ->> 'id';

do $$ begin
  assert public.post(0, 'commander', 'advance') = '{"ok": true, "seq": 1}'::jsonb;
  assert public.post(0, 'commander', 'advance') = '{"ok": false, "seq": 1}'::jsonb, 'a stale writer is refused';
  assert public.post(null, 'commander', 'advance') ->> 'ok' = 'false';
end $$;
select public.must_fail($q$select public.post(1, 'xo', 'advance')$q$, 'you do not hold this role');
select public.must_fail($q$select public.post(1, 'commander', 'reset')$q$, 'unknown event kind');
select public.must_fail($q$select public.post(1, 'commander', 'decide', '{"gate":"D0","option":"zzz"}')$q$, 'unknown gate option');
select public.must_fail($q$select public.post(1, 'commander', 'decide', '{"gate":"D1","option":"release"}')$q$, 'may not decide gate D1');
select public.must_fail($q$select public.post(1, 'commander', 'decide', '{"gate":"D0","option":"short","recommended":"full","reason":"  "}')$q$, 'a reason is required');
select public.must_fail($q$select public.post(1, 'commander', 'decide', '{"gate":"D0","option":"full","recommended":"zzz"}')$q$, 'unknown recommended');
select public.must_fail($q$select public.post(1, 'commander', 'chat', '{"to":"B1","text":""}')$q$, '1 to 400');
select public.must_fail($q$select public.post(1, 'commander', 'chat', jsonb_build_object('to', 'B1', 'text', repeat('a', 401)))$q$, '1 to 400');
select public.must_fail($q$select public.post(1, 'commander', 'chat', '{"to":"<script>","text":"a"}')$q$, 'unknown addressee');
select public.must_fail($q$select public.post(1, 'commander', 'chat', jsonb_build_object('to', 'B1', 'text', 'a', 'x', repeat('a', 4000)))$q$, 'invalid payload');
select public.must_fail($q$select public.post(1, 'commander', 'chat', '[1]')$q$, 'invalid payload');
select public.must_fail($q$select public.post(1, 'commander', 'inject', '{"preset":"uav","at":["1",2]}')$q$, 'invalid position');
select public.must_fail($q$select public.post(1, 'commander', 'inject', '{"preset":"uav","at":[1001,2]}')$q$, 'invalid position');
select public.must_fail($q$select public.post(1, 'commander', 'inject', '{"at":[1,2]}')$q$, 'unknown event');
select public.must_fail($q$select public.post(1, 'commander', 'remove', '{"incident":"../x"}')$q$, 'unknown incident');
select public.must_fail($q$select public.post(1, 'commander', 'escalate', '{"gate":"D99"}')$q$, 'unknown gate');
do $$ begin
  assert public.post(1, 'commander', 'decide', '{"gate":"D0","option":"short","recommended":"full","reason":"idő","evil":1}') ->> 'ok' = 'true';
  assert public.post(2, 'commander', 'chat', '{"to":"ch:staff","text":" Helyzet? ","from":"EXCON","quote":{"name":"S2","text":"x","z":1}}') ->> 'ok' = 'true';
  assert public.post(3, 'commander', 'inject', '{"preset":"uav","at":[100.26,200]}') ->> 'ok' = 'true';
  assert public.post(4, 'commander', 'remove', '{"incident":"i4"}') ->> 'ok' = 'true';
end $$;

set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$ begin
  assert public.post(5, 'ops_chief', 'decide', '{"gate":"D9","option":"none"}') ->> 'ok' = 'true', 'an option may name its own roles';
end $$;
select public.must_fail($q$select public.post(6, 'ops_chief', 'decide', '{"gate":"D9","option":"adjust"}')$q$, 'may not decide gate D9');
select public.must_fail($q$select public.post(6, 'xo', 'decide', '{"gate":"D6","option":"approve"}')$q$, 'may not decide gate D6');

set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select public.must_fail($q$select public.post(6, 'staff', 'advance')$q$, 'may not control');
select public.must_fail($q$select public.post(6, 'staff', 'decide', '{"gate":"D0","option":"full"}')$q$, 'may not decide');
select public.must_fail($q$select public.post(6, 'commander', 'advance')$q$, 'you do not hold this role');
select public.must_fail($q$select public.post(6, 'staff', 'chat', '{"to":"CDR","text":"a","from":"CDR"}')$q$, 'choose the element');
select public.must_fail($q$select public.post(6, 'staff', 'chat', '{"to":"CDR","text":"a"}')$q$, 'choose the element');
do $$
declare r jsonb;
begin
  assert public.post(6, 'staff', 'chat', '{"to":"CDR","text":"PIR 1 teljesült (fiktív).","from":"A02"}') ->> 'ok' = 'true';
  r := public.sse_ex_poll((select v::uuid from public.t where k = 'ex'), 0);
  assert jsonb_array_length(r -> 'events') = 7 and r -> 'roles' = '["staff"]'::jsonb and r ->> 'person' = 'Teszt törzstag';
  assert r -> 'events' -> 1 -> 'payload' = '{"gate":"D0","option":"short","reason":"idő","recommended":"full"}'::jsonb, 'unknown keys are dropped';
  assert r -> 'events' -> 2 -> 'payload' ->> 'from' = 'CDR', 'the command group cannot speak as somebody else';
  assert r -> 'events' -> 2 -> 'payload' ->> 'text' = 'Helyzet?' and not (r -> 'events' -> 2 -> 'payload' -> 'quote') ? 'z';
  assert r -> 'events' -> 3 -> 'payload' = '{"preset":"uav","at":[100.3,200]}'::jsonb;
  assert r -> 'events' -> 0 ->> 'by' = 'Teszt parancsnok' and r -> 'events' -> 6 ->> 'role' = 'staff';
  assert jsonb_array_length(public.sse_ex_poll((select v::uuid from public.t where k = 'ex'), 6) -> 'events') = 1;
  assert (public.sse_ex_list() -> 'exercises' -> 0 ->> 'events')::int = 7;
  assert public.sse_ex_list() -> 'exercises' -> 0 ->> 'title' = 'Közös gyakorlat 1';
end $$;

-- Another headquarters of the same project: no access to this exercise.
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select public.must_fail($q$select public.sse_ex_poll((select v::uuid from public.t where k = 'ex'))$q$, 'exercise not found');
select public.must_fail($q$select public.post(7, 'commander', 'advance')$q$, 'exercise not found');
do $$ begin assert public.sse_ex_list() -> 'exercises' = '[]'::jsonb; end $$;
select public.must_fail($q$select public.sse_ex_poll(gen_random_uuid())$q$, 'exercise not found');
reset role;

-- ---------------- the log is append-only, removal of a member ends the access
select public.must_fail($q$update sse.exercise_event set payload = '{}'$q$, 'append-only');
select public.must_fail($q$delete from sse.exercise_event$q$, 'append-only');
select public.must_fail($q$truncate sse.exercise_event$q$, 'append-only');
select public.must_fail($q$delete from sse.exercise where true$q$, 'append-only');
do $$ begin assert sse.remove_member('S2@example.test') = 1; end $$;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select public.must_fail($q$select public.sse_ex_poll((select v::uuid from public.t where k = 'ex'))$q$, 'exercise not found');
reset role;

-- ---------------- Bizalmas+ switches the shared (cloud) exercise off
update sse.instance_config set profile = 'confidential_plus';
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.must_fail($q$select public.sse_ex_list()$q$, 'confidential_plus');
select public.must_fail($q$select public.post(7, 'commander', 'advance')$q$, 'confidential_plus');
reset role;
\o
\echo ALL SHARED EXERCISE TESTS PASSED
