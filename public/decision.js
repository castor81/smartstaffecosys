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

export function decisionDialog({ engine, roleName, onEscalated, onDecided }) {
  let due = null;
  const selected = (gate) => engine().options(gate).find((o) => o.id === $('dlg-form').elements.opt?.value);

  function checkRole() {
    const gate = engine().currentGate();
    if (!gate) return;
    const allowed = engine().rolesFor(gate, selected(gate));
    const ok = allowed.includes($('role').value);
    $('dlg-switch').hidden = ok;
    $('dlg-error').textContent = ok ? '' : `A belépett szerep nem jogosult. Szükséges: ${allowed.map(roleName).join(' vagy ')}.`;
    $('dlg-ok').disabled = !ok || $('dlg-rec').hidden;
  }

  function tick() {
    const e = engine();
    if (e.state.status !== 'waiting') {
      due = null;
      if ($('dlg').open) $('dlg').close();
      return;
    }
    due ??= Date.now() + DEADLINE_MS;
    const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
    if (left === 0 && !e.state.pending.escalated) { e.escalate(); onEscalated(); }
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
    checkRole();
    tick();
    $('dlg').showModal();
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
  $('dlg-ok').addEventListener('click', () => {
    try {
      engine().decide({
        option: $('dlg-form').elements.opt?.value, role: $('role').value,
        reason: $('dlg-reason').value, recommended: $('dlg').dataset.rec,
      });
    } catch (err) { $('dlg-error').textContent = err.message; return; }
    due = null;
    $('dlg').close();
    onDecided();
  });
  setInterval(tick, 1000);

  return { open, reset() { due = null; } };
}
