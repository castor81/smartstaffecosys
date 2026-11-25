// The shared exercise: an append-only event list replayed on the same engine in every browser.
// Pure: no DOM, no network. An event that does not fit the current step is ignored everywhere alike.
import { createEngine } from './engine.js';
import { elementOf, channelOf } from './sim.js';
import { INCIDENTS } from './scenario.js';

export const CONTROL_ROLES = ['commander', 'xo', 'ops_chief'];

export const channelFor = (to) => (to.startsWith('ch:') ? to.slice(3) : channelOf(to));

/** The canned acknowledgement of an addressed staff element or subunit (null: nobody answers). */
export function ackFor(from, to, channel, incidentRef) {
  if (from.startsWith('ch:') || from === to) return null;
  const { group } = elementOf(from);
  if (group === 'command' || group === 'excon') return null;
  return { from, to, channel, kind: 'ack', incidentRef, text: 'Vettem, naplóztam. (szimulált nyugtázás – a demó a szöveget nem értelmezi)' };
}

export const injectMessage = (preset, at, id) => ({
  from: 'EXCON', to: preset.to, channel: 'excon', kind: 'inject',
  incident: { id, title: preset.title, severity: preset.severity, at },
  text: `ESEMÉNY: ${preset.title}. ${elementOf(preset.to).name}: intézkedést kérek.`,
});

export function createRoom(process) {
  const engine = createEngine(process);
  const room = { engine, extras: [], removed: [], seq: 0, requestedAt: null, apply };

  const add = (id, message) => room.extras.push({ id, after: engine.state.log.length, ...message });
  const gateIs = (gate) => engine.currentGate()?.id === gate;

  function play({ seq, kind, payload, role, by }) {
    if (kind === 'advance') engine.advance();
    else if (kind === 'resume') engine.resume();
    else if (engine.state.status === 'locked') return;
    else if (kind === 'escalate') { if (gateIs(payload.gate)) engine.escalate(); }
    else if (kind === 'decide') {
      if (engine.state.status === 'waiting' && gateIs(payload.gate)) {
        engine.decide({ option: payload.option, role, reason: payload.reason || '', recommended: payload.recommended || null });
      }
    } else if (kind === 'chat') {
      const { from, to, text, quote, incidentRef } = payload;
      const channel = channelFor(to);
      add(`x${seq}`, { from, to, channel, kind: 'user', text, quote, incidentRef, by });
      const ack = to.startsWith('ch:') ? null : ackFor(to, from, channel, incidentRef);
      if (ack) add(`x${seq}a`, ack);
    } else if (kind === 'inject') {
      const preset = INCIDENTS.find((p) => p.id === payload.preset);
      if (!preset) return;
      const id = `i${seq}`;
      add(`x${seq}`, { ...injectMessage(preset, payload.at, id), by });
      const ack = ackFor(preset.to, 'EXCON', 'excon', id);
      if (ack) add(`x${seq}a`, ack);
    } else if (kind === 'remove') room.removed.push(payload.incident);
  }

  /** Applies the events that follow the last one seen, in order. Returns how many were applied. */
  function apply(events) {
    let applied = 0;
    for (const event of events) {
      if (event.seq <= room.seq) continue;
      if (event.seq !== room.seq + 1) break;
      const before = engine.state.log.length;
      try { play(event); } catch { /* refused by the process rules */ }
      room.seq = event.seq;
      applied += 1;
      for (const entry of engine.state.log.slice(before)) {
        entry.at = event.at;
        entry.by = event.by;
        if (entry.type === 'decision_requested') room.requestedAt = Date.parse(event.at);
      }
    }
    return applied;
  }

  return room;
}
