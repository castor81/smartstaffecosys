// Run:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../public/engine.js';
import { DEMO } from '../public/demo.js';

const process_ = JSON.parse(readFileSync(new URL('../public/data/process.json', import.meta.url)));
const make = () => createEngine(process_);
const answer = (e, option) => {
  const gate = e.currentGate();
  return e.decide({ option: option ?? DEMO[gate.id].rec, role: gate.role, reason: 'teszt', recommended: DEMO[gate.id].rec });
};
const goTo = (e, gateId) => {
  for (let i = 0; i < 40; i += 1) {
    e.runToGate();
    if (e.currentGate().id === gateId) return;
    answer(e);
  }
  throw new Error(`gate ${gateId} not reached`);
};

test('every gate and option has demo material', () => {
  for (const g of process_.gates) {
    assert.ok(DEMO[g.id].o[DEMO[g.id].rec], g.id);
    for (const o of g.options) assert.equal(DEMO[g.id].o[o.id]?.length, 3, `${g.id}.${o.id}`);
  }
});

test('full cycle reaches execution and loops', () => {
  const e = make();
  const seen = [];
  for (let i = 0; i < 14; i += 1) { e.runToGate(); seen.push(e.currentGate().id); answer(e); }
  assert.deepEqual(seen, ['D0', 'D1', 'D2', 'D1', 'D3', 'D4', 'D6', 'D7', 'D1', 'D8', 'D9', 'D10', 'D9', 'D10']);
  assert.ok(e.valid('ORDER') && e.valid('FRAGORD'));
});

test('only the entitled role decides, deviation needs a reason', () => {
  const e = make();
  e.runToGate();
  assert.throws(() => e.decide({ option: 'full', role: 'xo' }), /csak ez a szerep/);
  assert.throws(() => e.decide({ option: 'short', role: 'commander', recommended: 'full' }), /indoklás/);
  assert.equal(e.state.status, 'waiting');
});

test('nothing advances while a decision is open, even after escalation', () => {
  const e = make();
  e.runToGate();
  const at = e.state.cursor;
  e.escalate();
  e.advance();
  e.runToGate();
  assert.equal(e.state.cursor, at);
  assert.equal(e.state.status, 'waiting');
  assert.equal(e.valid('GUIDANCE_0'), null);
});

test('rejection invalidates dependent products', () => {
  const e = make();
  goTo(e, 'D3');
  assert.ok(e.valid('COA_SET'));
  answer(e, 'reject');
  assert.equal(e.valid('COA_SET'), null);
  assert.ok(e.valid('MA_APPROVED'), 'earlier approval stays valid');
  assert.equal(e.subs[e.state.cursor].id, 'S3.2');
});

test('conditional gates appear only when flagged', () => {
  const e = make();
  e.state.flags.screening_failed = true;
  e.state.flags.staff_disagreement = true;
  goTo(e, 'DX'); answer(e, 'drop');
  goTo(e, 'D5');
});

test('directed mode has one COA and no staff dispute gate', () => {
  const e = make();
  e.runToGate(); answer(e, 'directed');
  e.state.flags.staff_disagreement = true;
  goTo(e, 'D6');
  assert.ok(!e.state.log.some((l) => l.gate === 'D5'));
});

test('risk escalation holds until the higher answer arrives', () => {
  const e = make();
  goTo(e, 'D7'); answer(e, 'higher');
  assert.equal(e.state.status, 'held');
  assert.equal(e.runToGate(), 'held');
  e.resume();
  assert.equal(e.currentGate().id, 'D7');
});

test('confidential+ stops everything and cannot be undone', () => {
  const e = make();
  e.runToGate();
  e.lockConfidential();
  assert.equal(e.runToGate(), 'locked');
  assert.throws(() => e.decide({ option: 'full', role: 'commander' }), /zárolva/);
  assert.equal(createEngine(process_, e.state).runToGate(), 'locked');
});
