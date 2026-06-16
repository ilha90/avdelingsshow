// worms-engine.js — Gjenbrukbar Romkrig-motor (canvas + fysikk + destruerbart terreng).
//
// Brukes av:
//   - worms.html  (hot-seat, mode:'local')  — lokal input + shop + alternering
//   - host.js     (nettverk, mode:'network') — server styrer turorden, host kjører fysikk
//
// Motoren er UI-agnostisk: den tegner ALT på canvas (inkl. turbanner, hjelpetekst,
// power-HUD). Hotbar/shop er valgfri DOM som hot-seat-wrapperen bygger og styrer
// via motorens metoder (selectWeapon/buyWeapon/onRefresh).
//
// Lagmodell: N ormer fordelt på 2 lag. Turorden styres eksternt (driver/server).

export function createWormsEngine(opts){
  opts = opts || {};
  const cv = opts.canvas;
  const ctx = cv.getContext('2d');
  const mode = opts.mode || 'local';                 // 'local' | 'network'
  const onTurnEnd  = opts.onTurnEnd  || function(){}; // (hits) => {}   network
  const onRefresh  = opts.onRefresh  || function(){}; // () => {}        hotbar/shop
  const onGameOver = opts.onGameOver || function(){}; // (winnerTeamId|null) => {}
  const onPhase    = opts.onPhase    || function(){}; // (phase) => {}
  const onCarve    = opts.onCarve    || function(){}; // (cx,cy,r) => {}   nettverk: stream destruksjon

  /* ================= Fast virtuell oppløsning =================
     Alle klienter (host + speilende telefoner) bruker SAMME interne
     koordinatrom, slik at snapshot-koordinater og seed-generert terreng
     matcher på tvers av skjermstørrelser. Canvas-elementet CSS-skaleres. */
  const VW = 1280, VH = 720;

  /* ================= Constants ================= */
  const GRAV = 0.27;
  const MOVE_BUDGET = 90;
  const MOVE_SPEED = 1.9;
  const MAX_DRAG = 160;
  const PREVIEW_POWER = 0.55;
  const SPEED_MAX = 17;
  const GRACE = 12;
  const WORM_R = 11;
  const COIN_TARGET = 12;
  const COIN_MIN = 6;

  // 2 lag — farger/lue. Kan overstyres via start({teams}).
  let TEAMS = [
    { id:0, name:'Rødt lag',  col:'#ff4d5e', dark:'#b3303d', cap:'#ffd34d' },
    { id:1, name:'Blått lag', col:'#4d9bff', dark:'#2f63b3', cap:'#7dffea' }
  ];

  /* ================= Weapons ================= */
  const WEAPONS = {
    rocket:   { id:'rocket',   name:'Rakett',      icon:'🚀', price:0,  dmg:[2,1], radius:38, speed:1.0,  wobble:0.30, free:true,  desc:'Allsidig. Bred spredning – vanskelig å sikte.' },
    grenade:  { id:'grenade',  name:'Granat',      icon:'💣', price:35, dmg:[3,1], radius:44, speed:0.95, wobble:0.12, bounces:2, fuse:95, desc:'Spretter 2× før timer-eksplosjon.' },
    shotgun:  { id:'shotgun',  name:'Hagle',       icon:'🔫', price:28, dmg:[1,0], radius:17, speed:1.05, wobble:0.18, pellets:5, desc:'5 pelleter i spredning.' },
    sniper:   { id:'sniper',   name:'Sniper',      icon:'🎯', price:50, dmg:[2,1], radius:22, speed:2.0,  wobble:0.02, desc:'Lynrask, lang rekkevidde, presis.' },
    bazooka:  { id:'bazooka',  name:'Bazooka',     icon:'💥', price:75, dmg:[3,2], radius:70, speed:0.95, wobble:0.10, desc:'Massiv eksplosjonsradius.' },
    airstrike:{ id:'airstrike',name:'Luftangrep',  icon:'✈️', price:85, dmg:[2,1], radius:36, speed:1.0,  wobble:0.08, airstrike:3, desc:'3 raketter fra toppen.' },
    cluster:  { id:'cluster',  name:'Kluster',     icon:'🌀', price:60, dmg:[1,0], radius:26, speed:1.0,  wobble:0.12, cluster:5, desc:'Deles i 5 småbomber ved landing.' },
    raygun:   { id:'raygun',   name:'Ray Gun',     icon:'⚡', price:65, dmg:[3,1], radius:24, speed:2.4,  wobble:0.04, raygun:true, desc:'Ingen gravitasjon. Skyter gjennom bakken!' },
    curse:    { id:'curse',    name:'Forbannelse', icon:'💀', price:50, dmg:[0,0], radius:0,  speed:0.95, wobble:0.10, curse:true, desc:'Lander som forbannet mynt → debuff.' }
  };
  const WEAPON_ORDER = ['rocket','grenade','shotgun','sniper','bazooka','airstrike','cluster','raygun','curse'];

  const DEBUFFS = [
    { id:'no_aim',       label:'🚫 Blindskudd — siktelinjen er skjult!' },
    { id:'random_power', label:'🎲 Skjelven hånd — tilfeldig kraft!' },
    { id:'mirrored',     label:'🪞 Speilvendt sikte!' },
    { id:'steal_coins',  label:'🩸 Tyvgods — mynter du treffer går til motstander!' }
  ];

  /* ================= Runtime size / terrain buffers ================= */
  let W = 0, H = 0;
  let terrainCv, terrainCtx;
  let solid;                   // Uint8Array W*H, 1 = solid
  let stars = [];
  let raf = 0;
  let coinsEnabled = true;
  let bannerText = '', bannerTimer = 0;

  /* ================= Seeded RNG (mulberry32) ================= */
  let _seed = 1234567;
  function srnd(){
    _seed |= 0; _seed = _seed + 0x6D2B79F5 | 0;
    let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function rnd(a,b){ return a + srnd()*(b-a); }
  function rint(a,b){ return (a + srnd()*(b-a+1))|0; }
  function pick(arr){ return arr[(srnd()*arr.length)|0]; }
  function clamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function dist(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }

  /* ================= Game state ================= */
  let G = null;
  function freshState(){
    return {
      phase:'idle',          // idle | shop | move | turn | flight | transition | gameover
      cur:0,                 // index into G.players of active worm
      round:0,
      players:[],
      coins:[],
      projectiles:[],
      particles:[],
      floaters:[],
      explosions:[],
      aim:{ dragging:false, ax:0, ay:0, mx:0, my:0, net:false, angle:0, power:0 },
      transTimer:0,
      turnHits:new Map(),    // pid -> total dmg this turn (for network result)
      over:false
    };
  }

  function setPhase(p){ if (G.phase!==p){ G.phase=p; onPhase(p); } }
  function cur(){ return G.players[G.cur]; }
  function wormByPid(pid){ return G.players.find(p=>p.pid===pid); }

  function isSolid(x,y){
    x|=0; y|=0;
    if (x<0||x>=W||y<0||y>=H) return false;
    return solid[y*W+x]===1;
  }
  function surfaceAt(x){
    x=clamp(x|0,0,W-1);
    for (let y=0;y<H;y++) if (solid[y*W+x]===1) return y;
    return H;
  }

  function banner(text, ms){ bannerText=text; bannerTimer=ms||1600; }

  /* ================= Stars (night sky) ================= */
  function makeStars(){
    stars = [];
    const n = Math.round(W*H/9000);
    for (let i=0;i<n;i++){
      stars.push({ x:srnd()*W, y:srnd()*H*0.8, r:rnd(0.4,1.7), tw:rnd(0,6.28), sp:rnd(0.5,2.0) });
    }
  }
  function drawSky(t){
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#07071e'); g.addColorStop(0.6,'#0b1138'); g.addColorStop(1,'#0d1640');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    for (const s of stars){
      const a = 0.35 + 0.65*Math.abs(Math.sin(t*0.001*s.sp + s.tw));
      ctx.globalAlpha = a; ctx.fillStyle = '#dfe7ff';
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= Terrain ================= */
  let spawnX = [];
  function genTerrain(nSpawns){
    solid = new Uint8Array(W*H);
    const gy = new Float32Array(W);
    const base = H*0.50;
    const a1=rnd(34,58), f1=rnd(0.0035,0.0075), p1=rnd(0,6.28);
    const a2=rnd(14,28), f2=rnd(0.011,0.02),   p2=rnd(0,6.28);
    const a3=rnd(5,12),  f3=rnd(0.03,0.055),   p3=rnd(0,6.28);
    for (let x=0;x<W;x++){
      gy[x] = base + a1*Math.sin(x*f1+p1) + a2*Math.sin(x*f2+p2) + a3*Math.sin(x*f3+p3);
    }
    // N flate spawn-soner spredt utover bredden
    const n = Math.max(2, nSpawns|0);
    const margin = 60, usable = W - margin*2;
    const zw = Math.min(150, Math.max(70, usable/(n*1.4)));
    spawnX = [];
    for (let i=0;i<n;i++){
      const cx = (n===1) ? W/2 : margin + (usable*(i/(n-1)));
      const cxi = clamp(cx|0, margin+zw/2, W-margin-zw/2)|0;
      spawnX.push(cxi);
      const x0 = clamp(cxi-zw/2|0, 1, W-2), x1 = clamp(cxi+zw/2|0, 1, W-2);
      const flat = gy[cxi];
      for (let x=x0;x<=x1;x++) gy[x] = lerp(gy[x], flat, smoothZone(x,x0,x1));
    }
    for (let x=0;x<W;x++){
      const top = clamp(gy[x]|0, 24, H-2);
      for (let y=top;y<H;y++) solid[y*W+x]=1;
    }
    renderTerrain(gy);
  }
  function smoothZone(x,a,b){ const t=(x-a)/(b-a); return t<0.5? t*2 : (1-t)*2; }

  function renderTerrain(gy){
    terrainCtx.clearRect(0,0,W,H);
    const grad = terrainCtx.createLinearGradient(0,H*0.35,0,H);
    grad.addColorStop(0,'#2e7d3c'); grad.addColorStop(0.18,'#236b2f');
    grad.addColorStop(0.5,'#194f24'); grad.addColorStop(1,'#0c2c14');
    terrainCtx.beginPath();
    terrainCtx.moveTo(0,H);
    for (let x=0;x<W;x++) terrainCtx.lineTo(x, gy[x]);
    terrainCtx.lineTo(W,H); terrainCtx.closePath();
    terrainCtx.fillStyle = grad; terrainCtx.fill();
    terrainCtx.beginPath();
    terrainCtx.moveTo(0,gy[0]);
    for (let x=1;x<W;x++) terrainCtx.lineTo(x, gy[x]);
    terrainCtx.lineWidth = 5; terrainCtx.strokeStyle = '#62e07d';
    terrainCtx.lineJoin = 'round'; terrainCtx.stroke();
    terrainCtx.lineWidth = 2; terrainCtx.strokeStyle = '#9bffb0'; terrainCtx.stroke();
  }

  function carveTerrain(cx,cy,r){
    carveTerrainLocal(cx,cy,r);
    if (mode !== 'mirror') onCarve(Math.round(cx), Math.round(cy), Math.round(r));
  }
  function carveTerrainLocal(cx,cy,r){
    const x0=clamp(cx-r|0,0,W-1), x1=clamp(cx+r|0,0,W-1);
    const y0=clamp(cy-r|0,0,H-1), y1=clamp(cy+r|0,0,H-1);
    const r2=r*r;
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
      const dx=x-cx, dy=y-cy;
      if (dx*dx+dy*dy<=r2) solid[y*W+x]=0;
    }
    terrainCtx.save();
    terrainCtx.globalCompositeOperation='destination-out';
    terrainCtx.beginPath(); terrainCtx.arc(cx,cy,r,0,7); terrainCtx.fill();
    terrainCtx.restore();
    terrainCtx.save();
    terrainCtx.globalCompositeOperation='source-atop';
    terrainCtx.beginPath(); terrainCtx.arc(cx,cy,r+3,0,7); terrainCtx.lineWidth=6;
    terrainCtx.strokeStyle='rgba(20,12,4,.4)'; terrainCtx.stroke();
    terrainCtx.restore();
  }

  /* ================= Worms / players ================= */
  function makePlayer(i, desc){
    const teamId = desc.team|0;
    const t = TEAMS[teamId] || TEAMS[0];
    const sx = spawnX[i % spawnX.length];
    return {
      idx:i, pid:desc.pid, name:desc.name || ('Orm '+(i+1)),
      team:teamId, col:t.col, dark:t.dark, cap:t.cap,
      x:sx, y:0, vy:0, settled:true,
      lives:(desc.lives!=null?desc.lives:8), maxLives:(desc.lives!=null?desc.lives:8),
      money:0, alive:true,
      owned:new Set(['rocket']), sel:'rocket',
      moveLeft:MOVE_BUDGET, face:(sx < W/2 ? 1 : -1),
      debuff:null, blink:0
    };
  }
  function drawHeart(x,y,s,filled){
    ctx.save(); ctx.translate(x,y);
    ctx.beginPath();
    ctx.moveTo(0, s*0.32);
    ctx.bezierCurveTo(0,-s*0.05, -s*0.5,-s*0.05, -s*0.5,-s*0.32);
    ctx.bezierCurveTo(-s*0.5,-s*0.62, 0,-s*0.62, 0,-s*0.28);
    ctx.bezierCurveTo(0,-s*0.62, s*0.5,-s*0.62, s*0.5,-s*0.32);
    ctx.bezierCurveTo(s*0.5,-s*0.05, 0,-s*0.05, 0, s*0.32);
    ctx.closePath();
    if (filled){ ctx.fillStyle='#ff4d6a'; ctx.fill(); ctx.strokeStyle='#7a1024'; ctx.lineWidth=1; ctx.stroke(); }
    else { ctx.fillStyle='#2a2f48'; ctx.fill(); ctx.strokeStyle='#4a5170'; ctx.lineWidth=1; ctx.stroke(); }
    ctx.restore();
  }
  function placeWormOnSurface(p){
    const s = surfaceAt(p.x);
    p.y = (s>=H? H-WORM_R-1 : s-WORM_R);
    p.vy = 0; p.settled = true;
  }
  function stepWormGravity(p){
    if (!p.alive){ return true; }
    const feetY = p.y + WORM_R;
    if (isSolid(p.x, feetY+1)){ p.vy=0; p.settled=true; return true; }
    p.settled = false;
    p.vy = Math.min(p.vy + GRAV, 10);
    let ny = p.y + p.vy;
    let steps = Math.ceil(p.vy);
    for (let s=1;s<=steps;s++){
      if (isSolid(p.x, p.y+WORM_R+s)){ p.y = p.y+s-1; p.vy=0; p.settled=true; return true; }
    }
    p.y = ny;
    if (p.y+WORM_R >= H){ p.y = H-WORM_R-1; p.vy=0; p.settled=true; return true; }
    return false;
  }
  function drawWorm(p, t){
    if (!p.alive) return;
    const x=p.x, y=p.y;
    ctx.fillStyle='rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, y+WORM_R+2, WORM_R*0.9, 4, 0,0,7); ctx.fill();
    const grad = ctx.createRadialGradient(x-3,y-4,2, x,y,WORM_R+2);
    grad.addColorStop(0, p.col); grad.addColorStop(1, p.dark);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x,y,WORM_R,0,7); ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.stroke();
    ctx.fillStyle=p.cap;
    ctx.beginPath(); ctx.arc(x, y-WORM_R*0.5, WORM_R*0.85, Math.PI, 0); ctx.fill();
    ctx.fillRect(x-WORM_R*0.95, y-WORM_R*0.55, WORM_R*1.9, 3);
    const ex=p.face*3;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(x-4+ex, y-1, 3.3, 0,7); ctx.arc(x+4+ex*0.4, y-1, 3.3,0,7); ctx.fill();
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.arc(x-4+ex+p.face, y-1, 1.6,0,7); ctx.arc(x+4+ex*0.4+p.face, y-1,1.6,0,7); ctx.fill();
    ctx.strokeStyle='#3a0a12'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.arc(x+ex*0.5, y+4, 3, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();
    // navn-tag
    ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillText(p.name, x+1, y-WORM_R-24+1);
    ctx.fillStyle=p.col; ctx.fillText(p.name, x, y-WORM_R-24);
    // hjerter
    const mh=Math.max(1,p.maxLives), hs=9, gap=2, total=mh*(hs+gap)-gap, hx=x-total/2+hs/2, hy=y-WORM_R-13;
    for (let i=0;i<mh;i++) drawHeart(hx+i*(hs+gap), hy, hs, i<p.lives);
    if (G.phase!=='gameover' && cur()===p && (G.phase==='move'||G.phase==='turn')){
      ctx.strokeStyle='rgba(255,255,255,'+(0.4+0.3*Math.sin(t*0.006))+')';
      ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,WORM_R+6,0,7); ctx.stroke();
      ctx.fillStyle='#ffcf4d';
      const ay=y-WORM_R-40+Math.sin(t*0.006)*3;
      ctx.beginPath(); ctx.moveTo(x,ay+8); ctx.lineTo(x-6,ay); ctx.lineTo(x+6,ay); ctx.closePath(); ctx.fill();
    }
  }

  /* ================= Aiming ================= */
  // Nettverk: aim settes direkte via {angle, power}. Lokal: fra mus-drag/hover.
  function aimVector(){
    const p=cur();
    let dir, power;
    if (G.aim.net){
      dir = { x:Math.cos(G.aim.angle), y:Math.sin(G.aim.angle) };
      power = clamp(G.aim.power, 0, 1);
    } else if (G.aim.dragging){
      let dx=G.aim.ax-G.aim.mx, dy=G.aim.ay-G.aim.my;        // motsatt av drag
      const len=Math.hypot(dx,dy)||1; dir={x:dx/len,y:dy/len};
      power=clamp(Math.hypot(G.aim.ax-G.aim.mx,G.aim.ay-G.aim.my),0,MAX_DRAG)/MAX_DRAG;
    } else {
      let dx=G.aim.mx-p.x, dy=G.aim.my-p.y;
      const len=Math.hypot(dx,dy)||1; dir={x:dx/len,y:dy/len};
      power=PREVIEW_POWER;
    }
    if (p.debuff==='mirrored') dir={x:-dir.x,y:dir.y};
    return {dir,power};
  }
  function simPath(sx,sy,ang,sp,w,maxSteps){
    const pts=[]; let x=sx,y=sy, vx=Math.cos(ang)*sp, vy=Math.sin(ang)*sp;
    const grav = w.raygun?0:GRAV;
    for (let i=0;i<maxSteps;i++){
      vy+=grav; x+=vx; y+=vy;
      if (x<-20||x>W+20||y>H+20) break;
      if (!w.raygun && i>2 && isSolid(x,y)){ pts.push({x,y}); break; }
      if ((i%2)===0) pts.push({x,y});
    }
    return pts;
  }
  function drawDots(pts,color,r){ ctx.fillStyle=color; for(const pt of pts){ ctx.beginPath(); ctx.arc(pt.x,pt.y,r,0,7); ctx.fill(); } }
  function drawAim(t){
    if (G.phase!=='turn' && G.phase!=='move') return;
    const p=cur(); if(!p||!p.alive) return;
    const w=WEAPONS[p.sel];
    const av=aimVector();
    const ang=Math.atan2(av.dir.y,av.dir.x);
    const sp=av.power*SPEED_MAX*w.speed;
    const sx=p.x+Math.cos(ang)*(WORM_R+4), sy=p.y+Math.sin(ang)*(WORM_R+4);
    const aiming = G.aim.dragging || G.aim.net;
    const hide = p.debuff==='no_aim';
    if (!hide){
      if (w.wobble>0.03){
        for (const s of [-1,1]){
          const pts=simPath(sx,sy, ang+s*w.wobble, sp, w, 240);
          drawDots(pts, 'rgba(255,255,255,.10)', 2);
        }
      }
      const main=simPath(sx,sy, ang, sp, w, 340);
      drawDots(main, aiming?'rgba(255,210,70,.95)':'rgba(170,200,255,.6)', aiming?3:2.3);
      if (main.length){
        const e=main[main.length-1];
        ctx.strokeStyle=aiming?'#ffd24a':'#9ac0ff'; ctx.lineWidth=2;
        const rr = w.radius>0?Math.min(w.radius,46): (w.raygun?10:8);
        ctx.beginPath(); ctx.arc(e.x,e.y,rr,0,7); ctx.stroke();
      }
    } else if (aiming){
      ctx.fillStyle='rgba(200,120,255,.9)'; ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
      ctx.fillText('🚫 sikte skjult', p.x, p.y-WORM_R-30);
    }
    if (aiming){
      // power-indikator over ormen
      const pct=Math.round(av.power*100);
      ctx.fillStyle='#ffd24a'; ctx.font='bold 15px sans-serif'; ctx.textAlign='center';
      ctx.fillText('⚡ '+pct+'%', p.x, p.y-WORM_R-44);
    }
    if (!G.aim.net && G.aim.dragging){
      ctx.setLineDash([]); ctx.strokeStyle='rgba(255,140,40,.92)'; ctx.lineWidth=4;
      ctx.beginPath(); ctx.moveTo(G.aim.ax,G.aim.ay); ctx.lineTo(G.aim.mx,G.aim.my); ctx.stroke();
      ctx.fillStyle='rgba(255,140,40,.92)'; ctx.beginPath(); ctx.arc(G.aim.ax,G.aim.ay,5,0,7); ctx.fill();
    }
  }

  /* ================= Firing ================= */
  function wob(w){ return rnd(-w.wobble,w.wobble); }
  function spawnProjectile(owner, x,y, vx,vy, w){
    G.projectiles.push({
      owner, x, y, vx, vy, w:w.id, steps:0, grace:GRACE, trail:[],
      bounces:w.bounces||0, fuse:w.fuse||0,
      gravity:!w.raygun, raygun:!!w.raygun, curse:!!w.curse,
      radius:w.radius, dmg:w.dmg, cluster:w.cluster||0, sub:false
    });
  }
  function launch(p, ang, sp, w){
    const mx=p.x+Math.cos(ang)*(WORM_R+5), my=p.y+Math.sin(ang)*(WORM_R+5);
    spawnProjectile(p.idx, mx,my, Math.cos(ang)*sp, Math.sin(ang)*sp, w);
  }
  function fireWeapon(p, dir, power){
    const w=WEAPONS[p.sel];
    const sp=Math.max(power,0.12)*SPEED_MAX*w.speed;
    if (w.airstrike){ fireAirstrike(p,w,dir); return; }
    if (w.pellets){
      for (let i=0;i<w.pellets;i++){
        const ang=Math.atan2(dir.y,dir.x) + (i-(w.pellets-1)/2)*0.07 + wob(w);
        launch(p, ang, sp, w);
      }
      return;
    }
    launch(p, Math.atan2(dir.y,dir.x)+wob(w), sp, w);
  }
  function fireAirstrike(p, w, dir){
    // sikt-x: lokal bruker mus-x; nettverk projiserer fra retning
    let tx = G.aim.net ? clamp(p.x + dir.x*220, 40, W-40) : clamp(G.aim.mx, 40, W-40);
    for (let i=-1;i<=1;i++){
      spawnProjectile(p.idx, tx+i*55, 2, rnd(-0.6,0.6), rnd(5,7), w);
    }
  }
  function releaseFire(){
    const p=cur();
    if (!G.aim.net){
      const dragLen=Math.hypot(G.aim.ax-G.aim.mx, G.aim.ay-G.aim.my);
      if (dragLen<8) return; // avbrutt
    }
    const av=aimVector();
    let power=av.power;
    if (p.debuff==='random_power') power=rnd(0.4,1);
    p._stealing = (p.debuff==='steal_coins');
    p.debuff=null;
    G.turnHits = new Map();
    fireWeapon(p, av.dir, power);
    G.aim.dragging=false; G.aim.net=false;
    setPhase('flight');
  }

  /* ================= Projectiles ================= */
  function updateProjectiles(dt){
    for (let i=G.projectiles.length-1;i>=0;i--){
      const pr=G.projectiles[i];
      if (pr.gravity) pr.vy += GRAV*dt;
      const speed=Math.hypot(pr.vx,pr.vy);
      const sub=Math.max(1, Math.ceil(speed/4));
      let done=false;
      for (let s=0;s<sub && !done;s++){
        pr.x += pr.vx/sub; pr.y += pr.vy/sub;
        collectCoinsAt(pr);
        if (pr.steps>GRACE){
          for (const w of G.players){
            if (w.alive && dist(pr.x,pr.y,w.x,w.y) < WORM_R+3){ resolveHit(pr, i); done=true; break; }
          }
          if (done) break;
        }
        if (!pr.raygun && pr.steps>GRACE && isSolid(pr.x,pr.y)){
          if (pr.w==='grenade' && pr.bounces>0){
            pr.x -= pr.vx/sub; pr.y -= pr.vy/sub;
            pr.vy = -Math.abs(pr.vy)*0.5; pr.vx *= 0.6; pr.bounces--;
            spawnParticles(pr.x,pr.y,5,['#cfe'],{ spread:2, life:14 });
          } else if (pr.w==='grenade'){
            pr.vx*=0.4; pr.vy=0; pr.x -= pr.vx/sub;
          } else { resolveHit(pr, i); done=true; }
          break;
        }
      }
      if (done) continue;
      pr.steps++;
      if (pr.gravity || pr.raygun){ pr.trail.push({x:pr.x,y:pr.y}); if (pr.trail.length>16) pr.trail.shift(); }
      if (pr.w==='grenade'){ pr.fuse--; if (pr.fuse<=0){ resolveHit(pr,i); continue; } }
      if (pr.x<-40||pr.x>W+40||pr.y>H+50||(pr.raygun&&pr.y<-40)){ G.projectiles.splice(i,1); }
    }
  }
  function resolveHit(pr, idx){
    G.projectiles.splice(idx,1);
    if (pr.curse){ createCurseCoin(pr.x, pr.y); return; }
    if (pr.cluster){
      explode(pr.x,pr.y,pr,false);
      for (let k=0;k<pr.cluster;k++){
        const ang=-Math.PI/2 + rnd(-1.1,1.1);
        const sp=rnd(3,6);
        const sub={ owner:pr.owner, x:pr.x, y:pr.y-2, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp,
          w:'cluster_sub', steps:0, grace:6, trail:[], bounces:0, fuse:0, gravity:true, raygun:false,
          curse:false, radius:22, dmg:[1,0], cluster:0, sub:true };
        G.projectiles.push(sub);
      }
      return;
    }
    explode(pr.x,pr.y,pr,true);
  }
  function explode(x,y,pr,carve){
    const r=pr.radius;
    if (r>0 && carve!==false){ carveTerrain(x,y,r); }
    if (r>0){
      spawnExplosion(x,y,r);
      spawnParticles(x,y, r>45?36:18, ['#ffffff','#ffe08a','#ff8a3a','#ff3b2f'], { spread:r>45?7:4.5, life:r>45?34:24 });
    } else {
      spawnParticles(x,y,10,['#ff7a2f','#fff'],{spread:3,life:18});
    }
    applyDamage(x,y,pr);
  }
  function applyDamage(x,y,pr){
    const r=Math.max(pr.radius,12);
    for (const w of G.players){
      if (!w.alive) continue;
      const d=dist(x,y,w.x,w.y);
      if (d>r+WORM_R) continue;
      let dmg = d<=r*0.55 ? pr.dmg[0] : pr.dmg[1];
      if (dmg<=0) continue;
      w.lives -= dmg;
      G.turnHits.set(w.pid, (G.turnHits.get(w.pid)||0) + dmg);
      addFloater(w.x, w.y-WORM_R-20, '-'+dmg+'❤', '#ff6a7a');
      const ang=Math.atan2(w.y-y, w.x-x);
      const push=clamp((r-d)/r,0,1)*16;
      w.x = clamp(w.x+Math.cos(ang)*push, WORM_R, W-WORM_R);
      w.vy = -Math.abs(Math.sin(ang))*4 - 1.5; w.settled=false;
      if (w.lives<=0){
        w.lives=0; w.alive=false;
        addFloater(w.x, w.y-WORM_R-20, '💀', '#fff');
        spawnParticles(w.x,w.y,28,[w.col,'#fff','#ffd24a'],{spread:6,life:40});
      }
    }
  }

  /* ================= Explosions / particles / floaters ================= */
  function spawnExplosion(x,y,r){ G.explosions.push({x,y,r:r*0.3,maxR:r,life:1}); }
  function spawnParticles(x,y,n,colors,o){ o=o||{}; const spread=o.spread||4, life=o.life||26;
    for (let i=0;i<n;i++){ const a=rnd(0,6.28), sp=rnd(1,spread);
      G.particles.push({ x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - rnd(0,1.5),
        life:life+rint(-6,6), maxLife:life, size:rnd(1.5,4), color:pick(colors), grav:o.grav==null?0.18:o.grav }); } }
  function addFloater(x,y,text,color){ G.floaters.push({x,y,text,color,life:60,maxLife:60}); }

  function updateEffects(dt){
    for (let i=G.explosions.length-1;i>=0;i--){ const e=G.explosions[i];
      e.r=lerp(e.r,e.maxR,0.4); e.life-=0.05*dt; if (e.life<=0) G.explosions.splice(i,1); }
    for (let i=G.particles.length-1;i>=0;i--){ const p=G.particles[i];
      p.vy+=p.grav*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; if (p.life<=0) G.particles.splice(i,1); }
    for (let i=G.floaters.length-1;i>=0;i--){ const f=G.floaters[i];
      f.y-=0.7*dt; f.life-=dt; if (f.life<=0) G.floaters.splice(i,1); }
  }

  /* ================= Coins ================= */
  function spawnCoins(target){
    if (!coinsEnabled) return;
    let guard=0;
    while (G.coins.filter(c=>!c.cursed).length < target && guard++<200){
      const x=rnd(50,W-50);
      const surf=surfaceAt(x);
      const baseY=rnd(H*0.16, Math.max(H*0.22, surf-46));
      const big=srnd()<0.25;
      G.coins.push({ x, baseY, y:baseY, r:big?21:13, big,
        value: big?pick([50,60,80]):pick([10,20,30]), ph:rnd(0,6.28), cursed:false });
    }
  }
  function maybeRespawnCoins(){ if (coinsEnabled && G.coins.filter(c=>!c.cursed).length < COIN_MIN) spawnCoins(COIN_TARGET); }
  function createCurseCoin(x,y){
    x=clamp(x,30,W-30);
    const surf=surfaceAt(x);
    G.coins.push({ x, baseY:Math.min(y, surf-22), y, r:16, big:false, value:0, ph:rnd(0,6.28), cursed:true });
    addFloater(x,y-24,'💀 Forbannelse lagt!','#c78bff');
  }
  function updateCoins(t){ for (const c of G.coins){ c.y = c.baseY + Math.sin(t*0.002+c.ph)*(c.cursed?3:5); } }
  function collectCoinsAt(pr){
    for (let i=G.coins.length-1;i>=0;i--){
      const c=G.coins[i];
      if (dist(pr.x,pr.y,c.x,c.y) < c.r+3){
        const shooter=G.players[pr.owner];
        if (c.cursed){
          const d=pick(DEBUFFS); shooter.debuff=d.id;
          addFloater(c.x,c.y-10, d.label, '#c78bff');
          spawnParticles(c.x,c.y,18,['#b06bff','#7a3bff','#fff'],{spread:4,life:30});
          G.coins.splice(i,1); onRefresh();
        } else {
          const recip = shooter._stealing ? (foeOf(shooter)||shooter) : shooter;
          recip.money += c.value;
          addFloater(c.x,c.y-8, (shooter._stealing?'🩸 ':'+')+c.value+' kr', shooter._stealing? recip.col : '#ffd24a');
          spawnParticles(c.x,c.y, c.big?20:12, ['#ffd24a','#fff','#ffe9a8'],{spread:c.big?5:3.5,life:26});
          G.coins.splice(i,1); onRefresh();
        }
      }
    }
  }
  function foeOf(p){ return G.players.find(q=>q.alive && q.team!==p.team) || G.players.find(q=>q.team!==p.team); }

  /* ================= Draw: world entities ================= */
  function drawCoins(t){
    for (const c of G.coins){
      ctx.save();
      if (c.cursed){
        const pul=0.6+0.4*Math.sin(t*0.006+c.ph);
        ctx.shadowColor='#b06bff'; ctx.shadowBlur=18*pul;
        ctx.fillStyle='#3a1457'; ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,7); ctx.fill();
        ctx.shadowBlur=0; ctx.strokeStyle='#c78bff'; ctx.lineWidth=2; ctx.stroke();
        ctx.font=(c.r+4)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('💀', c.x, c.y+1);
      } else {
        if (c.big){ ctx.shadowColor='#ffcf4d'; ctx.shadowBlur=16; }
        const g=ctx.createRadialGradient(c.x-c.r*0.3,c.y-c.r*0.3,1,c.x,c.y,c.r);
        g.addColorStop(0,'#fff3c0'); g.addColorStop(0.5,'#ffcf4d'); g.addColorStop(1,'#c98a17');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,7); ctx.fill();
        ctx.shadowBlur=0; ctx.strokeStyle='#8a5e0f'; ctx.lineWidth=1.5; ctx.stroke();
        ctx.fillStyle='#9a6a12'; ctx.font='bold '+(c.big?13:9)+'px sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(c.value, c.x, c.y+1);
      }
      ctx.restore();
    }
  }
  function drawProjectiles(){
    for (const pr of G.projectiles){
      if (pr.raygun){
        for (let i=0;i<pr.trail.length;i++){ const tp=pr.trail[i], a=i/pr.trail.length;
          ctx.fillStyle='rgba(80,230,255,'+(a*0.6)+')'; ctx.beginPath(); ctx.arc(tp.x,tp.y,4*a+1,0,7); ctx.fill(); }
        ctx.shadowColor='#5fe6ff'; ctx.shadowBlur=16; ctx.fillStyle='#bff6ff';
        ctx.beginPath(); ctx.arc(pr.x,pr.y,5,0,7); ctx.fill();
        ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(pr.x,pr.y,2.4,0,7); ctx.fill(); ctx.shadowBlur=0;
        continue;
      }
      for (let i=0;i<pr.trail.length;i++){ const tp=pr.trail[i], a=i/pr.trail.length;
        ctx.fillStyle='rgba(255,150,60,'+(a*0.45)+')'; ctx.beginPath(); ctx.arc(tp.x,tp.y,3*a+1,0,7); ctx.fill(); }
      if (pr.w==='grenade'){ const blink=pr.fuse<40&&((pr.fuse>>2)&1); ctx.fillStyle=blink?'#ff3b2f':'#2b3a22';
        ctx.beginPath(); ctx.arc(pr.x,pr.y,5,0,7); ctx.fill(); ctx.strokeStyle='#8aff6a'; ctx.lineWidth=1; ctx.stroke(); }
      else if (pr.w==='cluster'||pr.w==='cluster_sub'){ ctx.fillStyle='#a06bff'; ctx.beginPath(); ctx.arc(pr.x,pr.y,pr.sub?3:5,0,7); ctx.fill(); }
      else { ctx.fillStyle='#ffd24a'; ctx.beginPath(); ctx.arc(pr.x,pr.y,4,0,7); ctx.fill();
        ctx.fillStyle='#ff5a2f'; ctx.beginPath(); ctx.arc(pr.x,pr.y,2,0,7); ctx.fill(); }
    }
  }
  function drawExplosions(){
    for (const e of G.explosions){
      const g=ctx.createRadialGradient(e.x,e.y,1,e.x,e.y,e.r);
      g.addColorStop(0,'rgba(255,255,255,'+e.life+')');
      g.addColorStop(0.4,'rgba(255,180,60,'+(e.life*0.9)+')');
      g.addColorStop(0.8,'rgba(255,60,40,'+(e.life*0.6)+')');
      g.addColorStop(1,'rgba(255,60,40,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,7); ctx.fill();
    }
  }
  function drawParticles(){
    for (const p of G.particles){ ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);
      ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,7); ctx.fill(); }
    ctx.globalAlpha=1;
  }
  function drawFloaters(){
    ctx.textAlign='center'; ctx.textBaseline='middle';
    for (const f of G.floaters){ ctx.globalAlpha=clamp(f.life/f.maxLife,0,1);
      ctx.font='bold 16px sans-serif'; ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillText(f.text,f.x+1,f.y+1);
      ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); }
    ctx.globalAlpha=1;
  }
  function drawHud(){
    const p=cur(); if(!p) return;
    // turbanner topp-senter
    if (bannerTimer>0){
      ctx.save();
      ctx.globalAlpha=clamp(bannerTimer/300,0,1);
      ctx.font='bold 22px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      const tw=ctx.measureText(bannerText).width;
      ctx.fillStyle='rgba(8,12,40,.85)';
      roundRect(W/2-tw/2-18, 12, tw+36, 38, 16); ctx.fill();
      ctx.fillStyle='#fff'; ctx.fillText(bannerText, W/2, 19);
      ctx.restore();
    }
    // hjelpetekst bunn-senter
    let help='';
    if (G.phase==='move') help='Flytt ormen ('+Math.max(0,Math.round(p.moveLeft))+'px igjen) — så sikt og skyt';
    else if (G.phase==='turn') help='Sikt og slipp for å skyte';
    if (help){
      ctx.save(); ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
      const tw=ctx.measureText(help).width;
      ctx.fillStyle='rgba(8,12,40,.6)'; roundRect(W/2-tw/2-14, H-34, tw+28, 24, 12); ctx.fill();
      ctx.fillStyle='#9aa4cf'; ctx.fillText(help, W/2, H-12); ctx.restore();
    }
    // debuff-varsel topp-høyre
    if (p.debuff && (G.phase==='move'||G.phase==='turn'||G.phase==='shop')){
      const d=DEBUFFS.find(x=>x.id===p.debuff);
      if (d){ ctx.save(); ctx.font='bold 13px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='top';
        const tw=ctx.measureText('⚠ '+d.label).width;
        ctx.fillStyle='rgba(120,30,160,.9)'; roundRect(W-tw-28, 12, tw+18, 26, 10); ctx.fill();
        ctx.fillStyle='#fff'; ctx.fillText('⚠ '+d.label, W-16, 18); ctx.restore(); }
    }
  }
  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  /* ================= Turn flow ================= */
  function moveWorm(p, dir, dt){
    p.face=dir;
    const budget=Math.min(MOVE_SPEED*dt, p.moveLeft);
    if (budget<=0) return;
    const nx=clamp(p.x+dir*budget, WORM_R, W-WORM_R);
    const surfN=surfaceAt(nx);
    if (surfN >= p.y+WORM_R-16){
      const moved=Math.abs(nx-p.x);
      p.x=nx; p.moveLeft-=moved;
      p.y = (surfN>=H? H-WORM_R-1 : surfN-WORM_R);
    }
  }
  function endFlight(){
    for (const p of G.players) p._stealing=false;
    setPhase('transition'); G.transTimer=0;
  }
  function finishTransition(){
    maybeRespawnCoins();
    if (mode==='network'){
      const hits = Array.from(G.turnHits.entries()).map(([pid,dmg]) => ({ pid, dmg }));
      setPhase('idle');
      onTurnEnd(hits);
      return;
    }
    // lokal hot-seat: sjekk seier, ellers neste levende orm
    const at = aliveTeams();
    const aliveCount = at.filter(Boolean).length;
    if (aliveCount<=1){
      const winner = at[0] ? 0 : (at[1] ? 1 : null);
      setPhase('gameover'); onGameOver(winner);
      return;
    }
    advanceLocalTurn();
  }
  function advanceLocalTurn(){
    let guard=0;
    do { G.cur = (G.cur+1) % G.players.length; guard++; }
    while (!G.players[G.cur].alive && guard<=G.players.length*2);
    G.round++;
    beginTurnInternal(true);
  }
  function beginTurnInternal(withShop){
    const p=cur();
    p.moveLeft=MOVE_BUDGET; p.face=(p.x<W/2?1:-1);
    placeWormOnSurface(p);
    G.aim.dragging=false; G.aim.net=false; keyDir=0;
    onRefresh();
    if (withShop && mode==='local'){
      setPhase('shop');
    } else {
      setPhase('move');
      banner(p.name + ' sin tur!', 1300);
    }
  }
  function aliveTeams(){
    const at=[false,false];
    for (const p of G.players) if (p.alive) at[p.team]=true;
    return at;
  }

  /* ================= update / render dispatch ================= */
  let keyDir = 0; // -1 / 0 / +1 (lokal tastatur)
  function update(dt){
    if (!G) return;
    const t=performance.now();
    if (bannerTimer>0) bannerTimer-=dt*16.67;
    updateCoins(t);
    updateEffects(dt);
    if (G.phase==='move'){
      const p=cur();
      if (keyDir!==0) moveWorm(p, keyDir, dt);
    } else if (G.phase==='flight'){
      updateProjectiles(dt);
      if (G.projectiles.length===0) endFlight();
    } else if (G.phase==='transition'){
      let settled=true;
      for (const w of G.players){ if (w.alive && !stepWormGravity(w)) settled=false; }
      if (settled){ G.transTimer+=dt; if (G.transTimer>26) finishTransition(); }
    }
  }
  function render(){
    const t=performance.now();
    drawSky(t);
    ctx.drawImage(terrainCv,0,0);
    drawCoins(t);
    for (const p of G.players) drawWorm(p,t);
    drawProjectiles();
    drawExplosions();
    drawParticles();
    drawAim(t);
    drawFloaters();
    drawHud();
  }
  let lastT=0;
  function frame(t){
    const dt=Math.min(2.5, (t-lastT)/16.667 || 1);
    lastT=t;
    if (G){ if (mode!=='mirror') update(dt); render(); }
    raf=requestAnimationFrame(frame);
  }

  /* ================= Sizing ================= */
  // Fast intern oppløsning (VW×VH). Canvas-elementet skaleres via CSS.
  function resize(){
    W = VW; H = VH;
    cv.width = W; cv.height = H;
  }

  /* ================= Public API ================= */
  function start(config){
    config = config || {};
    if (config.teams) TEAMS = config.teams;
    if (config.seed!=null) _seed = (config.seed|0) || 1234567;
    coinsEnabled = config.coins !== false;
    resize();
    if (!terrainCv){ terrainCv = document.createElement('canvas'); }
    terrainCv.width = W; terrainCv.height = H; terrainCtx = terrainCv.getContext('2d');
    G = freshState();
    const descs = config.worms || [];
    genTerrain(descs.length || 2);
    makeStars();
    G.players = descs.map((d,i) => makePlayer(i, d));
    for (const p of G.players) placeWormOnSurface(p);
    if (coinsEnabled) spawnCoins(COIN_TARGET);
    G.cur = 0; G.round = 1;
    setPhase('idle');
    if (!raf) raf = requestAnimationFrame(frame);
    onRefresh();
  }
  // Nettverk: server sier hvem som er aktiv
  function beginTurn(pid){
    if (!G) return;
    const idx = G.players.findIndex(p=>p.pid===pid);
    if (idx<0) return;
    G.cur = idx;
    beginTurnInternal(false);
  }
  // Lokal hot-seat: start gjeldende spillers tur med shop
  function beginTurnLocal(){ if (G) beginTurnInternal(true); }
  // Lukk shop → move (hot-seat «Start tur»-knapp)
  function closeShopToMove(){
    if (!G || G.phase!=='shop') return;
    const p=cur(); p.moveLeft=MOVE_BUDGET;
    setPhase('move'); banner(p.name+' sin tur!', 1300);
    onRefresh();
  }
  // Generisk input. type: 'move'|'aim'|'release'|'fire'|'mouse'
  function input(type, payload){
    if (!G) return;
    payload = payload || {};
    if (type==='move'){
      // {dir:-1|1, on:bool}  (nettverk) eller lokal kall
      if (G.phase!=='move' && G.phase!=='turn') return;
      // Worms-følelse: flytting er lov helt til skudd. Trykker man flytt mens man
      // har påbegynt sikte (turn), avbrytes siktet og vi går tilbake til move.
      if (G.phase==='turn' && payload.on){
        G.aim.net=false; G.aim.dragging=false; setPhase('move');
      }
      keyDir = payload.on ? (payload.dir<0?-1:1) : 0;
    } else if (type==='toTurn'){
      if (G.phase==='move') setPhase('turn');
    } else if (type==='select'){
      // {id}  — velg eid våpen
      selectWeapon(null, payload.id);
    } else if (type==='buy'){
      // {id}  — kjøp våpen hvis råd
      buyWeapon(null, payload.id);
    } else if (type==='aim'){
      // {angle, power, dragging}  (nettverk slingshot live)
      if (G.phase==='move') setPhase('turn');
      if (G.phase!=='turn') return;
      // dragging:false = spilleren slapp sikteflaten uten å skyte → nullstill siktet
      if (!payload.dragging){ G.aim.net=false; G.aim.dragging=false; return; }
      G.aim.net=true; G.aim.angle=payload.angle; G.aim.power=clamp(payload.power||0,0,1);
      G.aim.dragging=true;
    } else if (type==='fire'){
      // {angle, power}  (nettverk slipp)
      if (G.phase==='move') setPhase('turn');
      if (G.phase!=='turn') return;
      G.aim.net=true; G.aim.angle=payload.angle; G.aim.power=clamp(payload.power||0,0,1);
      releaseFire();
    }
  }
  // Lokal mus/tastatur-bro (hot-seat)
  function localKey(dir, on){
    if (on){ if (G && G.phase==='move') keyDir = dir; }
    else { if (keyDir===dir) keyDir = 0; }
  }
  function localMouse(kind, mx, my){
    if (!G) return;
    G.aim.net=false; G.aim.mx=mx; G.aim.my=my;
    if (kind==='down'){
      if (G.phase==='move'){ setPhase('turn'); }
      if (G.phase==='turn'){ G.aim.dragging=true; G.aim.ax=mx; G.aim.ay=my; }
    } else if (kind==='up'){
      if (G.phase==='turn' && G.aim.dragging){ releaseFire(); }
    }
  }
  function spacePressed(){ if (G && G.phase==='move') setPhase('turn'); }
  // Synk kanoniske liv fra server
  function setLives(map){
    if (!G) return;
    for (const p of G.players){
      if (map[p.pid]!=null){ p.lives = map[p.pid]; if (p.lives<=0) p.alive=false; }
    }
  }
  function selectWeapon(pid,id){ const p=pid?wormByPid(pid):cur(); if(p&&p.owned.has(id)){ p.sel=id; onRefresh(); } }
  function buyWeapon(pid,id){ const p=pid?wormByPid(pid):cur(); if(!p) return; const w=WEAPONS[id];
    if (!p.owned.has(id) && p.money>=w.price){ p.money-=w.price; p.owned.add(id); p.sel=id; onRefresh(); } }
  function setGameOver(){ if (G){ setPhase('gameover'); } }
  function dispose(){ if (raf){ cancelAnimationFrame(raf); raf=0; } G=null; }

  /* ================= Snapshot / mirror (nettverk → telefoner) ================= */
  // Host produserer en kompakt snapshot per frame; speilende klienter rendrer den.
  function aimSnapshot(){
    if (!G || !G.aim.net) return null;
    const p=cur(); if(!p||!p.alive) return null;
    return { on:1, a:G.aim.angle, p:G.aim.power };
  }
  function snapshot(){
    if (!G) return null;
    const c = cur();
    return {
      ph: G.phase,
      cur: c ? c.pid : null,
      w: G.players.map(p => ({ p:p.pid, x:Math.round(p.x), y:Math.round(p.y), l:p.lives, a:p.alive?1:0, f:p.face })),
      pr: G.projectiles.map(o => ({ x:Math.round(o.x), y:Math.round(o.y), t:o.w, fu:o.fuse|0 })),
      ex: G.explosions.map(o => ({ x:Math.round(o.x), y:Math.round(o.y), r:Math.round(o.r), lf:+o.life.toFixed(2) })),
      co: G.coins.map(o => ({ x:Math.round(o.x), y:Math.round(o.y), r:o.r, b:o.big?1:0, v:o.value, c:o.cursed?1:0 })),
      // loadout for aktiv orm → spillerens arsenal-UI
      ld: c ? { m:c.money, sel:c.sel, own:Array.from(c.owned) } : null,
      aim: aimSnapshot(),
      bn: bannerText, bt: Math.round(bannerTimer)
    };
  }
  function applySnapshot(s){
    if (!G || !s) return;
    if (s.ph) G.phase = s.ph;
    if (s.cur != null){ const i = G.players.findIndex(p => p.pid === s.cur); if (i >= 0) G.cur = i; }
    if (s.w) for (const ws of s.w){
      const p = G.players.find(x => x.pid === ws.p);
      if (p){ p.x = ws.x; p.y = ws.y; p.lives = ws.l; p.alive = !!ws.a; p.face = ws.f; }
    }
    G.projectiles = (s.pr || []).map(o => ({ x:o.x, y:o.y, w:o.t, raygun:o.t==='raygun', trail:[], fuse:o.fu||0, sub:false }));
    G.explosions = (s.ex || []).map(o => ({ x:o.x, y:o.y, r:o.r, maxR:o.r, life:o.lf }));
    G.coins = (s.co || []).map(o => ({ x:o.x, baseY:o.y, y:o.y, r:o.r, big:!!o.b, value:o.v, ph:0, cursed:!!o.c }));
    if (s.aim && s.aim.on){ G.aim.net = true; G.aim.dragging = true; G.aim.angle = s.aim.a; G.aim.power = s.aim.p; }
    else { G.aim.net = false; G.aim.dragging = false; }
    if (s.bn != null){ bannerText = s.bn; bannerTimer = s.bt || 0; }
  }
  // Aktiv orms loadout fra siste snapshot (for speilende spillers arsenal-UI).
  function loadoutFromSnapshot(s){ return (s && s.ld) || null; }
  function applyCarve(cx,cy,r){ if (G) carveTerrainLocal(cx,cy,r); }

  const api = {
    start, beginTurn, beginTurnLocal, closeShopToMove, input,
    localKey, localMouse, spacePressed, setLives,
    selectWeapon, buyWeapon, setGameOver, dispose,
    aliveTeams, resize,
    snapshot, applySnapshot, applyCarve, loadoutFromSnapshot,
    getCurrent: () => cur(),
    getPlayers: () => G ? G.players : [],
    getPhase: () => G ? G.phase : 'idle',
    VW, VH,
    WEAPONS, WEAPON_ORDER, DEBUFFS, MAX_DRAG
  };
  return api;
}

