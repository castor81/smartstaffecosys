// Shared exercise over the database: login window, exercise list, polling and posting events.
import { configured, signedIn, signIn, signOut, onExpired, rpc } from './api.js';
import { createRoom, CONTROL_ROLES } from './room.js';

const POLL_MS = 2000;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

const REFUSALS = [
  [/you do not hold this role/, 'Ezzel a szereppel nem vagy beosztva.'],
  [/may not control the exercise/, 'A gyakorlatot csak a parancsnoki csoport vezérelheti.'],
  [/may not decide gate/, 'Ehhez a döntéshez nincs jogosultságod.'],
  [/a reason is required/, 'A törzsajánlástól eltérő döntéshez indoklás kell.'],
  [/only the command group/, 'Közös gyakorlatot csak a parancsnoki csoport tagja indíthat.'],
  [/version mismatch/, 'Ez a gyakorlat másik folyamatverzióval készült, itt nem nyitható meg.'],
  [/exercise not found/, 'Ez a gyakorlat nem található, vagy nincs hozzá jogosultságod.'],
  [/exercise limit reached|event limit reached/, 'A gyakorlat elérte a méretkorlátot.'],
  [/confidential_plus/, 'Bizalmas+ aktív: a felhős közös gyakorlat tiltva.'],
  [/a message has 1 to 400/, 'A közlés 1–400 karakter lehet.'],
  [/Invalid login credentials/, 'Hibás e-mail-cím vagy jelszó.'],
];
export const explain = (e) => REFUSALS.find(([pattern]) => pattern.test(e.message))?.[1] || `Nem sikerült: ${e.message}`;

export const exerciseId = () => {
  const id = new URLSearchParams(window.location.search).get('ex');
  return /^[0-9a-f-]{36}$/i.test(id || '') ? id : null;
};
const enter = (id) => window.location.assign(id ? `./?ex=${id}` : './');

/** The login and exercise chooser window. */
export function joinDialog(version) {
  const dlg = $('join');
  const show = (part) => {
    for (const id of ['join-setup', 'join-login', 'join-list']) $(id).hidden = id !== part;
  };
  const fail = (message) => { $('join-error').textContent = message; };

  async function list() {
    show('join-list');
    $('join-who').textContent = 'Betöltés…';
    $('join-rooms').replaceChildren();
    $('join-new').hidden = true;
    let data;
    try { data = await rpc('sse_ex_list'); } catch (e) { $('join-who').textContent = ''; if (signedIn()) fail(explain(e)); return; }
    if (!data.hqs.length) {
      $('join-who').textContent = 'Ehhez a fiókhoz nincs törzsbeosztás rendelve. A beosztást a rendszergazda adja meg.';
      return;
    }
    $('join-who').textContent = `${data.person} · ${data.hqs.map((h) => h.name).join(', ')}`;
    const controls = data.hqs.filter((h) => h.roles.some((r) => CONTROL_ROLES.includes(r)));
    $('join-new').hidden = !controls.length;
    $('join-hq').replaceChildren(...controls.map((h) => new Option(h.name, h.id)));
    $('join-hq').hidden = controls.length < 2;
    $('join-rooms').replaceChildren(...data.exercises.map((x) => {
      const b = el('button', null, 'room');
      b.type = 'button';
      const old = x.version !== version;
      b.disabled = old;
      b.append(el('strong', x.title), el('small', `${x.by} · ${new Date(x.at).toLocaleString('hu-HU')} · ${x.events} esemény${old ? ` · v${x.version}, itt nem nyitható meg` : ''}`));
      b.addEventListener('click', () => enter(x.id));
      return b;
    }));
    if (!data.exercises.length) $('join-rooms').append(el('p', 'Még nincs közös gyakorlat.', 'muted'));
  }

  function open(message = '') {
    fail(message);
    if (!dlg.open) dlg.showModal();
    if (!configured) show('join-setup');
    else if (signedIn()) list();
    else show('join-login');
  }

  $('join-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fail('');
    try { await signIn($('join-email').value, $('join-password').value); } catch (e) { fail(explain(e)); return; }
    $('join-password').value = '';
    if (exerciseId()) window.location.reload(); else list();
  });
  $('join-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fail('');
    try {
      const made = await rpc('sse_ex_create', { p_hq: $('join-hq').value, p_title: $('join-name').value, p_version: version });
      enter(made.id);
    } catch (e) { fail(explain(e)); }
  });
  $('join-refresh').addEventListener('click', () => { fail(''); list(); });
  $('join-logout').addEventListener('click', async () => {
    await signOut();
    if (exerciseId()) enter(null); else open();
  });
  // Closing a window that could not connect leads back to the local demo.
  const abandon = () => { if (exerciseId() && !(signedIn() && document.body.dataset.linked)) enter(null); };
  $('join-close').addEventListener('click', () => { dlg.close(); abandon(); });
  dlg.addEventListener('cancel', () => setTimeout(abandon, 0));
  onExpired((message) => open(message));
  return { open };
}

/**
 * Connects to one exercise. `onChange` runs after new events were replayed, `onStatus` with a line about
 * the connection. Posting is refused by the database when somebody else was faster; then we only catch up.
 */
export async function connect(process, id, { onChange, onStatus }) {
  const room = createRoom(process);
  const info = { title: '', person: '', hq: '', roles: [], skew: 0 };
  let timer = null;
  let running = null;
  let dead = false;

  async function pull() {
    for (;;) {
      const data = await rpc('sse_ex_poll', { p_exercise: id, p_since: room.seq });
      // Another process version would replay the same events differently.
      if (data.version !== process.meta.version) throw new Error('version mismatch');
      Object.assign(info, { title: data.title, person: data.person, hq: data.hq, roles: data.roles, skew: Date.parse(data.now) - Date.now() });
      const applied = room.apply(data.events);
      if (applied) onChange();
      if (data.events.length < 500 || !applied) return;
    }
  }
  // One request at a time; a second caller waits for the running one and then pulls again.
  async function sync() {
    while (running) await running.catch(() => {});
    running = pull().finally(() => { running = null; });
    return running;
  }
  async function tick() {
    clearTimeout(timer);
    if (dead || !signedIn()) return;
    if (!document.hidden) {
      try { await sync(); onStatus(true); } catch (e) {
        onStatus(false, explain(e));
        if (/exercise not found|confidential_plus/.test(e.message)) { dead = true; return; }
      }
    }
    clearTimeout(timer);
    timer = setTimeout(tick, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  await sync();
  timer = setTimeout(tick, POLL_MS);

  return {
    room,
    info,
    /** Returns true if the event was recorded; false if the state changed meanwhile (we are up to date then). */
    async post(role, kind, payload = {}, retries = 0) {
      for (let attempt = 0; ; attempt += 1) {
        const res = await rpc('sse_ex_post', { p_exercise: id, p_expected: room.seq, p_role: role, p_kind: kind, p_payload: payload });
        await sync();
        if (res.ok) return true;
        if (attempt >= retries) return false;
      }
    },
  };
}
