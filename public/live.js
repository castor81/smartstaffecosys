// Live decision window: login, inbox polling, decision dialog. All rules are enforced by the database.
import { configured, signedIn, signIn, signOut as endSession, onExpired, rpc } from './api.js';

const POLL_MS = 15000;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
let roles = {};
let inbox = [];
let current = null; // request shown in the dialog
let timer = null;
const announced = new Set();

function showLogin(message = '') {
  clearInterval(timer);
  announced.clear();
  inbox = [];
  current = null;
  if ($('dlg').open) $('dlg').close();
  $('inbox').replaceChildren();
  $('history').replaceChildren();
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-error').textContent = message;
}
onExpired(showLogin);

// Database refusals shown in Hungarian; unknown messages are shown as they arrive.
const REFUSALS = {
  'a reason is required when deviating from the recommendation': 'A törzsajánlástól eltérő döntéshez indoklás kell.',
  'written guidance is required for this decision': 'Ehhez a döntéshez írásos iránymutatás kell.',
  'request is not open': 'Ez a döntéskérés már nem nyitott.',
  'request not found': 'A döntéskérés nem található.',
  'the subject of this request has been invalidated': 'A döntés tárgya időközben érvényét vesztette.',
};
const explain = (m) => REFUSALS[m] || (m.startsWith('person is not entitled') ? 'Ehhez a döntéshez nincs jogosultságod.' : m);

const roleName = (r) => roles[r] || r;
const time = (iso) => (iso ? new Date(iso).toLocaleString('hu-HU') : '–');
const canDecide = (r) => r.options.some((o) => o.allowed);

function renderInbox() {
  if (!inbox.length) { $('inbox').replaceChildren(el('p', 'Nincs nyitott döntéskérés.', 'muted')); return; }
  $('inbox').replaceChildren(...inbox.map((r) => {
    const box = el('div', undefined, r.status === 'escalated' ? 'request late' : 'request');
    const button = el('button', 'Döntési ablak', canDecide(r) ? 'primary' : undefined);
    button.addEventListener('click', () => openDialog(r));
    box.append(el('strong', `${r.gate} · ${r.title}`), el('p', `${r.hq} · ${r.case}`, 'muted'),
      el('p', `${r.status === 'escalated' ? 'ESZKALÁLVA · ' : ''}határidő: ${time(r.due_at)}${canDecide(r) ? '' : ' · nem te döntesz'}`, 'muted'),
      button);
    return box;
  }));
}

function renderHistory(list) {
  $('history').replaceChildren(...list.map((d) => el('li',
    `${time(d.at)} · ${d.case} · ${d.gate}: ${d.option} (${d.by})${d.reason ? ` – ${d.reason}` : ''}${d.guidance ? ` | iránymutatás: ${d.guidance}` : ''}`)));
}

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function openDialog(r) {
  current = r;
  const m = r.material || {};
  $('dlg-meta').textContent = `${r.gate} · ${r.hq} · ${r.case}`;
  $('dlg-title').textContent = r.title;
  $('dlg-clock').textContent = `${r.status === 'escalated' ? 'ESZKALÁLVA. ' : ''}Határidő: ${time(r.due_at)}. Lejáratkor nincs automatikus jóváhagyás.`;
  const warnings = [
    ...(m.escalations || []).map((e) => `Eszkaláció: ${e.artifact} (${e.status}${e.by?.length ? `, ${e.by.join(', ')}` : ''})`),
    ...(m.gaps || []).map((g) => `Adathiány: ${g.artifact} – ${g.agent}: ${asText(g.gap)}`),
    ...(m.incomplete?.length ? [`Hiányos döntési anyag: ${m.incomplete.join(', ')}`] : []),
  ];
  const list = el('ul', undefined, 'warnings');
  list.append(...warnings.map((w) => el('li', w)));
  $('dlg-warnings').replaceChildren(...(warnings.length ? [list] : []));
  $('dlg-subject').open = false;
  $('dlg-content').textContent = JSON.stringify(r.subject, null, 2);
  $('dlg-options').replaceChildren(el('legend', 'Alternatívák'), ...r.options.map((o) => {
    const label = el('label', undefined, 'option');
    const input = el('input');
    Object.assign(input, { type: 'radio', name: 'opt', value: o.id, disabled: !o.allowed });
    const text = el('span');
    const a = m.options?.[o.id] || {};
    text.append(el('strong', o.label), el('small', `Előny: ${a.pro || '–'}`), el('small', `Hátrány: ${a.con || '–'}`),
      el('small', `Kockázat: ${a.risk || '–'}`), el('small', `Dönthet: ${o.roles.map(roleName).join(' vagy ')}`));
    label.append(input, text);
    return label;
  }));
  const rec = r.options.find((o) => o.id === r.recommendation);
  $('dlg-rec').textContent = rec ? `Törzsajánlás: ${rec.label}. ${m.why || ''}` : `Nincs törzsajánlás. ${m.why || ''}`;
  $('dlg-rec').hidden = true;
  $('dlg-reveal').disabled = true;
  $('dlg-guidance').value = '';
  $('dlg-guidance-box').hidden = true;
  $('dlg-reason').value = '';
  $('dlg-error').textContent = canDecide(r) ? '' : 'Ehhez a döntéshez nincs jogosult szereped.';
  $('dlg-ok').disabled = true;
  $('dlg').showModal();
}

const picked = () => current?.options.find((o) => o.id === $('dlg').querySelector('input[name=opt]:checked')?.value);

function update() {
  const o = picked();
  $('dlg-reveal').disabled = !o;
  $('dlg-guidance-box').hidden = !(o && current.needs_guidance && o.effect === 'advance');
  $('dlg-ok').disabled = !o?.allowed || $('dlg-rec').hidden;
}

async function refresh() {
  try {
    const [open, history] = await Promise.all([rpc('sse_inbox'), rpc('sse_history')]);
    inbox = open;
    renderInbox();
    renderHistory(history);
    $('conn').textContent = `Frissítve: ${new Date().toLocaleTimeString('hu-HU')}`;
  } catch (e) {
    $('conn').textContent = `Nem sikerült frissíteni: ${e.message}`;
    return;
  }
  if ($('dlg').open && current && !inbox.some((r) => r.id === current.id)) {
    $('dlg-error').textContent = 'Ez a döntéskérés már nem nyitott.';
    $('dlg-ok').disabled = true;
    current = null;
  }
  const fresh = inbox.filter((r) => canDecide(r) && !announced.has(r.id));
  if (fresh.length && !$('dlg').open) {
    announced.add(fresh[0].id);
    openDialog(fresh[0]);
    if (document.hidden && window.Notification?.permission === 'granted') {
      try { new Notification('SmartStaffEcosys: döntés vár', { body: `${fresh[0].gate} · ${fresh[0].title}` }); } catch { /* not supported here */ }
    }
  }
}

async function start() {
  try {
    const me = await rpc('sse_whoami');
    $('login').hidden = true;
    $('app').hidden = false;
    $('who').textContent = me.person
      ? `${me.person} · ${me.roles.map((a) => `${a.hq}: ${roleName(a.role)}`).join('; ') || 'nincs szerep'}`
      : 'Ehhez a fiókhoz nincs törzsbeosztás rendelve.';
    if (me.profile === 'confidential_plus') $('who').textContent += ' · Bizalmas+ aktív: a felhős feldolgozás tiltva.';
    await refresh();
    clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  } catch (e) {
    if (!signedIn()) return;
    endSession();
    showLogin(`Nem sikerült kapcsolódni: ${e.message}`);
  }
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('login-error').textContent = '';
  try {
    await signIn($('email').value, $('password').value);
  } catch (e) { $('login-error').textContent = `Sikertelen belépés: ${e.message}`; return; }
  $('password').value = '';
  await start();
});
$('logout').addEventListener('click', () => { endSession(); showLogin(); });
$('refresh').addEventListener('click', refresh);
$('notify').addEventListener('click', async () => {
  const state = window.Notification ? await Notification.requestPermission() : 'unsupported';
  $('conn').textContent = state === 'granted' ? 'Értesítés engedélyezve.' : 'Ezen az eszközön nincs értesítés; a felugró ablak működik.';
});
$('dlg-options').addEventListener('change', update);
$('dlg-reveal').addEventListener('click', () => { $('dlg-rec').hidden = false; update(); });
$('dlg-later').addEventListener('click', () => $('dlg').close());
$('dlg-ok').addEventListener('click', async () => {
  const o = picked();
  if (!o) return;
  $('dlg-ok').disabled = true;
  try {
    await rpc('sse_decide', {
      p_request: current.id, p_option: o.id, p_reason: $('dlg-reason').value.trim() || null,
      p_guidance: $('dlg-guidance-box').hidden ? null : $('dlg-guidance').value.trim() || null,
    });
  } catch (e) {
    $('dlg-error').textContent = explain(e.message);
    update();
    return;
  }
  $('dlg').close();
  current = null;
  await refresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn()) refresh(); });

if (!configured) {
  $('setup').hidden = false;
} else {
  roles = await fetch('data/process.json').then((r) => r.json()).then((p) => p.human_roles).catch(() => ({}));
  if (signedIn()) await start(); else $('login').hidden = false;
}
