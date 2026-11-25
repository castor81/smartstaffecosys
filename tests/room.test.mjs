// Shared exercise: every browser replays the same append-only event list and arrives at the same state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoom, ackFor, channelFor } from '../public/room.js';
import { timeline } from '../public/sim.js';
import { requestKey } from '../public/decision.js';

const process_ = JSON.parse(readFileSync(new URL('../public/data/process.json', import.meta.url)));
const at = (n) => new Date(Date.UTC(2026, 10, 25, 12, 0, n)).toISOString();
const log = (list) => list.map(([kind, payload = {}, role = 'commander'], i) => ({ seq: i + 1, kind, payload, role, by: 'Teszt', at: at(i) }));

/** Advances a fresh room to its first decision and returns the events that did it. */
function toFirstGate() {
  const room = createRoom(process_);
  const events = [];
  while (room.engine.state.status === 'ready') {
    events.push({ seq: events.length + 1, kind: 'advance', payload: {}, role: 'commander', by: 'Teszt', at: at(events.length) });
    room.apply(events);
  }
  return { room, events, gate: room.engine.currentGate() };
}

test('the same events give the same state, in one batch or one by one', () => {
  const { events, gate } = toFirstGate();
  const all = [...events, { seq: events.length + 1, kind: 'decide', role: 'commander', by: 'PK', at: at(99), payload: { gate: gate.id, option: 'full', recommended: 'full' } }];
  const a = createRoom(process_);
  const b = createRoom(process_);
  a.apply(all);
  for (const event of all) b.apply([event]);
  assert.deepEqual(a.engine.state, b.engine.state);
  assert.equal(a.seq, all.length);
  const entry = a.engine.state.log.find((x) => x.type === 'decision');
  assert.equal(entry.by, 'PK');
  assert.equal(entry.at, at(99), 'the database time, not the clock of the browser');
});

test('events are applied once and only without a gap', () => {
  const room = createRoom(process_);
  const events = log([['advance'], ['advance'], ['advance']]);
  assert.equal(room.apply([events[0], events[2]]), 1);
  assert.equal(room.seq, 1);
  assert.equal(room.apply(events), 2);
  assert.equal(room.apply(events), 0);
});

test('an event that does not fit the current step changes nothing but the sequence', () => {
  const { room, events, gate } = toFirstGate();
  const before = JSON.stringify(room.engine.state);
  const next = (kind, payload, role = 'commander') => room.apply([{ seq: room.seq + 1, kind, payload, role, by: 'x', at: at(80) }]);
  next('advance', {});
  next('resume', {});
  next('decide', { gate: 'D10', option: 'full' });
  next('decide', { gate: gate.id, option: 'nincs-ilyen' });
  next('decide', { gate: gate.id, option: 'full' }, 'staff');
  next('escalate', { gate: 'D10' });
  next('inject', { preset: 'nincs', at: [1, 1] });
  assert.equal(JSON.stringify(room.engine.state), before);
  assert.deepEqual(room.extras, []);
  assert.equal(room.seq, events.length + 7);
});

test('the request time comes from the event that opened it; escalation is recorded', () => {
  const { room, events, gate } = toFirstGate();
  assert.equal(room.requestedAt, Date.parse(events.at(-1).at));
  const key = requestKey(room.engine);
  room.apply([{ seq: room.seq + 1, kind: 'escalate', payload: { gate: gate.id }, role: 'commander', by: 'x', at: at(200) }]);
  assert.equal(room.engine.state.pending.escalated, true);
  assert.equal(room.engine.state.status, 'waiting', 'a missed deadline decides nothing');
  assert.equal(requestKey(room.engine), key);
});

test('chat, events and removal appear in the shared picture with stable ids', () => {
  const room = createRoom(process_);
  room.apply(log([
    ['chat', { from: 'A02', to: 'B2', text: 'Jelentést kérek.' }, 'staff'],
    ['chat', { from: 'CDR', to: 'ch:cmd', text: 'Kezdünk.' }],
    ['inject', { preset: 'comms', at: [300, 200] }],
    ['remove', { incident: 'i3' }],
  ]));
  assert.deepEqual(room.extras.map((m) => m.id), ['x1', 'x1a', 'x2', 'x3', 'x3a']);
  assert.deepEqual(room.removed, ['i3']);
  const { messages } = timeline(process_, room.engine.state.log, room.extras);
  assert.equal(messages.find((m) => m.id === 'x1').by, 'Teszt');
  assert.equal(messages.find((m) => m.id === 'x3').incident.id, 'i3');
  assert.equal(room.extras[0].channel, channelFor('B2'));
});

test('only an addressed staff element or subunit gives the canned acknowledgement', () => {
  assert.equal(ackFor('B2', 'A02', 'subs').kind, 'ack');
  assert.equal(ackFor('OPS', 'A02', 'cmd'), null);
  assert.equal(ackFor('ch:staff', 'A02', 'staff'), null);
  assert.equal(ackFor('A02', 'A02', 'staff'), null);
});
