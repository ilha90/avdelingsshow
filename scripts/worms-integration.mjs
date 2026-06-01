// Integrasjonstest: ekte server + socket.io-klienter. Kjører hele Romkrig-flyten
// (start → turorden → relay → result → kill → eliminasjon → gameover + scoring).
// Kjør:  node test/worms-integration.mjs
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3599;
const URL = `http://localhost:${PORT}`;
const SNAP = path.join(ROOT, 'state-snapshot.json');

// Flytt evt. snapshot til side så den ikke gjenoppretter gamle spillere
let movedSnap = false;
if (fs.existsSync(SNAP)){ fs.renameSync(SNAP, SNAP + '.bak'); movedSnap = true; }

const fails = [];
function check(cond, msg){ if (!cond){ fails.push(msg); console.error('FAIL:', msg); } else console.log('ok:', msg); }

const srv = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST_PASSWORD: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));

function cleanup(code){
  try { srv.kill('SIGKILL'); } catch(_){}
  try { if (fs.existsSync(SNAP)) fs.unlinkSync(SNAP); } catch(_){}
  if (movedSnap && fs.existsSync(SNAP + '.bak')) fs.renameSync(SNAP + '.bak', SNAP);
  process.exit(code);
}

function waitFor(stream, re, ms){
  return new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('timeout venter på ' + re)), ms);
    stream.on('data', d => { buf += d; if (re.test(buf)){ clearTimeout(to); res(); } });
  });
}

async function main(){
  await waitFor(srv.stdout, /lytter på/, 8000);

  // Host
  const host = io(URL, { transports: ['websocket'] });
  await new Promise(r => host.on('connect', r));
  host.emit('host:hello', { password: 'test' });
  await new Promise((res, rej) => { host.on('host:ok', res); host.on('host:denied', () => rej(new Error('host denied'))); });
  check(true, 'host innlogget');

  // 4 spillere
  const players = [];
  for (let i = 0; i < 4; i++){
    const s = io(URL, { transports: ['websocket'] });
    await new Promise(r => s.on('connect', r));
    s.emit('player:hello', { name: 'P' + i, emoji: '🦊' });
    const welcome = await new Promise(r => s.on('player:welcome', r));
    players.push({ sock: s, id: welcome.id });
  }
  const byId = new Map(players.map(p => [p.id, p]));
  check(players.length === 4, '4 spillere koblet til');

  // Modell av lag/levende fra worms:init
  let wormTeam = new Map();       // pid -> team
  let alive = new Set();
  let initSeen = false, controlsToHost = 0, gameover = null;
  let lastEndState = null;
  let framesToPlayers = 0, carvesToPlayers = 0;
  host.on('state', s => { if (s.phase === 'end') lastEndState = s; });
  // En spiller verifiserer at host-stream relayes til spillere
  players[0].sock.on('worms:frame', () => { framesToPlayers++; });
  players[0].sock.on('worms:carve', () => { carvesToPlayers++; });

  host.on('worms:init', data => {
    initSeen = true;
    for (const w of data.worms){ wormTeam.set(w.pid, w.team); alive.add(w.pid); }
  });
  host.on('worms:control', () => { controlsToHost++; });
  host.on('worms:gameover', go => { gameover = go; });

  // Når det er en spillers tur: den fyrer; host «simulerer» motoren og dreper
  // første levende fiende ved å rapportere dødelig skade.
  let turnCount = 0;
  host.on('worms:turn', ({ active }) => {
    turnCount++;
    if (turnCount > 40){ return; }
    const sock = byId.get(active);
    if (!sock) return;
    sock.sock.emit('player:worms-fire', { angle: 0, power: 0.6 });
  });

  // Host mottar fire-control og svarer med dødelig treff på første fiende.
  host.on('worms:control', ({ type }) => {
    if (type !== 'fire') return;
    // finn aktiv (siste turn) — vi sporer via egen variabel
    const activePid = lastActive;
    const myTeam = wormTeam.get(activePid);
    const enemy = [...alive].find(pid => wormTeam.get(pid) !== myTeam);
    const hits = enemy ? [{ pid: enemy, dmg: 4 }] : [];
    if (enemy) alive.delete(enemy);
    // Simuler at host strømmer render-snapshot + terreng-carve til spillerne
    host.emit('host:worms-frame', { ph: 'flight', cur: activePid, w: [], pr: [{ x: 100, y: 100, t: 'rocket' }], ex: [] });
    host.emit('host:worms-carve', { cx: 100, cy: 100, r: 40 });
    setTimeout(() => host.emit('host:worms-result', { hits }), 10);
  });
  let lastActive = null;
  host.on('worms:turn', ({ active }) => { lastActive = active; });

  // Start spillet + hopp over tutorial
  host.emit('host:start-worms');
  await new Promise(r => setTimeout(r, 150));
  host.emit('host:skip-tutorial');

  // Vent på gameover (eller timeout)
  await new Promise((res) => {
    const to = setTimeout(res, 9000);
    host.on('worms:gameover', () => { clearTimeout(to); setTimeout(res, 200); });
  });

  check(initSeen, 'worms:init mottatt av host');
  check(controlsToHost > 0, 'worms:control relayet til host (' + controlsToHost + ')');
  check(gameover != null, 'worms:gameover mottatt');
  check(gameover && (gameover.winnerTeam === 0 || gameover.winnerTeam === 1), 'gameover har et vinnerlag: ' + JSON.stringify(gameover));

  // Sjekk at sluttstate har phase end + lastGame=worms (fanget gjennom hele kjøringen)
  await new Promise(r => setTimeout(r, 300));
  check(lastEndState && lastEndState.phase === 'end', 'server-state nådde phase=end etter runden');
  check(lastEndState && lastEndState.lastGame === 'worms', 'lastGame=worms i sluttstate');
  check(framesToPlayers > 0, 'worms:frame relayet til spiller (' + framesToPlayers + ')');
  check(carvesToPlayers > 0, 'worms:carve relayet til spiller (' + carvesToPlayers + ')');

  console.log('\n' + (fails.length ? ('FEILET ❌ (' + fails.length + ')') : 'INTEGRASJON OK ✅'));
  cleanup(fails.length ? 1 : 0);
}

main().catch(e => { console.error(e); cleanup(1); });
setTimeout(() => { console.error('global timeout'); cleanup(1); }, 20000);
