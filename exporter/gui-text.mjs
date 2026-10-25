// The GUI's display text for Assets/manchester.app.json, in Chinese (the top-level fields) and English (under "en"):
// the weathers, the viewpoints and the two featured towers. Shared by export2.mjs (full export) and app-text.mjs (text
// only). A git-ignored exporter/data/personal.json can override any of it locally; it is skipped with { personal: false }
// (the published release). Its shape mirrors the tables below, e.g.
//   { "views": { "towers": { "name": "...", "en": { "name": "..." } } },
//     "towers": { "title": "...", "pins": "...", "en": { "title": "...", "pins": "..." }, "items": [ { "addr": "..." }, { "addr": "..." } ] } }
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// times of day and weathers, by id
const WEATHERS = {
  day:    { name: '正午', desc: '高悬的太阳 · 云影掠过',        icon: 'noon',      en: { name: 'Noon',      desc: 'High sun · drifting cloud shadows' } },
  clear:  { name: '午后', desc: '低斜阳光 · 长影与光束',        icon: 'afternoon', en: { name: 'Afternoon', desc: 'Low sun · long shadows and light shafts' } },
  cloudy: { name: '多云', desc: '云层低垂 · 柔和漫射光',        icon: 'cloudy',    en: { name: 'Overcast',  desc: 'Low cloud · soft diffuse light' } },
  dusk:   { name: '黄昏', desc: '金色时刻 · 华灯初上',          icon: 'dusk',      en: { name: 'Dusk',      desc: 'Golden hour · the lights come on' } },
  night:  { name: '夜晚', desc: '窗灯 · 路灯 · 星空与月光',      icon: 'night',     en: { name: 'Night',     desc: 'Windows · street lights · stars and moonlight' } },
};

// viewpoints, by the id export2.mjs gives each camera
const VIEWS = {
  overview:    { name: '全景鸟瞰',          desc: '曼彻斯特城区 · 真实街道布局',          en: { name: 'Overview',                    desc: 'Central Manchester · real street layout' } },
  towers:      { name: 'River Street 与 Acer', desc: 'River Street Tower · Acer Tower',   en: { name: 'River Street & Acer',         desc: 'River Street Tower · Acer Tower' } },
  townhall:    { name: '市政厅',            desc: 'Albert Square · 阿尔伯特纪念碑',       en: { name: 'Town Hall',                   desc: 'Albert Square · Albert Memorial' } },
  deansgate:   { name: 'Deansgate 天际线',  desc: 'Beetham Tower · Deansgate Square · 逆光', en: { name: 'Deansgate skyline',         desc: 'Beetham Tower · Deansgate Square · backlit' } },
  castlefield: { name: 'Castlefield',       desc: '运河与铁路高架',                       en: { name: 'Castlefield',                 desc: 'Canal and railway viaducts' } },
  university:  { name: '曼彻斯特大学',      desc: 'Old Quad · Whitworth Hall',            en: { name: 'University of Manchester',    desc: 'Old Quad · Whitworth Hall' } },
  oxfordroad:  { name: 'Oxford Road 街景',  desc: '人眼高度 · 曼大方向',                  en: { name: 'Oxford Road at street level', desc: 'Eye level · towards the university' } },
  etihad:      { name: '伊蒂哈德球场',      desc: '桌边卫星模型 · 距离压缩',              en: { name: 'Etihad Stadium',              desc: 'Tabletop satellite · distance compressed' } },
};

// the two featured towers in the bottom-left panel (and optional map pins)
const TOWERS = {
  title: '精选建筑', pins: '在地图上标出精选建筑', en: { title: 'Featured towers', pins: 'Show the featured towers on the map' },
  items: [
    { name: 'River Street Tower', brand: 'Canvas Manchester', addr: 'River Street' },
    { name: 'Acer Tower',         brand: 'Square Gardens',    addr: 'Willmott Street' },
  ],
};

// deep merge of plain objects; arrays merge element by element
function merge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => (i < b.length ? merge(x, b[i]) : x));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in a ? merge(a[k], v) : v;
    return out;
  }
  return b === undefined ? a : b;
}

export function guiText({ personal = true } = {}) {
  let text = { weathers: WEATHERS, views: VIEWS, towers: TOWERS };
  const file = path.join(here, 'data', 'personal.json');
  if (personal && fs.existsSync(file)) text = merge(text, JSON.parse(fs.readFileSync(file, 'utf8')));
  return text;
}
