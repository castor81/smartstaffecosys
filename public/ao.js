// The area of operations: named terrain points that form a polygon. Pure except for the small storage
// helpers. The area stays in this browser; it is not sent to the database.
import { toUtm, toMgrs, fromMgrs, zoneOf, gridLines, gridStep, wrapLon, MIN_LAT, MAX_LAT } from './mgrs.js';

export const AO_KEY = 'sse-ao-v1';
export const MAX_POINTS = 30;
const MAX_SPAN_KM = 600;

const text = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

export const emptyArea = () => ({ version: 1, name: 'Műveleti terület', points: [] });

/** Checks and copies data from storage or a file; throws an explanation if it is not an area. */
export function parseArea(data) {
  const value = typeof data === 'string' ? JSON.parse(data) : data;
  if (!value || value.version !== 1 || !Array.isArray(value.points)) throw new Error('Ez nem műveletiterület-fájl.');
  if (value.points.length > MAX_POINTS) throw new Error(`Legfeljebb ${MAX_POINTS} tereppont adható meg.`);
  const points = value.points.map((p, i) => {
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || !(p.lat >= MIN_LAT && p.lat <= MAX_LAT) || !(Math.abs(p.lon) <= 180)) {
      throw new Error(`A(z) ${i + 1}. tereppont koordinátája hibás.`);
    }
    return { name: text(p.name, 40, `TP${i + 1}`), lat: p.lat, lon: p.lon };
  });
  return { version: 1, name: text(value.name, 60, 'Műveleti terület'), points };
}

/** Longitudes next to the first point, so an area across the date line stays in one piece. */
export function unwrapped(points) {
  const base = points[0]?.lon ?? 0;
  return points.map((p) => ({ ...p, lon: base + wrapLon(p.lon - base) }));
}

export function boundsOf(points) {
  const list = unwrapped(points);
  const lons = list.map((p) => p.lon);
  const lats = list.map((p) => p.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export const widthKm = ([west, south, east, north]) => (east - west) * 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180);
export const heightKm = ([, south, , north]) => (north - south) * 111.13;

/** The corner points in metres on one common UTM zone. */
function plane(points) {
  const list = unwrapped(points);
  const lat = list.reduce((s, p) => s + p.lat, 0) / list.length;
  const lon = list.reduce((s, p) => s + p.lon, 0) / list.length;
  const zone = zoneOf(lat, lon);
  return list.map((p) => { const u = toUtm(p.lat, p.lon, zone, lat >= 0); return [u.easting, u.northing]; });
}

const turn = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const crosses = (a, b, c, d) => turn(a, b, c) !== turn(a, b, d) && turn(c, d, a) !== turn(c, d, b);

/** Whether the outline, in the order of the points, can bound an area; `why` explains a refusal. */
export function checkArea(area) {
  const { points } = area;
  if (points.length < 3) return { ok: false, why: `Még ${3 - points.length} tereppont kell.`, km2: 0 };
  const box = boundsOf(points);
  if (widthKm(box) > MAX_SPAN_KM || heightKm(box) > MAX_SPAN_KM) return { ok: false, why: `A terület túl nagy (legfeljebb ${MAX_SPAN_KM} km átmérő).`, km2: 0 };
  const p = plane(points);
  const size = p.length;
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 2; j < size; j += 1) {
      if (i === 0 && j === size - 1) continue;
      if (crosses(p[i], p[i + 1], p[j], p[(j + 1) % size])) return { ok: false, why: 'A határvonal metszi önmagát: a tereppontokat körbejárási sorrendben add meg.', km2: 0 };
    }
  }
  let twice = 0;
  for (let i = 0; i < size; i += 1) twice += p[i][0] * p[(i + 1) % size][1] - p[(i + 1) % size][0] * p[i][1];
  const km2 = Math.abs(twice) / 2 / 1e6;
  if (km2 < 0.01) return { ok: false, why: 'A tereppontok nem zárnak be területet.', km2 };
  return { ok: true, why: '', km2 };
}

export const mgrsOf = (p) => toMgrs(p.lat, p.lon, 5) || 'UPS (nem támogatott)';

export const areaStore = {
  load() { try { const raw = localStorage.getItem(AO_KEY); return raw ? parseArea(raw) : null; } catch { return null; } },
  save(area) { try { localStorage.setItem(AO_KEY, JSON.stringify(area)); return true; } catch { return false; } },
  clear() { try { localStorage.removeItem(AO_KEY); } catch { /* ignore */ } },
};
/** The area the command post shows: saved with `active` set by "load into the command post". */
export const activeStore = {
  load() { try { const raw = localStorage.getItem(`${AO_KEY}-active`); return raw ? parseArea(raw) : null; } catch { return null; } },
  save(area) {
    try {
      localStorage.setItem(`${AO_KEY}-active`, JSON.stringify(area));
      localStorage.removeItem('sse-ao-hidden'); // a freshly loaded area is shown
      return true;
    } catch { return false; }
  },
  clear() { try { localStorage.removeItem(`${AO_KEY}-active`); } catch { /* ignore */ } },
};

/* ---------- satellite tiles and the flat picture of the command post ---------- */

export const TILE_HOST = 'https://tiles.maps.eox.at';
export const tileTemplate = `${TILE_HOST}/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`;
export const TILE_CREDIT = 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017) · CC BY 4.0';
export const MAX_ZOOM = 14;

const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;

/**
 * Fits the area into a W × H picture (Web Mercator): projection, tiles, outline, grid and scale.
 * `margin` is the free share around the area.
 */
export function layout(area, W = 1000, H = 700, margin = 0.12) {
  const box = boundsOf(area.points);
  const x0 = mercX(box[0]);
  const x1 = mercX(box[2]);
  const y0 = mercY(box[3]);
  const y1 = mercY(box[1]);
  const k = Math.min((W * (1 - 2 * margin)) / (x1 - x0), (H * (1 - 2 * margin)) / (y1 - y0)); // units per world
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const project = (lon, lat) => [W / 2 + (mercX(lon) - cx) * k, H / 2 + (mercY(lat) - cy) * k];
  const unproject = (x, y) => ({
    lon: wrapLon((cx + (x - W / 2) / k) * 360 - 180),
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * (cy + (y - H / 2) / k)))) * 180) / Math.PI,
  });
  // The picture with some room around it, for panning.
  const view = [(cx - (0.75 * W) / k) * 360 - 180, 0, (cx + (0.75 * W) / k) * 360 - 180, 0];
  view[1] = Math.max(MIN_LAT, unproject(0, H * 1.25).lat);
  view[3] = Math.min(MAX_LAT, unproject(0, -H * 0.25).lat);

  // Tiles of the sharpest zoom level that needs at most 96 of them.
  const left = cx - (0.75 * W) / k;
  const right = cx + (0.75 * W) / k;
  const top = Math.max(0, cy - (0.75 * H) / k);
  const bottom = Math.min(1, cy + (0.75 * H) / k);
  let z = Math.min(MAX_ZOOM, Math.max(0, Math.ceil(Math.log2(k / 256))));
  const count = (level) => (Math.floor(right * 2 ** level) - Math.floor(left * 2 ** level) + 1) * (Math.floor(bottom * 2 ** level - 1e-9) - Math.floor(top * 2 ** level) + 1);
  while (z > 0 && count(z) > 96) z -= 1;
  const n = 2 ** z;
  const tiles = [];
  for (let tx = Math.floor(left * n); tx <= Math.floor(right * n); tx += 1) {
    for (let ty = Math.floor(top * n); ty <= Math.floor(bottom * n - 1e-9); ty += 1) {
      const [x, y] = [W / 2 + (tx / n - cx) * k, H / 2 + (ty / n - cy) * k];
      const url = tileTemplate.replace('{z}', z).replace('{y}', ty).replace('{x}', ((tx % n) + n) % n);
      tiles.push({ url, x, y, size: k / n });
    }
  }
  const middle = unproject(W / 2, H / 2);
  const kmPerUnit = (40075.017 * Math.cos((middle.lat * Math.PI) / 180)) / k;
  const step = gridStep(W * kmPerUnit, 700) || 100000;
  const grid = gridLines(view, step);
  return {
    W, H, project, unproject, tiles, zoom: z, kmPerUnit, step,
    outline: unwrapped(area.points).map((p) => ({ name: p.name, at: project(p.lon, p.lat) })),
    grid: {
      lines: grid.lines.map((l) => ({ ...l, path: l.coords.map(([lon, lat]) => project(lon, lat)) })),
      labels: grid.labels.map((l) => ({ ...l, xy: project(...l.at) })),
    },
  };
}

/**
 * Reads a typed position: an MGRS reference, or latitude and longitude in decimal degrees
 * ("47.5, 19.05" or "47,5 19,05"). Returns null if it is neither.
 */
export function parsePosition(input) {
  const value = String(input).trim();
  const grid = fromMgrs(value);
  if (grid) return { lat: grid.lat, lon: grid.lon };
  const m = value.match(/^(-?\d+(?:\.\d+)?)°?(?:\s*[,;]\s*|\s+)(-?\d+(?:\.\d+)?)°?$/)
    || value.match(/^(-?\d+(?:,\d+)?)°?(?:\s*;\s*|\s+)(-?\d+(?:,\d+)?)°?$/);
  if (!m) return null;
  const [lat, lon] = [m[1], m[2]].map((v) => Number(v.replace(',', '.')));
  return lat >= MIN_LAT && lat <= MAX_LAT && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** The points in going-round order about their middle, which removes self-intersections. */
export function sortAround(points) {
  const list = unwrapped(points);
  const lat = list.reduce((s, p) => s + p.lat, 0) / list.length;
  const lon = list.reduce((s, p) => s + p.lon, 0) / list.length;
  const squeeze = Math.cos((lat * Math.PI) / 180);
  return list.map((p, i) => ({ point: points[i], angle: Math.atan2(p.lat - lat, (p.lon - lon) * squeeze) }))
    .sort((a, b) => b.angle - a.angle).map((x) => x.point);
}

/** The next free default name. */
export function nextName(points) {
  const used = new Set(points.map((p) => p.name));
  let i = points.length + 1;
  while (used.has(`TP${i}`)) i += 1;
  return `TP${i}`;
}
