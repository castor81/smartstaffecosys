// Drives the n8n Code node scripts against the real database functions with a stand-in model.
// Checks the data flow of the runner through WF-01 and WF-02. It does not check n8n wiring or model quality. Started by run.sh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const src = (...n) => n.map((f) => read(`n8n/src/${f}`)).join('\n');
const [host, port, db] = process.argv.slice(2);

function psql(sql, vars = {}) {
  const args = ['-qAt', '-h', host, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-f', '-'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('psql', args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v)
  : `$j$${typeof v === 'string' ? v : JSON.stringify(v)}$j$`);
const rpc = (fn, ...a) => JSON.parse(psql(`set role service_role; select public.${fn}(${a.map(lit).join(', ')});`));

const sub = psql("select auth_user_id from sse.person limit 1");
const human = (sql) => psql(`set role authenticated; set request.jwt.claim.sub = '${sub}'; ${sql}`);
const inbox = () => JSON.parse(human('select public.sse_inbox();'));

const cfg = { hqId: '5e000000-0000-0000-0000-0000000000b1', caseTitle: 'GYAKORLAT-01',
  modelT1: 'test-t1', modelT2: 'test-t2', modelT3: 'test-t3', dueMinutes: 60 };

function code(source, input, nodes) {
  const items = (list) => ({ first: () => list[0], all: () => list });
  const wrap = (list) => list.map((json) => ({ json }));
  const $ = (name) => { assert.ok(nodes[name], `unknown node ${name}`); return items(wrap(nodes[name])); };
  return new Function('$input', '$', source)(items(wrap(input)), $).map((i) => i.json);
}

const calls = [];
function fakeModel(task, i) {
  calls.push(task);
  let content;
  if (task.user.includes('VÁLASZTHATÓ ALTERNATÍVÁK')) {
    const options = JSON.parse(task.user.match(/VÁLASZTHATÓ ALTERNATÍVÁK: (.*)/)[1]);
    content = { why: 'teszt', recommendation: options[0].id,
      options: options.map((o) => ({ id: o.id, pro: 'e', con: 'h', risk: 'k' })) };
  } else {
    content = Object.fromEntries(task.expected.map((c) => [c, c.startsWith('TIMELINE')
      ? { events: [{ name: 'tervezés', start: '2027-03-01T07:00:00+01:00', end: '2027-03-02T12:00:00+01:00', level: 'own' }] }
      : { text: `teszt ${c} ${task.agent}` }]));
  }
  const reply = { status: 'OK', content, sources: ['HQ_ORDER'], gaps: [] };
  // Two envelope shapes: text and already parsed.
  return { output: [{ content: [{ type: 'output_text', text: i % 2 ? reply : '```json\n' + JSON.stringify(reply) + '\n```' }] }] };
}

function run() {
  const opened = rpc('sse_engine_start', cfg.hqId, cfg.caseTitle, {});
  assert.equal(opened.created, false, 'the demo setup already created the case');
  const next = rpc('sse_engine_next', opened.case, null);
  if (next.action !== 'run') return next;
  const nodes = { 'Beállítások': [cfg], 'Ügy megnyitása': [opened], 'Mi a következő?': [next] };
  for (const step of next.plan) {
    nodes['Aktuális részlépés'] = [step];
    const tasks = code(src('task.js'), [rpc('sse_engine_context', opened.case)], nodes);
    nodes['Feladat összeállítása'] = tasks;
    let result = tasks[0];
    if (result.kind === 'llm') {
      const replies = tasks.map((t, i) => { rpc('sse_engine_model_call', opened.case, t.agent, t.model); return fakeModel(t, i); });
      result = code(src('parse.js', 'collect.js'), replies, nodes)[0];
    }
    rpc('sse_engine_put', opened.case, result.substep, result.outputs, result.agent, result.model);
  }
  const task = code(src('coordinator.js'), [rpc('sse_engine_context', opened.case)], nodes)[0];
  nodes['Döntési kérés összeállítása'] = [task];
  rpc('sse_engine_model_call', opened.case, task.agent, task.model);
  const m = code(src('parse.js', 'material.js'), [fakeModel(task, 1)], nodes)[0];
  rpc('sse_engine_request', opened.case, next.gate, next.gate_substep, m.recommendation, m.material, next.subject, cfg.dueMinutes);
  assert.equal(rpc('sse_engine_next', opened.case, null).action, 'wait');
  return next;
}

function decide(gate, option) {
  const open = inbox();
  assert.equal(open.length, 1, 'exactly one open request');
  assert.equal(open[0].gate, gate);
  const guidance = open[0].needs_guidance ? 'Fiktív iránymutatás.' : null;
  human(`select public.sse_decide('${open[0].id}', '${option}', ${lit('teszt indoklás')}, ${lit(guidance)});`);
}

const steps = [['WF-01', 'W1A', 'D0', 'full'], ['WF-01', 'W1B', 'D1', 'release'], ['WF-02', 'W2A', 'D2', 'more'],
  ['WF-02', 'W2A', 'D2', 'approve'], ['WF-02', 'W2B', 'D1', 'release']];
for (const [wf, segment, gate, option] of steps) {
  const next = run();
  assert.deepEqual([next.workflow, next.segment], [wf, segment]);
  decide(gate, option);
}
assert.equal(run().action, 'done');

const budget = calls.find((c) => c.substep === 'S1.4').user;
assert.match(budget, /"available_hours":72/);
assert.match(budget, /"own_planning_ends":"2027-03-02T06:00:00\+01:00"/);
assert.match(calls.find((c) => c.substep === 'S2.4').user, /"shortfall":48/);
const timeline = JSON.parse(psql(`select v.content from sse.artifact a join sse.artifact_version v on v.artifact_id = a.id
  where a.code = 'TIMELINE' and v.substep = 'S2.10' order by v.version desc limit 1`));
assert.deepEqual(timeline.issues.map((i) => i.type), ['EGYHARMAD_SZABALY']);
assert.equal(psql('select count(*) from sse.model_call'), String(calls.length));
console.log(`ALL WORKFLOW TESTS PASSED (${calls.length} stand-in model calls)`);
