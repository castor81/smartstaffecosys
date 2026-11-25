// Pure derivation of the command-post picture from the engine log. No DOM, no network.
import { SCRIPT, MINUTES, EXERCISE, ELEMENTS, COAS, ASSEMBLY, TURNS, TERRAIN, VARIANCES } from './scenario.js';

const element = new Map(ELEMENTS.map((e) => [e.id, e]));
export const elementOf = (id) => element.get(id) || { id, short: id, name: id, group: 'staff' };
export const roleElement = (role) => ({ commander: 'CDR', xo: 'XO', ops_chief: 'OPS' }[role] || 'A00');

const CHANNEL_BY_ID = { A01: 'sust', A02: 'intel', A03: 'ops', A04: 'sust', A09: 'ops', A10: 'ops' };
/** The room a free-text message to this element belongs to. */
export function channelOf(id) {
  const g = elementOf(id).group;
  if (g === 'staff') return CHANNEL_BY_ID[id] || 'staff';
  return { higher: 'higher', command: 'cmd', sub: 'subs', excon: 'excon' }[g] || 'staff';
}

const EXECUTION_OFFSET = (EXERCISE.executionAt - EXERCISE.receivedAt) / 60000;

export function formatClock(minute) {
  const d = new Date(EXERCISE.receivedAt + minute * 60000);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getUTCMonth() + 1)}.${two(d.getUTCDate())}. ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
export function formatH(minute) {
  const diff = Math.round(minute - EXECUTION_OFFSET);
  const abs = Math.abs(diff);
  return `H${diff < 0 ? '−' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Replays the engine log (plus locally added messages) into a message feed.
 * `extras` are user messages and exercise injects; each is placed after log entry number `after`.
 */
export function timeline(process, log, extras = []) {
  const gates = new Map(process.gates.map((g) => [g.id, g]));
  const messages = [];
  const emitted = new Set();
  const info = { minute: 0, mode: null, coaCount: 3, picked: null, approved: null, variance: null, adjusted: false, cycles: 0 };

  const push = (id, minute, m) => messages.push({ id, minute: Math.round(minute), kind: 'msg', ...m });

  function emit(substep, n) {
    if (emitted.has(substep)) return;
    emitted.add(substep);
    let lines = SCRIPT[substep] || [];
    if (substep === 'S8.1') {
      const which = info.cycles % lines.length;
      lines = lines[which];
      info.variance = which;
      info.adjusted = false;
      info.cycles += 1;
      info.minute = Math.max(info.minute, EXECUTION_OFFSET + 60);
    }
    if (substep === 'S8.5') info.adjusted = true;
    const span = MINUTES[substep] || 10;
    lines.forEach(([from, to, channel, text, ref], i) => {
      const filled = text.replace('{n}', info.coaCount).replace('{coa}', `COA ${info.approved || Math.min(2, info.coaCount)}`);
      push(`s${n}-${substep}-${i}`, info.minute + (span * (i + 1)) / (lines.length + 1), { from, to, channel, text: filled, ref, substep });
    });
    info.minute += span;
  }

  function event(e) {
    const id = `e${e.n}`;
    const gate = e.gate ? gates.get(e.gate) : null;
    if (e.type === 'decision_requested') {
      const sub = process.steps.flatMap((s) => s.substeps).find((s) => s.id === e.substep);
      if (sub && sub.run !== 'human') emit(e.substep, e.n);
      push(id, info.minute, { from: 'A00', to: roleElement(gate.role), channel: 'cmd', kind: 'request', gate: e.gate, text: `DÖNTÉS SZÜKSÉGES · ${e.gate}: ${gate.title}` });
    } else if (e.type === 'substep_done') {
      emit(e.substep, e.n);
      emitted.delete(e.substep);
    } else if (e.type === 'decision') {
      const option = gate.options.find((o) => o.id === e.option);
      info.minute += 5;
      if (e.gate === 'D0' && option.effect === 'advance') {
        info.mode = e.option;
        info.coaCount = process.modes[e.option].coa_count;
      }
      if (e.gate === 'D5') info.picked = e.option.startsWith('coa') ? Number(e.option.slice(3)) : null;
      if (e.gate === 'D6') info.approved = option.effect === 'advance' ? Math.min(info.picked || 2, info.coaCount) : null;
      push(id, info.minute, { from: roleElement(e.role), to: 'A00', channel: 'cmd', kind: 'decision', gate: e.gate, text: `${e.gate} döntés: ${option.label}${e.reason ? ` · Indok: ${e.reason}` : ''}` });
      if (option.effect === 'hold') push(`${id}h`, info.minute, { from: roleElement(e.role), to: 'HHQ', channel: 'higher', text: 'A kockázatra elöljárói jóváhagyást kérek.' });
    } else if (e.type === 'returned') {
      emitted.clear();
      push(id, info.minute, { from: 'A00', to: 'A03', channel: 'staff', kind: 'system', text: `Visszalépés ide: ${e.to}. Érvénytelenített produktumverzió: ${e.invalidated}.` });
    } else if (e.type === 'escalated') {
      push(id, info.minute, { from: 'A00', to: 'XO', channel: 'cmd', kind: 'alert', text: `${e.gate}: a határidő lejárt – eszkaláció. Döntés nem született.` });
    } else if (e.type === 'higher_answer_received') {
      info.minute += 30;
      push(id, info.minute, { from: 'HHQ', to: 'CDR', channel: 'higher', text: 'Az elöljárói válasz megérkezett; a döntés a parancsnoké.' });
    } else if (e.type === 'case_closed') {
      push(id, info.minute, { from: 'A00', to: 'CDR', channel: 'cmd', kind: 'system', text: e.why });
    } else if (e.type === 'confidential_plus_on') {
      push(id, info.minute, { from: 'A00', to: 'CDR', channel: 'cmd', kind: 'alert', text: `Bizalmas+ bekapcsolva. ${e.effect}` });
    }
  }

  const local = (after) => extras.filter((x) => x.after === after).forEach((x) => {
    info.minute += 1;
    push(x.id, info.minute, x);
  });

  local(0);
  for (const e of log) {
    event(e);
    local(e.n);
  }
  return { messages, info };
}

const ARROW_UNITS = ['B1', 'B2', 'TK3'];

/** What the map shows. `has(code)` says whether a valid product version exists. */
export function mapModel({ has, info, extras = [], removed = [], view = {} }) {
  const wargame = view.wargame || null;
  const coaCount = info.coaCount;
  const approved = has('COA_APPROVED') ? info.approved : null;
  const sketches = has('COA_SET') || has('ARRAY');
  const deployed = has('ACKS');

  let units = { ...ASSEMBLY };
  if (deployed) units = { ...COAS[approved || info.approved || Math.min(2, coaCount)].pos };
  if (deployed && info.adjusted) {
    if (info.variance === 1) units.LOG = [185, 385];
    else units.RES = [270, 300];
  }

  let enemy = [{ id: 'E1', at: TURNS[0].enemy[0], label: 'Vörös hcs.' }];
  if (has('IPOE')) enemy.push({ id: 'E2', at: TURNS[0].enemy[1], label: 'Átkelőeszk.?' });
  if (has('IPOE')) enemy.push({ id: 'ER', at: [960, 430], label: 'Tartalék ?', unknown: true });
  if (info.cycles > 0) {
    enemy = [{ id: 'E1', at: [440, 255], label: 'Vörös hcs.' }, { id: 'E2', at: info.variance === 0 ? [395, 335] : [415, 190], label: 'Átkelőeszk.' }, { id: 'ER', at: [900, 430], label: 'Tartalék ?', unknown: true }];
  }

  let arrows = [];
  const chosen = approved || null;
  const shown = view.coa && view.coa <= coaCount ? view.coa : null;
  if (sketches && !deployed) {
    const list = chosen ? [chosen] : shown ? [shown] : Array.from({ length: coaCount }, (_, i) => i + 1);
    arrows = list.flatMap((n) => ARROW_UNITS.map((u) => ({ coa: n, unit: u, from: ASSEMBLY[u], to: COAS[n].pos[u], solid: n === chosen })));
  }
  if (deployed && info.adjusted) {
    const [u, from] = info.variance === 1 ? ['LOG', COAS[approved || 2].pos.LOG] : ['RES', COAS[approved || 2].pos.RES];
    arrows.push({ coa: approved || 2, unit: u, from, to: units[u], solid: true, adjusted: true });
  }

  // Defence sketches of a single COA before deployment, shown as faded "planned" symbols.
  const ghostCoa = !deployed && sketches ? chosen || shown : null;
  const ghosts = ghostCoa ? Object.fromEntries(Object.entries(COAS[ghostCoa].pos).filter(([k]) => k !== 'CP' && k !== 'LOG')) : {};

  const incidents = extras.filter((x) => x.incident && !removed.includes(x.incident.id)).map((x) => x.incident);
  if (info.variance !== null && !removed.includes(`var${info.cycles}`)) incidents.push({ id: `var${info.cycles}`, ...VARIANCES[info.variance] });

  const model = {
    units, ghosts, enemy, arrows, incidents,
    avenues: has('IPOE'), nai: has('ICP'), dps: has('DECISION_POINTS') || has('EVENTS'),
    plan: has('ORDER_DRAFT') || has('ORDER'), keyTerrain: has('TASKS'),
    crossings: TERRAIN.crossings,
  };

  if (wargame) {
    const n = wargame.coa;
    const t = wargame.turn;
    model.units = t === 0 ? { ...ASSEMBLY } : { ...COAS[n].pos };
    if (t === 4) {
      if (n === 3) model.units.TK3 = [245, 150];
      model.units.RES = [285, 300];
    }
    model.enemy = [{ id: 'E1', at: TURNS[t].enemy[0], label: 'Vörös hcs.' }, { id: 'E2', at: TURNS[t].enemy[1], label: 'Átkelőeszk.' }, { id: 'ER', at: [955, 430], label: 'Tartalék ?', unknown: true }];
    model.arrows = t === 0 ? ARROW_UNITS.map((u) => ({ coa: n, unit: u, from: ASSEMBLY[u], to: COAS[n].pos[u] })) : [];
    model.ghosts = {};
    model.incidents = [];
    Object.assign(model, { avenues: true, nai: true, dps: true, plan: true, keyTerrain: true });
  }
  return model;
}

/** Element state for the order-of-battle list. */
export function elementStates({ engine, process, messages }) {
  const out = {};
  for (const m of messages) out[m.from] = 'seen';
  const sub = engine.subs[engine.state.cursor];
  if (engine.state.status === 'ready' && engine.state.log.length) for (const a of sub.agents) out[a] = 'working';
  if (engine.state.status === 'waiting') {
    const gate = process.gates.find((g) => g.id === engine.state.pending.queue[0]);
    out[roleElement(gate.role)] = engine.state.pending.escalated ? 'late' : 'decide';
  }
  if (engine.state.status === 'held') out.HHQ = 'decide';
  return out;
}
