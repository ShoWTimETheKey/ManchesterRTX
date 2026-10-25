// Manchester Central Library (E. Vincent Harris, 1934) at 0.25 m: a Portland-stone rotunda with a rusticated base and
// round-headed windows, a two-storey colonnade of Tuscan columns in front of a recessed glazed wall, a deep
// entablature and cornice, a lead roof rising to a stone drum, a shallow ribbed dome with a glazed lantern, and the
// pedimented portico facing St Peter's Square.
import { hash } from './geo.mjs';
import { Grid, meshGrid } from './vox.mjs';

export function buildRotunda({ id, c: [cx, cz], R, portico }, store) {
  const V = .25;
  // frame: local +x points from the centre to the portico
  const ang = Math.atan2(portico[1] - cz, portico[0] - cx), cs = Math.cos(ang), sn = Math.sin(ang);
  const PD = 8, PW = 27;                       // portico depth beyond the drum and width
  const half = R + PD + 2, n = Math.ceil(2 * half / V), H = Math.ceil(36 / V);
  const g = new Grid(n, H, n);
  const P = g.m('portland'), PT = g.m('trim'), LD = g.m('leadD'), GL = g.m('win'), GLL = g.m('winLit'), GR = g.m('glassRoof'), DOOR = g.m('door'), BRZ = g.m('gilt');
  const at = (i, k) => [-half + (i + .5) * V, -half + (k + .5) * V];   // local metres of a column
  const y = m => Math.round(m / V);
  const NB = 40, bayAng = 2 * Math.PI / NB;
  const baseTop = 8.5, colTop = 20, entTop = 22.2, corTop = 23, Rw = R - 2.8, Rc = R - 1.2;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const [x, z] = at(i, k), r = Math.hypot(x, z), th = Math.atan2(z, x);
    const b = Math.round(th / bayAng), dth = th - b * bayAng, tang = dth * r;   // offset from the bay centre along the wall
    const set = (y0, y1, v) => { for (let yy = y(y0); yy < y(y1); yy++) g.set(i, yy, k, v); };
    if (r <= R) {
      // rusticated base: horizontal channels every 0.75 m on the outer ring, round-headed windows in every bay
      set(0, baseTop, P);
      if (r > R - .45) {
        for (let yy = 0; yy < y(baseTop); yy++) if (yy % 3 === 0 && yy > 1) g.set(i, yy, k, 0);
        const win = Math.abs(tang) < .85, head = 5.3 - (.85 - Math.sqrt(Math.max(0, .85 * .85 - tang * tang)));
        if (win && !(Math.abs(th) < .45)) for (let yy = y(1.6); yy < y(head); yy++) g.set(i, yy, k, 0);
      } else if (r > R - .8) {
        const win = Math.abs(tang) < .85, head = 5.3 - (.85 - Math.sqrt(Math.max(0, .85 * .85 - tang * tang)));
        if (win && !(Math.abs(th) < .45)) for (let yy = y(1.6); yy < y(head); yy++) g.set(i, yy, k, hash(id, b, 1) < .35 ? GLL : GL);
      }
      // the floor of the colonnade walk and the recessed glazed wall behind the columns
      if (r <= Rw) {
        set(baseTop, colTop, P);
        if (r > Rw - .45) for (const [w0, w1] of [[10.4, 13.6], [15.2, 18.6]]) if (Math.abs(tang) < .9) for (let yy = y(w0); yy < y(w1); yy++) g.set(i, yy, k, 0);
        if (r > Rw - .7 && r <= Rw - .45) for (const [w0, w1] of [[10.4, 13.6], [15.2, 18.6]]) if (Math.abs(tang) < .9) for (let yy = y(w0); yy < y(w1); yy++) g.set(i, yy, k, Math.abs(tang) < .12 || yy === y(w0 + 1.7) ? PT : (hash(id, b, w0 | 0) < .35 ? GLL : GL));
      }
      // Tuscan columns with square plinths and capitals
      const ccx = Rc * Math.cos(b * bayAng), ccz = Rc * Math.sin(b * bayAng), dcol = Math.hypot(x - ccx, z - ccz), sq = Math.max(Math.abs(x - ccx), Math.abs(z - ccz));
      if (!(Math.abs(th) < .45)) {
        if (dcol < .55) set(baseTop, colTop, P);
        if (sq < .8) { set(baseTop, baseTop + .5, PT); set(colTop - .5, colTop, PT); }
      }
      // entablature, cornice
      set(colTop, entTop, P); if (r > R - .3) set(entTop - .75, entTop - .5, PT);
      set(entTop, corTop, PT);
      // lead roof rising to the drum, the drum, the ribbed dome and its lantern
      if (r > 25) set(corTop, corTop + (R - r) * .45 + .25, r > R - .35 ? PT : LD);
      else if (r > 23.2) { set(corTop, 28.2, P); if (r > 24.6 && Math.abs(tang) < .5 && b % 2 === 0) for (let yy = y(25.4); yy < y(27.2); yy++) g.set(i, yy, k, GL); set(28.2, 28.7, PT); }
      else {
        const dome = 28.2 + 4.2 * Math.sqrt(Math.max(0, 1 - (r / 23.2) ** 2)), rib = Math.abs(((th / (Math.PI / 8)) % 1 + 1) % 1 - .5) > .46;
        set(corTop, dome, rib && r > 5 ? PT : LD);
        if (r < 4.6) { set(dome, dome + 1.8, r < 4.3 ? GR : PT); set(dome + 1.8, dome + 2.2, LD); if (r < .6) set(dome + 2.2, dome + 3.4, BRZ); }
      }
    }
    // the portico
    if (x >= R + PD && x < R + PD + 2 && Math.abs(z) < PW / 2 + 1) { const s = Math.floor((x - R - PD) / .5); set(0, .9 - .3 * s, PT); }   // steps
    if (x > R - 3 && x < R + PD && Math.abs(z) < PW / 2) {
      const front = R + PD;
      set(0, 1.2, P);   // podium
      // columns: eight across the front, two deep; pilasters against the drum
      const nC = 8, sp = (PW - 3) / (nC - 1), ci = Math.round((z + (PW - 3) / 2) / sp), czc = -(PW - 3) / 2 + ci * sp;
      for (const cxc of [front - 1.2, front - 4.6]) if (ci >= 0 && ci < nC && Math.hypot(x - cxc, z - czc) < .62) set(1.2, 12.6, P);
      if (Math.abs(z) > PW / 2 - 1.3 && x < front - .5) set(1.2, 12.6, P);   // end walls
      // entablature and the pediment
      set(12.6, 14.4, P); if (x > front - .35) set(13.5, 13.75, PT);
      set(14.4, 14.9, PT);
      const ped = 14.9 + (PW / 2 - Math.abs(z)) * .3;
      if (x > front - .3) set(14.9, ped, Math.abs(z) < PW / 2 - .6 && 14.9 + (PW / 2 - .6 - Math.abs(z)) * .3 > (14.9 + .35) ? PT : PT);
      else set(14.9, ped, x > front - .8 ? P : LD);
      // doors in the drum behind the portico
      if (r <= R && r > R - .5 && Math.abs(z) < 7 && ((Math.abs(z) + 1.4) % 4.6) < 2.8) for (let yy = y(1.2); yy < y(5.8); yy++) g.set(i, yy, k, DOOR);
    }
  }
  return meshGrid(g, store, store.key(cx, cz), { cx, cz, oy: 0, cos: cs, sin: sn, x0: -half, z0: -half, vs: V });
}
