// Engangs røyktest for Snake 2.0 — kjøres manuelt mot en kjørende server.
// Verifiserer klassiske invarianter: nøyaktig 1 eple, kun 'normal'-type,
// vegg-kollisjon = død, og respawn etterpå.
import { io } from 'socket.io-client';
import { SNAKE_CHARS } from '../public/snake-chars.js';

const URL = process.env.URL || 'http://localhost:3996';
const opt = { forceNew: true };

const mkPlayer = (name) => new Promise((res) => {
  const s = io(URL, opt);
  s.on('connect', () => s.emit('player:hello', { name, emoji: '🐍' }));
  s.on('player:welcome', () => res(s));
});

const host = io(URL, opt);
await new Promise(r => { host.on('connect', () => host.emit('host:hello', { password: 'dnb' })); host.on('state', r); });
const p1 = await mkPlayer('P1');
const p2 = await mkPlayer('P2');

let phase = '', foodViolations = 0, maxFood = 0, p1Died = false, p1Respawned = false, sawSelect = false;
const tickMsSeen = new Set();
let lastApples = 0;

host.on('state', (s) => {
  phase = s.phase;
  if (phase === 'snake-select' && !sawSelect){
    sawSelect = true;
    const ids = SNAKE_CHARS.map(c => c.id);
    p1.emit('player:snake-char', { charId: ids[0] });
    p2.emit('player:snake-char', { charId: ids[1] });
  }
});

host.on('snake:tick', (d) => {
  const n = (d.food || []).length;
  maxFood = Math.max(maxFood, n);
  if (n !== 1) foodViolations++;
  if ((d.food || []).some(f => f.type && f.type !== 'normal')) foodViolations++;
  const a = (d.snakes || []).find(x => x.name === 'P1');
  if (a && !a.alive) p1Died = true;
  if (a && a.alive && p1Died) p1Respawned = true;
});

host.emit('host:start-snake');
const drive = setInterval(() => { if (phase === 'snake') p1.emit('player:snake-dir', { dir: 'up' }); }, 90);

await new Promise(r => setTimeout(r, 20000));
clearInterval(drive);

console.log('sluttfase:          ', phase);
console.log('maks epler samtidig:', maxFood, '(skal være 1)');
console.log('food-brudd:         ', foodViolations, '(skal være 0)');
console.log('P1 døde i vegg:     ', p1Died);
console.log('P1 respawnet:       ', p1Respawned);
const ok = maxFood === 1 && foodViolations === 0 && p1Died && p1Respawned;
console.log(ok ? '\n✓ SNAKE 2.0 INVARIANTER OK' : '\n✗ NOE FEILET');
host.close(); p1.close(); p2.close();
process.exit(ok ? 0 : 1);
