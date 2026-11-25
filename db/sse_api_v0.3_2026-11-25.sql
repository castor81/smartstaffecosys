-- SmartStaffEcosys API v0.3 (2026-11-25) for Supabase: the only way in from outside.
-- The sse schema is not exposed; these functions are. Run after the schema and the seed.
--   authenticated (a logged-in human):  sse_whoami, sse_inbox, sse_decide, sse_history
--   service_role (the workflow engine): sse_engine_*
begin;

create function sse.me() returns uuid language sql stable set search_path = '' as
$$ select id from sse.person where auth_user_id = auth.uid() $$;
revoke all on function sse.me() from public;

-- ---------------------------------------------------------------- humans
create function public.sse_whoami() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'person', (select display_name from sse.person where id = sse.me()),
    'profile', (select profile from sse.instance_config),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('hq', h.name, 'echelon', h.echelon, 'role', a.role)
                                        order by h.name, a.role)
                       from sse.role_assignment a join sse.hq h on h.id = a.hq_id
                       where a.person_id = sse.me()), '[]'::jsonb))
$$;

create function public.sse_inbox() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.item order by x.due_at nulls last), '[]'::jsonb) from (
    select r.due_at, jsonb_build_object(
      'id', r.id, 'gate', r.gate_code, 'title', g.title, 'substep', r.substep, 'case', c.title, 'hq', h.name,
      'status', case when r.status = 'pending' and r.due_at < now() then 'escalated' else r.status end,
      'due_at', r.due_at, 'recommendation', r.recommendation, 'material', r.payload,
      'needs_guidance', coalesce(s.human, false),
      'subject', (select v.content from sse.artifact_version v where v.id = r.subject_version),
      'options', (select jsonb_agg(jsonb_build_object(
                    'id', o.option_id, 'label', o.label, 'effect', o.effect,
                    'roles', coalesce(o.roles, array[g.role]),
                    'allowed', exists (select 1 from sse.role_assignment a
                                       where a.person_id = sse.me() and a.hq_id = r.hq_id
                                         and a.role = any (coalesce(o.roles, array[g.role])))))
                  from sse.gate_option o where o.gate_code = r.gate_code)) as item
    from sse.decision_request r
    join sse.gate_definition g on g.code = r.gate_code
    join sse.planning_case c on c.id = r.case_id
    join sse.hq h on h.id = r.hq_id
    left join sse.substep s on s.id = r.substep
    where r.status in ('pending', 'escalated')
      and exists (select 1 from sse.role_assignment a where a.person_id = sse.me() and a.hq_id = r.hq_id)
      and not exists (select 1 from sse.artifact_invalidation i where i.version_id = r.subject_version)
  ) x
$$;

create function public.sse_decide(p_request uuid, p_option text, p_reason text default null,
                                  p_guidance text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who uuid := sse.me(); target uuid;
begin
  select r.hq_id into target from sse.decision_request r
  where r.id = p_request
    and exists (select 1 from sse.role_assignment a where a.person_id = who and a.hq_id = r.hq_id);
  if target is null then
    raise exception 'request not found';
  end if;
  insert into sse.decision_record (request_id, hq_id, person_id, option_id, reason, guidance)
  values (p_request, target, who, p_option, p_reason, p_guidance);
  return jsonb_build_object('status', 'decided');
end $$;

create function public.sse_history() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.item order by x.id desc), '[]'::jsonb) from (
    select d.id, jsonb_build_object('id', d.id, 'gate', r.gate_code, 'option', o.label, 'by', p.display_name,
             'reason', d.reason, 'guidance', d.guidance, 'at', d.decided_at, 'case', c.title) as item
    from sse.decision_record d
    join sse.decision_request r on r.id = d.request_id
    join sse.gate_option o on o.gate_code = r.gate_code and o.option_id = d.option_id
    join sse.person p on p.id = d.person_id
    join sse.planning_case c on c.id = r.case_id
    where exists (select 1 from sse.role_assignment a where a.person_id = sse.me() and a.hq_id = d.hq_id)
    order by d.id desc limit 100
  ) x
$$;

-- ---------------------------------------------------------------- workflow engine
-- Returns the case with this title, creating it from the external inputs on first use.
create function public.sse_engine_start(p_hq uuid, p_title text, p_inputs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; k text;
begin
  perform pg_advisory_xact_lock(hashtext(p_hq::text || p_title));
  select id into c from sse.planning_case where hq_id = p_hq and title = p_title order by created_at desc limit 1;
  if c is not null then return jsonb_build_object('case', c, 'created', false); end if;
  if not coalesce(p_inputs ? 'HQ_ORDER', false) then raise exception 'HQ_ORDER is required'; end if;
  insert into sse.planning_case (hq_id, title, process_version) values (p_hq, p_title, '0.3') returning id into c;
  for k in select jsonb_object_keys(p_inputs) loop
    if k not in ('HQ_ORDER', 'KNOWLEDGE', 'SOP', 'UNIT_STATUS', 'INTEL', 'TERRAIN', 'ADJACENT') then
      raise exception 'not an external input: %', k;
    end if;
    perform sse.put_version(c, p_hq, null, k, p_inputs -> k);
  end loop;
  return jsonb_build_object('case', c, 'created', true);
end $$;

-- System prompt of one agent for one substep.
create function sse.system_prompt(p_agent text, p_substep text) returns text
language sql stable set search_path = '' as $$
  select replace(replace(replace(replace(c.body,
           '{beosztás}', a.name), '{agent_id}', a.id),
           '{eljárásrend}', 'FM 5-0 MDMP'), '{mdmp_step}', s.id || ' ' || s.name)
         || E'\n\n' || a.prompt
  from sse.prompt_common c, sse.agent a, sse.substep s where a.id = p_agent and s.id = p_substep
$$;
revoke all on function sse.system_prompt(text, text) from public;

-- What may happen now? run (a segment), wait (a human), done, or blocked.
-- p_workflow null: whatever comes next; otherwise only that workflow's segments.
create function public.sse_engine_next(p_case uuid, p_workflow text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare seg sse.segment; last record;
begin
  if not exists (select 1 from sse.planning_case where id = p_case) then
    raise exception 'unknown case';
  end if;
  if (select profile from sse.instance_config) = 'confidential_plus' then
    return jsonb_build_object('action', 'blocked', 'why', 'confidential_plus: cloud processing is disabled');
  end if;
  if p_workflow is not null and not exists (select 1 from sse.segment where workflow = p_workflow) then
    raise exception 'unknown workflow';
  end if;
  for seg in select * from sse.segment order by seq loop
    select r.id, r.status, o.effect into last
    from sse.decision_request r
    left join sse.decision_record d on d.request_id = r.id
    left join sse.gate_option o on o.gate_code = r.gate_code and o.option_id = d.option_id
    where r.case_id = p_case and r.gate_code = seg.gate_code and r.substep = seg.gate_substep
      and r.status <> 'cancelled'
    order by (r.status in ('pending', 'escalated')) desc, d.id desc nulls last
    limit 1;
    if last.id is not null and last.effect = 'advance' then
      continue;
    end if;
    if seg.workflow <> p_workflow then
      if seg.seq > (select max(seq) from sse.segment where workflow = p_workflow) then
        return jsonb_build_object('action', 'done');
      end if;
      return jsonb_build_object('action', 'blocked', 'why', 'earlier segment is not approved', 'segment', seg.id);
    end if;
    if last.status in ('pending', 'escalated') then
      return jsonb_build_object('action', 'wait', 'segment', seg.id, 'gate', seg.gate_code, 'request', last.id);
    end if;
    return jsonb_build_object(
      'action', 'run', 'segment', seg.id, 'workflow', seg.workflow, 'substeps', to_jsonb(seg.substeps),
      'gate', seg.gate_code, 'gate_substep', seg.gate_substep, 'subject', seg.subject,
      'gate_title', (select title from sse.gate_definition where code = seg.gate_code),
      'gate_options', (select jsonb_agg(jsonb_build_object('id', option_id, 'label', label) order by option_id)
                       from sse.gate_option where gate_code = seg.gate_code),
      'coordinator_prompt', sse.system_prompt('A00', seg.gate_substep),
      'plan', (select jsonb_agg(jsonb_build_object(
                 'substep', s.id, 'name', s.name, 'run', s.run, 'qa', s.qa,
                 'inputs', to_jsonb(s.inputs), 'outputs', to_jsonb(s.outputs),
                 'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'system', sse.system_prompt(a.id, s.id))
                                                      order by u.ord)
                                     from unnest(s.agents) with ordinality u(id, ord)
                                     join sse.agent a on a.id = u.id), '[]'::jsonb)) order by s.seq)
               from sse.substep s where s.id = any (seg.substeps)));
  end loop;
  return jsonb_build_object('action', 'done');
end $$;

-- Latest valid artifacts of a case, plus the human remarks the next draft must respect.
create function public.sse_engine_context(p_case uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'case', (select jsonb_build_object('title', title, 'mode', mode) from sse.planning_case where id = p_case),
    'artifacts', coalesce((
      select jsonb_object_agg(x.code, x.content) from (
        select distinct on (a.code) a.code, v.content
        from sse.artifact a join sse.artifact_version v on v.artifact_id = a.id
        where a.case_id = p_case
          and not exists (select 1 from sse.artifact_invalidation i where i.version_id = v.id)
        order by a.code, v.version desc) x), '{}'::jsonb),
    'human_remarks', coalesce((
      select jsonb_agg(jsonb_build_object('gate', r.gate_code, 'option', d.option_id,
                                          'reason', d.reason, 'guidance', d.guidance) order by d.id)
      from sse.decision_record d join sse.decision_request r on r.id = d.request_id
      where r.case_id = p_case), '[]'::jsonb))
$$;

create function public.sse_engine_put(p_case uuid, p_substep text, p_outputs jsonb,
                                      p_agent text default null, p_model text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h uuid; s sse.substep; k text; n int := 0;
begin
  select hq_id into h from sse.planning_case where id = p_case;
  select * into s from sse.substep where id = p_substep;
  if h is null or s.id is null then raise exception 'unknown case or substep'; end if;
  if s.human then raise exception 'only a human decision produces the outputs of this substep'; end if;
  foreach k in array s.outputs loop
    if p_outputs -> k is null or p_outputs -> k in ('null'::jsonb, '""'::jsonb) then
      raise exception 'missing output %', k;
    end if;
    perform sse.put_version(p_case, h, p_substep, k, p_outputs -> k, p_agent, p_model);
    n := n + 1;
  end loop;
  return jsonb_build_object('written', n);
end $$;

-- Must be called BEFORE every model call: a refusal here means no call.
create function public.sse_engine_model_call(p_case uuid, p_agent text, p_model text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into sse.model_call (case_id, hq_id, agent_id, model, location, classification)
  select id, hq_id, p_agent, p_model, 'cloud', 'NYILT_GYAKORLO' from sse.planning_case where id = p_case
  returning id into n;
  if n is null then raise exception 'unknown case'; end if;
  return jsonb_build_object('call', n);
end $$;

create function public.sse_engine_request(p_case uuid, p_gate text, p_substep text, p_recommendation text,
                                          p_material jsonb, p_subject_code text, p_due_minutes int default 60)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h uuid; subject uuid; req uuid;
begin
  select hq_id into h from sse.planning_case where id = p_case;
  if h is null then raise exception 'unknown case'; end if;
  select v.id into subject
  from sse.artifact a join sse.artifact_version v on v.artifact_id = a.id
  where a.case_id = p_case and a.code = p_subject_code
    and not exists (select 1 from sse.artifact_invalidation i where i.version_id = v.id)
  order by v.version desc limit 1;
  if subject is null then raise exception 'no valid subject %', p_subject_code; end if;
  insert into sse.decision_request (case_id, hq_id, gate_code, substep, subject_version, recommendation, payload, due_at)
  values (p_case, h, p_gate, p_substep, subject, p_recommendation, coalesce(p_material, '{}'::jsonb),
          now() + make_interval(mins => greatest(p_due_minutes, 1)))
  returning id into req;
  return jsonb_build_object('request', req);
end $$;

-- A missed deadline only escalates. It never decides.
create function public.sse_engine_escalate() returns int language sql security definer set search_path = '' as $$
  with late as (
    update sse.decision_request set status = 'escalated' where status = 'pending' and due_at < now() returning 1)
  select count(*)::int from late
$$;

-- ---------------------------------------------------------------- who may call what
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sse\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    execute format('grant execute on function %s to %I', f.sig,
                   case when f.proname like 'sse\_engine\_%' then 'service_role' else 'authenticated' end);
  end loop;
end $$;
revoke all on function sse.put_version(uuid, uuid, text, text, jsonb, text, text) from public;
revoke all on function sse.invalidate(uuid, text) from public;
grant execute on function sse.put_version(uuid, uuid, text, text, jsonb, text, text) to sse_app;
grant execute on function sse.invalidate(uuid, text) to sse_app;
commit;
