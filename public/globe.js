// Globe page: browse the Earth, set terrain points, see the MGRS grid, hand the area to the command post.
import { Map as GlMap, Marker, NavigationControl, ScaleControl, AttributionControl, setWorkerUrl } from './vendor/maplibre-gl-6.19.0/maplibre-gl.mjs';
import { toMgrs, gridLines, gridStep, wrapLon, MIN_LAT, MAX_LAT } from './mgrs.js';
import {
  emptyArea, parseArea, parsePosition, sortAround, nextName, checkArea, boundsOf, unwrapped, mgrsOf,
  areaStore, activeStore, tileTemplate, TILE_CREDIT, MAX_ZOOM, MAX_POINTS, AO_KEY,
} from './ao.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const PREFS = 'sse-globe-v1';
const locked = store.load().state?.status === 'locked';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* ignore */ } };

let area = areaStore.load() || activeStore.load() || emptyArea();
let tapping = false;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}

/* ---------- Bizalmas+ and layer switches ---------- */

$('sat').checked = !locked && prefs.sat !== false;
$('grid').checked = prefs.grid !== false;
if (locked) {
  document.body.classList.add('locked');
  $('banner').textContent = 'BIZALMAS+ · ZÁROLVA · külső térképszolgáltatás kikapcsolva';
  $('sat').disabled = true;
  $('google').removeAttribute('href');
  $('google').setAttribute('aria-disabled', 'true');
}

/* ---------- the globe ---------- */

const none = { type: 'FeatureCollection', features: [] };
const sources = {
  countries: { type: 'geojson', data: 'data/countries.geojson', attribution: 'Határok: Natural Earth' },
  grid: { type: 'geojson', data: none },
  area: { type: 'geojson', data: none },
};
const layers = [
  { id: 'sea', type: 'background', paint: { 'background-color': '#0e2c42' } },
  { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#27443a' } },
];
if (!locked) {
  sources.sat = { type: 'raster', tiles: [tileTemplate], tileSize: 256, maxzoom: MAX_ZOOM, attribution: TILE_CREDIT.replace('https://cloudless.eox.at', '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">https://cloudless.eox.at</a>').replace('CC BY 4.0', '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>') };
  layers.push({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: $('sat').checked ? 'visible' : 'none' } });
}
layers.push(
  { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#e4efe9', 'line-opacity': 0.45, 'line-width': 0.8 } },
  { id: 'grid', type: 'line', source: 'grid', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': '#f2d27a', 'line-opacity': 0.65, 'line-width': 0.8 } },
  { id: 'grid-square', type: 'line', source: 'grid', filter: ['==', ['get', 'kind'], 'square'], paint: { 'line-color': '#ffe9ad', 'line-opacity': 0.95, 'line-width': 1.8 } },
  { id: 'grid-zone', type: 'line', source: 'grid', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': 1.5 } },
  { id: 'area-fill', type: 'fill', source: 'area', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f2b441', 'fill-opacity': 0.16 } },
  { id: 'area-line', type: 'line', source: 'area', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#f2b441', 'line-width': 3 } },
);

let map = null;
try {
  setWorkerUrl(new URL('vendor/maplibre-gl-6.19.0/maplibre-gl-worker.mjs', import.meta.url).href);
  map = new GlMap({
    container: $('globe'),
    style: { version: 8, projection: { type: 'globe' }, sources, layers },
    center: [19.3, 40],
    zoom: window.innerWidth < 760 ? 1.2 : 1.8,
    maxZoom: 16,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new AttributionControl({ compact: window.innerWidth < 760 }), 'bottom-right');
} catch (error) {
  console.error(error);
  toast('A földgömb nem indítható (WebGL szükséges). A tereppontok koordinátával így is megadhatók.');
}

let satWarned = false;
map?.on('error', (event) => {
  if (event.sourceId === 'sat') {
    if (!satWarned) toast('A műholdkép most nem érhető el; a határrajz és az MGRS-rács használható.');
    satWarned = true;
  } else {
    console.error(event.error);
  }
});

/** Kilometres across the visible map, from the zoom level at the centre. */
function viewSize() {
  const { lat, lng } = map.getCenter();
  const kmPerPixel = (40075.017 * Math.max(0.05, Math.cos((lat * Math.PI) / 180))) / (512 * 2 ** map.getZoom());
  const el = map.getContainer();
  return { lat, lng, width: kmPerPixel * el.clientWidth, height: kmPerPixel * el.clientHeight };
}

function readout() {
  if (!map) return;
  const { lat, lng } = map.getCenter();
  const lon = wrapLon(lng);
  $('mgrs').textContent = toMgrs(lat, lon, 5) || 'MGRS: sarkvidék (UPS)';
  $('latlon').textContent = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
}

/** Height of the credit box at the bottom of the map, which labels and the area must stay above. */
const creditHeight = () => map.getContainer().querySelector('.maplibregl-ctrl-bottom-right')?.offsetHeight || 24;

/* ---------- MGRS grid ---------- */

let gridMarkers = [];
const STEP_NAMES = { 100000: '100 km', 10000: '10 km', 1000: '1 km', 100: '100 m' };

function drawGrid() {
  if (!map?.getSource('grid')) return;
  gridMarkers.forEach((m) => m.remove());
  gridMarkers = [];
  if (!$('grid').checked) {
    map.getSource('grid').setData(none);
    $('gridinfo').textContent = '';
    return;
  }
  const view = viewSize();
  const step = gridStep(view.width, map.getContainer().clientWidth);
  const dLat = (view.height / 111.13) * 0.7;
  const dLon = (view.width / (111.32 * Math.max(0.05, Math.cos((view.lat * Math.PI) / 180)))) * 0.7;
  const box = step ? [view.lng - Math.min(dLon, 90), view.lat - dLat, view.lng + Math.min(dLon, 90), view.lat + dLat] : [-180, MIN_LAT, 180, MAX_LAT];
  const grid = gridLines(box, step, 700);
  map.getSource('grid').setData({
    type: 'FeatureCollection',
    features: grid.lines.map((l) => ({ type: 'Feature', properties: { kind: l.kind }, geometry: { type: 'LineString', coordinates: l.coords } })),
  });
  $('gridinfo').textContent = `Rács: ${step ? STEP_NAMES[step] : 'övezetek (GZD)'}${grid.truncated ? ' · részleges, nagyíts rá' : ''}`;

  // Labels: only what is on screen, thinned so they do not overlap.
  const el = map.getContainer();
  const taken = [];
  const floor = el.clientHeight - creditHeight() - 8;
  const order = { square: 0, zone: 0, e: 1, n: 1 };
  for (const label of [...grid.labels].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (!step && map.getZoom() < 2.4) break;
    const at = label.at;
    if (!step && (Math.abs(wrapLon(at[0] - view.lng)) > 50 || Math.abs(at[1] - view.lat) > 40)) continue;
    const p = map.project(at);
    // Eastings sit on the lower edge of their line, northings on the left edge.
    const x = label.kind === 'n' ? Math.max(p.x, 16) : p.x;
    const y = label.kind === 'e' ? Math.min(p.y, floor) : p.y;
    if (x < 0 || y < 0 || x > el.clientWidth || y > el.clientHeight) continue;
    if (taken.some(([tx, ty]) => Math.abs(tx - x) < 30 && Math.abs(ty - y) < 16)) continue;
    taken.push([x, y]);
    const node = document.createElement('span');
    node.className = `gridlabel ${label.kind}`;
    node.textContent = label.text;
    const clamped = x === p.x && y === p.y ? at : map.unproject([x, y]);
    gridMarkers.push(new Marker({ element: node, opacityWhenCovered: '0' }).setLngLat(clamped).addTo(map));
    if (gridMarkers.length >= 90) break;
  }
}

/* ---------- terrain points ---------- */

let pins = [];

function drawArea() {
  if (!map?.getSource('area')) return;
  pins.forEach((p) => p.remove());
  const list = unwrapped(area.points);
  const ring = list.map((p) => [p.lon, p.lat]);
  const closed = ring.length > 2 ? [...ring, ring[0]] : ring;
  const features = [];
  if (ring.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closed } });
  if (checkArea(area).ok) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } });
  map.getSource('area').setData({ type: 'FeatureCollection', features });
  pins = list.map((p, i) => {
    const node = document.createElement('span');
    node.className = 'pin';
    node.textContent = String(i + 1);
    node.title = `${p.name} · ${mgrsOf(p)}`;
    const marker = new Marker({ element: node, draggable: true, opacityWhenCovered: '0' }).setLngLat([p.lon, p.lat]).addTo(map);
    marker.on('dragend', () => {
      const at = marker.getLngLat();
      area.points[i] = { name: area.points[i].name, lat: Math.min(MAX_LAT, Math.max(MIN_LAT, at.lat)), lon: wrapLon(at.lng) };
      changed();
    });
    return marker;
  });
}

function button(label, title, onClick, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderList() {
  const list = $('points');
  list.replaceChildren();
  if (!area.points.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Még nincs tereppont. Vidd a célkeresztet a helyszínre, vagy írj be MGRS-koordinátát. A pontokat körbejárási sorrendben vedd fel.';
    list.append(li);
  }
  area.points.forEach((p, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 40;
    name.value = p.name;
    name.setAttribute('aria-label', `A(z) ${i + 1}. tereppont neve`);
    name.addEventListener('change', () => { p.name = name.value.trim() || `TP${i + 1}`; changed(); });
    const code = document.createElement('code');
    code.textContent = mgrsOf(p);
    li.append(
      num, name,
      button('◎', `${p.name}: nézet ide`, () => map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 11) })),
      button('↑', `${p.name}: előrébb a sorrendben`, () => { [area.points[i - 1], area.points[i]] = [area.points[i], area.points[i - 1]]; changed(); }, i === 0),
      button('✕', `${p.name}: törlés`, () => { area.points.splice(i, 1); changed(); }),
      code,
    );
    list.append(li);
  });
}

function renderSummary() {
  const result = checkArea(area);
  const size = result.km2 >= 100 ? Math.round(result.km2).toLocaleString('hu-HU') : result.km2.toLocaleString('hu-HU', { maximumFractionDigits: 2 });
  const active = activeStore.load();
  const same = active && JSON.stringify(active) === JSON.stringify(area);
  $('summary').textContent = result.ok ? `${area.points.length} tereppont · ${size} km²${same ? ' · betöltve a harcvezető központba' : ''}` : result.why;
  $('summary').classList.toggle('bad', !result.ok);
  $('apply').disabled = !result.ok;
  $('fit').disabled = !area.points.length;
  $('sort').disabled = area.points.length < 4;
  $('export').disabled = !area.points.length;
}

function changed({ save = true } = {}) {
  if (save && !areaStore.save(area)) toast('A böngésző nem engedi a mentést: a területet mentsd fájlba.');
  $('areaname').value = area.name;
  renderList();
  renderSummary();
  drawArea();
}

function addPoint(lat, lon) {
  if (area.points.length >= MAX_POINTS) return toast(`Legfeljebb ${MAX_POINTS} tereppont adható meg.`);
  if (!(lat >= MIN_LAT && lat <= MAX_LAT)) return toast('A sarkvidéken (80° D alatt, 84° É felett) nincs MGRS-rács.');
  area.points.push({ name: nextName(area.points), lat, lon: wrapLon(lon) });
  changed();
  return true;
}

function fit() {
  if (!map || !area.points.length) return;
  const [w, s, e, n] = boundsOf(area.points);
  if (area.points.length === 1 || (e - w < 0.001 && n - s < 0.001)) map.flyTo({ center: [w, s], zoom: 11 });
  else {
    const h = map.getContainer().clientHeight;
    map.fitBounds([[w, s], [e, n]], { padding: { top: Math.min(70, h * 0.18), bottom: Math.min(h * 0.3, creditHeight() + 24), left: 40, right: 56 }, maxZoom: 13 });
  }
}

/* ---------- controls ---------- */

$('sat').addEventListener('change', () => {
  prefs.sat = $('sat').checked;
  savePrefs();
  if (map?.getLayer('sat')) map.setLayoutProperty('sat', 'visibility', prefs.sat ? 'visible' : 'none');
});
$('grid').addEventListener('change', () => { prefs.grid = $('grid').checked; savePrefs(); drawGrid(); });
$('add').addEventListener('click', () => {
  if (!map) return toast('Térkép nélkül a koordinátát írd be, majd „Felvesz”.');
  const c = map.getCenter();
  return addPoint(c.lat, c.lng);
});
$('tap').addEventListener('click', () => {
  tapping = !tapping;
  $('tap').setAttribute('aria-pressed', String(tapping));
  $('globe').classList.toggle('tapping', tapping);
  document.querySelector('.globewrap').classList.toggle('tapping', tapping);
});

function typed() {
  const at = parsePosition($('position').value);
  if (!at) toast('Nem értelmezhető. Példa: 33T YN 12345 67890 vagy 47.5, 19.05');
  return at;
}
$('jump').addEventListener('submit', (event) => {
  event.preventDefault();
  const at = typed();
  if (at) map?.flyTo({ center: [at.lon, at.lat], zoom: Math.max(map.getZoom(), 11) });
});
$('addtyped').addEventListener('click', () => {
  const at = typed();
  if (at && addPoint(at.lat, at.lon)) {
    $('position').value = '';
    map?.easeTo({ center: [at.lon, at.lat], zoom: Math.max(map.getZoom(), 9) });
  }
});
$('areaname').addEventListener('change', () => { area.name = $('areaname').value.trim() || 'Műveleti terület'; changed(); });
$('fit').addEventListener('click', fit);
$('sort').addEventListener('click', () => { area.points = sortAround(area.points); changed(); });
$('apply').addEventListener('click', () => {
  if (!checkArea(area).ok) return;
  if (!activeStore.save(area)) return toast('A böngésző nem engedi a mentést, ezért a terület nem vihető át.');
  location.href = './';
  return true;
});
$('export').addEventListener('click', () => {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const data = { ...area, created: d.toISOString(), mgrs: area.points.map(mgrsOf) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `sse_muveleti_terulet_v0.6_${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('import').addEventListener('change', async () => {
  const file = $('import').files[0];
  $('import').value = '';
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('A fájl túl nagy.');
    area = parseArea(await file.text());
    changed();
    fit();
  } catch (error) {
    toast(error instanceof SyntaxError ? 'A fájl nem érvényes JSON.' : error.message);
  }
});
$('clear').addEventListener('click', () => {
  if ((area.points.length || activeStore.load()) && !window.confirm('Törlöd a tereppontokat és a harcvezető központba betöltött területet?')) return;
  area = emptyArea();
  areaStore.clear();
  activeStore.clear();
  changed({ save: false });
});
// Points set in another tab (the Google page) appear here too.
window.addEventListener('storage', (event) => {
  if (event.key !== AO_KEY) return;
  area = areaStore.load() || emptyArea();
  changed({ save: false });
});

if (map) {
  map.on('move', readout);
  map.on('moveend', drawGrid);
  map.on('resize', drawGrid);
  map.on('click', (event) => { if (tapping) addPoint(event.lngLat.lat, event.lngLat.lng); });
  map.on('load', () => {
    document.body.dataset.ready = 'true';
    readout();
    changed({ save: false });
    drawGrid();
    if (area.points.length) fit();
  });
}
changed({ save: false });
