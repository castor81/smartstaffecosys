// Optional Google 3D view with the user's own API key. Nothing from Google loads until the user agrees.
// The area of operations and the MGRS grid are the same as on the open globe page.
import { gridLines, gridStep, MIN_LAT, MAX_LAT } from './mgrs.js';
import { emptyArea, nextName, checkArea, boundsOf, unwrapped, widthKm, mgrsOf, areaStore, activeStore, MAX_POINTS, AO_KEY } from './ao.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'sse-google-key';
// The sign-in of a shared exercise must not be within reach of third-party code.
try { sessionStorage.removeItem('sse-session'); } catch { /* ignore */ }

const locked = store.load().state?.status === 'locked';
const read = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };

let area = areaStore.load() || activeStore.load() || emptyArea();
let lib = null;
let map = null;
let drawn = [];
let grid = [];
let tapping = false;

const say = (message) => { $('status').textContent = message; };

if (locked) {
  document.body.classList.add('locked');
  $('banner').textContent = 'BIZALMAS+ · ZÁROLVA · a Google nem tölthető be';
  for (const el of $('start').elements) el.disabled = true;
  say('A Bizalmas+ kapcsoló aktív: külső szolgáltatás nem használható.');
} else {
  $('key').value = read();
}

$('forget').addEventListener('click', () => {
  try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
  $('key').value = '';
  say('A tárolt kulcsot töröltem.');
});

function loadGoogle(key) {
  return new Promise((resolve, reject) => {
    window.sseGoogleReady = resolve;
    window.gm_authFailure = () => {
      say('A Google elutasította a kulcsot (érvénytelen, korlátozott vagy nincs hozzá számlázás).');
      $('view').hidden = true;
      $('consent').hidden = false;
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=beta&loading=async&libraries=maps3d&callback=sseGoogleReady`;
    script.async = true;
    script.onerror = () => { script.remove(); reject(new Error('A Google programja nem tölthető le.')); };
    document.head.append(script);
    setTimeout(() => reject(new Error('A Google nem válaszolt időben.')), 20000);
  });
}

/* ---------- drawing ---------- */

const path = (coords) => coords.map(([lng, lat]) => ({ lat, lng }));
function polyline(coords, color, width) {
  const line = new lib.Polyline3DElement({ path: path(coords), altitudeMode: 'CLAMP_TO_GROUND', strokeColor: color, strokeWidth: width });
  map.append(line);
  return line;
}

function drawArea() {
  if (!map) return;
  drawn.forEach((node) => node.remove());
  drawn = [];
  const list = unwrapped(area.points);
  const ring = list.map((p) => [p.lon, p.lat]);
  if (ring.length > 1) drawn.push(polyline(ring.length > 2 ? [...ring, ring[0]] : ring, '#f2b441', 6));
  if (lib.Marker3DElement) {
    for (const p of list) {
      const marker = new lib.Marker3DElement({ position: { lat: p.lat, lng: p.lon }, label: p.name });
      map.append(marker);
      drawn.push(marker);
    }
  }
}

/** The box the grid covers: the current view, estimated from the camera range. */
function viewBox() {
  const centre = map.center;
  const lat = Number(centre?.lat);
  const lng = Number(centre?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const km = Math.max(0.5, (Number(map.range) || 100000) / 1000);
  const dLat = km / 111.13;
  const dLon = km / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLon, Math.max(MIN_LAT, lat - dLat), lng + dLon, Math.min(MAX_LAT, lat + dLat)];
}

function drawGrid() {
  const box = viewBox();
  if (!box) return;
  grid.forEach((node) => node.remove());
  const step = gridStep(widthKm(box), 700);
  const result = gridLines(box, step, 220);
  grid = result.lines.map((l) => polyline(l.coords, l.kind === 'line' ? '#f2d27acc' : '#ffffffee', l.kind === 'line' ? 1.5 : 3));
  $('gridinfo').textContent = `MGRS-rács: ${step ? (step >= 1000 ? `${step / 1000} km` : `${step} m`) : 'övezetek (GZD)'}${result.truncated ? ' (részleges: közelíts rá)' : ''}. Nézetváltás után az „MGRS-rács a nézetre” gombbal frissíthető.`;
}

/* ---------- points ---------- */

function render() {
  $('points').replaceChildren(...area.points.map((p, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const name = document.createElement('strong');
    name.textContent = p.name;
    const code = document.createElement('code');
    code.textContent = mgrsOf(p);
    li.append(num, name, code);
    return li;
  }));
  const result = checkArea(area);
  $('summary').textContent = result.ok ? `${area.points.length} tereppont · ${Math.round(result.km2).toLocaleString('hu-HU')} km²` : result.why;
  $('summary').classList.toggle('bad', !result.ok);
  $('apply').disabled = !result.ok;
  $('undo').disabled = !area.points.length;
  drawArea();
}

$('tap').addEventListener('click', () => {
  tapping = !tapping;
  $('tap').setAttribute('aria-pressed', String(tapping));
});
$('regrid').addEventListener('click', drawGrid);
$('undo').addEventListener('click', () => { area.points.pop(); areaStore.save(area); render(); });
$('apply').addEventListener('click', () => {
  if (checkArea(area).ok && activeStore.save(area)) $('summary').textContent = 'Betöltve. A harcvezető központ térképe most ezt a területet mutatja.';
});
window.addEventListener('storage', (event) => {
  if (event.key !== AO_KEY) return;
  area = areaStore.load() || emptyArea();
  render();
});

$('start').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (locked || !$('agree').checked) return;
  const key = $('key').value.trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) return say('Ez nem tűnik Google API-kulcsnak.');
  try { localStorage.setItem(KEY_STORE, key); } catch { /* the key is then asked again */ }
  say('Betöltés…');
  $('start').querySelector('button[type=submit]').disabled = true;
  try {
    await loadGoogle(key);
    lib = await window.google.maps.importLibrary('maps3d');
    const box = area.points.length ? boundsOf(area.points) : [18.6, 46.9, 19.9, 47.6];
    map = new lib.Map3DElement({
      center: { lat: (box[1] + box[3]) / 2, lng: (box[0] + box[2]) / 2, altitude: 0 },
      range: Math.max(20000, widthKm(box) * 1800),
      tilt: 30,
      heading: 0,
      mode: 'HYBRID',
    });
    map.addEventListener('gmp-click', (e) => {
      const lat = Number(e.position?.lat);
      const lon = Number(e.position?.lng);
      if (!tapping || !Number.isFinite(lat) || !Number.isFinite(lon) || !(lat >= MIN_LAT && lat <= MAX_LAT) || area.points.length >= MAX_POINTS) return;
      area.points.push({ name: nextName(area.points), lat, lon });
      areaStore.save(area);
      render();
    });
    $('map3d').append(map);
    $('consent').hidden = true;
    $('view').hidden = false;
    say('');
    render();
    drawGrid();
    document.body.dataset.ready = 'true';
  } catch (error) {
    console.error(error);
    $('consent').hidden = false;
    $('view').hidden = true;
    say(`${error.message} Töltsd újra az oldalt, vagy használd a nyílt földgömböt.`);
  }
  return true;
});
