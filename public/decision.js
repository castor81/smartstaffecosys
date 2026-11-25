// The decision pop-up of the demo, shared by the command post and the process view.
// Choose an alternative first, then the staff recommendation is revealed, then confirm.
// A missed deadline escalates; it never decides.
import { DEMO } from './demo.js';

const DEADLINE_MS = 120000;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

/** Identifies one open request, so a pop-up never outlives the question it shows. */
export const requestKey = (e) => (e.state.status === 'waiting'
  ? `${e.state.pending.queue[0]}:${e.state.log.filter((x) => x.type === 'decision_requested').length}` : null);

/**
 * `shared` (optional) moves the decision, the escalation and the deadline to a shared exercise:
 * { submit(args), escalate(), due() }. Without it the local engine is used and the role can be switched.
 */
export function decisionDialog({ engine, roleName, onEscalated, onDecided, shared = null }) {
  let due = null;
  let dueFor = null;
  let shown = null; // request shown in the open window
  let busy = false;
  const selected = (gate) => engine().options(gate).find((o) => o.id === $('dlg-form').elements.opt?.value);

  function checkRole() {
    const gate = engine().currentGate();
    if (!gate) return;
    const allowed = engine().rolesFor(gate, selected(gate));
    const ok = allowed.includes($('role').value);
    $('dlg-switch').hidden = ok || Boolean(shared);
    $('dlg-error').textContent = ok ? '' : `A belépett szerep nem jogosult. Szükséges: ${allowed.map(roleName).join(' vagy ')}.`;
    $('dlg-ok').disabled = busy || !ok || $('dlg-rec').hidden;
  }

  function tick() {
    const e = engine();
    const key = requestKey(e);
    if ($('dlg').open && shown !== key) $('dlg').close(); // decided or replaced meanwhile
    if (!key) { due = null; return; }
    if (dueFor !== key) { due = null; dueFor = key; }
    due ??= shared ? shared.due() : Date.now() + DEADLINE_MS;
    const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
    if (left === 0 && !e.state.pending.escalated) {
      if (shared) shared.escalate();
      else { e.escalate(); onEscalated(); }
    }
    $('dlg-clock').textContent = left ? `Hátralévő idő (demó): ${left} mp. Lejáratkor nincs automatikus jóváhagyás.` : 'A határidő lejárt: eszkalálva. A döntés továbbra is emberre vár.';
  }

  function open() {
    const gate = engine().currentGate();
    if (!gate || $('dlg').open) return;
    const demo = DEMO[gate.id];
    const options = engine().options(gate);
    const rec = options.some((o) => o.id === demo.rec) ? demo.rec : options[0].id;
    $('dlg').dataset.rec = rec;
    $('dlg-meta').textContent = `${gate.id} · döntéshozó: ${roleName(gate.role)} · FM 5-0 ${gate.fm}`;
    $('dlg-title').textContent = gate.title;
    $('dlg-options').replaceChildren(el('legend', 'Alternatívák (fiktív törzsanyag)'), ...options.map((o) => {
      const [pro, con, risk] = demo.o[o.id];
      const label = el('label', undefined, 'option');
      const input = el('input');
      Object.assign(input, { type: 'radio', name: 'opt', value: o.id });
      const body = el('span');
      body.append(el('strong', o.label), el('small', `Előny: ${pro}`), el('small', `Hátrány: ${con}`), el('small', `Kockázat: ${risk}`));
      if (o.roles) body.append(el('small', `Dönthet: ${o.roles.map(roleName).join(' vagy ')}`));
      label.append(input, body);
      return label;
    }));
    $('dlg-rec').hidden = true;
    $('dlg-rec').textContent = `Törzsajánlás: ${options.find((o) => o.id === rec).label}. ${demo.why}`;
    $('dlg-reason').value = '';
    $('dlg-reveal').disabled = true;
    $('dlg-ok').disabled = true;
    shown = requestKey(engine());
    checkRole();
    $('dlg').showModal();
    tick();
    $('dlg').scrollTop = 0;
  }

  $('dlg-later').addEventListener('click', () => $('dlg').close());
  $('dlg-options').addEventListener('change', () => { $('dlg-reveal').disabled = false; checkRole(); });
  $('dlg-reveal').addEventListener('click', () => { $('dlg-rec').hidden = false; checkRole(); });
  $('dlg-switch').addEventListener('click', () => {
    const gate = engine().currentGate();
    $('role').value = engine().rolesFor(gate, selected(gate))[0];
    $('role').dispatchEvent(new Event('change'));
    checkRole();
  });
  $('dlg-ok').addEventListener('click', async () => {
    const args = {
      option: $('dlg-form').elements.opt?.value, role: $('role').value,
      reason: $('dlg-reason').value, recommended: $('dlg').dataset.rec,
    };
    busy = true;
    $('dlg-ok').disabled = true;
    try {
      if (shared) await shared.submit(args); else engine().decide(args);
    } catch (err) {
      busy = false;
      checkRole();
      $('dlg-error').textContent = err.message;
      return;
    }
    busy = false;
    due = null;
    if ($('dlg').open) $('dlg').close();
    onDecided();
  });
  setInterval(tick, 1000);

  return { open, reset() { due = null; } };
}
