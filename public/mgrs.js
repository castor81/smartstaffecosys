// WGS84 latitude/longitude <-> UTM <-> MGRS, and the lines of the MGRS grid. Pure: no DOM, no network.
// Transverse Mercator after Krueger (series to the 6th order). The polar areas (UPS) are not supported:
// valid latitudes are 80° S to 84° N.

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E = Math.sqrt(F * (2 - F));
const n = F / (2 - F);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;
const n6 = n5 * n;
const RADIUS = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];
const BETA = [
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - n4 / 360 - (81 / 512) * n5 + (96199 / 604800) * n6,
  n2 / 48 + n3 / 15 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
  (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
  (4583 / 161280) * n5 - (108847 / 3991680) * n6,
  (20648693 / 638668800) * n6,
];
const RAD = Math.PI / 180;

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COLUMNS = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR']; // by zone % 3
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

export const MIN_LAT = -80;
export const MAX_LAT = 84;
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const bandOf = (lat) => BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))];
const bandRange = (i) => [-80 + 8 * i, i === 19 ? 84 : -72 + 8 * i];
export const centralMeridian = (zone) => zone * 6 - 183;

/** Longitude limits of one grid zone designator cell, with the Norwegian and Svalbard exceptions. */
export function zoneLimits(zone, band) {
  let west = centralMeridian(zone) - 3;
  let east = west + 6;
  if (band === 'V' && zone === 31) east = 3;
  if (band === 'V' && zone === 32) west = 3;
  if (band === 'X') {
    const svalbard = { 31: [0, 9], 33: [9, 21], 35: [21, 33], 37: [33, 42] };
    if (zone === 32 || zone === 34 || zone === 36) return null;
    if (svalbard[zone]) [west, east] = svalbard[zone];
  }
  return [west, east];
}

export function zoneOf(lat, lon) {
  const x = wrapLon(lon);
  const base = Math.min(60, Math.floor((x + 180) / 6) + 1);
  const band = bandOf(lat);
  if (band === 'V' || band === 'X') {
    for (let z = base - 1; z <= base + 1; z += 1) {
      const limits = zoneLimits(z, band);
      if (limits && x >= limits[0] && x < limits[1]) return z;
    }
  }
  return base;
}

const conformal = (tau) => {
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  return tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
};

/** Projects into the given zone (default: the zone of the point). Southern northings carry 10 000 km. */
export function toUtm(lat, lon, zone = zoneOf(lat, lon), north = lat >= 0) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) throw new RangeError('invalid coordinates');
  const lambda = wrapLon(lon - centralMeridian(zone)) * RAD;
  const t = conformal(Math.tan(lat * RAD));
  const xi0 = Math.atan2(t, Math.cos(lambda));
  const eta0 = Math.asinh(Math.sin(lambda) / Math.hypot(t, Math.cos(lambda)));
  let xi = xi0;
  let eta = eta0;
  ALPHA.forEach((a, i) => {
    const k = 2 * (i + 1);
    xi += a * Math.sin(k * xi0) * Math.cosh(k * eta0);
    eta += a * Math.cos(k * xi0) * Math.sinh(k * eta0);
  });
  return { zone, north, easting: 500000 + K0 * RADIUS * eta, northing: K0 * RADIUS * xi + (north ? 0 : 1e7) };
}

export function fromUtm({ zone, north, easting, northing }) {
  const xi = (northing - (north ? 0 : 1e7)) / (K0 * RADIUS);
  const eta = (easting - 500000) / (K0 * RADIUS);
  let xi0 = xi;
  let eta0 = eta;
  BETA.forEach((b, i) => {
    const k = 2 * (i + 1);
    xi0 -= b * Math.sin(k * xi) * Math.cosh(k * eta);
    eta0 -= b * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const t = Math.sin(xi0) / Math.hypot(Math.sinh(eta0), Math.cos(xi0));
  let tau = t;
  for (let i = 0; i < 8; i += 1) {
    const ti = conformal(tau);
    const step = ((t - ti) / Math.sqrt(1 + ti * ti)) * ((1 + (1 - E * E) * tau * tau) / ((1 - E * E) * Math.sqrt(1 + tau * tau)));
    tau += step;
    if (Math.abs(step) < 1e-13) break;
  }
  return { lat: Math.atan(tau) / RAD, lon: wrapLon(centralMeridian(zone) + Math.atan2(Math.sinh(eta0), Math.cos(xi0)) / RAD) };
}

/** The two letters of the 100 km square that holds this UTM position. */
export function squareId(zone, easting, northing) {
  const column = COLUMNS[zone % 3][Math.floor(easting / 100000) - 1];
  const row = ROWS[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  return column && row ? column + row : null;
}

/** MGRS text; `digits` per axis: 0 = 100 km square, 1 = 10 km … 5 = 1 m. Positions are truncated. */
export function toMgrs(lat, lon, digits = 5) {
  if (!(lat >= MIN_LAT && lat <= MAX_LAT)) return null;
  const utm = toUtm(lat, lon);
  const square = squareId(utm.zone, utm.easting, utm.northing);
  const part = (v) => String(Math.floor((v % 100000) / 10 ** (5 - digits))).padStart(digits, '0');
  const head = `${utm.zone}${bandOf(lat)} ${square}`;
  return digits ? `${head} ${part(utm.easting)} ${part(utm.northing)}` : head;
}

/**
 * Reads an MGRS reference. Returns the south-west corner of the referenced square as `utm`, the centre
 * of it as `lat`/`lon`, and its side length in metres; null if the text is not a valid reference.
 */
export function fromMgrs(text) {
  const clean = String(text).toUpperCase().replace(/\s+/g, '');
  const m = clean.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d{0,10})$/);
  if (!m || m[5].length % 2) return null;
  const zone = Number(m[1]);
  const band = m[2];
  if (zone < 1 || zone > 60 || !zoneLimits(zone, band)) return null;
  const column = COLUMNS[zone % 3].indexOf(m[3]);
  if (column < 0) return null;
  const digits = m[5].length / 2;
  const size = 10 ** (5 - digits);
  const rest = (s) => (digits ? Number(s) * size : 0);
  const easting = (column + 1) * 100000 + rest(m[5].slice(0, digits));
  const row = (ROWS.indexOf(m[4]) - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  const low = row * 100000 + rest(m[5].slice(digits));
  const north = band >= 'N';
  const [south, top] = bandRange(BANDS.indexOf(band));
  // The row letters repeat every 2000 km: pick the repetition whose square reaches into the latitude band.
  let best = null;
  for (let northing = low; northing < 1e7 + 1; northing += 2e6) {
    const at = (x, y) => fromUtm({ zone, north, easting: easting + x * size, northing: northing + y * size });
    const centre = at(0.5, 0.5);
    const lats = [centre, at(0, 0), at(1, 0), at(0, 1), at(1, 1)].map((p) => p.lat);
    const off = Math.max(0, south - Math.max(...lats), Math.min(...lats) - top);
    if (!best || off < best.off) best = { off, northing, ...centre };
  }
  if (best.off > 0.01) return null; // no such square in this band
  return { utm: { zone, north, easting, northing: best.northing }, lat: best.lat, lon: best.lon, size };
}

/* ---------- grid lines ---------- */

/** Splits a sampled line into the pieces inside the box, ending exactly on its edge. */
function clip(points, [west, south, east, north]) {
  const pieces = [];
  let piece = [];
  const flush = () => { if (piece.length > 1) pieces.push(piece); piece = []; };
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const dx = points[i][0] - x0;
    const dy = points[i][1] - y0;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [p, q] of [[-dx, x0 - west], [dx, east - x0], [-dy, y0 - south], [dy, north - y0]]) {
      if (p === 0) { if (q < 0) inside = false; continue; }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (!inside || t0 > t1) { flush(); continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    if (t0 > 0 || !piece.length) { flush(); piece = [a]; }
    piece.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

/** The grid zone cells that overlap the box [west, south, east, north] (west < east, may exceed ±180). */
export function zoneCells([west, south, east, north]) {
  const cells = [];
  const s = Math.max(MIN_LAT, south);
  const t = Math.min(MAX_LAT, north);
  if (s >= t || west >= east) return cells;
  const first = Math.floor((west + 180) / 6) - 1; // one more on each side for the wide zones
  const last = Math.floor((east + 180) / 6) + 1;
  for (let b = 0; b < 20; b += 1) {
    const [lo, hi] = bandRange(b);
    if (hi <= s || lo >= t) continue;
    for (let k = first; k <= Math.min(last, first + 61); k += 1) {
      const zone = (((k % 60) + 60) % 60) + 1;
      const limits = zoneLimits(zone, BANDS[b]);
      if (!limits) continue;
      const shift = Math.floor(k / 60) * 360;
      const box = [Math.max(west, limits[0] + shift), Math.max(s, lo), Math.min(east, limits[1] + shift), Math.min(t, hi)];
      if (box[0] < box[2] && box[1] < box[3]) {
        cells.push({ zone, band: BANDS[b], box, cell: [limits[0] + shift, lo, limits[1] + shift, hi] });
      }
    }
  }
  return cells;
}

/**
 * Grid spacing (metres) for a view of the given width in kilometres and screen pixels: the finest one
 * whose lines stay at least 22 px apart. Null: the view is so wide that only the zones are drawn.
 */
export const gridStep = (widthKm, widthPx = 1000) => {
  if (widthKm > 1400) return null;
  return [100, 1000, 10000].find((step) => ((step / 1000) * widthPx) / widthKm >= 22) || 100000;
};

/**
 * Lines and labels of the grid inside the box. Coordinates are [lon, lat]. Without `step` only the grid
 * zone designators are returned. `truncated` is set if the box needs more than `max` lines.
 */
export function gridLines(bounds, step = null, max = 600) {
  const lines = [];
  const labels = [];
  let truncated = false;
  const cells = zoneCells(bounds);
  for (const { zone, band, box, cell } of cells) {
    const [w, s, e, t] = box;
    // Zone borders: the west and south edge of each cell.
    const edge = (from, to) => Array.from({ length: 25 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / 24, from[1] + ((to[1] - from[1]) * i) / 24]);
    if (cell[0] >= bounds[0]) lines.push({ kind: 'zone', coords: edge([cell[0], s], [cell[0], t]) });
    if (cell[1] >= bounds[1]) lines.push({ kind: 'zone', coords: edge([w, cell[1]], [e, cell[1]]) });
    if (!step) {
      labels.push({ kind: 'zone', text: `${zone}${band}`, at: [(w + e) / 2, (s + t) / 2] });
      continue;
    }
    const north = s >= 0 || t > 0;
    // The UTM extent of the cell, from points along its border.
    let minE = Infinity;
    let maxE = -Infinity;
    let minN = Infinity;
    let maxN = -Infinity;
    for (let i = 0; i <= 16; i += 1) {
      const lon = w + ((e - w) * i) / 16;
      const lat = s + ((t - s) * i) / 16;
      for (const [y, x] of [[s, lon], [t, lon], [lat, w], [lat, e]]) {
        const u = toUtm(y, x, zone, north);
        minE = Math.min(minE, u.easting);
        maxE = Math.max(maxE, u.easting);
        minN = Math.min(minN, u.northing);
        maxN = Math.max(maxN, u.northing);
      }
    }
    if ((maxE - minE) / step + (maxN - minN) / step > max - lines.length) { truncated = true; continue; }
    const geo = (easting, northing) => {
      const p = fromUtm({ zone, north, easting, northing });
      // Keep the longitude next to the box (boxes may reach past the date line).
      return [p.lon + Math.round((w - p.lon) / 360) * 360, p.lat];
    };
    const samples = (from, to) => {
      const count = Math.min(64, Math.max(2, Math.ceil((to - from) / 20000) + 1));
      return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
    };
    const kind = (v) => (v % 100000 === 0 && step < 100000 ? 'square' : 'line');
    const label = (v) => String(Math.floor((v % 100000) / Math.min(1000, step))).padStart(step < 1000 ? 3 : 2, '0');
    for (let v = Math.ceil(minE / step) * step; v <= maxE; v += step) {
      for (const coords of clip(samples(minN - step, maxN + step).map((y) => geo(v, y)), box)) {
        lines.push({ kind: kind(v), axis: 'e', value: v, zone, north, coords });
        if (step < 100000) labels.push({ kind: 'e', text: label(v), at: coords[0][1] < coords.at(-1)[1] ? coords[0] : coords.at(-1) });
      }
    }
    for (let v = Math.ceil(minN / step) * step; v <= maxN; v += step) {
      for (const coords of clip(samples(minE - step, maxE + step).map((x) => geo(x, v)), box)) {
        lines.push({ kind: kind(v), axis: 'n', value: v, zone, north, coords });
        if (step < 100000) labels.push({ kind: 'n', text: label(v), at: coords[0][0] < coords.at(-1)[0] ? coords[0] : coords.at(-1) });
      }
    }
    // Names of the 100 km squares, in the middle of the part that is visible.
    if (step >= 10000) {
      for (let x = Math.floor(minE / 100000) * 100000; x < maxE; x += 100000) {
        for (let y = Math.floor(minN / 100000) * 100000; y < maxN; y += 100000) {
          const inside = [];
          for (let i = 0.05; i < 1; i += 0.1) {
            for (let j = 0.05; j < 1; j += 0.1) {
              const p = geo(x + i * 100000, y + j * 100000);
              if (p[0] > w && p[0] < e && p[1] > s && p[1] < t) inside.push(p);
            }
          }
          const id = squareId(zone, x, y);
          if (id && inside.length > 2) {
            const mean = (k) => inside.reduce((sum, p) => sum + p[k], 0) / inside.length;
            labels.push({ kind: 'square', text: id, at: [mean(0), mean(1)] });
          }
        }
      }
    }
  }
  return { lines, labels, truncated };
}
