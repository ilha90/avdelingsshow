// Headless smoke-test av worms-engine.js — stub DOM/canvas, pump RAF manuelt.
import { createWormsEngine } from '../public/worms-engine.js';

function makeCtx(){
  const grad = { addColorStop(){} };
  return new Proxy({}, {
    get(t, prop){
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v){ t[prop] = v; return true; }
  });
}
function makeCanvas(w, h){
  return { width:w, height:h, clientWidth:w, clientHeight:h,
    getContext(){ return makeCtx(); }, addEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,width:w,height:h}; } };
}

global.performance = global.performance || { now: () => Date.now() };
global.document = { createElement(){ return makeCanvas(1200, 600); } };

let frameCb = null, tms = 0;
global.requestAnimationFrame = (cb) => { frameCb = cb; return 1; };
global.cancelAnimationFrame = () => { frameCb = null; };
function pump(n){ for (let i=0; i<n && frameCb; i++){ const cb = frameCb; frameCb = null; tms += 16; cb(tms); } }

const teams = [
  { id:0, name:'Rødt lag',  col:'#ff4d5e', dark:'#b3303d', cap:'#ffd34d' },
  { id:1, name:'Blått lag', col:'#4d9bff', dark:'#2f63b3', cap:'#7dffea' }
];
const worms = [
  { pid:'r0', name:'Kari', team:0, lives:4 },
  { pid:'b0', name:'Per',  team:1, lives:4 },
  { pid:'r1', name:'Ola',  team:0, lives:4 },
  { pid:'b1', name:'Liv',  team:1, lives:4 }
];

let turnEnds = 0, lastHits = null;
const engine = createWormsEngine({
  canvas: makeCanvas(1200, 600),
  mode: 'network',
  onTurnEnd: (hits) => { turnEnds++; lastHits = hits; }
});

let ok = true;
function check(cond, msg){ if (!cond){ ok = false; console.error('FAIL:', msg); } else console.log('ok:', msg); }

engine.start({ coins:false, teams, worms, seed: 42 });
pump(3);
check(engine.getPlayers().length === 4, '4 ormer opprettet');
check(engine.getPhase() === 'idle', 'idle etter start');

engine.beginTurn('r0');
check(engine.getPhase() === 'move', 'phase=move etter beginTurn(r0)');
check(engine.getCurrent().pid === 'r0', 'current er r0');

const r0 = engine.getPlayers().find(p => p.pid === 'r0');
const b0 = engine.getPlayers().find(p => p.pid === 'b0');
// b0 spawner ~360px til høyre for r0. Fyr et lobb-skudd som forbi grace-perioden
// (12 steg) lander oppå b0 og skader via eksplosjonsradius.
const dx = b0.x - r0.x;
// 45°-lobb: range = v²/g  →  v = sqrt(range*g). power = v/(SPEED_MAX*speed[rocket]=17)
const v = Math.sqrt(Math.abs(dx) * 0.27);
const power = Math.min(1, v / 17);
const ang = Math.atan2(-1, dx >= 0 ? 1 : -1);   // 45° opp i skjerm-koords (y ned)
// Bruk sniper (wobble 0.02) for deterministisk bane:
r0.owned.add('sniper'); r0.sel = 'sniper';
const v2 = Math.sqrt(Math.abs(dx) * 0.27);
const power2 = Math.min(1, v2 / (17 * 2));       // sniper speed = 2.0
engine.input('fire', { angle: ang, power: power2 });
check(engine.getPhase() === 'flight', 'phase=flight etter fire');

pump(800);   // flukt + treff + transition + onTurnEnd
check(turnEnds === 1, 'onTurnEnd fyrt nøyaktig én gang (fikk ' + turnEnds + ')');
check(engine.getPhase() === 'idle', 'tilbake til idle etter tur (er ' + engine.getPhase() + ')');
check(Array.isArray(lastHits), 'lastHits er en array: ' + JSON.stringify(lastHits));
console.log('   b0.lives etter lobb =', b0.lives, '(skade hvis < 4)');

// Drep b0 og b1 → lag 1 utryddet → aliveTeams = [true,false]
const b1 = engine.getPlayers().find(p => p.pid === 'b1');
b0.lives = 0; b0.alive = false;
b1.lives = 0; b1.alive = false;
const at = engine.aliveTeams();
check(at[0] === true && at[1] === false, 'aliveTeams=[true,false] når lag 1 er ute: ' + JSON.stringify(at));

// ---- Mirror-modus: snapshot fra host → applySnapshot på speil-motor ----
const snap = engine.snapshot();
check(snap && Array.isArray(snap.w) && snap.w.length === 4, 'snapshot har 4 ormer');
const mirror = createWormsEngine({ canvas: makeCanvas(1200, 600), mode: 'mirror' });
mirror.start({ coins:false, teams, worms, seed: 42 });
pump(2);
mirror.applySnapshot(snap);
mirror.applyCarve(100, 100, 40);   // skal ikke kaste
pump(3);
const mb0 = mirror.getPlayers().find(p => p.pid === 'b0');
check(mb0 && mb0.lives === b0.lives, 'speil-motor synket b0.lives fra snapshot: ' + (mb0 && mb0.lives));
check(mirror.VW === 1280 && mirror.VH === 720, 'fast oppløsning 1280×720 eksponert');
mirror.dispose();

console.log(ok ? '\nSMOKE OK ✅' : '\nSMOKE FEILET ❌');
process.exit(ok ? 0 : 1);
