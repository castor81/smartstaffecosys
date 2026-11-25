// Command post: map in the middle, JCHAT beside it, the staff process running in the background.
import { createEngine } from './engine.js';
import { decisionDialog, requestKey } from './decision.js';
import { store, KEY } from './store.js';
import { createMap } from './map.js';
import { activeStore, checkArea, AO_KEY } from './ao.js';
import { timeline, mapModel, elementStates, elementOf, roleElement, formatClock, formatH } from './sim.js';
import { channelFor, ackFor, injectMessage, CONTROL_ROLES } from './room.js';
import { exerciseId, joinDialog, connect, explain } from './shared.js';
import { signedIn } from './api.js';
import { ELEMENTS, GROUPS, CHANNELS, UNITS, TERRAIN, TURNS, COAS, INCIDENTS } from './scenario.js';

const UI_VERSION = '0.6';
const DEADLINE_MS = 120000;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (label, onClick, cls) => {
  const b = el('button', label, cls);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

const process = await (await fetch('data/process.json')).json();
const saved = store.load();
const wanted = exerciseId(); // a shared exercise instead of the local demo
let link = null; // connection to it
let engine = createEngine(process, wanted ? undefined : saved.state);
let extras = wanted ? [] : saved.extras || [];
let removed = wanted ? [] : saved.removed || [];
let dialog = null;
let lastKey = null; // the open request the screen already reacted to
let popTimer = null;
let posting = false;
let submitting = false;
let escalating = null;

const ui = {
  channel: 'all', element: null, read: {}, reply: null, selected: null, coa: null, wargame: null,
  layers: { units: true, enemy: true, plan: true, incidents: true },
  playing: false, resumeAfter: false, atBottom: true,
};
let picture = null; // { messages, info, model }
let timer = null;
let wgTimer = null;
const rendered = new Set();
let knownIncidents = null;

const persist = () => { if (!wanted) store.save({ state: engine.state, extras, removed, role: $('role').value, speed: $('speed').value }); };
const myRole = () => $('role').value.split(':')[0];
const myElement = () => (myRole() === 'staff' ? $('role').value.split(':')[1] : roleElement(myRole()));
/** Who may move the exercise: anybody in the local demo, the command group in a shared one. */
const controls = () => !wanted || (Boolean(link) && CONTROL_ROLES.includes(myRole()));
const roleName = (r) => process.human_roles[r];
const has = (code) => Boolean(engine.valid(code));
const locked = () => engine.state.status === 'locked';
const SEVERITY = { alacsony: 'alacsony', 'közepes': 'közepes', magas: 'magas', 'kritikus': 'kritikus' };

let toastTimer = null;
function toast(message, ms = 2600) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, ms);
}

const map = createMap($('map'), { onSelect: (ref) => { ui.selected = ref; renderCard(); } });
/* ---------- process control ---------- */
function stop() {
  ui.playing = false;
  clearTimeout(timer);
}
/** May the signed-in role answer the open request? (The local demo can switch roles in the window.) */
function entitled() {
  const gate = engine.currentGate();
  return !wanted || (Boolean(gate) && engine.options(gate).some((o) => engine.rolesFor(gate, o).includes($('role').value)));
}
/** Runs after every state change: opens the pop-up for a new request, or resumes the playback. */
function settle() {
  const key = requestKey(engine);
  if (key === lastKey) return;
  if (wanted && $('dlg').open && !submitting) toast('Közben megváltozott a helyzet: a döntési ablak bezárult.', 4000);
  lastKey = key;
  clearTimeout(popTimer);
  dialog.reset();
  if (key) {
    if (ui.playing) { ui.resumeAfter = true; stop(); renderControl(); }
    // Let the new messages appear before the pop-up covers them.
    if (entitled()) popTimer = setTimeout(() => requestKey(engine) === key && !$('join').open && dialog.open(), Math.min(1200, Number($('speed').value)));
  } else if (ui.resumeAfter && engine.state.status === 'ready') {
    ui.resumeAfter = false;
    // In a shared exercise somebody else's decision must not close the war game being read.
    if (!(wanted && ui.wargame)) play();
  }
}
/** Posts one event of the shared exercise; refusals and lost connections are shown, not thrown. */
async function share(kind, payload, retries = 0) {
  try {
    return await link.post(myRole(), kind, payload, retries);
  } catch (e) {
    stop();
    renderControl();
    toast(explain(e), 5000);
    return null;
  }
}
async function advance() {
  if (engine.state.status !== 'ready' || !controls() || posting) return;
  if (link) {
    posting = true;
    await share('advance');
    posting = false;
    return;
  }
  engine.advance();
  persist();
  render();
  settle();
}
function play() {
  if (engine.state.status !== 'ready' || !controls()) return;
  closeWargame();
  ui.playing = true;
  clearTimeout(timer);
  const tick = async () => {
    await advance();
    if (!ui.playing) return;
    if (engine.state.status === 'ready') timer = setTimeout(tick, Number($('speed').value));
    else { stop(); renderControl(); }
  };
  tick();
  renderControl();
}

const sharedDecisions = {
  due: () => (link.room.requestedAt ? link.room.requestedAt - link.info.skew : Date.now()) + DEADLINE_MS,
  escalate() {
    const key = requestKey(engine);
    if (!link || !controls() || escalating === key) return;
    escalating = key;
    // Not recorded because somebody was faster: the next tick looks again. No retries while offline.
    link.post(myRole(), 'escalate', { gate: engine.currentGate().id }).then(
      (ok) => { if (!ok) escalating = null; },
      () => setTimeout(() => { escalating = null; }, 5000),
    );
  },
  async submit({ option, role, reason, recommended }) {
    const key = requestKey(engine);
    const gate = engine.currentGate().id;
    submitting = true;
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (requestKey(engine) !== key) throw new Error('Közben megváltozott a helyzet: ez a döntés már nem nyitott.');
        let ok;
        try { ok = await link.post(role, 'decide', { gate, option, reason, recommended }); } catch (e) { throw new Error(explain(e)); }
        if (ok) return;
      }
      throw new Error('Nem sikerült rögzíteni, próbáld újra.');
    } finally { submitting = false; }
  },
};

function renderControl() {
  const { state } = engine;
  const sub = engine.subs[state.cursor];
  const gate = engine.currentGate();
  const started = state.log.length > 0;
  $('play').textContent = ui.playing ? '⏸ Szünet' : started ? '▶ Folytatás' : '▶ Indítás';
  $('play').disabled = state.status !== 'ready' || !controls();
  $('step').disabled = state.status !== 'ready' || ui.playing || !controls();
  $('open').hidden = state.status !== 'waiting';
  $('open').textContent = gate && state.status === 'waiting' ? `Döntés vár: ${gate.id}` : 'Döntés vár';
  $('resume').hidden = state.status !== 'held' || !controls();
  $('status').textContent = {
    ready: `${started ? `Következik: ${sub.id} ${sub.name}` : 'A gyakorlat indításra kész.'}${controls() ? '' : ' · vezérli a parancsnoki csoport'}`,
    waiting: gate ? `${gate.title}${state.pending.escalated ? ' · eszkalálva' : ''}` : '',
    held: 'Felfüggesztve: elöljárói jóváhagyásra vár.',
    closed: 'Lezárva: új tervezési ciklus szükséges.',
    locked: 'Zárolva (Bizalmas+).',
  }[state.status];
  document.body.classList.toggle('locked', locked());
  document.body.classList.toggle('waiting', state.status === 'waiting' || state.status === 'held');
  $('lockpanel').hidden = !locked();
  $('conf').checked = locked();
  $('conf').disabled = locked();
  $('text').disabled = $('to').disabled = $('composer').querySelector('[type=submit]').disabled = locked();
  $('inject').disabled = locked() || !controls();
}

/* ---------- forces ---------- */
function renderForces() {
  const states = elementStates({ engine, process, messages: picture.messages });
  const label = { working: 'dolgozik', decide: 'döntésre vár', late: 'eszkalálva', seen: 'közölt', idle: 'tétlen' };
  const left = $('forces').scrollLeft;
  const top = $('forces').scrollTop;
  $('forces').replaceChildren(...Object.entries(GROUPS).map(([group, title]) => {
    const box = el('div', null, 'force-group');
    box.append(el('h3', title));
    for (const e of ELEMENTS.filter((x) => x.group === group)) {
      const st = states[e.id] || 'idle';
      const b = button(null, () => selectElement(e.id), `force g-${group} st-${st}${ui.element === e.id ? ' on' : ''}`);
      b.dataset.el = e.id;
      b.title = `${e.name} · ${label[st]}`;
      b.setAttribute('aria-pressed', String(ui.element === e.id));
      b.append(el('i'), el('b', e.short), el('span', e.name));
      box.append(b);
    }
    return box;
  }));
  $('forces').scrollLeft = left;
  $('forces').scrollTop = top;
}
function selectElement(id) {
  ui.element = ui.element === id ? null : id;
  ui.channel = 'all';
  if (ui.element) {
    setRecipient(id);
    if (UNITS[id]) map.focus(id);
  }
  renderForces();
  renderChat(true);
}

/* ---------- JCHAT ---------- */
const inView = (m) => (ui.channel === 'all' || m.channel === ui.channel) && (!ui.element || m.from === ui.element || m.to === ui.element);
const recipientName = (to) => (to?.startsWith('ch:') ? `${CHANNELS.find((c) => c.id === to.slice(3))?.label} háló` : elementOf(to).short);
const REF_NAMES = { LANE: 'ZÖLD sáv', CP: 'harcálláspont', ENEMY: 'Vörös erő', COA: 'COA-vázlat', RES: 'tartalék' };
const refName = (ref) => REF_NAMES[ref] || (ref.startsWith('inc:') ? 'esemény' : ref.startsWith('NAI') ? ref.replace('NAI', 'NAI ') : ref.startsWith('AA') ? ref.replace('AA', 'MI-') : ref.startsWith('DP') ? ref.replace('DP', 'DP ') : UNITS[ref]?.label || ref);

function showOnMap(ref) {
  $('chat').classList.remove('fs');
  syncFs();
  const target = ref === 'COA' && picture.model.arrows.length ? 'COA' : ref;
  if (!map.focus(target)) toast('Ez a jel most nincs a térképen.');
  else if (ref !== 'COA' && ref !== 'LANE') { ui.selected = ref; renderCard(); }
}

function messageNode(m) {
  const from = elementOf(m.from);
  const node = el('article', null, `msg g-${from.group} k-${m.kind}`);
  node.dataset.id = m.id;
  const head = el('header');
  const who = el('b', from.short, 'who');
  who.title = from.name;
  head.append(who, el('span', `→ ${recipientName(m.to)}`, 'to'));
  if (m.by) head.append(el('span', m.by, 'by'));
  head.append(el('time', formatClock(m.minute).slice(7)));
  node.append(head);
  if (m.quote) node.append(el('blockquote', `${m.quote.name}: ${m.quote.text}`));
  node.append(el('p', m.text));
  const foot = el('footer');
  const ref = m.incident ? `inc:${m.incident.id}` : m.ref;
  if (ref) foot.append(button(`📍 ${refName(ref)}`, () => showOnMap(ref), 'ref'));
  if (m.kind === 'request' && engine.state.status === 'waiting' && engine.currentGate()?.id === m.gate && m.id === picture.lastRequest) {
    foot.append(button('Döntési ablak', () => dialog.open(), 'ref decide'));
  }
  if (!locked()) foot.append(button('↩', () => startReply(m), 'reply'));
  foot.lastChild?.classList.contains('reply') && foot.lastChild.setAttribute('aria-label', 'Válasz');
  node.append(foot);
  return node;
}

function renderChannels() {
  const counts = {};
  for (const m of picture.messages) counts[m.channel] = (counts[m.channel] || 0) + 1;
  const left = $('channels').scrollLeft;
  $('channels').replaceChildren(...CHANNELS.map((c) => {
    if (ui.channel === 'all' || ui.channel === c.id) ui.read[c.id] = counts[c.id] || 0;
    const unread = c.id === 'all' ? 0 : Math.max(0, (counts[c.id] || 0) - (ui.read[c.id] || 0));
    const b = button(c.label, () => { ui.channel = c.id; if (c.id !== 'all') setRecipient(`ch:${c.id}`); renderChat(true); });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(ui.channel === c.id));
    b.dataset.channel = c.id;
    if (unread) b.append(el('em', String(unread)));
    return b;
  }));
  $('channels').scrollLeft = left;
}

function renderChat(toEnd = false) {
  const feed = $('feed');
  const stick = toEnd || ui.atBottom;
  const keep = feed.scrollTop;
  renderChannels();
  $('filter').hidden = !ui.element;
  $('filter').textContent = ui.element ? `${elementOf(ui.element).short} ✕` : '';
  const list = picture.messages.filter(inView);
  let fresh = 0;
  let day = null;
  const nodes = list.flatMap((m) => {
    const node = messageNode(m);
    if (!rendered.has(m.id)) {
      node.classList.add('new');
      node.style.animationDelay = `${Math.min(fresh, 8) * 90}ms`;
      fresh += 1;
    }
    const date = formatClock(m.minute).slice(0, 6);
    if (date === day) return [node];
    day = date;
    return [el('p', `${date} · ${formatH(m.minute)}`, 'day'), node];
  });
  for (const m of picture.messages) rendered.add(m.id);
  if (!nodes.length) {
    nodes.push(el('p', picture.messages.length ? 'Ebben a nézetben még nincs közlés.' : 'A ▶ Indítás gombbal a törzs és az alegységek kommunikációja itt jelenik meg.', 'empty'));
  }
  feed.replaceChildren(...nodes);
  if (stick) { feed.scrollTop = feed.scrollHeight; ui.atBottom = true; $('newer').hidden = true; } else {
    feed.scrollTop = keep;
    if (fresh) $('newer').hidden = false;
  }
}

function fillRecipients() {
  const rooms = el('optgroup');
  rooms.label = 'Háló';
  rooms.append(...CHANNELS.filter((c) => c.id !== 'all').map((c) => new Option(`${c.label} háló`, `ch:${c.id}`)));
  const people = el('optgroup');
  people.label = 'Címzett elem';
  people.append(...ELEMENTS.map((e) => new Option(`${e.short} – ${e.name}`, e.id)));
  $('to').replaceChildren(rooms, people);
  $('to').value = 'ch:staff';
}
const setRecipient = (value) => { $('to').value = value; };

function startReply(m) {
  ui.reply = { name: elementOf(m.from).short, text: m.text.length > 90 ? `${m.text.slice(0, 88)}…` : m.text, incidentRef: m.incident?.id || m.incidentRef };
  setRecipient(m.from === myElement() ? m.to : m.from);
  showQuote();
  $('text').focus();
}
function showQuote() {
  $('quote').hidden = !ui.reply;
  $('quote').querySelector('span').textContent = ui.reply ? `↩ ${ui.reply.name}: ${ui.reply.text}` : '';
}

let seq = 0;
function addExtra(message) {
  extras.push({ id: `x${Date.now().toString(36)}-${seq += 1}`, after: engine.state.log.length, ...message });
  persist();
  render();
}
function acknowledge(from, to, channel, incidentRef) {
  const ack = ackFor(from, to, channel, incidentRef);
  if (!ack) return;
  const exercise = engine;
  setTimeout(() => {
    if (locked() || exercise !== engine) return;
    addExtra(ack);
  }, 900);
}

async function send(event) {
  event.preventDefault();
  const body = $('text').value.trim();
  if (!body || locked() || (wanted && !link)) return;
  const to = $('to').value;
  const from = myElement();
  const channel = channelFor(to);
  const reply = ui.reply;
  const quote = reply ? { name: reply.name, text: reply.text } : null;
  const incidentRef = reply?.incidentRef;
  ui.reply = null;
  showQuote();
  $('text').value = '';
  if (ui.channel !== 'all' && ui.channel !== channel) ui.channel = channel;
  if (ui.element && ui.element !== from && ui.element !== to) ui.element = null;
  if (link) {
    ui.atBottom = true;
    if (!(await share('chat', { from, to, text: body, quote, incidentRef }, 5))) {
      // Not recorded: give the text back instead of losing it.
      if (!$('text').value) $('text').value = body;
      ui.reply = reply;
      showQuote();
      return;
    }
    renderChat(true);
    return;
  }
  addExtra({ from, to, channel, kind: 'user', text: body, quote, incidentRef });
  renderChat(true);
  if (!to.startsWith('ch:')) acknowledge(to, from, channel, incidentRef);
}

/* ---------- map card ---------- */
const ENEMY_NOTES = {
  ENEMY: ['Vörös erő (fiktív)', 'Megerősített gépesített harccsoport; a gyakorlat kezdetén kb. 60 km-re keletre (megerősített).'],
  E2: ['Átkelőeszközök', 'Mozgásukat észak felé észlelték (valószínű).'],
  ER: ['Vörös tartalék', 'A helye nem ismert (adathiány).'],
};
const POINT_NOTES = {
  NAI1: 'Megfigyelési körzet az ALFA átkelőhely előtt.', NAI2: 'Megfigyelési körzet a BRAVO átkelőhely előtt.', NAI3: 'Megfigyelési körzet a Vörös erő gyülekezési körletén.',
  AA1: 'Északi megközelítési irány az ALFA híd felé.', AA2: 'Középső megközelítési irány a BRAVO gázló felé.', AA3: 'Déli, vizenyős, nehezen járható irány.',
  DP1: 'Döntési pont az északi irányon.', DP2: 'Döntési pont a középső irányon.',
};

function renderCard() {
  const card = $('card');
  const ref = ui.selected;
  card.replaceChildren();
  card.hidden = !ref || Boolean(ui.wargame);
  if (card.hidden) return;
  const close = button('✕', () => { ui.selected = null; renderCard(); }, 'close');
  close.setAttribute('aria-label', 'Bezárás');
  const actions = el('div', null, 'actions');
  let related = picture.messages.filter((m) => m.ref === ref);
  const title = (t) => card.append(close, el('h3', t));

  if (ref.startsWith('inc:')) {
    const inc = picture.model.incidents.find((i) => `inc:${i.id}` === ref);
    if (!inc) { card.hidden = true; return; }
    title(`⚠ ${inc.title}`);
    card.append(el('p', `Súlyosság: ${SEVERITY[inc.severity]}`, `sevtext sev-${inc.severity}`));
    related = inc.id.startsWith('var')
      ? picture.messages.filter((m) => m.substep?.startsWith('S8') || m.incidentRef === inc.id).slice(-6)
      : picture.messages.filter((m) => m.incident?.id === inc.id || m.incidentRef === inc.id);
    if (!locked()) {
      actions.append(button('↩ Közlés ehhez', () => {
        ui.reply = { name: 'Esemény', text: inc.title, incidentRef: inc.id };
        showQuote();
        $('text').focus();
      }, 'primary'));
    }
    if (controls()) {
      actions.append(button('Levétel a térképről', () => {
        ui.selected = null;
        if (link) { renderCard(); share('remove', { incident: inc.id }, 5); return; }
        removed.push(inc.id);
        persist();
        render();
      }));
    }
  } else if (UNITS[ref]) {
    const unit = UNITS[ref];
    const known = ELEMENTS.some((e) => e.id === ref);
    title(unit.name || elementOf(ref).name);
    if (unit.status) {
      const dl = el('dl');
      const rows = { personnel: 'Állomány (megvan / rendsz.)', vehicles: 'Harcjármű', fuel: 'Hajtóanyag (nap)' };
      for (const [k, v] of Object.entries(unit.status)) dl.append(el('dt', rows[k]), el('dd', v));
      card.append(dl, el('p', 'Gyakorló kiinduló adat, 2027.03.01. 05:00.', 'note'));
    }
    if (known) {
      related = picture.messages.filter((m) => m.from === ref || m.to === ref);
      actions.append(button('✉ Üzenet', () => { setRecipient(ref); $('text').focus(); }, 'primary'), button('Közlései', () => { ui.element = null; selectElement(ref); }));
    }
  } else if (TERRAIN.crossings[ref]) {
    title(TERRAIN.crossings[ref].name);
    card.append(el('p', TERRAIN.crossings[ref].info));
  } else if (ENEMY_NOTES[ref]) {
    title(ENEMY_NOTES[ref][0]);
    card.append(el('p', ENEMY_NOTES[ref][1]));
    related = picture.messages.filter((m) => m.ref === 'ENEMY');
  } else if (POINT_NOTES[ref]) {
    title(refName(ref));
    card.append(el('p', POINT_NOTES[ref]));
  } else { card.hidden = true; return; }

  if (related.length) {
    const box = el('div', null, 'related');
    box.append(el('h4', `Kapcsolódó közlések (${related.length})`));
    for (const m of related.slice(-4)) box.append(el('p', `${elementOf(m.from).short} · ${formatClock(m.minute).slice(7)} · ${m.text}`));
    card.append(box);
  }
  if (actions.childNodes.length) card.append(actions);
}

/* ---------- exercise injects ---------- */
function injectMenu() {
  ui.selected = null;
  closeWargame();
  const card = $('card');
  const close = button('✕', () => { card.hidden = true; }, 'close');
  close.setAttribute('aria-label', 'Bezárás');
  card.replaceChildren(close, el('h3', 'Esemény bejátszása'), el('p', 'Gyakorlatvezetői esemény: megjelenik a térképen és a JCHAT-ben. A törzsfolyamatot nem módosítja.', 'note'),
    ...INCIDENTS.map((preset) => {
      const b = button(`${preset.title} · ${preset.severity}`, () => {
        card.hidden = true;
        toast('Koppints a térképre a helyszín kijelöléséhez.', 6000);
        map.pick((at) => {
          if (locked() || !controls()) return;
          $('toast').hidden = true;
          if (link) {
            const spot = [Math.max(0, Math.min(1000, at[0])), Math.max(0, Math.min(700, at[1]))];
            share('inject', { preset: preset.id, at: spot }, 5);
            return;
          }
          const id = `i${Date.now().toString(36)}`;
          addExtra(injectMessage(preset, at, id));
          acknowledge(preset.to, 'EXCON', 'excon', id);
        });
      }, `preset sev-${preset.severity}`);
      b.dataset.preset = preset.id;
      return b;
    }));
  card.hidden = false;
}

/* ---------- war-game walk-through ---------- */
const wargameAvailable = () => has('COA_SET') || has('ARRAY') || has('ACKS');
function openWargame() {
  if (!wargameAvailable()) return;
  stop();
  ui.wargame = { coa: Math.min(picture.info.approved || ui.coa || 1, picture.info.coaCount), turn: 0 };
  ui.selected = null;
  render();
  // Wait for the panel to take its place, then keep the action above it.
  setTimeout(() => ui.wargame && map.frame(window.innerWidth < 760 ? [90, 60, 700, 460] : [20, 30, 1000, 490], $('wargame').offsetHeight + 12), 80);
}
function closeWargame() {
  clearInterval(wgTimer);
  wgTimer = null;
  if (!ui.wargame) return;
  ui.wargame = null;
  render();
  setTimeout(() => map.home(), 80);
}
function setTurn(turn) {
  if (!ui.wargame) return;
  ui.wargame.turn = Math.max(0, Math.min(TURNS.length - 1, turn));
  render();
}
function renderWargame() {
  $('wg-open').disabled = !wargameAvailable();
  $('wg-open').title = wargameAvailable() ? 'COA-k vázlatos lejátszása a térképen' : 'A COA-k kidolgozása után érhető el';
  if (ui.wargame && !wargameAvailable()) ui.wargame = null;
  $('wargame').hidden = !ui.wargame;
  $('mappanel').classList.toggle('gaming', Boolean(ui.wargame));
  $('wg-auto').textContent = wgTimer ? 'Megállít' : 'Lejátszás';
  if (!ui.wargame) return;
  const { coa, turn } = ui.wargame;
  $('wg-name').textContent = COAS[coa].name;
  $('wg-coas').replaceChildren(...Array.from({ length: picture.info.coaCount }, (_, i) => {
    const b = button(`COA ${i + 1}`, () => { ui.wargame.coa = i + 1; render(); });
    b.setAttribute('aria-pressed', String(coa === i + 1));
    return b;
  }));
  $('wg-range').value = String(turn);
  $('wg-own').textContent = `${TURNS[turn].name} · Saját: ${TURNS[turn].own || COAS[coa].turns[0]}`;
  $('wg-red').textContent = `Vörös: ${TURNS[turn].hostile}`;
}

function renderCoaBar() {
  const show = (has('COA_SET') || has('ARRAY')) && !has('ACKS') && !has('COA_APPROVED') && !ui.wargame;
  $('coabar').hidden = !show;
  if (!show) return;
  if (ui.coa > picture.info.coaCount) ui.coa = null;
  const items = [null, ...Array.from({ length: picture.info.coaCount }, (_, i) => i + 1)];
  $('coabar').replaceChildren(...items.map((n) => {
    const b = button(n ? `COA ${n}` : 'Mind', () => { ui.coa = n; render(); }, n ? `coa${n}` : '');
    b.setAttribute('aria-pressed', String(ui.coa === n));
    return b;
  }));
}

/* ---------- render ---------- */
function render() {
  const { messages, info } = timeline(process, engine.state.log, extras);
  const model = mapModel({ has, info, extras, removed, view: { coa: ui.coa, wargame: ui.wargame } });
  const lastRequest = messages.filter((m) => m.kind === 'request').at(-1)?.id;
  picture = { messages, info, model, lastRequest };
  $('clock').textContent = formatClock(info.minute);
  $('hhour').textContent = formatH(info.minute);
  renderControl();
  renderForces();
  renderWargame();
  renderCoaBar();
  map.render(model, ui.layers);
  renderChat();
  renderCard();
  // Jump to a new incident, as on the common operating picture.
  const ids = model.incidents.map((i) => i.id);
  if (!ui.wargame) {
    const fresh = knownIncidents && ids.find((id) => !knownIncidents.has(id));
    if (fresh) map.focus(`inc:${fresh}`, { gentle: true });
    knownIncidents = new Set([...(knownIncidents || []), ...ids]);
  }
}

/* ---------- exports ---------- */
function download(name, content, type) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
const stamp = () => new Date().toISOString().slice(0, 10);
// Quote every cell and defuse spreadsheet formulas.
const cell = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
function exportChat() {
  const rows = [['gyakorlási idő', 'H-óra', 'háló', 'feladó', 'címzett', 'típus', 'szöveg', 'szerző'],
    ...picture.messages.map((m) => [formatClock(m.minute), formatH(m.minute), m.channel, elementOf(m.from).name, recipientName(m.to), m.kind, m.text, m.by])];
  download(`sse_jchat_v${UI_VERSION}_${stamp()}.csv`, `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`, 'text/csv;charset=utf-8');
}

/* ---------- wiring ---------- */
const join = joinDialog(process.meta.version);
function fillRoles() {
  if (!wanted) {
    $('role').replaceChildren(...Object.keys(process.human_roles).map((r) => new Option(roleName(r), r)));
    $('role').value = saved.role || 'commander';
    return;
  }
  // Only the roles of the signed-in person; a staff member chooses whom to speak for.
  const roles = link?.info.roles || [];
  const command = Object.keys(process.human_roles).filter((r) => roles.includes(r));
  const options = command.map((r) => new Option(roleName(r), r));
  if (roles.includes('staff')) {
    options.push(...ELEMENTS.filter((e) => e.group === 'staff' || e.group === 'sub').map((e) => new Option(`Törzstag: ${e.short} – ${e.name}`, `staff:${e.id}`)));
  }
  $('role').replaceChildren(...options);
  let last = null;
  try { last = sessionStorage.getItem('sse-role'); } catch { /* not kept */ }
  if (options.some((o) => o.value === last)) $('role').value = last;
  else if (!command.length && roles.includes('staff')) $('role').value = 'staff:A02';
}
if (saved.speed) $('speed').value = saved.speed;
fillRecipients();

$('play').addEventListener('click', () => { if (ui.playing) { stop(); ui.resumeAfter = false; renderControl(); } else play(); });
$('step').addEventListener('click', () => { closeWargame(); ui.resumeAfter = false; advance(); });
$('open').addEventListener('click', () => { clearTimeout(popTimer); dialog.open(); });
$('resume').addEventListener('click', () => {
  if (link) { share('resume'); return; }
  engine.resume();
  persist();
  render();
  settle();
});
$('role').addEventListener('change', () => {
  persist();
  if (!wanted) return;
  try { sessionStorage.setItem('sse-role', $('role').value); } catch { /* not kept */ }
  stop();
  render();
});
$('shared-open').addEventListener('click', () => { stop(); renderControl(); $('menu').open = false; join.open(); });
$('speed').addEventListener('change', persist);
$('composer').addEventListener('submit', send);
$('quote').querySelector('button').addEventListener('click', () => { ui.reply = null; showQuote(); });
$('filter').addEventListener('click', () => { ui.element = null; renderForces(); renderChat(true); });
$('newer').addEventListener('click', () => renderChat(true));
$('feed').addEventListener('scroll', () => {
  const f = $('feed');
  if (!f.clientHeight) return;
  ui.atBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 60;
  if (ui.atBottom) $('newer').hidden = true;
});
// Stay at the newest message when the panel changes size (war game, full screen, keyboard).
new ResizeObserver(() => { const f = $('feed'); if (ui.atBottom && f.clientHeight) f.scrollTop = f.scrollHeight; }).observe($('feed'));
$('zin').addEventListener('click', () => map.zoom(1 / 1.35));
$('zout').addEventListener('click', () => map.zoom(1.35));
$('zhome').addEventListener('click', () => map.home());
$('map').addEventListener('mapview', (e) => {
  // The scale bar: 5 km on the fictitious terrain; on a real area a round length of fitting size.
  const km = e.detail.real ? [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1].find((v) => v * e.detail.pxPerKm <= 110) || 0.1 : 5;
  $('scale-line').style.width = `${Math.round(e.detail.pxPerKm * km)}px`;
  $('scale-text').textContent = km < 1 ? `${km * 1000} m` : `${km} km`;
});

/* ---------- area of operations ---------- */
const AO_HIDDEN = 'sse-ao-hidden';
const readFlag = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
/**
 * Puts the area chosen on the globe page under the map. Only in the local demo: in a shared exercise
 * every participant sees the same fictitious terrain. Bizalmas+ stops the satellite tiles.
 */
function applyArea() {
  const area = wanted ? null : activeStore.load();
  const usable = Boolean(area) && checkArea(area).ok;
  $('ao-row').hidden = !usable;
  $('ao-layer').checked = readFlag(AO_HIDDEN) !== '1';
  const on = usable && $('ao-layer').checked;
  let sat = true;
  try { sat = JSON.parse(readFlag('sse-globe-v1'))?.sat !== false; } catch { /* default */ }
  const imagery = on && !locked() && sat;
  const picture = map.setArea(on ? area : null, { imagery });
  $('mappanel').classList.toggle('real', on);
  if (imagery && $('ao-credit').hidden) $('ao-credit').open = window.matchMedia('(min-width: 761px) and (min-height: 561px)').matches;
  $('ao-credit').hidden = !imagery;
  const grid = picture && (picture.step >= 1000 ? `${picture.step / 1000} km` : `${picture.step} m`);
  $('map-title').textContent = on ? `${area.name} · MGRS ${grid} · a jelek helye vázlatos` : 'Közös műveleti kép · fiktív terep';
}
$('ao-layer').addEventListener('change', () => {
  try { if ($('ao-layer').checked) localStorage.removeItem(AO_HIDDEN); else localStorage.setItem(AO_HIDDEN, '1'); } catch { /* ignore */ }
  applyArea();
});
// A change on the globe page in another tab, or coming back with the browser's back button.
window.addEventListener('storage', (e) => { if (e.key?.startsWith(AO_KEY) || e.key === 'sse-globe-v1') applyArea(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) applyArea(); });
// Leaving for the globe page would drop a shared exercise, so there it opens in a new tab.
if (wanted) { $('ao-open').target = '_blank'; $('ao-open').rel = 'noopener'; }
for (const box of document.querySelectorAll('[data-layer]')) {
  box.addEventListener('change', () => { ui.layers[box.dataset.layer] = box.checked; render(); });
}
$('inject').addEventListener('click', injectMenu);
$('wg-open').addEventListener('click', () => (ui.wargame ? closeWargame() : openWargame()));
$('wg-close').addEventListener('click', closeWargame);
$('wg-prev').addEventListener('click', () => setTurn(ui.wargame.turn - 1));
$('wg-next').addEventListener('click', () => setTurn(ui.wargame.turn + 1));
$('wg-range').addEventListener('input', (e) => setTurn(Number(e.target.value)));
$('wg-auto').addEventListener('click', () => {
  if (wgTimer) { clearInterval(wgTimer); wgTimer = null; renderWargame(); return; }
  if (ui.wargame.turn === TURNS.length - 1) ui.wargame.turn = 0;
  wgTimer = setInterval(() => {
    if (!ui.wargame || ui.wargame.turn >= TURNS.length - 1) { clearInterval(wgTimer); wgTimer = null; renderWargame(); return; }
    setTurn(ui.wargame.turn + 1);
  }, 1800);
  setTurn(ui.wargame.turn);
});

const syncFs = () => {
  for (const [id, panel] of [['fs-map', 'mappanel'], ['fs-chat', 'chat']]) {
    const on = $(panel).classList.contains('fs');
    $(id).textContent = on ? '✕' : '⛶';
    $(id).setAttribute('aria-pressed', String(on));
  }
};
for (const [id, panel] of [['fs-map', 'mappanel'], ['fs-chat', 'chat']]) {
  $(id).addEventListener('click', () => { $(panel).classList.toggle('fs'); syncFs(); });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('dlg').open) return;
  map.cancelPick();
  $('mappanel').classList.remove('fs');
  $('chat').classList.remove('fs');
  syncFs();
});
// Close the drop-down menus when tapping elsewhere.
document.addEventListener('pointerdown', (e) => {
  for (const d of document.querySelectorAll('.menu[open], .layers[open]')) if (!d.contains(e.target)) d.open = false;
});

$('export-chat').addEventListener('click', exportChat);
$('export-log').addEventListener('click', () => download(`sse_naplo_v${UI_VERSION}_${stamp()}.json`, JSON.stringify({ process: process.meta, ui: UI_VERSION, log: engine.state.log, local_messages: extras }, null, 2), 'application/json'));
$('conf').addEventListener('change', () => {
  if (!$('conf').checked) return;
  if (window.confirm('A Bizalmas+ egyirányú kapcsoló: ez a példány leáll. Bekapcsolod?')) {
    stop();
    closeWargame();
    map.cancelPick();
    engine.lockConfidential();
    clearTimeout(popTimer);
    lastKey = null;
    persist();
    $('menu').open = false;
  }
  render();
  applyArea(); // Bizalmas+ also stops the satellite tiles
});
$('reset').addEventListener('click', () => {
  if (!window.confirm('Új gyakorlat: a közlések, események és döntések törlődnek. Folytatod?')) return;
  stop();
  clearInterval(wgTimer);
  clearTimeout(popTimer);
  lastKey = null;
  store.clear();
  engine = createEngine(process);
  extras = [];
  removed = [];
  Object.assign(ui, { channel: 'all', element: null, read: {}, reply: null, selected: null, coa: null, wargame: null, resumeAfter: false });
  rendered.clear();
  knownIncidents = null;
  showQuote();
  dialog.reset();
  $('menu').open = false;
  render();
  applyArea();
  map.home();
});
// The process view (or another tab) changed the local demo state.
window.addEventListener('storage', (e) => { if (e.key === KEY && !wanted) window.location.reload(); });

function showStatus(online, why) {
  if (!link) return;
  $('subtitle').textContent = online ? `● ${link.info.title} · ${link.info.person}` : `○ ${why}`;
  $('subtitle').classList.toggle('off', !online);
}
async function start() {
  if (wanted) {
    document.body.classList.add('shared');
    $('banner').textContent = 'NYÍLT / GYAKORLÓ · csak fiktív adat · KÖZÖS, MI nélkül';
    for (const id of ['reset', 'conf-row', 'process-link']) $(id).hidden = true;
    $('leave').hidden = false;
    $('subtitle').textContent = 'Közös gyakorlat: kapcsolódás…';
    if (signedIn()) {
      let live = false;
      try {
        const made = await connect(process, wanted, {
          onStatus: showStatus,
          onChange: () => { if (live) { render(); settle(); } },
        });
        ({ engine, extras, removed } = made.room);
        link = made;
        document.body.dataset.linked = '1';
        live = true;
      } catch (e) { join.open(explain(e)); }
    } else join.open();
    if (!link) {
      $('subtitle').textContent = '○ Nincs kapcsolat';
      $('subtitle').classList.add('off');
    }
  }
  fillRoles();
  dialog = decisionDialog({
    engine: () => engine,
    roleName,
    shared: wanted ? sharedDecisions : null,
    onEscalated: () => { persist(); render(); },
    onDecided: () => { if (!wanted) { persist(); render(); } settle(); },
  });
  showStatus(true);
  const initial = timeline(process, engine.state.log, extras);
  for (const m of initial.messages) rendered.add(m.id);
  render();
  applyArea();
  renderChat(true);
  // A request that was already open does not pop up again in the local demo; a shared one does.
  if (!wanted) lastKey = requestKey(engine); else settle();
}
await start();
