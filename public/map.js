// The map as SVG, with pan, pinch zoom and tappable features. The ground is either the fictitious
// terrain (no external requests) or a chosen real area with its MGRS grid and optional satellite tiles.
import { TERRAIN, UNITS } from './scenario.js';
import { layout } from './ao.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 700;

function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}
const text = (value, attrs) => { const t = s('text', attrs); t.textContent = value; return t; };
const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
const RIVER = [[372, 0], [356, 80], [362, 165], [340, 245], [350, 315], [343, 425], [374, 515], [360, 610], [382, 700]];
const smooth = (p) => p.slice(1, -1).reduce((d, c, i) => {
  const n = p[i + 2];
  return `${d} Q${c[0]},${c[1]} ${(c[0] + n[0]) / 2},${(c[1] + n[1]) / 2}`;
}, `M${p[0][0]},${p[0][1]}`) + ` L${p.at(-1)[0]},${p.at(-1)[1]}`;

function terrain() {
  const g = s('g', { class: 'terrain' });
  g.append(s('rect', { x: -1000, y: -1000, width: 3000, height: 2700, class: 'ground' }));
  g.append(s('rect', { x: 0, y: 372, width: W, height: 328, class: 'lowland' }));
  const grid = s('g', { class: 'grid' });
  for (let x = 0; x <= W; x += 100) grid.append(s('path', { d: `M${x},0 V${H}` }), text(String(x / 10).padStart(2, '0'), { x: x + 3, y: 12 }));
  for (let y = 0; y <= H; y += 100) grid.append(s('path', { d: `M0,${y} H${W}` }));
  // Hills (north): nested contour rings.
  for (const [cx, cy, rx, ry] of [[105, 85, 95, 55], [245, 262, 55, 38], [520, 75, 120, 58], [730, 280, 100, 64], [190, 40, 70, 30], [850, 90, 90, 50]]) {
    for (const f of [1, 0.66, 0.34]) g.append(s('ellipse', { cx, cy, rx: rx * f, ry: ry * f, class: 'contour' }));
  }
  for (const [cx, cy, rx, ry] of [[80, 190, 48, 30], [240, 100, 52, 28], [430, 235, 44, 34], [610, 120, 70, 36], [150, 345, 60, 22], [790, 190, 55, 30], [650, 255, 36, 24]]) {
    g.append(s('ellipse', { cx, cy, rx, ry, class: 'forest' }));
  }
  for (let x = 40; x < W; x += 62) {
    for (let y = 398; y < H - 20; y += 48) {
      const dx = (y % 96 ? 24 : 0) + x;
      g.append(s('path', { d: `M${dx},${y} h16 M${dx + 4},${y} v-6 M${dx + 9},${y} v-9 M${dx + 13},${y} v-6`, class: 'marsh' }));
    }
  }
  g.append(grid);
  g.append(s('path', { d: smooth(RIVER), class: 'river-bank' }), s('path', { d: smooth(RIVER), class: 'river' }));
  g.append(text('Kék-folyó', { x: 384, y: 60, class: 'water-name' }));
  g.append(s('path', { d: 'M0,190 L200,182 L330,165 L390,165 L600,148 L1000,205', class: 'road' }));
  g.append(s('path', { d: 'M165,290 L170,182 M165,290 L215,400 L200,520 L0,560', class: 'road minor' }));
  g.append(s('path', { d: 'M0,505 L355,470 M370,470 L700,540 L1000,520', class: 'road weak' }));
  g.append(text('északi körzet', { x: 185, y: 362, class: 'area-name' }), text('déli, vizenyős terület', { x: 150, y: 394, class: 'area-name' }));
  return g;
}

/** A real area of operations: tiles (if allowed), MGRS grid, outline and its terrain points. */
function realTerrain(picture, imagery) {
  const g = s('g', { class: 'terrain real' });
  g.append(s('rect', { x: -3000, y: -3000, width: 7000, height: 6700, class: 'ground' }));
  if (imagery) {
    // Half a unit of overlap hides the seams between the tiles.
    for (const t of picture.tiles) g.append(s('image', { href: t.url, x: t.x, y: t.y, width: t.size + 0.5, height: t.size + 0.5, preserveAspectRatio: 'none', class: 'tile' }));
  }
  for (const l of picture.grid.lines) g.append(s('path', { d: line(l.path), class: `mgrs-line ${l.kind}` }));
  g.append(s('path', { d: `${line(picture.outline.map((p) => p.at))} Z`, class: 'ao-outline' }));
  for (const l of picture.grid.labels) {
    if (l.kind === 'square') g.append(s('g', { 'data-x': l.xy[0], 'data-y': l.xy[1] }, text(l.text, { class: 'mgrs-square' })));
  }
  for (const p of picture.outline) {
    g.append(s('g', { 'data-x': p.at[0], 'data-y': p.at[1], class: 'ao-point' }, s('circle', { r: 3.5 }), text(p.name, { x: 6, y: -6 })));
  }
  return g;
}

/** Where a nearly straight line crosses x (axis 0) or y (axis 1) = value; null if it does not. */
function crossing(path, axis, value) {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if ((a[axis] - value) * (b[axis] - value) <= 0 && a[axis] !== b[axis]) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      return a[1 - axis] + t * (b[1 - axis] - a[1 - axis]);
    }
  }
  return null;
}

function friendlySymbol(unit, ghost) {
  const g = s('g', { class: `sym friend${ghost ? ' ghost' : ''}` });
  g.append(s('rect', { x: -16, y: -11, width: 32, height: 22, class: 'frame' }));
  const k = unit.kind;
  if (k === 'mech') g.append(s('path', { d: 'M-16,-11 L16,11 M-16,11 L16,-11' }), s('rect', { x: -10, y: -5.5, width: 20, height: 11, rx: 5.5 }));
  if (k === 'armor') g.append(s('rect', { x: -10, y: -5.5, width: 20, height: 11, rx: 5.5 }));
  if (k === 'art') g.append(s('circle', { r: 4.5, class: 'dot' }));
  if (k === 'eng') g.append(s('path', { d: 'M-9,5 V-4 H9 V5 M0,-4 V4' }));
  if (k === 'log') g.append(s('path', { d: 'M-16,5 H16' }));
  if (k === 'hq') g.append(s('path', { d: 'M-16,11 V27' }), text('HQ', { y: 4, class: 'in' }));
  if (unit.size) g.append(text(unit.size, { y: -15, class: 'size' }));
  g.append(text(unit.label, { y: k === 'hq' ? 24 : 23, x: k === 'hq' ? 6 : 0, class: 'label' }));
  return g;
}

function hostileSymbol(e) {
  const g = s('g', { class: `sym hostile${e.unknown ? ' unknown' : ''}` });
  g.append(s('path', { d: 'M0,-18 L18,0 L0,18 L-18,0 Z', class: 'frame' }));
  if (e.unknown) g.append(text('?', { y: 5, class: 'in' }));
  else if (e.id === 'E2') g.append(s('path', { d: 'M-8,-3 H8 M-8,3 H8' }));
  else g.append(s('path', { d: 'M-8,-6 L8,6 M-8,6 L8,-6' }), s('rect', { x: -9, y: -4.5, width: 18, height: 9, rx: 4.5 }));
  g.append(text(e.label, { y: 31, class: 'label' }));
  return g;
}

const incidentSymbol = (inc) => s('g', { class: `incident sev-${inc.severity}` },
  s('circle', { r: 20, class: 'pulse' }),
  s('path', { d: 'M0,-14 L15,12 H-15 Z', class: 'frame' }),
  s('path', { d: 'M0,-5 V3 M0,6.5 V8', class: 'mark' }));

export function createMap(host, { onSelect }) {
  const svg = s('svg', { class: 'mapsvg', role: 'group', 'aria-label': 'Fiktív gyakorló terep vázlata' });
  svg.append(s('defs', {},
    ...['1', '2', '3', 'adj'].map((n) => s('marker', { id: `head-${n}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4.5, markerHeight: 4.5, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 Z', class: `head coa${n}` }))),
    s('marker', { id: 'head-red', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4.5, markerHeight: 4.5, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 Z', class: 'head red' }))));
  const layers = {};
  let ground = terrain();
  let real = null; // the layout of a real area, if one is shown
  svg.append(ground);
  const edgeLabels = s('g', { class: 'layer-edge' });
  svg.append(edgeLabels);
  for (const id of ['plan', 'enemyplan', 'arrows', 'points', 'ghosts', 'units', 'enemy', 'incidents', 'ping']) {
    layers[id] = s('g', { class: `layer-${id}` });
    svg.append(layers[id]);
  }
  host.append(svg);

  const view = { x: 0, y: 0, w: W, h: H };
  let scale = 1; // map units per screen pixel
  let picking = null;
  const places = new Map(); // ref -> [x, y]

  const size = () => ({ w: host.clientWidth || 600, h: host.clientHeight || 400 });

  function place(node) {
    const x = Number(node.dataset.x);
    const y = Number(node.dataset.y);
    node.style.transform = `translate(${x}px, ${y}px) scale(${scale * Number(node.dataset.s || 1)})`;
  }
  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const px = size().w;
    scale = view.w / px;
    // Symbols keep a readable on-screen size at any zoom.
    scale *= px < 560 ? 0.82 : 1;
    svg.style.setProperty('--u', String(view.w / px));
    for (const n of svg.querySelectorAll('[data-x]')) place(n);
    labelGrid();
    // The fictitious terrain has 10 units to the kilometre.
    host.dispatchEvent(new CustomEvent('mapview', { detail: { pxPerKm: px / view.w / (real ? real.kmPerUnit : 0.1), real: Boolean(real) } }));
  }
  /** Grid numbers stay along the lower and the left edge of the picture. */
  function labelGrid() {
    edgeLabels.replaceChildren();
    if (!real || real.step >= 100000) return;
    const unit = view.w / size().w; // map units per screen pixel
    const bottom = view.y + view.h - 78 * unit;
    const left = view.x + 14 * unit;
    const used = { e: [], n: [] };
    for (const l of real.grid.lines) {
      if (!l.axis) continue;
      const along = l.axis === 'e' ? 0 : 1;
      const at = crossing(l.path, 1 - along, along === 0 ? bottom : left);
      if (at === null || at < (along === 0 ? view.x + 36 * unit : view.y + 28 * unit) || at > (along === 0 ? view.x + view.w - 52 * unit : view.y + view.h - 96 * unit)) continue;
      if (used[l.axis].some((v) => Math.abs(v - at) < 24 * unit)) continue;
      used[l.axis].push(at);
      const x = along === 0 ? at : left;
      const y = along === 0 ? bottom : at;
      const value = String(Math.floor((l.value % 100000) / Math.min(1000, real.step))).padStart(real.step < 1000 ? 3 : 2, '0');
      const node = s('g', { 'data-x': x, 'data-y': y }, text(value, { class: 'mgrs-number', y: 4 }));
      edgeLabels.append(node);
      place(node);
    }
  }
  function fit([x0, y0, x1, y1]) {
    const { w, h } = size();
    const ratio = w / h;
    let bw = x1 - x0;
    let bh = y1 - y0;
    if (bw / bh < ratio) bw = bh * ratio; else bh = bw / ratio;
    Object.assign(view, { x: (x0 + x1) / 2 - bw / 2, y: (y0 + y1) / 2 - bh / 2, w: bw, h: bh });
    apply();
  }
  const home = () => {
    if (!real) return fit(size().w < 700 ? [25, 50, 560, 560] : [10, 20, 990, 680]);
    // The whole area and the whole schematic picture.
    const xs = real.outline.map((p) => p.at[0]);
    const ys = real.outline.map((p) => p.at[1]);
    return fit([Math.min(20, ...xs), Math.min(20, ...ys), Math.max(980, ...xs), Math.max(680, ...ys)]);
  };
  let shownArea = '';
  /** Shows a real area (or, with null, the fictitious terrain) under the schematic symbols. */
  function setArea(area, { imagery = false } = {}) {
    const key = area ? JSON.stringify([area, imagery]) : '';
    if (key === shownArea) return real;
    const moved = JSON.stringify(area) !== JSON.stringify(real?.area ?? null);
    shownArea = key;
    real = area ? { ...layout(area, W, H, 0.04), area } : null;
    const next = real ? realTerrain(real, imagery) : terrain();
    svg.replaceChild(next, ground);
    ground = next;
    svg.setAttribute('aria-label', real ? `${area.name}: valós terep MGRS-ráccsal, vázlatosan elhelyezett jelekkel` : 'Fiktív gyakorló terep vázlata');
    if (moved && host.clientWidth) home(); else apply();
    return real;
  }
  /** Fits a box into the part of the panel that is not covered at the bottom. */
  function frame([x0, y0, x1, y1], inset = 0) {
    const { w, h } = size();
    const free = Math.max(80, h - inset);
    const k = Math.max((x1 - x0) / w, (y1 - y0) / free); // map units per pixel
    Object.assign(view, { x: (x0 + x1) / 2 - (w * k) / 2, y: (y0 + y1) / 2 - (free * k) / 2, w: w * k, h: h * k });
    apply();
  }

  function toMap(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return [view.x + ((clientX - r.left) / r.width) * view.w, view.y + ((clientY - r.top) / r.height) * view.h];
  }
  function zoom(factor, around) {
    const [cx, cy] = around || [view.x + view.w / 2, view.y + view.h / 2];
    const w = Math.min(1900, Math.max(130, view.w * factor));
    const f = w / view.w;
    Object.assign(view, { x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f, w, h: view.h * f });
    apply();
  }

  // Pointer gestures: one finger pans, two fingers zoom, a still tap selects.
  const pointers = new Map();
  let tap = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, target: e.target } : null;
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = [e.clientX, e.clientY];
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 7) tap = null;
    svg.classList.add('moving');
    if (pointers.size === 1 && !tap) {
      const k = view.w / size().w;
      view.x -= (now[0] - prev[0]) * k;
      view.y -= (now[1] - prev[1]) * k;
      apply();
    } else if (pointers.size === 2) {
      const other = [...pointers].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const after = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (before > 0 && after > 0) zoom(before / after, toMap((now[0] + other[0]) / 2, (now[1] + other[1]) / 2));
    }
    pointers.set(e.pointerId, now);
  });
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (!pointers.size) svg.classList.remove('moving');
    if (e.type !== 'pointerup' || !tap) return;
    if (picking) {
      const cb = picking;
      picking = null;
      host.classList.remove('picking');
      const [x, y] = toMap(e.clientX, e.clientY);
      cb([Math.round(Math.min(W - 10, Math.max(10, x))), Math.round(Math.min(H - 10, Math.max(10, y)))]);
    } else {
      onSelect(tap.target.closest('[data-ref]')?.dataset.ref || null);
    }
    tap = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, toMap(e.clientX, e.clientY)); }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    const ref = e.target.closest('[data-ref]')?.dataset.ref;
    if (ref && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(ref); }
  });

  /** Keyed marker that survives re-rendering, so moves are animated. */
  const markers = new Map();
  function marker(layer, key, at, ref, label, build, signature, s_) {
    let m = markers.get(key);
    if (!m) {
      m = s('g', { class: 'marker', tabindex: 0, role: 'button' });
      layers[layer].append(m);
      markers.set(key, m);
    }
    if (m.dataset.sig !== signature) {
      m.replaceChildren(s('circle', { r: 22, class: 'hit' }), build());
      m.dataset.sig = signature;
    }
    Object.assign(m.dataset, { x: at[0], y: at[1], ref, s: s_ || 1 });
    m.setAttribute('aria-label', label);
    place(m);
    places.set(ref, at);
    return key;
  }
  const point = (at, ref, ...nodes) => {
    const g = s('g', { 'data-x': at[0], 'data-y': at[1], 'data-ref': ref, tabindex: 0, role: 'button', 'aria-label': ref, class: 'marker' }, s('circle', { r: 20, class: 'hit' }), ...nodes);
    layers.points.append(g);
    places.set(ref, at);
    place(g);
  };

  function render(model, visible) {
    const live = new Set();
    places.clear();
    layers.plan.replaceChildren();
    layers.enemyplan.replaceChildren();
    layers.arrows.replaceChildren();
    layers.points.replaceChildren();

    // Boundaries of the exercise lane are known from the higher order.
    layers.plan.append(s('path', { d: 'M30,28 H700 M30,672 H700', class: 'boundary' }), text('ZÖLD sáv', { x: 40, y: 46, class: 'lane-name' }));
    places.set('LANE', [200, 200]);
    if (model.plan && visible.plan) {
      layers.plan.append(
        s('path', { d: 'M30,372 H356', class: 'boundary inner' }),
        s('path', { d: 'M240,40 C 225,200 260,300 238,372', class: 'phase' }), text('SÁRGA', { x: 208, y: 66, class: 'phase-name' }),
        s('path', { d: 'M565,25 C 540,200 590,330 555,520', class: 'phase' }), text('BARNA', { x: 572, y: 38, class: 'phase-name' }),
        s('ellipse', { cx: 305, cy: 148, rx: 44, ry: 36, class: 'position' }), s('ellipse', { cx: 298, cy: 305, rx: 44, ry: 40, class: 'position' }));
    }
    for (const [id, c] of Object.entries(model.crossings)) {
      point(c.at, id,
        s('path', { d: id === 'ALFA' ? 'M-13,-5 H13 M-13,5 H13 M-13,-5 l-5,-4 M-13,5 l-5,4 M13,-5 l5,-4 M13,5 l5,4' : 'M-13,0 H13', class: `crossing${id === 'BRAVO' ? ' ford' : ''}${model.keyTerrain ? ' key' : ''}` }),
        text(id, { y: -13, class: 'crossing-name' }));
    }
    if (model.avenues && visible.enemy) {
      for (const [id, pts] of Object.entries(TERRAIN.avenues)) {
        layers.enemyplan.append(s('path', { d: line(pts), class: `avenue${id === 'AA3' ? ' weak' : ''}`, 'marker-end': 'url(#head-red)' }));
        point(pts[1], id, text(id.replace('AA', 'MI-'), { y: -8, class: 'avenue-name' }));
      }
    }
    if (model.nai && visible.plan) {
      for (const [id, [x, y, r]] of Object.entries(TERRAIN.nai)) {
        layers.enemyplan.append(s('circle', { cx: x, cy: y, r, class: 'nai' }));
        point([x, y - r], id, text(id.replace('NAI', 'NAI '), { y: -4, class: 'nai-name' }));
      }
    }
    if (model.dps && visible.plan) {
      for (const [id, at] of Object.entries(TERRAIN.dps)) {
        point(at, id, s('path', { d: 'M0,-10 L3,-3 L10,-3 L4.5,2 L7,9 L0,4.5 L-7,9 L-4.5,2 L-10,-3 L-3,-3 Z', class: 'dp' }), text(id.replace('DP', 'DP '), { y: 22, class: 'dp-name' }));
      }
    }
    if (visible.plan) {
      for (const a of model.arrows) {
        const [x0, y0] = a.from;
        const [x1, y1] = a.to;
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const bend = (a.coa - 2) * 22;
        const mx = (x0 + x1) / 2 - ((y1 - y0) / len) * bend;
        const my = (y0 + y1) / 2 + ((x1 - x0) / len) * bend;
        const ex = x1 - ((x1 - mx) / (Math.hypot(x1 - mx, y1 - my) || 1)) * 20;
        const ey = y1 - ((y1 - my) / (Math.hypot(x1 - mx, y1 - my) || 1)) * 20;
        const kind = a.adjusted ? 'adj' : a.coa;
        layers.arrows.append(s('path', { d: `M${x0},${y0} Q${mx},${my} ${ex},${ey}`, class: `coa-arrow coa${kind}${a.solid ? ' solid' : ''}`, 'marker-end': `url(#head-${kind})` }));
      }
    }
    if (visible.units) {
      for (const [id, at] of Object.entries(model.ghosts)) {
        live.add(marker('ghosts', `g-${id}`, at, id, `${UNITS[id].label} tervezett helye`, () => friendlySymbol(UNITS[id], true), `ghost-${id}`, 0.9));
      }
      for (const [id, at] of Object.entries(model.units)) {
        live.add(marker('units', `u-${id}`, at, id, UNITS[id].name || UNITS[id].label, () => friendlySymbol(UNITS[id]), `unit-${id}`));
      }
    }
    if (visible.enemy) {
      for (const e of model.enemy) {
        const ref = e.id === 'E1' ? 'ENEMY' : e.id;
        live.add(marker('enemy', `h-${e.id}`, e.at, ref, e.label, () => hostileSymbol(e), `${e.id}-${e.label}`));
      }
    }
    if (visible.incidents) {
      for (const inc of model.incidents) {
        live.add(marker('incidents', `i-${inc.id}`, inc.at, `inc:${inc.id}`, inc.title, () => incidentSymbol(inc), `${inc.id}-${inc.severity}`));
      }
    }
    for (const [key, m] of markers) if (!live.has(key)) { m.remove(); markers.delete(key); }
  }

  /**
   * Flashes a feature and brings it into view. With `gentle` the zoom is kept and the map only
   * moves if the feature is outside the picture. Returns false if the feature is not on the map now.
   */
  function focus(ref, { gentle = false } = {}) {
    const at = ref === 'COA' ? [250, 250] : places.get(ref);
    if (!at) return false;
    const inside = at[0] > view.x + view.w * 0.08 && at[0] < view.x + view.w * 0.88 && at[1] > view.y + view.h * 0.1 && at[1] < view.y + view.h * 0.86;
    if (!gentle) {
      const w = Math.min(view.w, size().w < 700 ? 520 : 760);
      const f = w / view.w;
      Object.assign(view, { w, h: view.h * f });
    }
    if (!gentle || !inside) Object.assign(view, { x: at[0] - view.w / 2, y: at[1] - view.h / 2 });
    apply();
    const ring = s('g', { 'data-x': at[0], 'data-y': at[1], class: 'pinger' }, s('circle', { r: 26 }));
    layers.ping.replaceChildren(ring);
    place(ring);
    setTimeout(() => ring.remove(), 2600);
    return true;
  }

  let last = '';
  new ResizeObserver(() => {
    const key = `${host.clientWidth}x${host.clientHeight}`;
    if (key === last || !host.clientWidth || !host.clientHeight) return;
    const first = !last;
    const widthChanged = first || last.split('x')[0] !== String(host.clientWidth);
    last = key;
    if (widthChanged) home();
    else fit([view.x, view.y, view.x + view.w, view.y + view.h]);
  }).observe(host);

  return {
    render, focus, home, frame, zoom, setArea,
    pick(cb) { picking = cb; host.classList.add('picking'); },
    cancelPick() { picking = null; host.classList.remove('picking'); },
  };
}
