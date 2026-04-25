// public/player.js — spiller-UI + kontroller
import { AVATAR_CHOICES, colorFor } from './avatars.js';
import { sfx, setMuted, isMuted, unlock as unlockAudio } from './sound.js';

const socket = io({ transports: ['websocket','polling'] });
let state = null;
let me = null; // { id, token, emoji, name, team, color }
let snakeRenderer = null;
let bombRenderer = null;
let bombInit = null;
let bombZoom = 1.2;

const app = document.getElementById('app');

// ====== Haptic helpers ======
const haptic = {
  tap(){ try { navigator.vibrate && navigator.vibrate(10); } catch(e){} },
  bump(){ try { navigator.vibrate && navigator.vibrate([15, 30, 15]); } catch(e){} },
  buzz(){ try { navigator.vibrate && navigator.vibrate(60); } catch(e){} },
  success(){ try { navigator.vibrate && navigator.vibrate([25, 60, 25]); } catch(e){} },
  fail(){ try { navigator.vibrate && navigator.vibrate([80, 40, 80]); } catch(e){} },
};

// Double-tap prevention — gir en action-cooldown per spiller
const cooldowns = new Map();
function cooldown(key, ms){
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < ms) return false;
  cooldowns.set(key, now);
  return true;
}

// Connection status UI
let connEl = null;
function ensureConnEl(){
  if (!connEl){
    connEl = document.createElement('div');
    connEl.className = 'conn-status';
    connEl.textContent = '⚠️ Frakoblet — kobler til...';
    document.body.appendChild(connEl);
  }
  return connEl;
}

// ====== Persist name/emoji ======
const LS = {
  name: 'avdelingsshow:name',
  emoji: 'avdelingsshow:emoji',
  token: 'avdelingsshow:token'
};
function getSaved(){
  return {
    name: localStorage.getItem(LS.name) || '',
    emoji: localStorage.getItem(LS.emoji) || '🦊',
    token: localStorage.getItem(LS.token) || ''
  };
}

// ====== Login ======
function showLogin(){
  const s = getSaved();
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-title">Avdelingsshow</div>
      <div style="color: var(--muted); font-size: 14px;">Velg navn og emoji</div>
      <div class="avatar-grid" id="av-grid">
        ${AVATAR_CHOICES.map(e => `<button class="avatar-choice ${e===s.emoji?'active':''}" data-e="${e}">${e}</button>`).join('')}
      </div>
      <input class="name-input" id="name-in" placeholder="Ditt navn" value="${escapeHtml(s.name)}" maxlength="20" />
      <button class="btn-primary" id="join-btn">Bli med! 🎉</button>
    </div>
  `;
  let picked = s.emoji;
  app.querySelectorAll('.avatar-choice').forEach(b => {
    b.addEventListener('click', () => {
      app.querySelectorAll('.avatar-choice').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      picked = b.dataset.e;
    });
  });
  const join = () => {
    if (!cooldown('join', 800)) return;
    const name = app.querySelector('#name-in').value.trim().slice(0, 20);
    if (!name){ sfx.wrong(); haptic.fail(); return; }
    localStorage.setItem(LS.name, name);
    localStorage.setItem(LS.emoji, picked);
    socket.emit('player:hello', { name, emoji: picked, token: s.token || null });
    sfx.join();
    haptic.success();
  };
  app.querySelector('#join-btn').addEventListener('click', join);
  app.querySelector('#name-in').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  // Auto-rejoin if saved
  if (s.name && s.token){
    setTimeout(() => {
      socket.emit('player:hello', { name: s.name, emoji: s.emoji, token: s.token });
    }, 200);
  }
}

socket.on('player:welcome', ({ id, token, team }) => {
  me = { id, token, emoji: localStorage.getItem(LS.emoji) || '🦊', name: localStorage.getItem(LS.name) || '', team };
  me.color = colorFor(me.name);
  localStorage.setItem(LS.token, token);
});

socket.on('state', s => {
  state = s;
  // If I'm not registered yet, show login
  if (!me){ showLogin(); return; }
  const pself = s.players.find(p => p.id === me.id);
  if (!pself){
    // If server lost me, re-emit hello
    showLogin();
    return;
  }
  // Detekt min rank-endring
  detectMyRankChange(s);
  // Detekt score-økning → pulse min visning
  detectMyScoreChange(pself);
  me.name = pself.name; me.emoji = pself.emoji; me.team = pself.team; me.color = pself.color;
  render(s);
});

// ===== Player-side moment detection =====
let _myPrevRank = null;
let _myPrevScore = 0;

function detectMyRankChange(s){
  const sorted = s.players.slice().sort((a,b) => b.score - a.score);
  const myRank = sorted.findIndex(p => p.id === me.id) + 1;
  if (_myPrevRank != null && myRank < _myPrevRank && myRank <= 3){
    // Klatret til topp 3
    const rankLabels = ['🥇 1. plass!', '🥈 2. plass!', '🥉 3. plass!'];
    showRankToast(rankLabels[myRank - 1]);
    haptic.success();
    sfx.streak(myRank === 1 ? 5 : 3);
  }
  _myPrevRank = myRank;
}

function detectMyScoreChange(pself){
  if (pself.score > _myPrevScore){
    const delta = pself.score - _myPrevScore;
    // Pulse min score-visning hvis aktiv UI
    pulseOwnScore(delta);
    if (delta >= 500){ haptic.success(); sfx.correct(); }
  }
  _myPrevScore = pself.score;
}

function showRankToast(text){
  const el = document.createElement('div');
  el.className = 'rank-toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('in'), 20);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2700);
}

function pulseOwnScore(delta){
  // Float-up toast med +N
  const el = document.createElement('div');
  el.className = 'my-delta';
  el.textContent = '+' + delta;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

socket.on('error:msg', msg => { alert(msg); });

socket.on('disconnect', () => {
  ensureConnEl().classList.add('show');
  haptic.fail();
});
socket.on('connect', () => {
  ensureConnEl().classList.remove('show');
  // Re-emit hello med lagret token (socket.io reconnect beholder ikke state.id på server)
  const s = getSaved();
  if (s.token && s.name){
    socket.emit('player:hello', { name: s.name, emoji: s.emoji, token: s.token });
  }
});

socket.on('bomb:init', d => { bombInit = d; });

socket.on('bomb:tick', d => {
  if (bombRenderer){
    bombRenderer.setPlayers(d.players);
    bombRenderer.setBombs(d.bombs);
    bombRenderer.setPowerups(d.powerups);
    bombRenderer.updateSoft(d.soft);
    updateBombHeader(d);
  }
});
socket.on('bomb:explosion', ({ cells }) => {
  if (bombRenderer) bombRenderer.explosion(cells);
  sfx.boom();
});
socket.on('snake:tick', d => {
  if (snakeRenderer){
    snakeRenderer.setState(d);
    updateSnakeHeader(d);
  }
});

// Start
showLogin();

// ====== Phase render ======
function render(s){
  // Cleanup of 3D renderers when phase leaves
  if (s.phase !== 'snake' && s.phase !== 'countdown' && snakeRenderer){
    snakeRenderer.dispose(); snakeRenderer = null;
  }
  if (s.phase !== 'bomb' && s.phase !== 'countdown' && bombRenderer){
    bombRenderer.dispose(); bombRenderer = null;
  }
  // Reset quiz-rebuild-key når vi forlater quiz-faser
  if (s.phase !== 'question' && s.phase !== 'reveal') resetQuizKey();
  if (s.phase !== 'lie-play') lastLiePid = null;

  switch(s.phase){
    case 'lobby': showLobby(s); break;
    case 'tutorial': showTutorial(s); break;
    case 'countdown': showCountdown(s); break;
    case 'question': showQuestion(s); break;
    case 'reveal': showReveal(s); break;
    case 'leaderboard': showLeaderboard(s); break;
    case 'voting': showVoting(s); break;
    case 'vote-result': showWaitScreen('Resultat vises...'); break;
    case 'scatter-play': showScatterPlay(s); break;
    case 'scatter-review': showWaitScreen('Gjennomgang pågår...'); break;
    case 'icebreaker': showIcebreaker(s); break;
    case 'wheel': showWheel(s); break;
    case 'snake': showSnakeGame(s); break;
    case 'bomb': showBombGame(s); break;
    case 'lie-collect': showLieCollect(s); break;
    case 'lie-play': showLiePlay(s); break;
    case 'lie-reveal': showWaitScreen('Avsløring!'); break;
    case 'end': showEnd(s); break;
    default: showWaitScreen(s.phase);
  }
}

function showLobby(s){
  const pself = s.players.find(p => p.id === me.id);
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 90px;">${pself?.emoji || me.emoji}</div>
      <div class="lobby-msg">Du er med! 🎉</div>
      <div class="name-big" style="color: ${pself?.color || me.color}">${escapeHtml(pself?.name || me.name)}</div>
      ${pself?.team ? `<div class="team-badge" style="background: ${pself.team.color}33; color: ${pself.team.color}">${pself.team.emoji} ${escapeHtml(pself.team.name)}</div>` : ''}
      <div style="color: var(--muted); margin-top: 20px;">${s.players.length} med. Venter på at host starter...</div>
    </div>
    ${reactionBarHTML()}
  `;
  bindReactions();
}

function showTutorial(s){
  const icon = { quiz:'🧠', lightning:'⚡', voting:'🗳️', scatter:'📝', lie:'🤥', icebreaker:'💬', wheel:'🎡', snake:'🐍', bomb:'💣' }[s.tutorialGame] || '🎮';
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 120px;">${icon}</div>
      <div style="font-size: 22px; text-align:center; padding: 0 20px; max-width: 500px; color: var(--text);">${escapeHtml(s.tutorialText)}</div>
      <div style="color: var(--muted); margin-top: 14px;">Starter snart...</div>
    </div>
  `;
}

function showCountdown(s){
  app.innerHTML = `
    <div class="login-screen">
      <div class="countdown-num" style="font-size: 160px">🎬</div>
      <div style="font-size: 22px;">Starter nå...</div>
    </div>
  `;
}

// Track forrige quiz-question-index så vi ikke rebuilder DOM mens spilleren tar på svar
let lastQuizKey = null;

function showQuestion(s){
  if (!s.quiz || !s.quiz.question) return;
  const answered = s.players.find(p => p.id === me.id)?.hasAnswered;
  const q = s.quiz.question;
  const qKey = s.quiz.index + ':' + (q.q || '');

  // Ny question → full rebuild. Samme question → kun oppdater disabled + "sendt"-indikator
  if (lastQuizKey === qKey){
    const buttons = app.querySelectorAll('.player-answer');
    if (buttons.length){
      buttons.forEach(b => { if (answered) b.disabled = true; });
      const sentMarker = app.querySelector('.sent-marker');
      if (answered && !sentMarker){
        const m = document.createElement('div');
        m.className = 'sent-marker';
        m.style.cssText = 'text-align:center; color:var(--accent); font-weight:700;';
        m.textContent = 'Svar sendt ✓';
        app.querySelector('.player-q-wrap').appendChild(m);
      }
      return;
    }
  }
  lastQuizKey = qKey;

  app.innerHTML = `
    <div class="player-q-wrap">
      <div style="color: var(--muted);">Spørsmål ${s.quiz.index+1} / ${s.quiz.total} ${s.quiz.isLightning?'⚡':''}</div>
      <div class="player-q-text">${q.isEmoji ? '<span style="font-size: 42px">'+escapeHtml(q.q)+'</span>' : escapeHtml(q.q)}</div>
      <div class="player-answers">
        ${q.a.map((a, i) => `
          <button class="player-answer ${['a','b','c','d'][i]}" data-idx="${i}" ${answered ? 'disabled' : ''}>
            <span class="letter">${['A','B','C','D'][i]}</span>
            <span>${escapeHtml(a)}</span>
          </button>
        `).join('')}
      </div>
      ${answered ? '<div class="sent-marker" style="text-align:center; color:var(--accent); font-weight:700;">Svar sendt ✓</div>' : ''}
    </div>
  `;

  app.querySelectorAll('.player-answer').forEach(btn => {
    const fire = (e) => {
      if (btn.disabled) return;
      if (!cooldown('answer', 800)) return;
      const idx = parseInt(btn.dataset.idx, 10);
      socket.emit('player:answer', { idx });
      sfx.pop();
      haptic.tap();
      // Disable alle umiddelbart (før server-state kommer)
      app.querySelectorAll('.player-answer').forEach(b => b.disabled = true);
      btn.style.outline = '4px solid var(--accent)';
      btn.style.outlineOffset = '4px';
      stopQuizHaptic();
    };
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      fire(e);
    }, { passive: false });
    btn.addEventListener('click', fire);
  });

  // Haptic-hjerteslag siste 5s (kun hvis ikke svart)
  startQuizHaptic(s.quiz.deadline);
}

let _quizHapticTimer = null;
function startQuizHaptic(deadlineMs){
  stopQuizHaptic();
  let interval = 900;
  const beat = () => {
    const remaining = (deadlineMs - Date.now()) / 1000;
    if (remaining > 5 || remaining <= 0){
      // Venter til under 5s
      if (remaining > 5){
        _quizHapticTimer = setTimeout(beat, (remaining - 5) * 1000 + 50);
      }
      return;
    }
    haptic.tap();
    _quizHapticTimer = setTimeout(beat, interval);
    interval = Math.max(320, interval - 90);
  };
  _quizHapticTimer = setTimeout(beat, 50);
}
function stopQuizHaptic(){
  if (_quizHapticTimer){ clearTimeout(_quizHapticTimer); _quizHapticTimer = null; }
}

// Reset key når vi forlater quiz
function resetQuizKey(){ lastQuizKey = null; stopQuizHaptic(); }

function showReveal(s){
  const correct = s.quiz?.correctIdx;
  const a = app.querySelectorAll('.player-answer');
  if (correct != null){
    a.forEach((el, i) => {
      if (i === correct) el.style.outline = '4px solid var(--mint)';
      else el.style.opacity = '0.3';
    });
  }
  // Subtle feedback
  const me_p = s.players.find(p => p.id === me.id);
  if (me_p){
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed; top:14px; left:50%; transform:translateX(-50%); background: rgba(0,0,0,.6); padding: 8px 14px; border-radius: 999px; font-weight:700;';
    div.textContent = 'Poeng: ' + me_p.score;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2500);
  }
}

function showLeaderboard(s){
  const me_p = s.players.find(p => p.id === me.id);
  const sorted = s.players.slice().sort((a,b) => b.score - a.score);
  const myRank = sorted.findIndex(p => p.id === me.id) + 1;
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 64px;">🏆</div>
      <div style="font-size: 24px; font-weight: 800;">Din plass: #${myRank}</div>
      <div style="font-size: 40px; color: var(--mint); font-weight: 900;">${me_p?.score || 0} poeng</div>
      <div style="color: var(--muted)">Se storskjerm for tavla</div>
    </div>
  `;
}

function showVoting(s){
  // Idempotent — bevar vote-buttons mellom state-broadcasts så de ikke mistes ved tap
  if (app.querySelector('button[data-id]')) return;
  app.innerHTML = `
    <div class="player-q-wrap">
      <div style="font-size: 14px; color:var(--muted)">Hvem er mest sannsynlig</div>
      <div class="player-q-text">${escapeHtml(s.vote.prompt)}</div>
      <div style="display:flex; flex-wrap:wrap; gap: 8px; flex:1; align-content:flex-start; overflow:auto;">
        ${s.players.filter(p => p.id !== me.id).map(p => `
          <button class="btn" data-id="${p.id}" style="flex: 1 0 46%; padding: 16px; display:flex; flex-direction:column; gap: 6px; align-items:center; color:${p.color};">
            <span style="font-size: 38px">${p.emoji}</span>
            <span style="font-weight:700">${escapeHtml(p.name)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  app.querySelectorAll('button[data-id]').forEach(b => {
    const fire = (e) => {
      if (b.disabled) return;
      if (!cooldown('vote', 500)) return;
      socket.emit('player:vote', { targetId: b.dataset.id });
      sfx.pop();
      haptic.tap();
      app.querySelectorAll('button[data-id]').forEach(x => { x.disabled = true; x.style.opacity = '0.4'; });
      b.style.opacity = '1'; b.style.outline = '3px solid var(--accent)';
    };
    b.addEventListener('touchstart', (e) => { e.preventDefault(); fire(e); }, { passive: false });
    b.addEventListener('click', fire);
  });
}

function showScatterPlay(s){
  // Idempotent — ikke rebuild UI mens brukeren skriver
  if (document.querySelector('.scatter-play input[data-i]')) return;
  const entries = new Array(5).fill('');
  app.innerHTML = `
    <div class="player-q-wrap scatter-play">
      <div style="text-align:center;">
        <div style="color:var(--muted)">Bokstav</div>
        <div style="font-size: 80px; font-weight:900; color: var(--mint); line-height: 1;">${escapeHtml(s.scatter.letter)}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; flex: 1;">
        ${s.scatter.categories.map((c, i) => `
          <label style="display:flex; flex-direction:column; gap: 4px;">
            <span style="font-size: 13px; color: var(--muted)">${escapeHtml(c)}</span>
            <input type="text" data-i="${i}" maxlength="40" placeholder="Ord som starter med ${escapeHtml(s.scatter.letter)}..." />
          </label>
        `).join('')}
      </div>
      <button class="btn-primary" id="submit-sc">Send inn ✓</button>
    </div>
  `;
  app.querySelectorAll('input[data-i]').forEach(inp => {
    inp.addEventListener('input', e => { entries[parseInt(inp.dataset.i,10)] = e.target.value; });
  });
  app.querySelector('#submit-sc').addEventListener('click', () => {
    if (!cooldown('submit-sc', 500)) return;
    socket.emit('player:scatter', { entries });
    sfx.correct();
    haptic.success();
    showWaitScreen('Sendt! Venter på de andre...');
  });
}

function showIcebreaker(s){
  const t = s.icebreaker.target;
  const isMe = t && t.id === me.id;
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 90px;">💬</div>
      <div style="font-size: 22px; text-align:center; padding: 0 20px; max-width: 400px;">${escapeHtml(s.icebreaker.prompt)}</div>
      ${t ? `<div style="font-size: 16px; color: ${t.color}; margin-top: 20px;">${isMe ? '✨ Du er valgt! Svar høyt!' : t.emoji + ' ' + escapeHtml(t.name) + ' svarer'}</div>` : ''}
    </div>
    ${reactionBarHTML()}
  `;
  bindReactions();
}

function showWheel(s){
  const c = s.wheel?.chosen;
  const isMe = c && c.id === me.id;
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 80px;">🎡</div>
      ${c ? `<div style="font-size: 22px;">${isMe ? '✨ Du ble valgt! ✨' : c.emoji + ' ' + escapeHtml(c.name) + ' er valgt'}</div>` : '<div style="color:var(--muted)">Venter på at host snurrer...</div>'}
    </div>
    ${reactionBarHTML()}
  `;
  bindReactions();
}

function showLieCollect(s){
  const submitted = s.players.find(p => p.id === me.id)?.hasSubmitted;
  if (submitted){ showWaitScreen('Sendt! Venter på andre... ('+s.lie.submittedCount+'/'+s.lie.total+')'); return; }
  // Idempotent — bevar skjema-tekst når andre spillere sender
  if (document.querySelector('.lie-form input[data-i]')) return;
  const items = ['', '', ''];
  let lieIdx = 0;
  app.innerHTML = `
    <div class="player-q-wrap">
      <div style="color:var(--muted); font-size: 13px;">2 sannheter, 1 løgn</div>
      <div style="font-size: 18px;">Skriv 3 påstander om deg selv og huk av hvilken som er LØGN.</div>
      <div class="lie-form">
        ${[0,1,2].map(i => `
          <label>Påstand ${['A','B','C'][i]}</label>
          <input type="text" data-i="${i}" maxlength="160" placeholder="Jeg har..." />
          <label><input type="radio" name="lie" data-li="${i}" ${i===0?'checked':''}> Dette er løgn</label>
        `).join('')}
      </div>
      <button class="btn-primary" id="submit-lie">Send inn ✓</button>
    </div>
  `;
  app.querySelectorAll('input[data-i]').forEach(inp => {
    inp.addEventListener('input', e => { items[parseInt(inp.dataset.i,10)] = e.target.value; });
  });
  app.querySelectorAll('input[name="lie"]').forEach(r => {
    r.addEventListener('change', e => { if (r.checked) lieIdx = parseInt(r.dataset.li, 10); });
  });
  app.querySelector('#submit-lie').addEventListener('click', () => {
    if (!cooldown('submit-lie', 500)) return;
    if (items.some(x => !x.trim())){ sfx.wrong(); haptic.fail(); alert('Fyll ut alle 3'); return; }
    socket.emit('player:lie-submit', { items, lieIdx });
    sfx.correct();
    haptic.success();
    showWaitScreen('Sendt!');
  });
}

let lastLiePid = null;
function showLiePlay(s){
  const c = s.lie.current; if (!c) return;
  const isMine = c.pid === me.id;
  // Ny spiller under avhør → rebuild. Samme → la stå slik at taps ikke mistes
  if (lastLiePid === c.pid && app.querySelector('.lie-claim')) return;
  lastLiePid = c.pid;
  app.innerHTML = `
    <div class="player-q-wrap">
      <div style="font-size: 14px; color: var(--muted);">Hvem lyver?</div>
      <div style="font-size: 30px; color: ${c.color}; font-weight: 900;">${c.emoji} ${escapeHtml(c.name)}</div>
      <div class="lie-list">
        ${c.items.map((it,i) => `<div class="lie-claim" data-i="${i}" ${isMine?'style="opacity:.5; pointer-events:none;"':''}>${['A','B','C'][i]}. ${escapeHtml(it)}</div>`).join('')}
      </div>
      ${isMine ? '<div style="text-align:center; color:var(--muted)">Dette er dine påstander — du kan ikke stemme.</div>' : ''}
    </div>
  `;
  app.querySelectorAll('.lie-claim').forEach(el => {
    const fire = (e) => {
      if (!cooldown('lie-vote', 400)) return;
      const idx = parseInt(el.dataset.i, 10);
      socket.emit('player:lie-vote', { idx });
      app.querySelectorAll('.lie-claim').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      sfx.pop();
      haptic.tap();
    };
    el.addEventListener('touchstart', (e) => { e.preventDefault(); fire(e); }, { passive: false });
    el.addEventListener('click', fire);
  });
}

function showEnd(s){
  const me_p = s.players.find(p => p.id === me.id);
  const sorted = s.players.slice().sort((a,b) => b.score - a.score);
  const myRank = sorted.findIndex(p => p.id === me.id) + 1;
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 80px;">🎉</div>
      <div style="font-size: 28px; font-weight: 900;">Runde over!</div>
      <div style="font-size: 22px;">Din plass: <b>#${myRank}</b></div>
      <div style="font-size: 40px; color: var(--mint); font-weight: 900;">${me_p?.score || 0} poeng</div>
    </div>
    ${reactionBarHTML()}
  `;
  bindReactions();
}

function showWaitScreen(msg){
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size: 60px;">⏳</div>
      <div style="font-size: 18px; color: var(--muted); text-align:center; padding: 0 20px;">${escapeHtml(msg)}</div>
    </div>
    ${reactionBarHTML()}
  `;
  bindReactions();
}

// ====== Snake game view ======
function showSnakeGame(s){
  // Idempotent — bare build DOM + bind første gang, så state-updates ikke
  // ødelegger event-listenere.
  if (document.getElementById('snake-canvas')) return;
  app.innerHTML = `
    <div class="player-game-wrap">
      <canvas id="snake-canvas"></canvas>
      <div class="swipe-layer" id="snake-swipe"></div>
      <div class="player-header">
        <div><b id="snake-score-me">0</b> poeng</div>
        <div id="snake-timer"></div>
      </div>
      <div class="arrow-pad">
        <button class="u" data-d="up">▲</button>
        <button class="l" data-d="left">◀</button>
        <button class="r" data-d="right">▶</button>
        <button class="d" data-d="down">▼</button>
      </div>
      <div class="swipe-hint">Sveip i retning — eller bruk pilene</div>
    </div>
  `;
  import('./snake3d.js').then(m => {
    snakeRenderer = new m.SnakeRenderer(document.getElementById('snake-canvas'));
  });
  bindSnakeControls();
}

function bindSnakeControls(){
  // ===== Keyboard =====
  const keys = new Set();
  const keyDir = e => {
    const k = e.key.toLowerCase();
    if (['arrowup','w'].includes(k)) return 'up';
    if (['arrowdown','s'].includes(k)) return 'down';
    if (['arrowleft','a'].includes(k)) return 'left';
    if (['arrowright','d'].includes(k)) return 'right';
    return null;
  };
  const onKD = e => {
    const d = keyDir(e); if (!d) return;
    if (keys.has(d)) return;
    keys.add(d);
    socket.emit('player:snake-dir', { dir: d });
  };
  const onKU = e => {
    const d = keyDir(e); if (!d) return;
    keys.delete(d);
  };
  window.addEventListener('keydown', onKD);
  window.addEventListener('keyup', onKU);

  // ===== Arrow pad — touch FIRST for rask respons, stopPropagation =====
  app.querySelectorAll('.arrow-pad button').forEach(b => {
    const fire = (e) => {
      e.preventDefault();
      e.stopPropagation();
      socket.emit('player:snake-dir', { dir: b.dataset.d });
      sfx.tick();
      haptic.tap();
    };
    b.addEventListener('touchstart', fire, { passive: false });
    b.addEventListener('mousedown', fire);
  });

  // ===== Swipe på dedikert layer (under arrow-pad, over canvas) =====
  // Bruker native touch-events fordi de er mer pålitelige på mobil enn pointer-events
  const layer = document.getElementById('snake-swipe');
  let startX = 0, startY = 0, startT = 0, active = false;

  const handleStart = (x, y) => {
    startX = x; startY = y; startT = Date.now(); active = true;
  };
  const handleEnd = (x, y) => {
    if (!active) return;
    active = false;
    const dx = x - startX, dy = y - startY;
    const mag = Math.hypot(dx, dy);
    const dt = Date.now() - startT;
    if (mag < 24 || dt > 1500) return;  // for kort / for sakte = ikke en swipe
    if (Math.abs(dx) > Math.abs(dy)){
      socket.emit('player:snake-dir', { dir: dx > 0 ? 'right' : 'left' });
    } else {
      socket.emit('player:snake-dir', { dir: dy > 0 ? 'down' : 'up' });
    }
    sfx.tick();
    haptic.tap();
  };

  // Touch events (primær for mobil)
  layer.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    handleStart(t.clientX, t.clientY);
  }, { passive: true });
  layer.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    handleEnd(t.clientX, t.clientY);
  }, { passive: true });
  layer.addEventListener('touchcancel', () => { active = false; }, { passive: true });

  // Mouse events (for PC, drag-swipe)
  layer.addEventListener('mousedown', (e) => { handleStart(e.clientX, e.clientY); });
  layer.addEventListener('mouseup', (e) => { handleEnd(e.clientX, e.clientY); });
  layer.addEventListener('mouseleave', () => { active = false; });
}

function updateSnakeHeader(d){
  const me_s = (d.score||[]).find(x => x.id === me.id);
  const el = document.getElementById('snake-score-me');
  if (el) el.textContent = me_s?.score || 0;
  const t = document.getElementById('snake-timer');
  if (t){
    if (d.endAt){
      const left = Math.max(0, Math.round((d.endAt - Date.now())/1000));
      t.textContent = left + 's';
    } else { t.textContent = '∞'; }
  }
}

// ====== Bomb game view ======
function showBombGame(s){
  // Idempotent — state-updates skal ikke rebuilde event-listenere
  if (document.getElementById('bomb-canvas')) return;
  app.innerHTML = `
    <div class="player-game-wrap">
      <canvas id="bomb-canvas"></canvas>
      <div class="player-header">
        <div><b id="bomb-score-me">0</b> · 💣×<span id="bc-bombs">1</span> · 🔥<span id="bc-fire">2</span> <span id="bc-icons"></span></div>
        <div id="bomb-timer"></div>
      </div>
      <div class="zoom-btns">
        <button id="zoom-in">+</button>
        <button id="zoom-out">−</button>
      </div>
      <div class="joystick-wrap" id="joy">
        <div class="joystick-base">
          <div class="joystick-thumb" id="joy-thumb"></div>
        </div>
      </div>
      <button class="bomb-btn" id="bomb-btn">💣</button>
      <button class="remote-btn hidden" id="remote-btn">💥</button>
    </div>
  `;
  import('./bomb3d.js').then(m => {
    const c = document.getElementById('bomb-canvas');
    bombRenderer = new m.BombRenderer(c, { follow: bombZoom < 1.4, followId: me.id });
    if (bombInit){
      bombRenderer.setWalls(bombInit.hard, bombInit.soft);
    }
  });
  bindBombControls();
}

function bindBombControls(){
  const dirs = new Set();
  const sendDirs = () => socket.emit('player:bomb-move', { dirs: [...dirs] });

  // Keyboard
  const keyDir = e => {
    const k = e.key.toLowerCase();
    if (['arrowup','w'].includes(k)) return 'up';
    if (['arrowdown','s'].includes(k)) return 'down';
    if (['arrowleft','a'].includes(k)) return 'left';
    if (['arrowright','d'].includes(k)) return 'right';
    return null;
  };
  const onDown = e => {
    if (e.key === ' ' || e.key.toLowerCase() === 'b'){
      e.preventDefault();
      socket.emit('player:bomb-action');
      sfx.buttonDown();
      return;
    }
    if (e.key.toLowerCase() === 'x'){
      socket.emit('player:bomb-detonate');
      return;
    }
    const d = keyDir(e); if (!d) return;
    if (dirs.has(d)) return;
    dirs.add(d); sendDirs();
  };
  const onUp = e => {
    const d = keyDir(e); if (!d) return;
    dirs.delete(d); sendDirs();
  };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  // Joystick med glow + haptic ved retningsendring
  const joy = document.getElementById('joy');
  const thumb = document.getElementById('joy-thumb');
  let pid = null;
  let lastDirKey = '';
  const baseRect = () => joy.getBoundingClientRect();
  joy.addEventListener('pointerdown', e => {
    pid = e.pointerId;
    joy.setPointerCapture(pid);
    joy.classList.add('active');
    onJoy(e);
  });
  joy.addEventListener('pointermove', e => { if (e.pointerId === pid) onJoy(e); });
  joy.addEventListener('pointerup', e => { if (e.pointerId === pid){ pid = null; resetJoy(); } });
  joy.addEventListener('pointercancel', e => { if (e.pointerId === pid){ pid = null; resetJoy(); } });

  function onJoy(e){
    const r = baseRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width/2 - 20;
    const mag = Math.hypot(dx, dy);
    if (mag > max){ dx *= max/mag; dy *= max/mag; }
    thumb.style.left = (r.width/2 + dx) + 'px';
    thumb.style.top = (r.height/2 + dy) + 'px';
    thumb.style.transform = 'translate(-50%, -50%)';
    // Glow på max-pull
    const pull = Math.hypot(dx, dy) / max;
    joy.classList.toggle('max-pull', pull > 0.85);
    // Dead zone 22%
    const dead = max * 0.22;
    dirs.clear();
    if (Math.hypot(dx, dy) > dead){
      if (Math.abs(dx) > dead) dirs.add(dx > 0 ? 'right' : 'left');
      if (Math.abs(dy) > dead) dirs.add(dy > 0 ? 'down' : 'up');
    }
    const dirKey = [...dirs].sort().join(',');
    if (dirKey !== lastDirKey){
      lastDirKey = dirKey;
      if (dirs.size > 0) haptic.tap();
    }
    sendDirs();
  }
  function resetJoy(){
    thumb.style.left = '50%'; thumb.style.top = '50%';
    joy.classList.remove('active', 'max-pull');
    lastDirKey = '';
    dirs.clear(); sendDirs();
  }

  // Bomb button med haptic
  document.getElementById('bomb-btn').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!cooldown('bomb', 180)) return;
    socket.emit('player:bomb-action');
    sfx.buttonDown();
    haptic.bump();
  });
  document.getElementById('remote-btn').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!cooldown('remote', 180)) return;
    socket.emit('player:bomb-detonate');
    sfx.buttonDown();
    haptic.buzz();
  });

  // Zoom
  document.getElementById('zoom-in').addEventListener('click', () => {
    bombZoom = Math.max(0.8, bombZoom - 0.2);
    applyZoom();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    bombZoom = Math.min(2.0, bombZoom + 0.2);
    applyZoom();
  });
  function applyZoom(){
    if (!bombRenderer) return;
    bombRenderer.setFollow(bombZoom < 1.4, me.id);
  }
}

function updateBombHeader(d){
  const mine = d.players.find(p => p.id === me.id);
  if (!mine) return;
  const me_p = state.players.find(p => p.id === me.id);
  const el = document.getElementById('bomb-score-me');
  if (el) el.textContent = me_p?.score || 0;
  const bombs = document.getElementById('bc-bombs'); if (bombs) bombs.textContent = mine.maxBombs;
  const fire = document.getElementById('bc-fire'); if (fire) fire.textContent = mine.range;
  const icons = document.getElementById('bc-icons');
  if (icons){
    icons.textContent = '';
    if (mine.kick) icons.textContent += ' 👟';
    if (mine.punch) icons.textContent += ' 🥊';
    if (mine.remote) icons.textContent += ' 📡';
    if (mine.shield > 0) icons.textContent += ' 🛡️' + (mine.shield > 1 ? ('×'+mine.shield) : '');
  }
  const btn = document.getElementById('bomb-btn');
  if (btn){
    if (mine.carrying){ btn.textContent = '🫳'; }
    else {
      // If standing on own bomb + punch -> 🤲
      const onOwn = d.bombs.find(b => b.x === mine.x && b.y === mine.y && b.owner === me.id);
      btn.textContent = onOwn && mine.punch ? '🤲' : '💣';
    }
  }
  const remoteBtn = document.getElementById('remote-btn');
  if (remoteBtn){
    remoteBtn.classList.toggle('hidden', !mine.remote);
  }
  const t = document.getElementById('bomb-timer');
  if (t){
    if (d.endAt){
      const left = Math.max(0, Math.round((d.endAt - Date.now())/1000));
      t.textContent = left + 's';
    } else { t.textContent = '∞'; }
  }
}

// ====== Reaction bar ======
function reactionBarHTML(){
  const emojis = ['😂','👏','🔥','🎉','💯','❤️'];
  return `<div class="reaction-bar">${emojis.map(e => `<button data-emoji="${e}">${e}</button>`).join('')}</div>`;
}
function bindReactions(){
  app.querySelectorAll('.reaction-bar button').forEach(b => {
    b.addEventListener('click', () => {
      if (!cooldown('reaction:' + b.dataset.emoji, 300)) return;
      socket.emit('player:reaction', b.dataset.emoji);
      sfx.pop();
      haptic.tap();
    });
  });
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[ch]);
}
