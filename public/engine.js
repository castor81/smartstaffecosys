// Process engine: pure state transitions over data/process.json. No DOM, no network.
export function createEngine(process, saved) {
  const subs = process.steps.flatMap((st) => st.substeps.map((s) => ({ ...s, step: st.id })));
  const index = new Map(subs.map((s, i) => [s.id, i]));
  const gates = new Map(process.gates.map((g) => [g.id, g]));

  const fresh = () => ({
    version: process.meta.version, cursor: 0, status: 'ready', mode: null, pending: null,
    artifacts: [], log: [], flags: { screening_failed: false, staff_disagreement: false },
  });
  const state = saved && saved.version === process.meta.version ? saved : fresh();

  const note = (type, data) => state.log.push({ n: state.log.length + 1, at: new Date().toISOString(), type, ...data });
  const locked = () => state.status === 'locked';

  function produce(sub) {
    for (const code of sub.outputs) {
      const version = state.artifacts.filter((a) => a.code === code).length + 1;
      state.artifacts.push({ code, version, by: sub.id, valid: true });
    }
  }

  function activeGates(sub) {
    return (sub.gates || []).filter((id) => {
      const flag = gates.get(id).conditional;
      if (!flag) return true;
      if (flag === 'staff_disagreement' && state.mode === 'directed') return false;
      return state.flags[flag];
    });
  }

  function moveNext() {
    const sub = subs[state.cursor];
    // Execution (S8) is a continuous cycle: after the last substep it starts again.
    state.cursor = state.cursor + 1 < subs.length ? state.cursor + 1 : index.get('S8.1');
    state.status = 'ready';
    state.pending = null;
    note('substep_done', { substep: sub.id });
  }

  /** Runs the current substep. Stops in status "waiting" if a human gate is open. */
  function advance() {
    if (state.status !== 'ready') return state.status;
    const sub = subs[state.cursor];
    const queue = activeGates(sub);
    if (sub.run !== 'human') produce(sub); // draft first, then the human releases it
    if (queue.length) {
      state.status = 'waiting';
      state.pending = { substep: sub.id, queue, escalated: false };
      note('decision_requested', { substep: sub.id, gate: queue[0] });
    } else {
      if (sub.run === 'human') produce(sub);
      moveNext();
    }
    return state.status;
  }

  function runToGate() {
    let guard = subs.length + 1;
    while (state.status === 'ready' && guard-- > 0) advance();
    return state.status;
  }

  function currentGate() {
    return state.pending ? gates.get(state.pending.queue[0]) : null;
  }

  function options(gate) {
    if (gate.id !== 'D5') return gate.options;
    const count = process.modes[state.mode || 'full'].coa_count;
    return gate.options.filter((o) => !o.id.startsWith('coa') || Number(o.id.slice(3)) <= count);
  }

  /** An option may name its own roles; otherwise only the gate's role may choose it. */
  function rolesFor(gate, chosen) {
    return chosen?.roles || [gate.role];
  }

  function invalidate(from, to) {
    let n = 0;
    for (const a of state.artifacts) {
      const i = index.get(a.by);
      if (a.valid && i >= from && i <= to) { a.valid = false; n += 1; }
    }
    return n;
  }

  function decide({ option, role, reason = '', recommended = null }) {
    if (locked()) throw new Error('A példány zárolva van.');
    if (state.status !== 'waiting') throw new Error('Nincs nyitott döntés.');
    const gate = currentGate();
    const chosen = options(gate).find((o) => o.id === option);
    if (!chosen) throw new Error('Válassz egy alternatívát.');
    const allowed = rolesFor(gate, chosen);
    if (!allowed.includes(role)) throw new Error(`Ezt csak ez a szerep döntheti el: ${allowed.map((r) => process.human_roles[r]).join(' vagy ')}.`);
    if (recommended && option !== recommended && !reason.trim()) throw new Error('Az ajánlástól eltéréshez indoklás kell.');

    const here = state.cursor;
    const sub = subs[here];
    note('decision', { substep: sub.id, gate: gate.id, option, role, reason: reason.trim(), recommended, escalated: state.pending.escalated });
    if (gate.id === 'D0' && chosen.effect === 'advance') state.mode = option;
    if (gate.conditional) state.flags[gate.conditional] = false;

    if (chosen.effect === 'advance') {
      state.pending.queue.shift();
      if (state.pending.queue.length) {
        state.pending.escalated = false;
        note('decision_requested', { substep: sub.id, gate: state.pending.queue[0] });
      } else {
        if (sub.run === 'human') produce(sub);
        moveNext();
      }
    } else if (chosen.effect === 'hold') {
      state.status = 'held';
    } else if (chosen.effect === 'new_case') {
      state.status = 'closed';
      state.pending = null;
      note('case_closed', { why: 'Új MDMP-ciklus indítása szükséges.' });
    } else {
      // revise: redo this draft (for a human substep: the preceding one). rework/loop: jump back.
      const target = chosen.effect === 'revise' ? (sub.run === 'human' ? here - 1 : here) : index.get(chosen.to);
      const n = invalidate(target, here);
      state.cursor = target;
      state.status = 'ready';
      state.pending = null;
      note('returned', { to: subs[target].id, invalidated: n });
    }
    return state.status;
  }

  function resume() {
    if (state.status !== 'held') return state.status;
    state.status = 'waiting';
    note('higher_answer_received', { gate: state.pending.queue[0] });
    return state.status;
  }

  /** A missed deadline only escalates. It never decides. */
  function escalate() {
    if (state.status !== 'waiting' || state.pending.escalated) return;
    state.pending.escalated = true;
    note('escalated', { gate: state.pending.queue[0] });
  }

  /** One-way switch: this cloud demo has no local adapters, so everything stops. */
  function lockConfidential() {
    if (locked()) return;
    state.status = 'locked';
    state.pending = null;
    note('confidential_plus_on', { effect: 'Minden külső adapter tiltva; helyi adapter nincs, a feldolgozás leállt.' });
  }

  return {
    state, subs, advance, runToGate, currentGate, options, rolesFor, decide, resume, escalate, lockConfidential,
    valid: (code) => state.artifacts.filter((a) => a.code === code && a.valid).at(-1) || null,
  };
}
