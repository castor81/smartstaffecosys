import { createEngine } from './engine.js';
import { DEMO } from './demo.js';

const KEY = 'sse-demo-v0.3';
const DEADLINE_MS = 120000;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
// Storage is a convenience only; the page works without it.
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

const process = await (await fetch('data/process.json')).json();
const saved = store.load();
let engine = createEngine(process, saved.state);
let echelon = saved.echelon || process.meta.pilot_echelon;
let due = null;

const persist = () => store.save({ state: engine.state, echelon });
const echelonDef = () => process.echelons.find((e) => e.id === echelon);
const agentName = (a) => {
  const rank = echelonDef().rank;
  if (rank >= 3 && a.id === 'A06') return 'Tűztámogatási főnök';
  if (rank >= 3 && a.id === 'A08') return 'Oltalmazási főnök';
  return a.name.replace('{p}', rank >= 3 ? 'G' : 'S');
};
const roleName = (r) => (r === 'xo' && echelonDef().chief === 'COS' ? 'Törzsfőnök (COS)' : process.human_roles[r]);

const RUN = { script: 'script', human: 'ember', 'llm:T1': 'modell T1', 'llm:T2': 'modell T2', 'llm:T3': 'modell T3', 'script+llm:T1': 'script + T1', 'script+llm:T2': 'script + T2', 'script+llm:T3': 'script + T3' };
const STATUS = { ready: 'Folytatható', waiting: 'Emberi döntésre vár', held: 'Felfüggesztve: elöljárói jóváhagyásra vár', closed: 'Lezárva: új tervezési ciklus szükséges', locked: 'Zárolva (Bizalmas+)' };

function describe(e) {
  const gate = process.gates.find((g) => g.id === e.gate);
  const label = gate?.options.find((o) => o.id === e.option)?.label;
  return {
    substep_done: `${e.substep} kész`,
    decision_requested: `${e.gate}: döntéskérés (${e.substep})`,
    decision: `${e.gate}: ${label} – ${roleName(e.role)}${e.reason ? ` · indok: ${e.reason}` : ''}${e.escalated ? ' · eszkaláció után' : ''}`,
    returned: `Visszalépés: ${e.to}; érvénytelenített produktumverzió: ${e.invalidated}`,
    higher_answer_received: `${e.gate}: elöljárói válasz megérkezett`,
    escalated: `${e.gate}: határidő lejárt – ESZKALÁCIÓ, döntés nem született`,
    case_closed: e.why,
    confidential_plus_on: `Bizalmas+ bekapcsolva. ${e.effect}`,
  }[e.type] || e.type;
}

function render() {
  const { state } = engine;
  const locked = state.status === 'locked';
  const runnable = echelonDef().rank <= 4;
  document.body.classList.toggle('locked', locked);
  $('lockpanel').hidden = !locked;
  $('conf').checked = locked;
  $('conf').disabled = locked;
  $('run').disabled = $('step').disabled = state.status !== 'ready' || !runnable;
  $('open').hidden = state.status !== 'waiting';
  $('resume').hidden = state.status !== 'held';
  const current = engine.subs[state.cursor];
  $('status').textContent = `${STATUS[state.status]} · ${current.id} ${current.name}${state.mode ? ` · ${process.modes[state.mode].label}, ${process.modes[state.mode].coa_count} COA` : ''}`;
  $('f-disagree').checked = state.flags.staff_disagreement;
  $('f-screen').checked = state.flags.screening_failed;

  const def = echelonDef();
  $('echinfo').textContent = `${def.status === 'pilot' ? 'Pilot szint.' : def.status === 'prepared' ? 'Előkészített profil: a demó a közös MDMP-folyamattal fut.' : 'Helyőrző: külön folyamatdefiníció kell.'} Eljárás: ${def.procedure}. Eltérések: ${def.differences.join('; ')}.`;

  const open = new Set([...$('steps').querySelectorAll('details[open]')].map((d) => d.dataset.id));
  $('steps').replaceChildren(...process.steps.map((st, n) => {
    const box = el('details');
    box.dataset.id = st.id;
    box.open = open.has(st.id) || st.id === current.step;
    box.append(el('summary', `${n + 1 < 8 ? `${n + 1}. ` : ''}${st.name}`), el('p', `${st.workflow} · idő: ${st.time_share}`, 'muted'));
    for (const s of st.substeps) {
      const done = s.outputs.every((c) => engine.state.artifacts.some((a) => a.code === c && a.by === s.id && a.valid));
      const row = el('div', undefined, `sub-row${s.id === current.id ? ' current' : done ? ' done' : ''}`);
      const title = el('div');
      title.append(el('strong', `${s.id} ${s.name}`), el('span', RUN[s.run], 'tag'));
      for (const g of s.gates || []) title.append(el('span', g, 'tag'));
      row.append(title, el('div', `FM 5-0 ${s.fm}${s.agents.length ? ` · ${s.agents.join(', ')}` : ''}`), el('div', `Be: ${s.inputs.join(', ')}`), el('div', `Ki: ${s.outputs.join(', ')}`));
      if (s.qa) row.append(el('div', `Ellenőrzés: ${s.qa}`));
      box.append(row);
    }
    return box;
  }));

  $('log').replaceChildren(...state.log.slice(-80).reverse().map((e) => {
    const li = el('li', `${new Date(e.at).toLocaleTimeString('hu-HU')} ${describe(e)}`);
    li.value = e.n;
    return li;
  }));
  $('agents').replaceChildren(...process.agents
    .filter((a) => process.echelons.find((e) => e.id === a.min_echelon).rank <= def.rank)
    .map((a) => el('li', `${a.id} ${agentName(a)} · ${a.tier}${a.enabled ? '' : ' · előkészítve'}`)));
  $('profiles').replaceChildren(...process.profiles.map((p) => {
    const box = el('div');
    const list = el('ul');
    for (const [k, v] of Object.entries(p.adapters)) list.append(el('li', `${k}: ${v}`));
    box.append(el('strong', `${p.label} · kimenő forgalom: ${p.egress === 'deny' ? 'tiltva' : 'engedélylista'}`), list);
    return box;
  }));
  persist();
}

function openDialog() {
  const gate = engine.currentGate();
  if (!gate) return;
  const demo = DEMO[gate.id];
  const options = engine.options(gate);
  const rec = options.some((o) => o.id === demo.rec) ? demo.rec : options[0].id;
  $('dlg').dataset.rec = rec;
  $('dlg-meta').textContent = `${gate.id} · döntéshozó: ${roleName(gate.role)} · FM 5-0 ${gate.fm}`;
  $('dlg-title').textContent = gate.title;
  $('dlg-options').replaceChildren(el('legend', 'Alternatívák (fiktív törzsanyag)'), ...options.map((o) => {
    const [pro, con, risk] = demo.o[o.id];
    const label = el('label', undefined, 'option');
    const input = el('input');
    Object.assign(input, { type: 'radio', name: 'opt', value: o.id });
    const text = el('span');
    text.append(el('strong', o.label), el('small', `Előny: ${pro}`), el('small', `Hátrány: ${con}`), el('small', `Kockázat: ${risk}`));
    if (o.roles) text.append(el('small', `Dönthet: ${o.roles.map(roleName).join(' vagy ')}`));
    label.append(input, text);
    return label;
  }));
  $('dlg-rec').hidden = true;
  $('dlg-rec').textContent = `Törzsajánlás: ${options.find((o) => o.id === rec).label}. ${demo.why}`;
  $('dlg-reason').value = '';
  checkRole(gate);
  $('dlg-reveal').disabled = true;
  $('dlg-ok').disabled = true;
  due ??= Date.now() + DEADLINE_MS;
  tick();
  $('dlg').showModal();
}

const selected = (gate) => engine.options(gate).find((o) => o.id === $('dlg-form').elements.opt?.value);

function checkRole(gate) {
  const allowed = engine.rolesFor(gate, selected(gate));
  const ok = allowed.includes($('role').value);
  $('dlg-switch').hidden = ok;
  $('dlg-error').textContent = ok ? '' : `A belépett szerep nem jogosult. Szükséges: ${allowed.map(roleName).join(' vagy ')}.`;
  $('dlg-ok').disabled = !ok || $('dlg-rec').hidden;
}

function tick() {
  if (engine.state.status !== 'waiting') { due = null; return; }
  due ??= Date.now() + DEADLINE_MS;
  const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
  if (left === 0 && !engine.state.pending.escalated) { engine.escalate(); render(); }
  $('dlg-clock').textContent = left ? `Hátralévő idő (demó): ${left} mp. Lejáratkor nincs automatikus jóváhagyás.` : 'A határidő lejárt: eszkalálva. A döntés továbbra is emberre vár.';
}

function afterRun() {
  due = null;
  render();
  if (engine.state.status === 'waiting') openDialog();
}

$('run').addEventListener('click', () => { engine.runToGate(); afterRun(); });
$('step').addEventListener('click', () => { engine.advance(); afterRun(); });
$('open').addEventListener('click', openDialog);
$('resume').addEventListener('click', () => { engine.resume(); afterRun(); });
$('dlg-later').addEventListener('click', () => $('dlg').close());
$('dlg-options').addEventListener('change', () => { $('dlg-reveal').disabled = false; checkRole(engine.currentGate()); });
$('dlg-reveal').addEventListener('click', () => {
  $('dlg-rec').hidden = false;
  checkRole(engine.currentGate());
});
$('dlg-switch').addEventListener('click', () => {
  const gate = engine.currentGate();
  $('role').value = engine.rolesFor(gate, selected(gate))[0];
  checkRole(engine.currentGate());
});
$('dlg-ok').addEventListener('click', () => {
  try {
    engine.decide({
      option: $('dlg-form').elements.opt?.value, role: $('role').value,
      reason: $('dlg-reason').value, recommended: $('dlg').dataset.rec,
    });
  } catch (err) { $('dlg-error').textContent = err.message; return; }
  $('dlg').close();
  afterRun();
});
$('conf').addEventListener('change', () => {
  if (!$('conf').checked) return;
  if (window.confirm('A Bizalmas+ egyirányú kapcsoló: ez a példány leáll. Bekapcsolod?')) engine.lockConfidential();
  render();
});
$('f-disagree').addEventListener('change', (e) => { engine.state.flags.staff_disagreement = e.target.checked; persist(); });
$('f-screen').addEventListener('change', (e) => { engine.state.flags.screening_failed = e.target.checked; persist(); });
$('echelon').addEventListener('change', (e) => { echelon = e.target.value; fillRoles(); render(); });
$('reset').addEventListener('click', () => {
  if (!window.confirm('Új demó-példány: a napló és minden állapot törlődik. Folytatod?')) return;
  store.clear();
  engine = createEngine(process);
  due = null;
  render();
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ process: process.meta, echelon, log: engine.state.log }, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sse_naplo_v${process.meta.version}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function fillRoles() {
  const keep = $('role').value || 'commander';
  $('role').replaceChildren(...Object.keys(process.human_roles).map((r) => new Option(roleName(r), r)));
  $('role').value = keep;
}
$('echelon').replaceChildren(...process.echelons.map((e) => new Option(e.label + (e.status === 'pilot' ? ' (pilot)' : ''), e.id)));
$('echelon').value = echelon;
fillRoles();
render();
setInterval(tick, 1000);
