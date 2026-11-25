// MGRS and UTM against reference values calculated with pyproj (PROJ) and the Python "mgrs" package (GeoTrans).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toUtm, fromUtm, toMgrs, fromMgrs, zoneOf, gridLines, gridStep } from '../public/mgrs.js';

// name, latitude, longitude, MGRS (1 m), zone, easting, northing
const REFERENCE = [
  ['Budapest', 47.4979, 19.0402, '34T CT 52397 62357', 34, 352397.326, 5262357.796],
  ['nyugati határ', 47.2, 16.45, '33T XN 09824 28409', 33, 609824.167, 5228409.526],
  ['Bergen (32V)', 60.39, 5.32, '32V KN 97230 00510', 32, 297230.22, 6700510.175],
  ['Svalbard (33X)', 78.22, 15.65, '33X WG 14813 83004', 33, 514813.527, 8683004.153],
  ['Fokváros (dél)', -33.92, 18.42, '34H BH 61488 43716', 34, 261488.826, 6243716.333],
  ['Quito (egyenlítő)', -0.18, -78.47, '17M QV 81616 80085', 17, 781616.424, 9980085.048],
  ['dátumvonal', -17.0, 179.99, '60K ZG 18385 18014', 60, 818385.906, 8118014.492],
  ['magas szélesség', 83.5, -40.0, '24X VT 87362 72385', 24, 487362.111, 9272385.451],
  ['déli határ', -79.5, 100.0, '47C NM 20343 74046', 47, 520343.228, 1174046.407],
];

test('MGRS and UTM agree with the reference libraries', () => {
  for (const [name, lat, lon, reference, zone, easting, northing] of REFERENCE) {
    assert.equal(toMgrs(lat, lon, 5), reference, name);
    const utm = toUtm(lat, lon);
    assert.equal(utm.zone, zone, name);
    assert.ok(Math.hypot(utm.easting - easting, utm.northing - northing) < 0.002, `${name}: ${utm.easting} ${utm.northing}`);
    const back = fromUtm(utm);
    assert.ok(Math.abs(back.lat - lat) < 1e-8 && Math.abs(back.lon - lon) < 1e-7, name);
  }
});

test('a reference is read back to a square that holds the point, at every precision', () => {
  for (const [name, lat, lon] of REFERENCE) {
    const utm = toUtm(lat, lon);
    for (let digits = 0; digits <= 5; digits += 1) {
      const read = fromMgrs(toMgrs(lat, lon, digits));
      assert.ok(read, `${name} ${digits}`);
      assert.equal(read.size, 10 ** (5 - digits));
      assert.ok(utm.easting >= read.utm.easting && utm.easting < read.utm.easting + read.size, `${name} ${digits} easting`);
      assert.ok(utm.northing >= read.utm.northing - 1e-6 && utm.northing < read.utm.northing + read.size, `${name} ${digits} northing`);
    }
  }
});

test('text that is not a reference is refused', () => {
  for (const bad of ['', 'abc', '34T', '34T CT 123 45', '61T CT 12345 67890', '34I CT 12345 67890', '32X MH 12345 67890', '34T CT 12345 678901', '34T AA 12345 67890', '47.5, 19.0']) {
    assert.equal(fromMgrs(bad), null, bad);
  }
  assert.equal(toMgrs(85, 0), null);
  assert.equal(toMgrs(-81, 0), null);
  assert.throws(() => toUtm(Number.NaN, 0), RangeError);
});

test('the Norwegian and Svalbard zone exceptions', () => {
  assert.equal(zoneOf(60, 4), 32);
  assert.equal(zoneOf(60, 2), 31);
  assert.equal(zoneOf(75, 8), 31);
  assert.equal(zoneOf(75, 10), 33);
  assert.equal(zoneOf(47.5, 19), 34);
});

test('grid lines run on whole grid values and stay inside the box', () => {
  const box = [17.8, 46.9, 18.3, 47.3]; // crosses the 33/34 zone border at 18° E
  const grid = gridLines(box, 10000);
  assert.ok(grid.lines.filter((l) => l.kind === 'line' || l.kind === 'square').length > 6);
  assert.ok(grid.lines.some((l) => l.kind === 'zone'));
  assert.deepEqual([...new Set(grid.lines.map((l) => l.zone).filter(Boolean))].sort(), [33, 34]);
  for (const line of grid.lines) {
    for (const [lon, lat] of line.coords) assert.ok(lon >= box[0] - 1e-7 && lon <= box[2] + 1e-7 && lat >= box[1] - 1e-7 && lat <= box[3] + 1e-7);
    for (const [lon, lat] of line.coords.slice(1, -1)) {
      if (line.kind === 'zone') continue;
      const utm = toUtm(lat, lon, line.zone, line.north);
      assert.ok(Math.abs((line.axis === 'e' ? utm.easting : utm.northing) - line.value) < 0.01);
    }
  }
  assert.ok(grid.labels.some((l) => l.kind === 'square' && /^[A-Z]{2}$/.test(l.text)));
});

test('the grid spacing follows the screen, and too large requests are cut off', () => {
  assert.equal(gridStep(3000, 1000), null);
  assert.equal(gridStep(800, 390), 100000);
  assert.equal(gridStep(100, 1000), 10000);
  assert.equal(gridStep(30, 1000), 1000);
  assert.equal(gridStep(1, 1000), 100);
  assert.equal(gridLines([16, 45, 24, 49], 1000, 100).truncated, true);
});
