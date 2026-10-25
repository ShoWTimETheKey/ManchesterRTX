// Refresh only the GUI's display text in Assets/manchester.app.json - names and captions of the weathers, viewpoints
// and featured towers, in Chinese and English (gui-text.mjs) - without re-exporting the city:
//   tools\node\node.exe exporter\app-text.mjs                       with the local overrides (exporter/data/personal.json)
//   tools\node\node.exe exporter\app-text.mjs --public --out <file>  without them, written elsewhere (the published release)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { guiText } from './gui-text.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pub = args.includes('--public');
const src = path.join(here, '..', 'renderer', 'Assets', 'manchester.app.json');
const out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : src;
const T = guiText({ personal: !pub });

// app.json files written before the views carried an id are matched by their camera name
const ID_OF_KEY = { 'Overview': 'overview', 'River Street & Acer towers': 'towers',
  'Town Hall & Albert Square': 'townhall', 'Deansgate skyline': 'deansgate', 'Castlefield viaducts': 'castlefield',
  'University Old Quad': 'university', 'Street level, Oxford Road': 'oxfordroad', 'Etihad Stadium': 'etihad' };

const app = JSON.parse(fs.readFileSync(src, 'utf8'));
let n = 0;
app.weathers = app.weathers.map(w => {
  const t = T.weathers[w.id]; if (!t) return w; n++;
  const { name, desc, en, icon, ...rest } = w;
  return { id: w.id, name: t.name, desc: t.desc, en: t.en, icon: t.icon, ...rest };
});
app.views = app.views.map(v => {
  const id = v.id || ID_OF_KEY[v.key], t = T.views[id]; if (!t) return v; n++;
  const { key, name, desc, en, ...rest } = v;
  return { key, id, name: t.name, desc: t.desc, en: t.en, ...rest };
});
app.towers = app.towers.map((h, i) => (T.towers.items[i] ? { ...h, ...T.towers.items[i] } : h));
const { towers, towersText, ...head } = app;
const result = { ...head, towersText: { title: T.towers.title, pins: T.towers.pins, en: T.towers.en }, towers };
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${n} entries and the featured towers written to ${path.relative(process.cwd(), out)}${pub ? ' (public text)' : ''}`);
