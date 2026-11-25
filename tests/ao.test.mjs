// Area of operations: validation, size, typed positions and the flat picture of the command post.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArea, checkArea, parsePosition, sortAround, nextName, layout, boundsOf, MAX_POINTS, tileTemplate } from '../public/ao.js';

const points = (list) => list.map(([lat, lon], i) => ({ name: `TP${i + 1}`, lat, lon }));
const area = (list) => ({ version: 1, name: 'Próba', points: points(list) });
const SQUARE = [[47.0, 18.0], [47.0, 18.2], [47.1, 18.2], [47.1, 18.0]];

test('only well-formed areas are accepted, and they are copied', () => {
  const copy = parseArea(JSON.stringify({ ...area(SQUARE), extra: '<script>' }));
  assert.deepEqual(Object.keys(copy), ['version', 'name', 'points']);
  assert.equal(copy.points.length, 4);
  assert.equal(parseArea({ version: 1, points: [{ lat: 1, lon: 2 }] }).points[0].name, 'TP1');
  for (const bad of [{}, { version: 2, points: [] }, { version: 1, points: [{ lat: '47', lon: 18 }] }, { version: 1, points: [{ lat: 90, lon: 0 }] }, { version: 1, points: [{ lat: 0, lon: 181 }] }, area(Array(MAX_POINTS + 1).fill([1, 1]))]) {
    assert.throws(() => parseArea(bad));
  }
  assert.throws(() => parseArea('{nem json'), SyntaxError);
});

test('size, self-intersection and limits', () => {
  const ok = checkArea(area(SQUARE));
  assert.ok(ok.ok);
  // 0.2° of longitude at 47.05° N is 15.2 km, 0.1° of latitude 11.1 km.
  assert.ok(Math.abs(ok.km2 - 169) < 2, String(ok.km2));
  assert.equal(checkArea(area(SQUARE.slice(0, 2))).ok, false);
  assert.match(checkArea(area([SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]])).why, /metszi/);
  assert.match(checkArea(area([[40, 10], [40, 30], [50, 20]])).why, /túl nagy/);
  assert.equal(checkArea(area([[47, 18], [47, 18], [47, 18]])).ok, false);
  assert.ok(checkArea({ ...area([]), points: sortAround(points([SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]])) }).ok);
});

test('an area across the date line stays one piece', () => {
  const a = area([[-17, 179.9], [-17, -179.9], [-17.1, -179.9], [-17.1, 179.9]]);
  const box = boundsOf(a.points);
  assert.ok(box[2] - box[0] < 0.3);
  assert.ok(checkArea(a).ok);
  assert.ok(layout(a).tiles.every((t) => !t.url.includes('/-')));
});

test('typed positions', () => {
  for (const [input, lat, lon] of [['47.5, 19.05', 47.5, 19.05], ['47.5,19.05', 47.5, 19.05], ['47,5 19,05', 47.5, 19.05], ['47,5; 19,05', 47.5, 19.05], ['-33.9 18.4', -33.9, 18.4], ['47.5° 19.05°', 47.5, 19.05]]) {
    assert.deepEqual(parsePosition(input), { lat, lon }, input);
  }
  const grid = parsePosition('34t ct 53000 62000');
  assert.ok(Math.abs(grid.lat - 47.5) < 0.6 && Math.abs(grid.lon - 19) < 1.2);
  for (const bad of ['', 'Budapest', '95, 19', '47.5', '47.5, 200', '1, 2, 3']) assert.equal(parsePosition(bad), null, bad);
});

test('default names do not repeat', () => {
  assert.equal(nextName([]), 'TP1');
  assert.equal(nextName([{ name: 'TP2' }]), 'TP3');
});

test('the flat picture holds the area, a grid and a limited number of tiles', () => {
  const a = area(SQUARE);
  const picture = layout(a, 1000, 700, 0.04);
  for (const p of picture.outline) assert.ok(p.at[0] >= 39 && p.at[0] <= 961 && p.at[1] >= 27 && p.at[1] <= 673, String(p.at));
  const [x, y] = picture.project(18.1, 47.05);
  const back = picture.unproject(x, y);
  assert.ok(Math.abs(back.lon - 18.1) < 1e-9 && Math.abs(back.lat - 47.05) < 1e-9);
  assert.ok(picture.tiles.length > 0 && picture.tiles.length <= 96);
  assert.ok(picture.tiles.every((t) => t.url.startsWith(tileTemplate.split('{z}')[0])));
  // The tiles cover the whole picture.
  assert.ok(Math.min(...picture.tiles.map((t) => t.x)) <= 0 && Math.max(...picture.tiles.map((t) => t.x + t.size)) >= 1000);
  assert.ok(Math.min(...picture.tiles.map((t) => t.y)) <= 0 && Math.max(...picture.tiles.map((t) => t.y + t.size)) >= 700);
  assert.ok(picture.grid.lines.length > 4);
  assert.ok(Math.abs(picture.kmPerUnit * (picture.project(18.2, 47.05)[0] - picture.project(18.0, 47.05)[0]) - 15.2) < 0.2);
});
