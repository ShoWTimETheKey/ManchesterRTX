// Procedural, tileable PBR textures for the city's materials, written as PNG (albedo sRGB, tangent-space normal, ORM).
// Every pattern is periodic over the tile so world-space UVs repeat without seams.
import fs from 'node:fs';
import zlib from 'node:zlib';

/* ---------------- PNG writer ---------------- */
const CRC=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; CRC[n]=c>>>0; }
function crc32(buf){ let c=0xffffffff; for(let i=0;i<buf.length;i++) c=CRC[(c^buf[i])&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type,data){ const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const td=Buffer.concat([Buffer.from(type,'ascii'),data]); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len,td,crc]); }
export function writePNG(path,w,h,px,ch){
  const stride=w*ch, raw=Buffer.alloc((stride+1)*h);
  for(let y=0;y<h;y++){ raw[y*(stride+1)]=0; Buffer.from(px.buffer,px.byteOffset+y*stride,stride).copy(raw,y*(stride+1)+1); }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=ch===4?6:ch===3?2:0; ihdr[10]=ihdr[11]=ihdr[12]=0;
  fs.writeFileSync(path,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:7})),chunk('IEND',Buffer.alloc(0))]));
}

/* ---------------- tileable noise ---------------- */
function ih(x,y,s){ let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1442695041))|0; h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; return (h>>>0)/4294967296; }
const fade=t=>t*t*(3-2*t);
// value noise with lattice period p (integer), so noise(x+p)=noise(x)
function vn(x,y,p,s){ const xi=Math.floor(x), yi=Math.floor(y), fx=fade(x-xi), fy=fade(y-yi), m=a=>((a%p)+p)%p;
  const a=ih(m(xi),m(yi),s), b=ih(m(xi+1),m(yi),s), c=ih(m(xi),m(yi+1),s), d=ih(m(xi+1),m(yi+1),s);
  return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy; }
// fbm over unit square [0,1)^2, base period p0 cells, doubling each octave (stays tileable)
export function fbm(u,v,p0,oct,s,gain=.5){ let sum=0,amp=1,norm=0,p=p0; for(let o=0;o<oct;o++){ sum+=amp*vn(u*p,v*p,p,s+o*17); norm+=amp; amp*=gain; p*=2; } return sum/norm; }
const clamp01=x=>x<0?0:x>1?1:x, lerp=(a,b,t)=>a+(b-a)*t, smooth=(a,b,x)=>{ const t=clamp01((x-a)/(b-a)); return t*t*(3-2*t); };
export const hexLin=h=>{ const n=parseInt(h.slice(1),16); return [n>>16&255,n>>8&255,n&255].map(c=>{ c/=255; return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4); }); };
const toS=c=>{ c=clamp01(c); return Math.round(255*(c<=.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-.055)); };

/* ---------------- texture builder ----------------
   pattern(u,v) → {a:[r,g,b] linear albedo, h height 0..1, r roughness, m metalness, o occlusion}; u,v in [0,1) across the tile */
export function bake(dir,name,size,pattern,{bump=1}={}){
  const N=size, A=new Uint8Array(N*N*3), Nm=new Uint8Array(N*N*3), O=new Uint8Array(N*N*3), H=new Float32Array(N*N);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){ const s=pattern((x+.5)/N,(y+.5)/N), i=y*N+x;
    A[3*i]=toS(s.a[0]); A[3*i+1]=toS(s.a[1]); A[3*i+2]=toS(s.a[2]); H[i]=s.h??.5;
    O[3*i]=Math.round(255*clamp01(s.o??1)); O[3*i+1]=Math.round(255*clamp01(s.r??.8)); O[3*i+2]=Math.round(255*clamp01(s.m??0)); }
  // normal from the height field; x along +u, y along +v (rows going down), strength in "height units per tile"
  const k=bump*N/64;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const hx=H[y*N+(x+1)%N]-H[y*N+(x+N-1)%N], hy=H[((y+1)%N)*N+x]-H[((y+N-1)%N)*N+x];
    let nx=-hx*k, ny=-hy*k, nz=1; const l=Math.hypot(nx,ny,nz); nx/=l; ny/=l; nz/=l; const i=3*(y*N+x);
    Nm[i]=Math.round((nx*.5+.5)*255); Nm[i+1]=Math.round((ny*.5+.5)*255); Nm[i+2]=Math.round((nz*.5+.5)*255); }
  writePNG(`${dir}/${name}_albedo.png`,N,N,A,3); writePNG(`${dir}/${name}_normal.png`,N,N,Nm,3); writePNG(`${dir}/${name}_orm.png`,N,N,O,3);
  return {albedo:`${name}_albedo.png`,normal:`${name}_normal.png`,orm:`${name}_orm.png`};
}

/* ---------------- patterns ----------------
   Each factory takes the material's base colour (linear RGB) and returns a pattern function. */
const vary=(c,k)=>c.map(x=>x*k);
const tint=(c,dr,dg,db)=>[c[0]*dr,c[1]*dg,c[2]*db];

// stretcher-bond brick: 4 bricks across, 12 courses up a 0.9 m tile; mortar ~10 mm recessed
export const brick=(base,{mortar=[.42,.40,.36],seed=1}={})=>(u,v)=>{
  const rows=12, cols=4, ry=v*rows, row=Math.floor(ry), fy=ry-row, rx=u*cols+(row&1)*.5, col=Math.floor(rx), fx=rx-col;
  const m=.045, my=m*cols/rows*3.4, inM=fx<m||fx>1-m||fy<my||fy>1-my, bid=((col%cols)+cols)%cols+row*7;
  const r=ih(bid,row,seed), r2=ih(bid,row,seed+9), g=fbm(u,v,16,4,seed+3);
  if(inM){ const mn=.85+.3*g; return {a:vary(mortar,mn),h:.12+.1*g,r:.95,o:.75}; }
  const edge=Math.min(fx,1-fx,(fy)*rows/cols/3.4,(1-fy)*rows/cols/3.4), chip=smooth(0,.06,edge+(fbm(u,v,32,2,seed+5)-.5)*.05);
  let c=vary(base,.78+.42*r); if(r2<.12) c=vary(c,.7); else if(r2>.93) c=tint(c,1.08,.95,.85);   // some over-fired, some sandy bricks
  c=vary(c,.88+.24*fbm(u,v,64,3,seed+7));
  return {a:c,h:.55+.4*chip+.05*fbm(u,v,64,2,seed+11),r:.82+.12*g,o:.9+.1*chip};
};
// ashlar masonry: 0.9 m x 0.45 m blocks on a 1.8 m tile, thin joints, grain and soot streaks
export const ashlar=(base,{seed=2,soot=.25,joint=.012}={})=>(u,v)=>{
  const rows=4, cols=2, ry=v*rows, row=Math.floor(ry), fy=ry-row, rx=u*cols+(row&1)*.5, col=Math.floor(rx), fx=rx-col;
  const j=joint*cols, jy=joint*rows, inJ=fx<j||fx>1-j||fy<jy||fy>1-jy, r=ih(((col%cols)+cols)%cols,row,seed);
  const grain=fbm(u,v,24,5,seed+1), streak=fbm(u*.25,v,8,3,seed+4);
  let c=vary(base,(.9+.2*r)*(.86+.28*grain)); c=vary(c,1-soot*smooth(.55,.85,streak));
  if(inJ) return {a:vary(c,.7),h:.2,r:.92,o:.7};
  const e=Math.min(fx,1-fx,fy,1-fy); return {a:c,h:.6+.25*smooth(0,.05,e)+.08*grain,r:.78+.15*grain,o:.92+.08*smooth(0,.05,e)};
};
// board-marked concrete panel with tie holes; joint at the tile edge (tile 2.4 m)
export const concrete=(base,{seed=3}={})=>(u,v)=>{
  const g=fbm(u,v,8,6,seed), board=Math.sin(v*Math.PI*2*16)*.5+.5, pores=fbm(u,v,128,2,seed+2);
  const edge=Math.min(u,1-u,v,1-v), tie=[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].some(([a,b])=>Math.hypot(u-a,v-b)<.008);
  let c=vary(base,.85+.3*g-.04*board); if(pores>.82) c=vary(c,.75);
  return {a:tie?vary(c,.5):c,h:(edge<.004?.1:.5)+.06*g+.02*board-(tie?.3:0)-(pores>.82?.08:0),r:.88,o:edge<.004||tie?.6:1};
};
// slate roofing: 6 courses of 0.2 m, 0.3 m slates staggered, each slate a wedge so the overlaps cast tiny shadows (tile 1.2 m)
export const slate=(base,{seed=4}={})=>(u,v)=>{
  const rows=6, cols=4, ry=v*rows, row=Math.floor(ry), fy=ry-row, rx=u*cols+(row&1)*.5, col=Math.floor(rx), fx=rx-col;
  const r=ih(((col%cols)+cols)%cols,row,seed), gap=fx<.02||fx>.98;
  let c=vary(base,.8+.4*r); c=vary(c,.9+.2*fbm(u,v,32,3,seed+1));
  return {a:gap?vary(c,.45):c,h:gap?.05:.15+.75*fy,r:.55+.2*r,o:gap?.5:.75+.25*fy};
};
// clay roof tiles laid in alternating bands of plain and fish-scale (round-bottomed) courses, as on Waterhouse's
// Whitworth Building (tile 1.2 m: 12 courses of 8 tiles, bands of three courses)
export const fishscale=(base,{seed=23}={})=>(u,v)=>{
  const rows=12, cols=8, ry=v*rows, row=Math.floor(ry), fy=ry-row, rx=u*cols+(row&1)*.5, col=Math.floor(rx), fx=rx-col;
  const scale=Math.floor(row/3)%2===1;
  // the exposed lower edge of the tile: straight, or a half circle in the scale bands; below it shows the next course
  const edge=scale?.55+.45*Math.sqrt(Math.max(0,1-(2*fx-1)**2)):.97, below=fy>edge;
  const rr=below?row+1:row, rc=below?Math.floor(u*cols+(rr&1)*.5):col, r=ih(((rc%cols)+cols)%cols,rr,seed);
  const joint=Math.abs(fy-edge)<.035||(!below&&(fx<.025||fx>.975));
  let c=vary(base,.8+.38*r); c=vary(c,.9+.2*fbm(u,v,32,3,seed+1));
  const t=below?fy-edge:fy;
  return {a:joint?vary(c,.5):c,h:joint?.05:.2+.7*Math.min(1,t/Math.max(edge,.3)),r:.5+.2*r,o:joint?.55:.8+.2*t};
};
// asphalt with stone aggregate and the odd repair patch (tile 4 m)
export const asphalt=(base,{seed=5}={})=>(u,v)=>{
  const agg=fbm(u,v,256,2,seed), g=fbm(u,v,6,4,seed+1), patch=fbm(u,v,3,3,seed+2)>.68;
  let c=vary(base,.85+.25*g); if(agg>.72) c=vary(c,1.35); if(patch) c=vary(c,.82);
  return {a:c,h:.5+.25*(agg-.5),r:.9-.15*(agg>.72),o:1};
};
// paving flags 0.6 m, two by two on a 1.2 m tile
export const flags=(base,{seed=6,n=2,joint=.008}={})=>(u,v)=>{
  const fx=u*n, fy=v*n, ix=Math.floor(fx), iy=Math.floor(fy), ax=fx-ix, ay=fy-iy, j=joint*n/1.2*1.2, inJ=ax<j||ax>1-j||ay<j||ay>1-j;
  const r=ih(ix,iy,seed), g=fbm(u,v,16,4,seed+1), stain=fbm(u,v,4,3,seed+2);
  let c=vary(base,(.9+.2*r)*(.9+.2*g)); c=vary(c,1-.18*smooth(.6,.8,stain));
  return inJ?{a:vary(c,.55),h:.15,r:.95,o:.6}:{a:c,h:.55+.05*g,r:.8+.1*g,o:1};
};
// large pale stone slabs 1.2 m x 0.6 m staggered (tile 2.4 m)
export const slabs=(base,{seed=7}={})=>(u,v)=>{
  const rows=4, cols=2, ry=v*rows, row=Math.floor(ry), fy=ry-row, rx=u*cols+(row&1)*.5, col=Math.floor(rx), fx=rx-col;
  const inJ=fx<.004||fx>.996||fy<.008||fy>.992, r=ih(((col%cols)+cols)%cols,row,seed), g=fbm(u,v,12,5,seed+1);
  const c=vary(base,(.92+.16*r)*(.9+.2*g)); return inJ?{a:vary(c,.6),h:.2,r:.9,o:.7}:{a:c,h:.55+.04*g,r:.7+.15*g,o:1};
};
// speckled granite (kerbs)
export const granite=(base,{seed=8}={})=>(u,v)=>{ const s=fbm(u,v,128,2,seed), g=fbm(u,v,16,3,seed+1);
  let c=vary(base,.85+.2*g); if(s>.7) c=vary(c,.55); else if(s<.25) c=vary(c,1.2); return {a:c,h:.5+.1*(s-.5),r:.7,o:1}; };
// grass: tufts of light and dark blades over soil (tile 2 m)
export const grass=(base,{seed=9}={})=>(u,v)=>{ const blades=fbm(u*1.0,v*1.0,192,2,seed), clump=fbm(u,v,10,4,seed+1), dry=fbm(u,v,4,3,seed+2);
  let c=vary(base,.7+.6*blades); c=vary(c,.8+.4*clump); if(dry>.62) c=tint(c,1.25,1.08,.7);
  return {a:c,h:.3+.6*blades*clump,r:.95,o:.7+.3*blades}; };
// gravel / ballast stones
export const gravel=(base,{seed=10}={})=>(u,v)=>{ const s=fbm(u,v,64,3,seed), t=fbm(u,v,64,2,seed+3);
  return {a:vary(base,.65+.7*t),h:s,r:.9,o:.6+.4*s}; };
// rusted weathering steel: mottled oxide with vertical run-off streaks and a panel seam on the tile edge (tile 1.2 m)
export const corten=(base,{seed=11}={})=>(u,v)=>{ const g=fbm(u,v,10,6,seed), spots=fbm(u,v,48,3,seed+1), streak=fbm(u*.15,v,6,4,seed+2);
  let c=vary(base,.75+.5*g); if(spots>.68) c=tint(c,1.25,1.05,.85); c=vary(c,1-.25*smooth(.5,.8,streak)); const seam=u<.004||v<.004;
  return {a:seam?vary(c,.5):c,h:seam?.2:.5+.15*g+.05*spots,r:.75+.15*g,m:.15,o:seam?.6:1}; };
// metal cladding panel with folded seams (tile 1.2 m)
export const panel=(base,{seed=12,rough=.42,metal=.6}={})=>(u,v)=>{ const g=fbm(u,v,8,4,seed), brush=fbm(u*.05,v,2,2,seed+1)*.5+fbm(u,v*64,1,1,seed+2)*.5;
  const seam=u<.006||u>.994||v<.003||v>.997; return {a:vary(base,(.9+.15*g)*(seam?.6:1)),h:seam?.1:.55+.03*brush,r:rough+.1*g,m:metal,o:seam?.5:1}; };
// painted render / smooth cladding (tile 2 m)
export const render=(base,{seed=13}={})=>(u,v)=>{ const g=fbm(u,v,24,5,seed), dirt=fbm(u*.3,v,6,3,seed+1);
  return {a:vary(base,(.92+.12*g)*(1-.12*smooth(.55,.9,dirt))),h:.5+.06*g,r:.85,o:1}; };
// glazed terracotta blocks 0.6 x 0.3 m with fine crazing (tile 1.2 m)
export const terracotta=(base,{seed=14}={})=>(u,v)=>{ const rows=4, cols=2, ry=v*rows, row=Math.floor(ry), fy=ry-row, fx=u*cols-Math.floor(u*cols);
  const inJ=fx<.015||fx>.985||fy<.03||fy>.97, r=ih(Math.floor(u*cols),row,seed), craze=fbm(u,v,96,2,seed+1);
  return inJ?{a:vary(base,.55),h:.2,r:.9,o:.6}:{a:vary(base,.88+.2*r),h:.6+.03*craze,r:.32+.1*craze,o:1}; };
// bituminous roofing membrane with granules (tile 4 m)
export const membrane=(base,{seed=15}={})=>(u,v)=>{ const s=fbm(u,v,256,2,seed), g=fbm(u,v,6,4,seed+1), lap=(v*8)%1<.01;
  return {a:vary(base,(.85+.25*g)*(s>.7?1.25:1)*(lap?.7:1)),h:.5+.2*(s-.5)-(lap?.2:0),r:.92,o:1}; };
// photovoltaic panel: dark cells, silver bus lines, frame (tile 1.0 m)
export const solar=(base,{seed=16}={})=>(u,v)=>{ const cx=(u*6)%1, cy=(v*6)%1, line=cx<.03||cy<.03, bus=Math.abs(cx-.33)<.006||Math.abs(cx-.66)<.006, frame=u<.01||v<.01;
  return frame?{a:[.5,.5,.52],h:.7,r:.35,m:1}:line?{a:[.75,.75,.78],h:.5,r:.3,m:1}:bus?{a:[.6,.6,.62],h:.52,r:.3,m:1}:{a:vary(base,.9+.15*fbm(u,v,16,2,seed)),h:.5,r:.08,o:1}; };
// leaves: overlapping clusters with deep gaps (tile 1.2 m)
export const foliage=(base,{seed=17}={})=>(u,v)=>{ const l=fbm(u,v,24,4,seed), d=fbm(u,v,96,2,seed+1);
  let c=vary(base,.55+.9*l); if(d>.7) c=tint(c,1.15,1.2,.9); return {a:c,h:l,r:.85,o:.45+.55*l}; };
// tree bark
export const bark=(base,{seed=18}={})=>(u,v)=>{ const f=fbm(u*4,v*.5,8,4,seed); return {a:vary(base,.7+.6*f),h:f,r:.95,o:.6+.4*f}; };
// timber boards 0.15 m (tile 1.2 m)
export const timber=(base,{seed=19}={})=>(u,v)=>{ const b=Math.floor(v*8), fv=v*8-b, grain=fbm(u*.3,v*8,4,4,seed+b), r=ih(b,0,seed);
  return fv<.04?{a:vary(base,.5),h:.2,r:.9,o:.6}:{a:vary(base,(.8+.3*r)*(.85+.3*grain)),h:.55+.05*grain,r:.7,o:1}; };
// water: no albedo detail, a wave normal map (tile 8 m)
export const water=(base,{seed=20}={})=>(u,v)=>({a:base,h:fbm(u,v,4,5,seed,.55)*.7+fbm(u,v,24,3,seed+1)*.3,r:.04,o:1});
// float glass: very slight waviness so reflections are not perfectly flat (tile 3 m)
export const glass=(base,{seed=21,rough=.03}={})=>(u,v)=>({a:base,h:fbm(u,v,3,3,seed)*.3,r:rough,o:1});
// plain material with gentle grain
export const plain=(base,{seed=22,rough=.6,metal=0}={})=>(u,v)=>{ const g=fbm(u,v,16,4,seed); return {a:vary(base,.92+.16*g),h:.5+.05*g,r:rough+.08*(g-.5),m:metal,o:1}; };
export const lerpC=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
