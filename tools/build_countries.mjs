// Rebuilds public/data/countries.geojson (offline outlines of the globe page).
// Source: Natural Earth 1:50m (public domain), packaged as world-atlas (ISC).
// Usage: npm install --no-save world-atlas@2.0.2 topojson-client@3 && node tools/build_countries.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/`);
const { feature } = require('topojson-client');
const topology = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json')));
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000] : c.map(round));
const features = feature(topology, topology.objects.countries).features
  .filter((f) => f.geometry)
  .map((f) => ({ type: 'Feature', properties: { name: f.properties.name }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } }));
writeFileSync(new URL('../public/data/countries.geojson', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`${features.length} countries written`);
