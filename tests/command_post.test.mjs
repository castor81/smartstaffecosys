// Command post: the JCHAT feed and the map picture are derived from the engine log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../public/engine.js';
import { DEMO } from '../public/demo.js';
import { timeline, mapModel, elementStates, channelOf, formatClock, formatH } from '../public/sim.js';
import { SCRIPT, MINUTES, ELEMENTS, CHANNELS, UNITS, ASSEMBLY, COAS, TURNS } from '../public/scenario.js';

const process_ = JSON.parse(readFileSync(new URL('../public/data/process.json', import.meta.url)));
const substeps = process_.steps.flatMap((s) => s.substeps);
const ids = new Set(ELEMENTS.map((e) => e.id));
const rooms = new Set(CHANNELS.map((c) => c.id));

const picture = (e, extras = [], removed = []) => {
  const { messages, info } = timeline(process_, e.state.log, extras);
  return { messages, info, model: mapModel({ has: (c) => Boolean(e.valid(c)), info, extras, removed }) };
};
const answer = (e, option) => {
  const gate = e.currentGate();
  const id = option ?? (e.options(gate).some((o) => o.id === DEMO[gate.id].rec) ? DEMO[gate.id].rec : e.options(gate)[0].id);
  const role = e.rolesFor(gate, gate.options.find((o) => o.id === id))[0];
  e.decide({ option: id, role, reason: 'teszt' });
};
const goTo = (e, gateId, choose = {}) => {
  for (let i = 0; i < 60; i += 1) {
    e.runToGate();
    const gate = e.currentGate();
    if (gate.id === gateId) return;
    answer(e, choose[gate.id]);
  }
  throw new Error(`gate ${gateId} not reached`);
};

test('every substep has a script and a duration, addressed to known elements and rooms', () => {
  for (const s of substeps) {
    assert.ok(SCRIPT[s.id], `script ${s.id}`);
    assert.ok(MINUTES[s.id] > 0, `minutes ${s.id}`);
    for (const line of SCRIPT[s.id].flatMap((l) => (typeof l[0] === 'string' ? [l] : l))) {
      const [from, to, channel, text] = line;
      assert.ok(ids.has(from) && ids.has(to) && rooms.has(channel) && channel !== 'all' && text, `${s.id}: ${line}`);
    }
  }
  assert.equal(Object.keys(SCRIPT).length, substeps.length);
  for (const e of ELEMENTS) assert.ok(rooms.has(channelOf(e.id)), e.id);
});

test('planning fits before execution and the clock never runs backwards', () => {
  const e = createEngine(process_);
  goTo(e, 'D9');
  const { messages } = picture(e);
  const planning = messages.filter((m) => !m.substep?.startsWith('S8') && m.gate !== 'D9');
  assert.match(formatH(Math.max(...planning.map((m) => m.minute))), /^H−/);
  for (let i = 1; i < messages.length; i += 1) assert.ok(messages[i].minute >= messages[i - 1].minute - 1, `${messages[i - 1].id} -> ${messages[i].id}`);
  assert.equal(formatClock(0), '03.01. 06:00');
  assert.equal(formatH(0), 'H−72:00');
});

test('draft messages come before the request, human substeps after the decision, nothing twice', () => {
  const e = createEngine(process_);
  goTo(e, 'D2');
  const { messages } = picture(e);
  const at = (f) => messages.findIndex(f);
  assert.ok(at((m) => m.substep === 'S1.5') > at((m) => m.kind === 'decision' && m.gate === 'D0'));
  assert.equal(messages.filter((m) => m.substep === 'S1.6' && m.to === 'B1' && m.from === 'A03').length, 1);
  assert.equal(new Set(messages.map((m) => m.id)).size, messages.length);
  assert.equal(messages.at(-1).kind, 'request');
  assert.equal(messages.at(-1).to, 'CDR');
});

test('the map follows the products', () => {
  const e = createEngine(process_);
  let p = picture(e);
  assert.deepEqual(p.model.units.B1, ASSEMBLY.B1);
  assert.equal(p.model.avenues, false);
  goTo(e, 'D3');
  p = picture(e);
  assert.ok(p.model.avenues && p.model.nai);
  assert.deepEqual([...new Set(p.model.arrows.map((a) => a.coa))], [1, 2, 3]);
  assert.deepEqual(p.model.units.B1, ASSEMBLY.B1, 'nobody moves before the order');
  goTo(e, 'D9');
  p = picture(e);
  assert.deepEqual(p.model.units.B1, COAS[2].pos.B1);
  assert.equal(p.model.incidents.length, 1);
  assert.match(p.messages.map((m) => m.text).join('\n'), /COA 2 jóváhagyva/);
});

test('the XO choice on disagreement is the approved course of action', () => {
  const e = createEngine(process_);
  e.state.flags.staff_disagreement = true;
  goTo(e, 'D9', { D5: 'coa3' });
  const p = picture(e);
  assert.equal(p.info.approved, 3);
  assert.deepEqual(p.model.units.TK3, COAS[3].pos.TK3);
});

test('shorter modes show fewer courses of action', () => {
  for (const [mode, n] of [['short', 2], ['directed', 1]]) {
    const e = createEngine(process_);
    goTo(e, 'D3', { D0: mode });
    const p = picture(e);
    assert.equal(new Set(p.model.arrows.map((a) => a.coa)).size, n, mode);
    assert.ok(p.messages.some((m) => m.text.startsWith(`${n} COA`)), mode);
    goTo(e, 'D9');
    assert.ok(picture(e).info.approved <= n, mode);
  }
});

test('local messages keep their place; incidents can be removed', () => {
  const e = createEngine(process_);
  goTo(e, 'D0');
  const extras = [{ id: 'x1', after: e.state.log.length, from: 'EXCON', to: 'A05', channel: 'excon', kind: 'inject', text: 'ESEMÉNY', incident: { id: 'i1', title: 'x', severity: 'magas', at: [100, 100] } }];
  assert.equal(picture(e, extras).model.incidents.length, 1);
  assert.equal(picture(e, extras, ['i1']).model.incidents.length, 0);
  answer(e);
  e.runToGate();
  const { messages } = picture(e, extras);
  const mine = messages.findIndex((m) => m.id === 'x1');
  assert.ok(mine > 0 && mine < messages.findIndex((m) => m.kind === 'decision'));
});

test('element states mark who has to decide', () => {
  const e = createEngine(process_);
  goTo(e, 'D1');
  const states = elementStates({ engine: e, process: process_, messages: picture(e).messages });
  assert.equal(states.XO, 'decide');
  e.escalate();
  assert.equal(elementStates({ engine: e, process: process_, messages: [] }).XO, 'late');
});

test('war-game turns place every unit and enemy', () => {
  const e = createEngine(process_);
  goTo(e, 'D3');
  const { info } = picture(e);
  for (const coa of [1, 2, 3]) {
    for (let turn = 0; turn < TURNS.length; turn += 1) {
      const m = mapModel({ has: () => false, info, view: { wargame: { coa, turn } } });
      for (const [id, at] of Object.entries(m.units)) assert.ok(UNITS[id] && at.length === 2, `${coa}/${turn}/${id}`);
      assert.equal(m.enemy.length, 3);
    }
  }
});
