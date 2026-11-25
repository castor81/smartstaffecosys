import { createEngine } from './engine.js';
import { decisionDialog } from './decision.js';
import { store, KEY } from './store.js';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

const process = await (await fetch('data/process.json')).json();
const saved = store.load();
let engine = createEngine(process, saved.state);
let echelon = saved.echelon || process.meta.pilot_echelon;

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

function afterRun() {
  dialog.reset();
  render();
  if (engine.state.status === 'waiting') dialog.open();
}

const dialog = decisionDialog({ engine: () => engine, roleName, onEscalated: render, onDecided: afterRun });

$('run').addEventListener('click', () => { engine.runToGate(); afterRun(); });
$('step').addEventListener('click', () => { engine.advance(); afterRun(); });
$('open').addEventListener('click', () => dialog.open());
$('resume').addEventListener('click', () => { engine.resume(); afterRun(); });
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
  dialog.reset();
  render();
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ process: process.meta, echelon, log: engine.state.log }, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sse_naplo_v0.4_${new Date().toISOString().slice(0, 10)}.json`;
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
// The command post (or another tab) changed the shared demo state.
window.addEventListener('storage', (e) => { if (e.key === KEY) window.location.reload(); });
