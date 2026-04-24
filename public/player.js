// player.js — spiller-siden (mobil/laptop)
import { avatarFor } from '/avatars.js';
const socket = io({
  transports: ['websocket', 'polling'],
  upgrade: true,
  rememberUpgrade: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});
const screen = document.getElementById('screen');
let me = null;
let chosenEmoji = null;  // valgt avatar ved login
let state = null;
let lastPhase = null;
let chosenThisQ = null;
let votedThisRound = null;
let scatterDraft = {};
let wasKicked = false;
let connected = true;

function buzz(ms = 20) { if ('vibrate' in navigator) navigator.vibrate(ms); }

function updateConnBadge() {
  let b = document.getElementById('connBadge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'connBadge';
    b.className = 'conn-badge';
    document.body.appendChild(b);
  }
  if (connected) {
    b.classList.add('hidden');
  } else {
    b.classList.remove('hidden');
    b.textContent = '⚡ Kobler til…';
  }
}
updateConnBadge();

socket.on('connect', () => {
  connected = true;
  updateConnBadge();
  // Gjenopprett tilstand hvis vi var innlogget
  const saved = sessionStorage.getItem('player-name');
  if (saved && !me) {
    socket.emit('player:join', saved, chosenEmoji || undefined);
  }
});
socket.on('disconnect', () => { connected = false; updateConnBadge(); });
socket.on('reconnect_attempt', () => { connected = false; updateConnBadge(); });

// ===== Snake tick =====
let snakeSnap = null;
socket.on('snake:tick', s => {
  snakeSnap = s;
  if (state?.phase === 'snake') updateSnakePlayer();
});

// ===== Bomberman tick =====
let bombSnap = null;
let bombWallsCache = null;
socket.on('bomb:tick', s => {
  if (s.walls) bombWallsCache = s.walls;
  else if (bombWallsCache) s.walls = bombWallsCache;
  bombSnap = s;
  if (state?.phase === 'bomb') updateBombPlayer();
});

// Render login-skjerm umiddelbart
render();

socket.on('state', s => {
  const prev = state;
  state = s;
  if (prev && prev.phase !== s.phase) {
    if (s.phase === 'question') { chosenThisQ = null; }
    if (s.phase === 'voting') { votedThisRound = null; }
    if (s.phase === 'scatter-play') { scatterDraft = {}; }
    if (s.phase === 'lie-collect') { lieDraft = { s1: '', s2: '', s3: '', lieIdx: -1 }; lieSubmitted = false; }
    if (s.phase === 'lie-play') { lieVoteCast = null; lastLieTurnId = null; }
    if (s.phase === 'reveal' && me) {
      const m = currentMe();
      if (m?.lastCorrect === true) window.sfx?.correct();
      else if (m?.lastCorrect === false) window.sfx?.wrong();
    }
    if (s.phase === 'lie-reveal' && me) {
      const m = currentMe();
      if (m?.lastCorrect === true) window.sfx?.correct();
      else if (m?.lastCorrect === false) window.sfx?.wrong();
    }
    if (s.phase === 'end') window.sfx?.fanfare();
  }
  // Skip re-render hvis spiller er midt i lie-collect og ikke har sendt — ellers mister de input-focus
  if (prev && prev.phase === s.phase && s.phase === 'lie-collect' && !lieSubmitted && me) {
    const stillNotSubmitted = !(s.lieCollect?.submittedIds || []).includes(currentMe()?.id);
    if (stillNotSubmitted) { lastPhase = s.phase; return; }
  }
  lastPhase = s.phase;
  render();
});

socket.on('join:ok', ({ name }) => {
  me = name;
  sessionStorage.setItem('player-name', name);
  window.sfx?.join();
  buzz(30);
  render();
});
socket.on('join:error', msg => { const err = document.getElementById('err'); if (err) err.textContent = msg; });
socket.on('kicked', () => {
  me = null;
  wasKicked = true;
  sessionStorage.removeItem('player-name');
  render();
});

// Reactions (get light feedback when others react)
socket.on('reaction', ({ from, emoji }) => {
  if (from === me) return;
  // Subtle buzz when someone reacts
  buzz(10);
});

window.react = (emoji) => {
  socket.emit('player:react', emoji);
  buzz(20);
  // Little pop animation on player screen
  const el = document.createElement('div');
  el.className = 'self-react';
  el.textContent = emoji;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
};

function currentMe() {
  if (!state || !me) return null;
  return state.players.find(p => p.name === me);
}
function myTeam() {
  const m = currentMe();
  if (!m || !state.teamMode) return null;
  return state.teams.find(t => t.id === m.teamId);
}

function render() {
  try {
  if (wasKicked) {
    screen.innerHTML = `<div class="player-login"><h1>Du ble fjernet 👋</h1><p>Last siden på nytt for å bli med igjen.</p><button class="input-group" onclick="location.reload()" style="margin-top:20px; padding:14px 28px; background:var(--gold); color:#111; border:none; border-radius:12px; font-weight:700; cursor:pointer">Last på nytt</button></div>`;
    return;
  }
  if (!me || !currentMe()) return renderLogin();
  if (!state) return renderWaiting('Kobler til…');
  switch (state.phase) {
    case 'lobby':        return renderLobbyWait();
    case 'countdown':    return renderCountdown();
    case 'question':     return renderQuestion();
    case 'reveal':       return renderReveal();
    case 'leaderboard':  return renderMiniLeaderboard();
    case 'wheel':        return renderWheelWait();
    case 'voting':       return renderVoting();
    case 'vote-result':  return renderVoteResult();
    case 'scatter-play': return renderScatterPlay();
    case 'scatter-review': return renderScatterReview();
    case 'icebreaker':   return renderIcebreaker();
    case 'lie-collect':  return renderLieCollect();
    case 'lie-play':     return renderLiePlay();
    case 'lie-reveal':   return renderLieReveal();
    case 'snake':        return renderSnakePlayer();
    case 'snake-end':    return renderSnakeEndPlayer();
    case 'bomb':         return renderBombPlayer();
    case 'bomb-end':     return renderBombEndPlayer();
    case 'end':          return renderEnd();
  }
  } catch (e) { console.error('[player render]', e); }
}

// ============ LOGIN ============
function renderLogin() {
  const pool = ['🦊','🐼','🐨','🦁','🐯','🐸','🦄','🐲','🐙','🦉','🐺','🐹','🦒','🐧','🦈','🐬','🌵','🌻','🍄','⭐','🔥','⚡','👾','🤖','👻','🎨','🎸','🎮'];
  if (!chosenEmoji) chosenEmoji = pool[Math.floor(Math.random() * pool.length)];
  screen.innerHTML = `
    <div class="player-login">
      <h1>Avdelingsshow</h1>
      <p>Velg navn og avatar</p>
      <div class="avatar-picker" id="avatarPicker">
        ${pool.map(e => `<button class="av-opt ${e === chosenEmoji ? 'selected' : ''}" data-e="${e}">${e}</button>`).join('')}
      </div>
      <div class="input-group">
        <input id="nameInp" placeholder="Ditt navn" maxlength="20" autocomplete="off" autofocus>
        <button id="joinBtn">Bli med</button>
        <div class="err" id="err"></div>
      </div>
    </div>`;
  const input = document.getElementById('nameInp');
  const btn = document.getElementById('joinBtn');
  const go = () => { const v = input.value.trim(); if (v) socket.emit('player:join', v, chosenEmoji); };
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.getElementById('avatarPicker')?.querySelectorAll('.av-opt').forEach(b => {
    b.addEventListener('click', () => {
      chosenEmoji = b.dataset.e;
      document.querySelectorAll('.av-opt').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    });
  });
}

// ============ COUNTDOWN ============
function renderCountdown() {
  const endsAt = state.countdownEndsAt || Date.now() + 3000;
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div class="pq-meta">Gjør deg klar…${state.lightning ? ' ⚡ LYN' : ''}</div>
      <div class="player-countdown" id="pcdNum">3</div>
    </div>`;
  const el = document.getElementById('pcdNum');
  let lastN = -1;
  function tick() {
    const msLeft = endsAt - Date.now();
    const n = Math.ceil(msLeft / 1000);
    if (n <= 0) { el.textContent = 'GO!'; el.classList.add('go'); return; }
    if (n !== lastN) {
      lastN = n;
      el.textContent = n;
      el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
      buzz(15);
    }
    if (state.phase === 'countdown') requestAnimationFrame(tick);
  }
  tick();
}

// ============ HEADER ============
function headerHtml() {
  const m = currentMe();
  const t = myTeam();
  if (!m) return '';
  const av = m.emoji || avatarFor(m.name);
  return `<div class="player-me" ${t ? `style="border-color:${t.color}"` : ''}>
    <div class="name">
      <span class="avatar-lg">${av}</span>
      ${t ? `<span class="team-pill" style="background:${t.color}">${t.emoji} ${esc(t.name)}</span>` : ''}
      ${esc(m.name)}
    </div>
    <div class="score">${m.score} p</div>
  </div>`;
}

function reactionBar() {
  return `<div class="reaction-bar">
    ${['🔥','❤️','😂','👏','💪','😱','🎉','🤯'].map(e => `<button class="react-btn" onclick="react('${e}')">${e}</button>`).join('')}
  </div>`;
}

// ============ SNAKE ============
function mySnake() {
  if (!snakeSnap) return null;
  // Match by name (server key er socketId som vi ikke vet selv)
  return snakeSnap.snakes.find(s => s.name === me);
}

function renderSnakePlayer() {
  const my = mySnake();
  const color = my?.color || '#d4af37';
  screen.innerHTML = `${headerHtml()}
    <div class="player-state snake-player">
      <div class="snake-player-top">
        <div class="snake-player-info" style="color:${color}">
          ${my?.emoji || '🐍'} <b>${my ? my.score + ' p' : '0 p'}</b>
          ${my && !my.alive && my.respawnIn > 0 ? `<span class="snake-dead"> · 🪦 respawn i ${Math.ceil(my.respawnIn/1000)}s</span>` : ''}
          ${my && !my.alive && my.respawnIn === 0 ? `<span class="snake-dead"> · 🪦</span>` : ''}
        </div>
        ${snakeSnap && !snakeSnap.started ? `<div class="snake-player-cd">Gjør deg klar…</div>` : ''}
      </div>
      <canvas id="playerSnakeCanvas" class="player-mini-canvas" width="400" height="250"></canvas>
      <div class="snake-pad" id="snakePad">
        <button class="pad-btn pad-up" data-dir="up">▲</button>
        <div class="pad-row">
          <button class="pad-btn pad-left" data-dir="left">◀</button>
          <button class="pad-btn pad-right" data-dir="right">▶</button>
        </div>
        <button class="pad-btn pad-down" data-dir="down">▼</button>
      </div>
      <p class="snake-hint">Trykk eller sveip. Unngå vegger og andre slanger.</p>
    </div>`;
  // Wire up knappene + swipe
  const pad = document.getElementById('snakePad');
  pad.querySelectorAll('.pad-btn').forEach(b => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sendSnakeDir(b.dataset.dir);
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  // Swipe-gestures på hele skjermen
  let touchStart = null;
  const screenEl = screen;
  const onStart = e => {
    const t = e.touches ? e.touches[0] : e;
    touchStart = { x: t.clientX, y: t.clientY };
  };
  const onMove = e => {
    // Blokker scroll/zoom under spill
    if (e.cancelable) e.preventDefault();
  };
  const onEnd = e => {
    if (!touchStart) return;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (Math.max(absX, absY) < 30) { touchStart = null; return; }
    if (absX > absY) sendSnakeDir(dx > 0 ? 'right' : 'left');
    else sendSnakeDir(dy > 0 ? 'down' : 'up');
    touchStart = null;
  };
  screenEl.addEventListener('touchstart', onStart, { passive: true });
  screenEl.addEventListener('touchmove', onMove, { passive: false });
  screenEl.addEventListener('touchend', onEnd, { passive: true });
  // Keyboard (desktop)
  window.onkeydown = (e) => {
    if (state?.phase !== 'snake') return;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') sendSnakeDir('up');
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') sendSnakeDir('down');
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') sendSnakeDir('left');
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') sendSnakeDir('right');
  };
  drawSnakeMini();
}

function sendSnakeDir(dir) {
  socket.emit('player:snake-dir', dir);
  buzz(10);
  // Umiddelbar visuell feedback: highlight knappen
  const pad = document.getElementById('snakePad');
  if (pad) {
    pad.querySelectorAll('.pad-btn').forEach(b => b.classList.remove('active-dir'));
    pad.querySelector(`[data-dir="${dir}"]`)?.classList.add('active-dir');
  }
}

function updateSnakePlayer() {
  // Oppdater bare relevante tall uten full re-render
  const my = mySnake();
  const info = screen.querySelector('.snake-player-info');
  if (info && my) {
    info.innerHTML = `
      ${my.emoji || '🐍'} <b>${my.score} p</b>
      ${!my.alive && my.respawnIn > 0 ? `<span class="snake-dead"> · 🪦 respawn i ${Math.ceil(my.respawnIn/1000)}s</span>` : ''}
      ${!my.alive && my.respawnIn === 0 ? `<span class="snake-dead"> · 🪦</span>` : ''}`;
    info.style.color = my.color;
  }
  drawSnakeMini();
}

function drawSnakeMini() {
  const canvas = document.getElementById('playerSnakeCanvas');
  if (!canvas || !snakeSnap) return;
  const ctx = canvas.getContext('2d');
  const cell = Math.min(canvas.width / snakeSnap.grid.w, canvas.height / snakeSnap.grid.h);
  const offX = (canvas.width - cell * snakeSnap.grid.w) / 2;
  const offY = (canvas.height - cell * snakeSnap.grid.h) / 2;
  // Bakgrunn
  ctx.fillStyle = '#0b0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(93,224,174,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(offX, offY, cell * snakeSnap.grid.w, cell * snakeSnap.grid.h);
  // Mat
  for (const f of snakeSnap.food) {
    ctx.fillStyle = '#5de0ae';
    ctx.beginPath();
    ctx.arc(offX + f.x * cell + cell/2, offY + f.y * cell + cell/2, cell * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tegn andre slanger FØRST (så dempet)
  for (const s of snakeSnap.snakes) {
    if (!s.body.length) continue;
    const isMe = s.name === me;
    if (isMe) continue;
    ctx.globalAlpha = s.alive ? 0.35 : 0.15;
    ctx.fillStyle = s.color;
    for (const seg of s.body) {
      ctx.fillRect(offX + seg.x * cell + 0.5, offY + seg.y * cell + 0.5, cell - 1, cell - 1);
    }
  }
  ctx.globalAlpha = 1;
  // Tegn MIN slange med full kraft + glow + puls
  const my = snakeSnap.snakes.find(s => s.name === me);
  if (my && my.body.length) {
    const pulse = 1 + 0.15 * Math.sin(Date.now() / 200);
    ctx.fillStyle = my.color;
    ctx.globalAlpha = my.alive ? 1 : 0.4;
    for (let i = 1; i < my.body.length; i++) {
      const seg = my.body[i];
      ctx.fillRect(offX + seg.x * cell, offY + seg.y * cell, cell, cell);
    }
    const head = my.body[0];
    if (my.alive) { ctx.shadowColor = my.color; ctx.shadowBlur = 18; }
    ctx.fillRect(offX + head.x * cell - 0.5, offY + head.y * cell - 0.5, cell + 1, cell + 1);
    ctx.shadowBlur = 0;
    // Hvit omriss rundt hode
    if (my.alive) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(offX + head.x * cell + 0.5, offY + head.y * cell + 0.5, cell - 1, cell - 1);
      // DU-pil over hodet
      const px = offX + head.x * cell + cell/2;
      const py = offY + head.y * cell - 6 * pulse;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 5, py - 6);
      ctx.lineTo(px + 5, py - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function renderSnakeEndPlayer() {
  const my = mySnake();
  const sorted = snakeSnap ? [...snakeSnap.snakes].sort((a, b) => b.score - a.score) : [];
  const rank = sorted.findIndex(s => s.name === me) + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🐍';
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div style="font-size:64px; text-align:center">${medal}</div>
      <h2 style="font-size:26px; text-align:center; margin:10px 0">Plass ${rank} av ${sorted.length}</h2>
      <p style="color:var(--gold-2); font-size:22px; text-align:center">${my?.score || 0} poeng fra slangen</p>
      <p style="color:var(--ink-2); text-align:center; margin-top:14px">Poengene ble lagt til hovedscoren din.</p>
    </div>
    ${reactionBar()}`;
}

// ============ BOMBERMAN ============
function myBombPlayer() {
  if (!bombSnap) return null;
  return bombSnap.players.find(p => p.name === me);
}

function renderBombPlayer() {
  const my = myBombPlayer();
  const color = my?.color || '#d4af37';
  screen.innerHTML = `${headerHtml()}
    <div class="player-state snake-player">
      <div class="snake-player-top">
        <div class="snake-player-info" style="color:${color}">
          ${my?.emoji || '💣'} <b>${my ? my.score + ' p' : '0 p'}</b>
          ${my ? `<span class="bomb-stats"> · 💣×${my.bombsMax} · 🔥${my.range}${my.shield > 0 ? ' · 🛡️' : ''}${my.kills ? ' · ☠️' + my.kills : ''}</span>` : ''}
          ${my && !my.alive && my.respawnIn > 0 ? `<span class="snake-dead"> · respawn i ${Math.ceil(my.respawnIn/1000)}s</span>` : ''}
        </div>
        ${bombSnap && !bombSnap.started ? `<div class="snake-player-cd">Gjør deg klar…</div>` : ''}
      </div>
      <canvas id="playerBombCanvas" class="player-mini-canvas" width="400" height="240"></canvas>
      <div class="bomb-pad" id="bombPad">
        <div class="bomb-pad-grid">
          <div></div>
          <button class="pad-btn pad-up" data-dir="up">▲</button>
          <div></div>
          <button class="pad-btn pad-left" data-dir="left">◀</button>
          <button class="pad-btn pad-bomb" id="bombDrop">💣</button>
          <button class="pad-btn pad-right" data-dir="right">▶</button>
          <div></div>
          <button class="pad-btn pad-down" data-dir="down">▼</button>
          <div></div>
        </div>
      </div>
      <p class="snake-hint">Piltaster/WASD på laptop, swipe eller knapper på mobil. Mellomrom/knapp = bombe.</p>
    </div>`;
  const pad = document.getElementById('bombPad');
  const bombActiveDirs = new Set();
  function emitBombDirs() {
    socket.emit('player:bomb-dirs', {
      up: bombActiveDirs.has('up'),
      down: bombActiveDirs.has('down'),
      left: bombActiveDirs.has('left'),
      right: bombActiveDirs.has('right'),
    });
    // Oppdater aktiv-status på knapper
    pad.querySelectorAll('.pad-btn[data-dir]').forEach(el => {
      el.classList.toggle('active-dir', bombActiveDirs.has(el.dataset.dir));
    });
  }
  pad.querySelectorAll('.pad-btn[data-dir]').forEach(b => {
    // pointerdown: legg til dir, behold capture slik at vi får up selv om fingeren glir utenfor knappen
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch {}
      bombActiveDirs.add(b.dataset.dir);
      emitBombDirs();
      buzz(12);
    });
    const release = (e) => {
      bombActiveDirs.delete(b.dataset.dir);
      emitBombDirs();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    // Blokker context-menu ved lang press
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  document.getElementById('bombDrop').addEventListener('click', () => { socket.emit('player:bomb-drop'); buzz(40); });

  // Swipe på screen (ikke pad — så multitouch-pad ikke forstyrres)
  let touchStart = null;
  const canvas = document.getElementById('playerBombCanvas');
  const onStart = e => {
    if (e.target.closest('.bomb-pad')) return; // ignorer swipe fra pad-området
    const t = e.touches ? e.touches[0] : e;
    touchStart = { x: t.clientX, y: t.clientY, dir: null };
  };
  const onMove = e => {
    if (e.cancelable) e.preventDefault(); // blokker scroll/zoom
    if (!touchStart) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (Math.max(absX, absY) < 25) return;
    const dir = absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (dir !== touchStart.dir) {
      touchStart.dir = dir;
      bombActiveDirs.clear();
      bombActiveDirs.add(dir);
      emitBombDirs();
    }
  };
  const onEnd = (e) => {
    if (e.target?.closest('.bomb-pad')) return;
    touchStart = null;
    bombActiveDirs.clear();
    emitBombDirs();
  };
  screen.addEventListener('touchstart', onStart, { passive: true });
  screen.addEventListener('touchmove', onMove, { passive: false });
  screen.addEventListener('touchend', onEnd, { passive: true });

  // Keyboard — tracker også pressed keys for diagonal
  const KEY_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                    w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right' };
  window.onkeydown = (e) => {
    if (state?.phase !== 'bomb') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      socket.emit('player:bomb-drop'); buzz(40);
      return;
    }
    const d = KEY_DIR[e.key];
    if (!d) return;
    if (bombActiveDirs.has(d)) return; // unngå repeat-spam
    bombActiveDirs.add(d);
    emitBombDirs();
  };
  window.onkeyup = (e) => {
    if (state?.phase !== 'bomb') return;
    const d = KEY_DIR[e.key];
    if (!d) return;
    bombActiveDirs.delete(d);
    emitBombDirs();
  };
  drawBombMini();
}

function sendBombMove(dir) {
  socket.emit('player:bomb-move', dir);
  if (dir && dir !== 'stop') buzz(10);
  const pad = document.getElementById('bombPad');
  if (pad) {
    pad.querySelectorAll('.pad-btn[data-dir]').forEach(b => b.classList.remove('active-dir'));
    if (dir && dir !== 'stop') pad.querySelector(`[data-dir="${dir}"]`)?.classList.add('active-dir');
  }
}

function updateBombPlayer() {
  const my = myBombPlayer();
  const info = screen.querySelector('.snake-player-info');
  if (info && my) {
    info.innerHTML = `
      ${my.emoji || '💣'} <b>${my.score} p</b>
      <span class="bomb-stats"> · 💣×${my.bombsMax} · 🔥${my.range}${my.shield > 0 ? ' · 🛡️' : ''}${my.kills ? ' · ☠️' + my.kills : ''}</span>
      ${!my.alive && my.respawnIn > 0 ? `<span class="snake-dead"> · 💀 respawn i ${Math.ceil(my.respawnIn/1000)}s</span>` : ''}`;
    info.style.color = my.color;
  }
  drawBombMini();
}

function drawBombMini() {
  const canvas = document.getElementById('playerBombCanvas');
  if (!canvas || !bombSnap) return;
  const ctx = canvas.getContext('2d');
  const cell = Math.min(canvas.width / bombSnap.grid.w, canvas.height / bombSnap.grid.h);
  const offX = (canvas.width - cell * bombSnap.grid.w) / 2;
  const offY = (canvas.height - cell * bombSnap.grid.h) / 2;
  // Bakgrunn
  ctx.fillStyle = '#1a2e1f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Vegger
  const W = bombSnap.grid.w;
  for (let y = 0; y < bombSnap.grid.h; y++) {
    for (let x = 0; x < W; x++) {
      const v = bombSnap.walls[y * W + x];
      if (v === 1) { ctx.fillStyle = '#3a3a45'; ctx.fillRect(offX + x*cell, offY + y*cell, cell, cell); }
      else if (v === 2) { ctx.fillStyle = '#8a5f35'; ctx.fillRect(offX + x*cell+1, offY + y*cell+1, cell-2, cell-2); }
    }
  }
  // Powerups (fargekodet)
  const PU_COLOR = { bomb: '#e54b4b', range: '#ffbe0b', shield: '#3a86ff', gold: '#d4af37' };
  for (const u of bombSnap.powerups) {
    ctx.fillStyle = PU_COLOR[u.type] || '#fff';
    ctx.beginPath(); ctx.arc(offX + u.x*cell + cell/2, offY + u.y*cell + cell/2, cell * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  // Bomber
  for (const b of bombSnap.bombs) {
    const pulse = 1 + 0.15 * Math.sin(Date.now() / 100);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(offX + b.x*cell + cell/2, offY + b.y*cell + cell/2, cell * 0.42 * pulse, 0, Math.PI * 2); ctx.fill();
  }
  // Eksplosjoner
  for (const e of bombSnap.explosions) {
    ctx.fillStyle = `rgba(255,180,60,${e.tLeft / 700})`;
    ctx.fillRect(offX + e.x*cell, offY + e.y*cell, cell, cell);
  }
  // ANDRE spillere (dempet)
  for (const p of bombSnap.players) {
    if (!p.alive || p.name === me) continue;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(offX + p.x*cell + cell/2, offY + p.y*cell + cell/2, cell * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // MIN spiller — hvit ring + pulserende glow + "DU"-pil
  const my = bombSnap.players.find(p => p.name === me);
  if (my && my.alive) {
    const cx = offX + my.x*cell + cell/2, cy = offY + my.y*cell + cell/2;
    const pulse = 1 + 0.18 * Math.sin(Date.now() / 200);
    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 1.2);
    glow.addColorStop(0, my.color);
    glow.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 1.1 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Hoved-sirkel
    ctx.shadowColor = my.color; ctx.shadowBlur = 20;
    ctx.fillStyle = my.color;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Hvit ring + DU-pil
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.58 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    const py = cy - cell * 0.95 - 4 * pulse;
    ctx.beginPath();
    ctx.moveTo(cx, py);
    ctx.lineTo(cx - 6, py - 8);
    ctx.lineTo(cx + 6, py - 8);
    ctx.closePath();
    ctx.fill();
  }
}

function renderBombEndPlayer() {
  const my = myBombPlayer();
  const sorted = bombSnap ? [...bombSnap.players].sort((a, b) => b.score - a.score) : [];
  const rank = sorted.findIndex(p => p.name === me) + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '💣';
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div style="font-size:64px; text-align:center">${medal}</div>
      <h2 style="font-size:26px; text-align:center; margin:10px 0">Plass ${rank} av ${sorted.length}</h2>
      <p style="color:var(--gold-2); font-size:22px; text-align:center">${my?.score || 0} poeng${my?.kills ? ' · ' + my.kills + ' kills' : ''}</p>
      <p style="color:var(--ink-2); text-align:center; margin-top:14px">Poengene er lagt til hovedscoren din.</p>
    </div>
    ${reactionBar()}`;
}

// ============ LOBBY ============
function renderLobbyWait() {
  const t = myTeam();
  screen.innerHTML = `
    ${headerHtml()}
    <div class="player-state waiting">
      <h2>Du er med!</h2>
      ${t ? `<p style="color:${t.color}; font-weight:700; font-size:20px; margin-bottom:16px">Du spiller for ${t.emoji} ${esc(t.name)}</p>` : ''}
      <p>Venter på at verten starter.</p>
      <div><span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span></div>
      <p style="margin-top: 24px">Spillere inne: <b>${state.players.length}</b></p>
    </div>
    ${reactionBar()}`;
}

// ============ QUESTION ============
function renderQuestion() {
  const m = currentMe();
  if (!m) return;
  if (m.answered || chosenThisQ !== null) {
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <h2>Svar registrert ✓</h2>
        <p>Venter på resten…</p>
        <div><span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span></div>
      </div>`;
    return;
  }
  const q = state.question;
  const isEmoji = q?.isEmoji;
  screen.innerHTML = `${headerHtml()}
    <div class="player-state player-question">
      <div class="pq-meta">Spørsmål ${state.qIndex + 1} / ${state.total}</div>
      ${isEmoji
        ? `<div class="pq-emoji">${esc(q.text)}</div>`
        : `<div class="pq-text">${esc(q.text)}</div>`}
      <div class="pq-options">
        ${(q?.options || []).map((o, i) => `
          <button class="pq-opt b${i}" onclick="answer(${i})">
            <span class="pq-letter">${'ABCD'[i]}</span>
            <span class="pq-label">${esc(o)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}
window.answer = (i) => {
  chosenThisQ = i;
  socket.emit('player:answer', i);
  buzz(30);
  render();
};

// ============ REVEAL ============
function renderReveal() {
  const m = currentMe();
  if (!m) return;
  const ok = m.lastCorrect === true;
  const nope = m.lastCorrect === false;
  const cls = ok ? 'ok' : nope ? 'nope' : 'skip';
  const big = ok ? '🎉 Riktig!' : nope ? '❌ Feil' : '💤 Ikke svart';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex(p => p.name === m.name) + 1;
  screen.innerHTML = `${headerHtml()}
    <div class="feedback ${cls}">
      <div class="big">${big}</div>
      ${ok ? `<div class="delta">+${m.lastDelta} poeng</div>` : ''}
      ${ok && m.streak >= 2 ? `<div style="color: var(--gold-2); font-weight: 700">🔥 ${m.streak} på rad!</div>` : ''}
      <div class="rank">Plass ${rank} av ${state.players.length}</div>
    </div>
    ${reactionBar()}`;
}

// ============ LEADERBOARD MINI ============
function renderMiniLeaderboard() {
  const m = currentMe();
  if (state.teamMode) {
    const teams = [...state.teams].sort((a, b) => b.score - a.score);
    const myT = myTeam();
    const rank = myT ? teams.findIndex(t => t.id === myT.id) + 1 : 0;
    screen.innerHTML = `${headerHtml()}
      <div class="player-state">
        <h2 style="font-size: 26px; margin-bottom: 8px">Lag-tavle</h2>
        ${myT ? `<div class="rank" style="color:${myT.color}; font-size: 18px; margin-bottom: 20px">Ditt lag er på plass ${rank}</div>` : ''}
        ${teams.map((t, i) => `
          <div class="lb-row" style="grid-template-columns:40px 1fr auto; font-size:16px; border-left:4px solid ${t.color}">
            <div class="lb-rank">${i + 1}</div>
            <div>${t.emoji} ${esc(t.name)}${myT && t.id === myT.id ? ' 👈' : ''}</div>
            <div>${t.score} p</div>
          </div>`).join('')}
      </div>`;
  } else {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(p => p.name === m.name) + 1;
    const top5 = sorted.slice(0, 5);
    screen.innerHTML = `${headerHtml()}
      <div class="player-state">
        <h2 style="font-size: 26px; margin-bottom: 16px">Poengtavle</h2>
        <div class="rank" style="color: var(--gold-2); font-size: 18px; margin-bottom: 20px">Du ligger på plass ${rank}</div>
        ${top5.map((p, i) => `
          <div class="lb-row" style="grid-template-columns: 40px 1fr auto; font-size: 16px">
            <div class="lb-rank" style="font-size: 22px">${i + 1}</div>
            <div>${esc(p.name)}${p.name === m.name ? ' 👤' : ''}</div>
            <div>${p.score} p</div>
          </div>`).join('')}
      </div>`;
  }
}

// ============ WHEEL (spiller ser resultat) ============
function renderWheelWait() {
  screen.innerHTML = `${headerHtml()}
    <div class="player-state waiting">
      <h2>🎡 Lykkehjulet snurrer</h2>
      <p>Følg med på storskjermen…</p>
      ${state.wheelResult ? `<div style="margin-top: 20px; font-size: 28px; font-weight: 700; color: ${state.wheelResult === me ? 'var(--gold-2)' : 'var(--ink)'}">${state.wheelResult === me ? '🎉 Det ble deg!' : esc(state.wheelResult)}</div>` : ''}
    </div>
    ${reactionBar()}`;
}

// ============ VOTING ============
function renderVoting() {
  const m = currentMe();
  if (votedThisRound || m.voted) {
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <h2>Stemme registrert ✓</h2>
        <p>Venter på resten…</p>
        <div><span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span></div>
      </div>`;
    return;
  }
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div class="vote-prompt"><span class="vote-prefix">Hvem er mest sannsynlig til å…</span>${esc(state.votingPrompt)}</div>
      <div class="vote-choices">
        ${state.players.map(p => `<button class="vote-btn" onclick="castVote('${p.id}')">${esc(p.name)}</button>`).join('')}
      </div>
      <p style="color:var(--ink-2); font-size:13px; margin-top:12px">Anonymt — ingen ser hvem du stemte på.</p>
    </div>`;
}
window.castVote = (id) => {
  votedThisRound = id;
  socket.emit('player:vote', id);
  render();
};

function renderVoteResult() {
  const res = state.votingResults || [];
  const m = currentMe();
  const myVotes = res.find(r => r.name === m.name)?.count || 0;
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div class="vote-prompt"><span class="vote-prefix">Hvem er mest sannsynlig til å…</span>${esc(state.votingPrompt)}</div>
      ${res[0] ? `<div class="vote-winner-small">🏆 ${esc(res[0].name)} — ${res[0].count} ${res[0].count === 1 ? 'stemme' : 'stemmer'}</div>` : ''}
      ${myVotes > 0 ? `<div style="color:var(--gold-2); font-size:16px; margin-top:10px">Du fikk ${myVotes} ${myVotes === 1 ? 'stemme' : 'stemmer'}</div>` : ''}
    </div>
    ${reactionBar()}`;
}

// ============ SCATTERGORIES ============
function renderScatterPlay() {
  const m = currentMe();
  if (m.answered) {
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <h2>Sendt inn ✓</h2>
        <p>Venter på de andre…</p>
      </div>`;
    return;
  }
  screen.innerHTML = `${headerHtml()}
    <div class="player-state scatter-player">
      <div class="scatter-letter-big">${state.scatterLetter}</div>
      <p style="color:var(--ink-2); margin-bottom: 16px">Skriv ord som starter med ${state.scatterLetter}</p>
      <div class="scatter-inputs">
        ${state.scatterCategories.map((c, i) => `
          <label class="scatter-input">
            <span>${esc(c)}</span>
            <input type="text" id="si${i}" maxlength="40" value="${esc(scatterDraft[i] || '')}" placeholder="${state.scatterLetter}…" oninput="scatterInput(${i}, this.value)">
          </label>`).join('')}
      </div>
      <button class="btn btn-primary" style="width:100%; margin-top:16px" onclick="submitScatter()">Send inn</button>
    </div>`;
}
window.scatterInput = (i, v) => { scatterDraft[i] = v; };
window.submitScatter = () => {
  const arr = state.scatterCategories.map((_, i) => scatterDraft[i] || '');
  socket.emit('player:scatter', arr);
};

function renderScatterReview() {
  const m = currentMe();
  const myRow = state.scatterReview?.find(r => r.name === m.name);
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <h2 style="font-size:22px; margin-bottom:12px">Kategori-kamp</h2>
      <p style="color:var(--gold-2); font-size:26px; font-weight:800; margin-bottom:16px">+${myRow?.delta || 0} poeng</p>
      ${myRow ? state.scatterCategories.map((c, i) => `
        <div class="scatter-review-row">
          <span class="scat-cat">${esc(c)}</span>
          <span class="scat-val">${esc((myRow.answers[i] || '').trim() || '—')}</span>
        </div>`).join('') : ''}
      <p style="color:var(--ink-2); font-size:14px; margin-top:16px">Se storskjermen for full oversikt.</p>
    </div>`;
}

// ============ ICEBREAKER ============
function renderIcebreaker() {
  const m = currentMe();
  const mine = state.icebreakerTarget === m.name;
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div class="icebreaker-label" style="font-size:16px">Bli-kjent-kort</div>
      <div class="icebreaker-target" style="font-size:30px; ${mine ? 'color:var(--gold-2)' : ''}">${mine ? '🎤 Du er valgt!' : esc(state.icebreakerTarget)}</div>
      <div class="icebreaker-prompt" style="font-size:22px; margin-top:20px">${esc(state.icebreakerPrompt)}</div>
      ${mine ? '<p style="color:var(--ink-2); margin-top:20px">Del svaret ditt med gruppen 😊</p>' : '<p style="color:var(--ink-2); margin-top:20px">Hør på storskjermen.</p>'}
    </div>
    ${reactionBar()}`;
}

// ============ 2 SANNHETER, 1 LØGN ============
let lieDraft = { s1: '', s2: '', s3: '', lieIdx: -1 };
let lieSubmitted = false;
let lieVoteCast = null;
let lastLieTurnId = null;

function renderLieCollect() {
  const m = currentMe();
  const lc = state.lieCollect || { submittedIds: [] };
  const iSubmitted = lc.submittedIds.includes(m.id) || lieSubmitted;
  if (iSubmitted) {
    const waiting = state.players.length - lc.submittedIds.length;
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <h2>Sendt inn ✓</h2>
        <p>${waiting > 0 ? `Venter på ${waiting} til…` : 'Alle er ferdige — starter snart!'}</p>
        <div><span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span></div>
      </div>`;
    return;
  }
  screen.innerHTML = `${headerHtml()}
    <div class="player-state lie-input">
      <div class="lie-input-title">🤥 2 sannheter og 1 løgn</div>
      <div class="lie-input-sub">Skriv 3 ting om deg selv. Velg hvilken som er løgnen.</div>
      <div class="lie-input-fields">
        ${[0,1,2].map(i => `
          <div class="lie-input-row ${lieDraft.lieIdx === i ? 'is-lie' : ''}">
            <textarea id="lieInp${i}" rows="2" maxlength="120" placeholder="Påstand ${i+1}">${esc(['s1','s2','s3'][i] && lieDraft[['s1','s2','s3'][i]] || '')}</textarea>
            <label class="lie-mark">
              <input type="radio" name="lieMark" value="${i}" ${lieDraft.lieIdx === i ? 'checked' : ''}>
              <span>Løgn</span>
            </label>
          </div>
        `).join('')}
      </div>
      <button id="lieSendBtn" class="btn btn-primary btn-lg" style="width:100%; margin-top:14px" disabled>Send inn</button>
      <p style="color:var(--ink-2); font-size:13px; margin-top:10px">De andre spillerne skal prøve å gjette hvilken som er løgnen din.</p>
    </div>`;

  const inputs = [0,1,2].map(i => document.getElementById('lieInp' + i));
  const radios = document.querySelectorAll('input[name="lieMark"]');
  const sendBtn = document.getElementById('lieSendBtn');

  function refreshBtn() {
    const allFilled = inputs.every(x => x.value.trim().length > 0);
    const hasLie = lieDraft.lieIdx >= 0;
    sendBtn.disabled = !(allFilled && hasLie);
  }

  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      lieDraft[['s1','s2','s3'][i]] = inp.value;
      refreshBtn();
    });
  });
  radios.forEach(r => {
    r.addEventListener('change', () => {
      lieDraft.lieIdx = Number(r.value);
      document.querySelectorAll('.lie-input-row').forEach((el, idx) => {
        el.classList.toggle('is-lie', idx === lieDraft.lieIdx);
      });
      refreshBtn();
    });
  });
  sendBtn.addEventListener('click', () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sender…';
    socket.emit('player:lie-submit', {
      s1: lieDraft.s1.trim(),
      s2: lieDraft.s2.trim(),
      s3: lieDraft.s3.trim(),
      lieIdx: lieDraft.lieIdx,
    });
    lieSubmitted = true;
    setTimeout(() => render(), 100);
  });
  refreshBtn();
}

function renderLiePlay() {
  const m = currentMe();
  const lp = state.liePlay;
  if (!lp) return renderWaiting('Venter…');
  // Reset vote når ny spiller kommer på tur
  if (lastLieTurnId !== lp.currentId) {
    lastLieTurnId = lp.currentId;
    lieVoteCast = null;
  }
  const isMine = lp.currentId === m.id;
  if (isMine) {
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <div style="font-size:60px">🎭</div>
        <h2>Dine påstander vises nå</h2>
        <p>De andre prøver å gjette løgnen din. Se på storskjermen.</p>
        <div class="lie-mini-stmts">
          ${lp.statements.map((s, i) => `<div class="lie-mini-stmt ${i === lp.statements.findIndex(x => x) ? '' : ''}">${i+1}. ${esc(s)}</div>`).join('')}
        </div>
      </div>`;
    return;
  }
  if (lieVoteCast != null) {
    const waiting = Math.max(0, state.players.length - 1 - lp.votedIds.length);
    screen.innerHTML = `${headerHtml()}
      <div class="player-state waiting">
        <h2>Stemme registrert ✓</h2>
        <p>Du tror nr. ${lieVoteCast + 1} er løgnen.</p>
        <p style="color:var(--ink-2); margin-top:8px">${waiting > 0 ? `Venter på ${waiting} til…` : 'Alle har stemt!'}</p>
        <div><span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span></div>
      </div>`;
    return;
  }
  screen.innerHTML = `${headerHtml()}
    <div class="player-state lie-vote">
      <div class="lie-vote-head">
        <span class="lie-vote-emoji">${lp.currentEmoji || avatarFor(lp.currentName)}</span>
        <div>
          <div class="lie-vote-label">Hvilken er løgnen?</div>
          <div class="lie-vote-name">${esc(lp.currentName)}</div>
        </div>
      </div>
      <div class="lie-vote-btns">
        ${lp.statements.map((s, i) => `
          <button class="lie-vote-btn" onclick="castLieVote(${i})">
            <span class="lie-vote-num">${i + 1}</span>
            <span class="lie-vote-text">${esc(s)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

window.castLieVote = (idx) => {
  if (lieVoteCast != null) return;
  lieVoteCast = idx;
  socket.emit('player:lie-vote', idx);
  buzz(30);
  render();
};

function renderLieReveal() {
  const m = currentMe();
  const lp = state.liePlay;
  if (!lp) return renderWaiting('Venter…');
  const isMine = lp.currentId === m.id;
  const lieIdx = lp.lieDisplayIdx;
  const delta = m.lastDelta || 0;
  const correct = m.lastCorrect;
  let headline, sub;
  if (isMine) {
    headline = delta > 0 ? `+${delta} poeng 🎭` : 'Ingen lot seg lure 😅';
    sub = delta > 0 ? `Du lurte ${delta / 50} spiller${delta / 50 === 1 ? '' : 'e'}!` : 'Prøv vanskeligere løgner neste gang.';
  } else if (correct === true) {
    headline = `+${delta} poeng ✓`;
    sub = 'Du avslørte løgnen!';
  } else if (correct === false) {
    headline = 'Feil gjetning ✗';
    sub = `Løgnen var nr. ${lieIdx + 1}.`;
  } else {
    headline = 'Runde ferdig';
    sub = `Løgnen var nr. ${lieIdx + 1}.`;
  }
  screen.innerHTML = `${headerHtml()}
    <div class="player-state lie-reveal">
      <div class="lie-reveal-head">
        <div class="lie-reveal-emoji">${lp.currentEmoji || avatarFor(lp.currentName)}</div>
        <div class="lie-reveal-name">${esc(lp.currentName)}</div>
      </div>
      <div class="lie-reveal-lie">Løgnen: <b>${esc(lp.statements[lieIdx] || '')}</b></div>
      <h2 class="lie-reveal-headline ${correct === true || (isMine && delta > 0) ? 'ok' : (correct === false ? 'bad' : '')}">${headline}</h2>
      <p class="lie-reveal-sub">${sub}</p>
    </div>
    ${reactionBar()}`;
}

// ============ END ============
function renderEnd() {
  const m = currentMe();
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex(p => p.name === m.name) + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎯';
  const t = myTeam();
  const teamRank = t ? [...state.teams].sort((a,b) => b.score-a.score).findIndex(x => x.id === t.id) + 1 : 0;
  screen.innerHTML = `${headerHtml()}
    <div class="player-state">
      <div style="font-size: 80px; text-align: center">${medal}</div>
      <h2 style="font-size: 28px; margin: 10px 0; text-align:center">Plass ${rank} av ${state.players.length}</h2>
      <p style="color: var(--gold-2); font-size: 22px; text-align:center">${m.score} poeng</p>
      ${t ? `<p style="color:${t.color}; font-size:18px; margin-top:16px; text-align:center">Lag ${t.emoji} ${esc(t.name)} — plass ${teamRank} av ${state.teams.length}</p>` : ''}
      <p style="margin-top: 30px; color: var(--ink-2); text-align:center">Takk for i kveld!</p>
    </div>
    ${reactionBar()}`;
}

function renderWaiting(msg) {
  screen.innerHTML = `<div class="player-state waiting"><h2>${msg}</h2></div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
