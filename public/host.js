// host.js — vert-siden (storskjerm)
import { getAiConfig, saveAiConfig, generateQuestions, generateVotingPrompts } from '/ai.js';
import { avatarFor, colorFor } from '/avatars.js';
import * as bomb3d from '/bomb3d.js';
import * as snake3d from '/snake3d.js';
const socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });

// ==== Passord på host ====
function hostHello() {
  const pw = sessionStorage.getItem('host-pw') || '';
  socket.emit('host:hello', pw);
}
socket.on('host:ok', () => { /* OK, continue */ });
socket.on('host:denied', ({ reason } = {}) => {
  if (reason === 'taken') {
    alert('En annen vert er allerede koblet til. Åpne siden på nytt etter at de har lukket fanen sin.');
    return;
  }
  promptHostPassword();
});

function promptHostPassword() {
  const overlay = document.createElement('div');
  overlay.id = 'hostPwOverlay';
  overlay.className = 'game-menu-overlay open';
  overlay.style.zIndex = '100000';
  overlay.innerHTML = `
    <div class="game-menu" style="max-width:440px; text-align:center" onclick="event.stopPropagation()">
      <h2 style="font-size:32px">🔒 Host-passord</h2>
      <p class="menu-sub">Kun verten kan kjøre showet</p>
      <input id="hostPwInp" type="password" placeholder="Passord" autocomplete="off"
        style="width:100%; padding:16px 20px; border-radius:12px; border:2px solid var(--card-b);
        background:var(--card); color:var(--ink); font-size:18px; font-family:inherit; text-align:center; margin-bottom:14px">
      <div id="hostPwErr" style="color:var(--red); font-size:14px; min-height:18px; margin-bottom:10px"></div>
      <button class="btn btn-primary btn-lg" id="hostPwBtn" style="width:100%">Logg inn</button>
    </div>`;
  document.body.appendChild(overlay);
  const inp = document.getElementById('hostPwInp');
  const btn = document.getElementById('hostPwBtn');
  const err = document.getElementById('hostPwErr');
  setTimeout(() => inp.focus(), 50);
  const go = () => {
    const v = inp.value.trim();
    if (!v) { err.textContent = 'Skriv inn passord'; return; }
    sessionStorage.setItem('host-pw', v);
    err.textContent = '';
    btn.textContent = 'Sjekker…';
    btn.disabled = true;
    // Lytt én gang på resultat
    const onOk = () => { socket.off('host:denied', onDenied); overlay.remove(); };
    const onDenied = ({ reason } = {}) => {
      socket.off('host:ok', onOk);
      if (reason === 'taken') { overlay.remove(); alert('En annen vert er allerede tilkoblet.'); return; }
      err.textContent = 'Feil passord';
      sessionStorage.removeItem('host-pw');
      btn.textContent = 'Logg inn'; btn.disabled = false; inp.value = ''; inp.focus();
    };
    socket.once('host:ok', onOk);
    socket.once('host:denied', onDenied);
    socket.emit('host:hello', v);
  };
  btn.addEventListener('click', go);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

hostHello();
const main = document.getElementById('main');
const controls = document.getElementById('controls');
const phaseTag = document.getElementById('phaseTag');
const floaters = document.getElementById('floaters');

let state = null;
let connectUrl = '';
let timerRAF = null;
let lastPhase = null;
let lastQIndex = -99;
let tickAccum = 0;
let wheelRevealTimeout = null;

const PHASE_LABELS = {
  lobby: 'Lobby', countdown: 'Klar…', question: 'Spørsmål', reveal: 'Fasit',
  leaderboard: 'Poengtavle', wheel: 'Lykkehjul',
  voting: 'Avstemning', 'vote-result': 'Avstemning – resultat',
  'scatter-play': 'Kategori-kamp', 'scatter-review': 'Gjennomgang',
  icebreaker: 'Bli-kjent', snake: 'Slange-kamp', 'snake-end': 'Slange – resultat',
  bomb: 'Bomberman', 'bomb-end': 'Bomberman – resultat',
  'lie-collect': '2 sannheter, 1 løgn – innsending', 'lie-play': '2 sannheter, 1 løgn', 'lie-reveal': 'Løgn – fasit',
  end: 'Ferdig',
};

fetch('/connect-url')
  .then(r => r.json())
  .then(j => { connectUrl = j.url; if (state) render(); })
  .catch(() => { connectUrl = window.location.origin; if (state) render(); });

// Fullscreen button
document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
});
document.getElementById('helpBtn')?.addEventListener('click', () => openHelpModal());

// ===== "Bli med selv" sidepanel =====
const selfPanel = document.getElementById('selfPanel');
const selfPanelFrame = document.getElementById('selfPanelFrame');
const selfPlayBtn = document.getElementById('selfPlayBtn');
function toggleSelfPanel(forceOpen) {
  const willOpen = forceOpen != null ? forceOpen : !selfPanel.classList.contains('open');
  if (willOpen) {
    if (!selfPanelFrame.src) selfPanelFrame.src = '/';
    selfPanel.classList.add('open');
    document.body.classList.add('self-panel-open');
    selfPlayBtn.classList.add('active');
  } else {
    selfPanel.classList.remove('open');
    document.body.classList.remove('self-panel-open');
    selfPlayBtn.classList.remove('active');
  }
}
selfPlayBtn?.addEventListener('click', () => toggleSelfPanel());
document.getElementById('selfPanelClose')?.addEventListener('click', () => toggleSelfPanel(false));

// ===== Animert programleder (mascot) =====
const mascotEl = document.getElementById('mascot');
const mascotBubbleEl = document.getElementById('mascotBubble');
let mascotFadeTimer = null;

function showMascotBubble(text) {
  if (!mascotEl || !text) return;
  mascotEl.classList.add('speaking');
  if (mascotBubbleEl) {
    mascotBubbleEl.textContent = text.length > 160 ? text.slice(0, 157) + '…' : text;
    mascotBubbleEl.classList.add('visible');
  }
  if (mascotFadeTimer) clearTimeout(mascotFadeTimer);
  const estMs = Math.max(2200, Math.min(8000, text.length * 80));
  mascotFadeTimer = setTimeout(() => {
    mascotEl.classList.remove('speaking');
    mascotBubbleEl?.classList.remove('visible');
  }, estMs);
}

function hostSpeak(text) {
  if (!text) return;
  showMascotBubble(text);
}

// Mascot rusler rundt i viewport — forhåndsvalgte hjørnesoner, ikke sentrum
function wanderMascot() {
  if (!mascotEl) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = 140, H = 180;
  // Soner: nede-venstre, nede-høyre, oppe-venstre, oppe-høyre (unngå sentrum)
  const zones = [
    { xMin: 20, xMax: Math.min(260, vw * 0.25), yMin: vh - H - 30, yMax: vh - H - 10 },
    { xMin: Math.max(vw - 260, vw * 0.75 - 140), xMax: vw - W - 20, yMin: vh - H - 30, yMax: vh - H - 10 },
    { xMin: 20, xMax: Math.min(200, vw * 0.2), yMin: 90, yMax: 180 },
    { xMin: Math.max(vw - 220, vw * 0.8 - 140), xMax: vw - W - 20, yMin: 90, yMax: 180 },
  ];
  const z = zones[Math.floor(Math.random() * zones.length)];
  const x = z.xMin + Math.random() * Math.max(10, z.xMax - z.xMin);
  const y = z.yMin + Math.random() * Math.max(10, z.yMax - z.yMin);
  const duration = 5 + Math.random() * 4; // 5-9s — rolig tempo
  mascotEl.style.transition = `transform ${duration}s cubic-bezier(.45,0,.25,1)`;
  mascotEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  setTimeout(wanderMascot, (duration + 2 + Math.random() * 3) * 1000);
}
// Startposisjon (nede-venstre) og begynn å vandre
if (mascotEl) {
  const startY = window.innerHeight - 200;
  mascotEl.style.transform = `translate3d(30px, ${startY}px, 0)`;
  setTimeout(wanderMascot, 2000);
  // Hold mascoten innenfor viewport ved resize
  window.addEventListener('resize', () => {
    // Bare oppdater hvis den er langt utenfor
  });
}

// ===== Live emoji reactions (flytende bobler) =====
socket.on('reaction', ({ emoji, from }) => spawnFloater(emoji, from));

function spawnFloater(emoji, from) {
  const el = document.createElement('div');
  el.className = 'floater';
  const x = 20 + Math.random() * (window.innerWidth - 80);
  el.style.left = x + 'px';
  el.style.bottom = '80px';
  el.innerHTML = `<div class="floater-emoji">${emoji}</div><div class="floater-name">${esc(from || '')}</div>`;
  // Random drift
  el.style.setProperty('--drift', ((Math.random() - 0.5) * 200).toFixed(0) + 'px');
  floaters.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ===== Trofé-annonseringer (via mascoten) =====
socket.on('trophies', (list) => {
  // Mascoten feirer en kort stund når trofeer dukker opp
  if (mascotEl && list.length > 0) {
    mascotEl.classList.add('celebrating');
    setTimeout(() => mascotEl.classList.remove('celebrating'), 2000);
  }
  list.forEach((t, i) => setTimeout(() => {
    let msg = '';
    if (t.type === 'first' && t.name) msg = `${t.name} var først ute! ⚡`;
    else if (t.type === 'streak' && t.name) msg = `${t.name} — ${t.label} 🔥`;
    else if (t.type === 'perfect') msg = 'Alle svarte riktig! 💯';
    else if (t.name) msg = `${t.emoji || '🏆'} ${t.name} — ${t.label}`;
    else msg = `${t.emoji || '🏆'} ${t.label}`;
    hostSpeak(msg);
    spawnTrophyEmoji(t.emoji || '🏆');
    window.sfx?.fanfare?.();
  }, i * 1800 + 300));
});

// Trofé-emoji fyres fra mascotens posisjon og flyter oppover
function spawnTrophyEmoji(emoji) {
  if (!mascotEl) return;
  const rect = mascotEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'trophy-emoji-float';
  el.textContent = emoji;
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = (rect.top + 20) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('fly'), 30);
  setTimeout(() => el.remove(), 2800);
}

socket.on('state', s => {
  const prev = state;
  state = s;
  triggerPhaseEffects(prev, s);
  // Unngå re-render når bare "answered count" endres under quiz
  const sameQuestion = prev && prev.phase === s.phase && s.phase === 'question'
    && prev.qIndex === s.qIndex && prev.paused === s.paused;
  const sameVoting = prev && prev.phase === s.phase && s.phase === 'voting';
  const sameScatter = prev && prev.phase === s.phase && s.phase === 'scatter-play';
  if (sameQuestion || sameVoting || sameScatter) {
    // Soft update — oppdater bare counters
    softUpdateCounts();
    lastPhase = s.phase;
    return;
  }
  // Aktiver fase-fade kun ved FAKTISK fase-endring
  if (prev && prev.phase !== s.phase) {
    main.classList.remove('phase-changing');
    void main.offsetWidth;
    main.classList.add('phase-changing');
  }
  lastPhase = s.phase;
  lastQIndex = s.qIndex;
  const ae = document.activeElement;
  const preservedId = ae && ['aiTopic','aiKey','aiEndpoint','aiModel'].includes(ae.id) ? ae.id : null;
  const preservedValue = preservedId ? ae.value : null;
  const preservedSelStart = preservedId && 'selectionStart' in ae ? ae.selectionStart : null;
  const preservedSelEnd = preservedId && 'selectionEnd' in ae ? ae.selectionEnd : null;
  render();
  if (preservedId) {
    const el = document.getElementById(preservedId);
    if (el) {
      el.value = preservedValue;
      el.focus();
      if (preservedSelStart != null) try { el.setSelectionRange(preservedSelStart, preservedSelEnd); } catch {}
    }
  }
});

function softUpdateCounts() {
  if (!state) return;
  const answered = state.players.filter(p => p.answered || p.voted).length;
  const total = state.players.length;
  // Quiz-counter
  const qMeta = document.querySelector('.q-meta div:last-child');
  if (qMeta && state.phase === 'question') {
    qMeta.textContent = `${answered} / ${total} svar inne ${state.paused ? '· ⏸ Pause' : ''}`;
  }
  // Voting-counter
  const vStatus = document.querySelector('.voting-status');
  if (vStatus && state.phase === 'voting') {
    vStatus.textContent = `${answered} / ${total} har stemt`;
  }
  const vBar = document.querySelector('.voting-bar');
  if (vBar && state.phase === 'voting') {
    vBar.style.width = ((answered / Math.max(1, total)) * 100) + '%';
  }
  // Scatter-counter
  const sStatus = document.querySelector('.scatter-status');
  if (sStatus && state.phase === 'scatter-play') {
    sStatus.textContent = `${answered} / ${total} ferdig`;
  }
}

function triggerPhaseEffects(prev, s) {
  if (!prev) return;
  if (prev.phase !== s.phase) {
    if (s.phase === 'wheel') { window.sfx?.spin(); stopSpeaking(); }
    if (s.phase === 'end') { stopSpeaking(); window.sfx?.fanfare(); window.confetti?.burst(); setTimeout(() => window.confetti?.burst(), 600); setTimeout(() => window.confetti?.burst(), 1400); window.sfx?.applause(); }
    if (s.phase === 'vote-result') { window.sfx?.reveal(); stopSpeaking(); }
    if (s.phase === 'scatter-review') { window.sfx?.reveal(); stopSpeaking(); }
    if (s.phase === 'lie-reveal') { window.sfx?.reveal(); stopSpeaking(); }
    if (s.phase === 'reveal') stopSpeaking(); // lyd spilles i renderReveal basert på riktig/feil
  }
  // TTS: les opp spørsmål (kun)
  if (s.phase === 'question' && prev.phase !== 'question' && s.question && s.question.text) {
    if (!s.question.isEmoji) hostSpeak(s.question.text);
  }
  // Player joined sound
  if (prev.players.length < s.players.length) window.sfx?.join();
}

function render() {
  try {
  if (!state) return;
  const newPhaseLabel = PHASE_LABELS[state.phase] || state.phase;
  if (phaseTag.textContent !== newPhaseLabel) {
    phaseTag.textContent = newPhaseLabel;
    phaseTag.classList.add('changed');
    setTimeout(() => phaseTag.classList.remove('changed'), 400);
  }
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
  if (wheelRevealTimeout) { clearTimeout(wheelRevealTimeout); wheelRevealTimeout = null; }

  switch (state.phase) {
    case 'lobby': renderLobby(); break;
    case 'countdown': renderCountdown(); break;
    case 'question': renderQuestion(); break;
    case 'reveal': renderReveal(); break;
    case 'leaderboard': renderLeaderboard(); break;
    case 'wheel': renderWheel(); break;
    case 'voting': renderVoting(); break;
    case 'vote-result': renderVoteResult(); break;
    case 'scatter-play': renderScatterPlay(); break;
    case 'scatter-review': renderScatterReview(); break;
    case 'icebreaker': renderIcebreaker(); break;
    case 'snake': renderSnake(); break;
    case 'snake-end': renderSnakeEnd(); break;
    case 'bomb': renderBomb(); break;
    case 'bomb-end': renderBombEnd(); break;
    case 'lie-collect': renderLieCollect(); break;
    case 'lie-play': renderLiePlay(); break;
    case 'lie-reveal': renderLieReveal(); break;
    case 'end': renderEnd(); break;
  }
  renderControls();
  } catch (e) { console.error('[host render error]', e); }
}

// ============ COUNTDOWN ============
function renderCountdown() {
  const endsAt = state.countdownEndsAt || Date.now() + 3000;
  main.innerHTML = `
    <div class="countdown-screen">
      <div class="countdown-meta">Spørsmål ${state.qIndex + 1} / ${state.total}${state.lightning ? ' ⚡ LYN-RUNDE' : ''}</div>
      <div class="countdown-num" id="cdNum">3</div>
    </div>`;
  const el = document.getElementById('cdNum');
  function tick() {
    const msLeft = endsAt - Date.now();
    const n = Math.ceil(msLeft / 1000);
    if (n <= 0) { el.textContent = 'GO!'; el.className = 'countdown-num go'; return; }
    if (el.textContent !== String(n)) {
      el.textContent = n;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      window.sfx?.countdown();
    }
    if (state.phase === 'countdown') requestAnimationFrame(tick);
  }
  tick();
}

// ============ LOBBY ============
function renderLobby() {
  const p = state.players;
  const teams = state.teams || [];
  main.innerHTML = `
    <div class="lobby">
      <div class="lobby-left">
        <h2>Velkommen til showet</h2>
        <p class="lead">Skann koden eller åpne lenken på telefonen din.</p>
        <div class="join-box">
          <img src="/qr" alt="QR">
          <div class="join-info">
            <b>Bli med på</b>
            <div class="url">${connectUrl.replace('http://', '')}</div>
            <span>Skriv et navn og du er inne.</span>
          </div>
        </div>
        <div class="lobby-config">
          <div class="cfg-row">
            <label>
              <input type="checkbox" id="cfgTeam" ${state.teamMode ? 'checked' : ''}>
              Lag-modus
            </label>
            <select id="cfgNumTeams" ${!state.teamMode ? 'disabled' : ''}>
              ${[2,3,4,5,6].map(n => `<option value="${n}" ${teams.length === n ? 'selected' : ''}>${n} lag</option>`).join('')}
            </select>
            ${state.teamMode ? `<button class="btn btn-ghost btn-sm" onclick="reshuffle()">🔀 Miks lag</button>` : ''}
          </div>
          <div class="cfg-row">
            <label>Spørsmål: <select id="cfgQCount">
              ${[5,8,10,12,15,20].map(n => `<option value="${n}" ${n === state.questionCount ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
            <label>Tid: <select id="cfgTime">
              ${[10000,15000,20000,30000].map(n => `<option value="${n}" ${n === state.timeLimit ? 'selected' : ''}>${n/1000} sek</option>`).join('')}
            </select></label>
            <label>📊 Tavle: <select id="cfgLBEvery">
              <option value="0" ${state.leaderboardEvery === 0 ? 'selected' : ''}>Bare på slutten</option>
              <option value="3" ${state.leaderboardEvery === 3 ? 'selected' : ''}>Hver 3.</option>
              <option value="5" ${state.leaderboardEvery === 5 ? 'selected' : ''}>Hver 5.</option>
              <option value="10" ${state.leaderboardEvery === 10 ? 'selected' : ''}>Hver 10.</option>
            </select></label>
          </div>
        </div>
        ${renderAiBox()}
      </div>
      <div class="lobby-right">
        <h3>Spillere <span class="count">${p.length}</span>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="openLeaderboardModal()" title="Se historisk topplist">🏆 Topplist</button>
        </h3>
        ${p.length === 0
          ? '<div class="empty-hint">Venter på at noen skal bli med…</div>'
          : (state.teamMode
              ? teams.map(t => {
                  const members = p.filter(x => x.teamId === t.id);
                  return `<div class="team-block" style="--team-color:${t.color}">
                    <div class="team-header"><span class="team-emoji">${t.emoji}</span>
                      <b class="team-name-ed" data-tid="${t.id}" title="Klikk for å endre navn">${esc(t.name)}</b>
                      <span class="team-count">${members.length}</span></div>
                    <div class="team-players">${members.map(x => `<span class="team-chip" title="Klikk for å fjerne" data-pid="${x.id}" data-pname="${esc(x.name)}"><span class="avatar-sm">${x.emoji || avatarFor(x.name)}</span> ${esc(x.name)}</span>`).join('') || '<span class="empty-hint-sm">–</span>'}</div>
                  </div>`;
                }).join('')
              : `<div class="players-grid">${p.map(x => `<div class="player-chip" title="Klikk for å fjerne" data-pid="${x.id}" data-pname="${esc(x.name)}"><span class="avatar">${x.emoji || avatarFor(x.name)}</span> ${esc(x.name)}</div>`).join('')}</div>`)
        }
      </div>
    </div>`;
  // Wire config
  const team = document.getElementById('cfgTeam');
  const num = document.getElementById('cfgNumTeams');
  const qc = document.getElementById('cfgQCount');
  const tm = document.getElementById('cfgTime');
  team?.addEventListener('change', () => socket.emit('host:config', { teamMode: team.checked, numTeams: +num.value }));
  num?.addEventListener('change', () => socket.emit('host:config', { numTeams: +num.value }));
  qc?.addEventListener('change', () => socket.emit('host:config', { questionCount: +qc.value }));
  tm?.addEventListener('change', () => socket.emit('host:config', { timeLimit: +tm.value }));
  const lb = document.getElementById('cfgLBEvery');
  lb?.addEventListener('change', () => socket.emit('host:config', { leaderboardEvery: +lb.value }));

  // Kick-spiller: klikk på player-chip
  document.querySelectorAll('.player-chip[data-pid], .team-chip[data-pid]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.pid;
      const pname = el.dataset.pname;
      if (confirm(`Fjern ${pname} fra spillet?`)) socket.emit('host:kick', pid);
    });
  });
  // Rename team: klikk på team-name
  document.querySelectorAll('.team-name-ed').forEach(el => {
    el.addEventListener('click', () => {
      const id = +el.dataset.tid;
      const cur = el.textContent;
      const n = prompt('Nytt navn for laget:', cur);
      if (n && n.trim() && n.trim() !== cur) socket.emit('host:rename-team', { id, name: n.trim() });
    });
  });
}

window.reshuffle = () => socket.emit('host:reshuffle-teams');

// ============ AI GENERATOR ============
let aiState = {
  status: 'idle',      // idle | working | ready | error | voting-ready
  mode: 'quiz',        // quiz | voting
  message: '',
  questions: null,
  title: '',
  votingPrompts: null,
  showSettings: false,
};

function renderAiBox() {
  const cfg = getAiConfig();
  const hasKey = !!cfg.apiKey;
  return `
    <div class="ai-box">
      <div class="ai-head">
        <div class="ai-title">🪄 Egendefinert med AI</div>
        <button class="ai-gear" onclick="toggleAiSettings()" title="Innstillinger">⚙️</button>
      </div>
      ${aiState.showSettings ? `
        <div class="ai-settings">
          <label>API-URL<input type="text" id="aiEndpoint" value="${esc(cfg.endpoint)}" placeholder="https://api.openai.com/v1/chat/completions"></label>
          <label>Modell<input type="text" id="aiModel" value="${esc(cfg.model)}" placeholder="gpt-4o-mini"></label>
          <label>API-nøkkel<input type="password" id="aiKey" value="${esc(cfg.apiKey)}" placeholder="sk-..." autocomplete="off"></label>
          <button class="btn btn-ghost btn-sm" onclick="saveAi()">💾 Lagre</button>
          <p class="ai-note">Nøkkelen lagres kun i nettleseren din. Serveren ser den aldri.</p>
        </div>` : ''}
      ${!hasKey && !aiState.showSettings ? `
        <p class="ai-note">Legg inn API-nøkkel under ⚙️ for å generere.</p>` : ''}
      <div class="ai-row">
        <input type="text" id="aiTopic" placeholder="Tema – f.eks. Premier League, gutta på hytta, IT-avdelingen..." ${aiState.status === 'working' ? 'disabled' : ''}>
        <select id="aiCount" ${aiState.status === 'working' ? 'disabled' : ''}>
          ${[5,8,10,12,15].map(n => `<option value="${n}" ${n === 10 ? 'selected' : ''}>${n} stk</option>`).join('')}
        </select>
        <select id="aiMode" ${aiState.status === 'working' ? 'disabled' : ''}>
          <option value="quiz">📝 Quiz</option>
          <option value="emoji">🎭 Emoji</option>
          <option value="voting">🗳️ Hvem er mest sannsynlig</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="generateAi()" ${aiState.status === 'working' || !hasKey ? 'disabled' : ''}>
          ${aiState.status === 'working' ? '⏳' : '✨ Generer'}
        </button>
      </div>
      ${aiState.status === 'ready' && aiState.questions ? `
        <div class="ai-ready">
          ✅ <b>${aiState.questions.length} spørsmål klare</b> — "${esc(aiState.title)}"
          <button class="btn btn-primary btn-sm" onclick="startCustomQuiz()">▶ Start nå</button>
          <button class="btn btn-ghost btn-sm" onclick="previewCustom()">👁 Forhåndsvis</button>
          <button class="btn btn-ghost btn-sm" onclick="resetAi()">✕</button>
        </div>` : ''}
      ${aiState.status === 'voting-ready' && aiState.votingPrompts ? `
        <div class="ai-ready">
          ✅ <b>${aiState.votingPrompts.length} nye "mest sannsynlig"-spørsmål</b> lagt i poolen
          <button class="btn btn-primary btn-sm" onclick="act('host:start-voting')">🗳️ Start runde</button>
          <button class="btn btn-ghost btn-sm" onclick="previewVoting()">👁 Se liste</button>
          <button class="btn btn-ghost btn-sm" onclick="resetAi()">✕</button>
        </div>` : ''}
      ${aiState.status === 'error' ? `<div class="ai-error">⚠️ ${esc(aiState.message)}</div>` : ''}
    </div>`;
}

window.toggleAiSettings = () => { aiState.showSettings = !aiState.showSettings; render(); };
window.saveAi = () => {
  const endpoint = document.getElementById('aiEndpoint').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  const apiKey = document.getElementById('aiKey').value.trim();
  saveAiConfig({ endpoint, model, apiKey });
  aiState.showSettings = false;
  render();
};
window.generateAi = async () => {
  const topic = document.getElementById('aiTopic').value.trim();
  const count = +document.getElementById('aiCount').value;
  const mode = document.getElementById('aiMode').value;
  if (!topic) { aiState.status = 'error'; aiState.message = 'Skriv et tema først'; render(); return; }
  aiState.status = 'working';
  aiState.message = '';
  aiState.mode = mode;
  render();
  try {
    if (mode === 'voting') {
      const prompts = await generateVotingPrompts({ topic, count });
      aiState.votingPrompts = prompts;
      aiState.status = 'voting-ready';
      socket.emit('host:add-voting-prompts', prompts);
      render();
    } else {
      const result = await generateQuestions({ topic, count, tone: mode });
      aiState.questions = result.questions;
      aiState.title = result.title;
      aiState.status = 'ready';
      render();
    }
  } catch (e) {
    aiState.status = 'error';
    aiState.message = e.message || 'Generering feilet';
    render();
  }
};
window.startCustomQuiz = () => {
  if (!aiState.questions?.length) return;
  socket.emit('host:start-custom-quiz', { questions: aiState.questions, title: aiState.title });
  aiState = { status: 'idle', mode: 'quiz', message: '', questions: null, title: '', votingPrompts: null, showSettings: false };
};
window.previewCustom = () => {
  if (!aiState.questions) return;
  const txt = aiState.questions.map((q, i) =>
    `${i + 1}. ${q.q}\n` + q.a.map((a, j) => `   ${'ABCD'[j]}${j === q.c ? ' ✓' : ' '} ${a}`).join('\n')
  ).join('\n\n');
  alert(txt);
};
window.previewVoting = () => {
  if (!aiState.votingPrompts) return;
  alert(aiState.votingPrompts.map((p, i) => (i+1)+'. '+p).join('\n\n'));
};
window.resetAi = () => { aiState = { status: 'idle', mode: 'quiz', message: '', questions: null, title: '', votingPrompts: null, showSettings: false }; render(); };

// ============ QUESTION ============
function renderQuestion() {
  const q = state.question;
  const isEmoji = q.isEmoji;
  const answered = state.players.filter(p => p.answered).length;
  main.innerHTML = `
    <div class="q-screen">
      <div class="q-meta">
        <div>Spørsmål ${state.qIndex + 1} / ${state.total}</div>
        <div>${answered} / ${state.players.length} svar inne ${state.paused ? '· ⏸ Pause' : ''}</div>
      </div>
      ${isEmoji ? `<div class="q-emoji">${q.text}</div>` : `<div class="q-text">${esc(q.text)}</div>`}
      <div class="timer"><div class="timer-bar" id="tbar"></div></div>
      <div class="options">
        ${q.options.map((o, i) => `<div class="option option-${i}"><div class="marker">${'ABCD'[i]}</div>${esc(o)}</div>`).join('')}
      </div>
    </div>`;
  animateTimer(q.startedAt, q.timeLimit);
}

function renderReveal() {
  const q = state.question;
  main.innerHTML = `
    <div class="q-screen">
      <div class="q-meta"><div>Spørsmål ${state.qIndex + 1} / ${state.total}</div><div>Fasit</div></div>
      ${q.isEmoji ? `<div class="q-emoji">${q.text}</div>` : `<div class="q-text">${esc(q.text)}</div>`}
      <div class="options">
        ${q.options.map((o, i) => `<div class="option option-${i} ${i === q.correct ? 'correct' : 'dimmed'}"><div class="marker">${'ABCD'[i]}</div>${esc(o)}</div>`).join('')}
      </div>
      <div class="answered-row">
        <div>✅ ${state.players.filter(p => p.lastCorrect).length} riktig</div>
        <div>❌ ${state.players.filter(p => p.lastCorrect === false).length} feil</div>
        <div>💤 ${state.players.filter(p => p.lastCorrect === null).length} uten svar</div>
      </div>
    </div>`;
  if (state.players.filter(p => p.lastCorrect).length > 0) {
    window.confetti?.spawn(40, window.innerWidth / 2, window.innerHeight * 0.4);
    window.sfx?.correct();
  } else {
    window.sfx?.wrong();
  }
}

// ============ LEADERBOARD ============
function renderLeaderboard() {
  if (state.teamMode) {
    const teams = [...state.teams].sort((a, b) => b.score - a.score);
    main.innerHTML = `
      <div class="leaderboard">
        <h2>Lag-tavle</h2>
        ${teams.map((t, i) => {
          const members = state.players.filter(p => p.teamId === t.id);
          const avg = members.length ? Math.round(t.score / members.length) : 0;
          return `<div class="lb-row team-row" style="animation-delay:${i*80}ms; border-color:${t.color}">
            <div class="lb-rank">${i+1}</div>
            <div><span class="team-emoji">${t.emoji}</span> ${esc(t.name)} <span class="team-members-s">· ${members.length} spillere</span></div>
            <div class="lb-delta">snitt ${avg}</div>
            <div>${t.score} p</div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    main.innerHTML = `
      <div class="leaderboard">
        <h2>Poengtavle</h2>
        ${sorted.slice(0, 10).map((p, i) => `
          <div class="lb-row" style="animation-delay: ${i * 80}ms">
            <div class="lb-rank">${i + 1}</div>
            <div><span class="avatar">${avatarFor(p.name)}</span> ${esc(p.name)}</div>
            <div class="lb-delta ${p.lastDelta ? '' : 'neg'}">${p.lastDelta ? '+' + p.lastDelta : '±0'}</div>
            <div>${p.score} p</div>
          </div>`).join('')}
      </div>`;
  }
}

// ============ WHEEL ============
function renderWheel() {
  const names = state.players.map(p => p.name);
  const n = names.length;
  if (!n) { main.innerHTML = '<div class="empty-hint">Ingen spillere på hjulet.</div>'; return; }
  const slice = 360 / n;
  const colors = ['#e54b4b', '#3a86ff', '#ffbe0b', '#29c46a', '#d4af37', '#a855f7', '#14b8a6', '#f97316'];
  const chosenIdx = state.wheelResult ? names.indexOf(state.wheelResult) : -1;
  const targetAngle = chosenIdx >= 0 ? -(chosenIdx * slice + slice / 2) : 0;
  const wheelAngle = 360 * 5 + targetAngle;
  const radius = 250, cx = 260, cy = 260;
  const segments = names.map((name, i) => {
    const a1 = (i * slice - 90) * Math.PI / 180;
    const a2 = ((i + 1) * slice - 90) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
    const x2 = cx + radius * Math.cos(a2), y2 = cy + radius * Math.sin(a2);
    const large = slice > 180 ? 1 : 0;
    const d = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`;
    const mid = ((i + 0.5) * slice - 90) * Math.PI / 180;
    const tx = cx + radius * 0.65 * Math.cos(mid), ty = cy + radius * 0.65 * Math.sin(mid);
    const rot = (i + 0.5) * slice;
    return `<path d="${d}" fill="${colors[i % colors.length]}" stroke="#0b0d1a" stroke-width="3"/>
      <text x="${tx}" y="${ty}" transform="rotate(${rot} ${tx} ${ty})" text-anchor="middle" fill="#fff" font-weight="700" font-size="${Math.max(12, Math.min(24, 420 / n))}">${esc(name.slice(0, 14))}</text>`;
  }).join('');
  main.innerHTML = `
    <div class="wheel-wrap">
      <h2>Lykkehjulet snurrer…</h2>
      <div class="wheel">
        <div class="needle"></div>
        <svg id="wheelSvg" width="520" height="520" viewBox="0 0 520 520" style="transform: rotate(0deg)">
          ${segments}
          <circle cx="${cx}" cy="${cy}" r="30" fill="#0b0d1a" stroke="#d4af37" stroke-width="4"/>
        </svg>
      </div>
      <div id="wheelReveal" style="min-height: 80px"></div>
    </div>`;
  requestAnimationFrame(() => {
    const svg = document.getElementById('wheelSvg');
    if (svg) svg.style.transform = `rotate(${wheelAngle}deg)`;
  });
  if (state.wheelResult) {
    wheelRevealTimeout = setTimeout(() => {
      const r = document.getElementById('wheelReveal');
      if (r) r.innerHTML = `<div class="wheel-result">🎉 ${esc(state.wheelResult)} 🎉</div>`;
      window.confetti?.burst();
      window.sfx?.fanfare();
    }, 4600);
  }
}

// ============ VOTING ============
function renderVoting() {
  const answered = state.players.filter(p => p.voted).length;
  main.innerHTML = `
    <div class="voting-screen">
      <div class="voting-label">Hvem er mest sannsynlig…</div>
      <div class="voting-prompt">${esc(state.votingPrompt)}</div>
      <div class="voting-progress">
        <div class="voting-bar" style="width:${(answered / Math.max(1, state.players.length)) * 100}%"></div>
      </div>
      <div class="voting-status">${answered} / ${state.players.length} har stemt</div>
      <div class="voting-grid">
        ${state.players.map(p => `<div class="vote-chip ${p.voted ? 'voted' : ''}">${esc(p.name)}${p.voted ? ' ✓' : ''}</div>`).join('')}
      </div>
    </div>`;
}

function renderVoteResult() {
  const results = state.votingResults || [];
  const top = results[0];
  main.innerHTML = `
    <div class="voting-screen">
      <div class="voting-label">Hvem er mest sannsynlig…</div>
      <div class="voting-prompt">${esc(state.votingPrompt)}</div>
      ${top ? `<div class="vote-winner">🏆 ${esc(top.name)} <span class="vote-count">(${top.count} ${top.count === 1 ? 'stemme' : 'stemmer'})</span></div>` : ''}
      <div class="vote-results">
        ${results.slice(0, 8).map((r, i) => {
          const pct = top ? (r.count / top.count) * 100 : 0;
          return `<div class="vote-row">
            <div class="vote-name">${esc(r.name)}</div>
            <div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%; animation-delay:${i*100}ms"></div></div>
            <div class="vote-num">${r.count}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  if (top) { window.confetti?.burst(); window.sfx?.applause(); }
}

// ============ SCATTERGORIES ============
function renderScatterPlay() {
  const answered = state.players.filter(p => p.answered).length;
  main.innerHTML = `
    <div class="scatter-screen">
      <div class="scatter-letter">${state.scatterLetter}</div>
      <div class="scatter-subtitle">Skriv ord som starter med <b>${state.scatterLetter}</b> i hver kategori</div>
      <div class="scatter-cats">
        ${state.scatterCategories.map(c => `<div class="scatter-cat">${esc(c)}</div>`).join('')}
      </div>
      <div class="timer"><div class="timer-bar" id="tbar"></div></div>
      <div class="scatter-status">${answered} / ${state.players.length} ferdig</div>
    </div>`;
  animateTimer(state.scatterStartedAt || Date.now(), state.scatterTimeLimit || 60000);
}

function renderScatterReview() {
  const review = state.scatterReview || [];
  const cats = state.scatterCategories;
  main.innerHTML = `
    <div class="scatter-review">
      <h2>Kategori-kamp — Bokstav ${state.scatterLetter}</h2>
      <table class="scatter-table">
        <thead>
          <tr><th>Spiller</th>${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th>+</th></tr>
        </thead>
        <tbody>
          ${review.map(r => `<tr>
            <td><b>${esc(r.name)}</b></td>
            ${(r.answers || []).map((a, i) => {
              const word = (a || '').trim();
              const startsRight = word && word[0].toLowerCase() === state.scatterLetter.toLowerCase();
              return `<td class="${word ? (startsRight ? 'ok' : 'bad') : 'empty'}">${esc(word) || '—'}</td>`;
            }).join('')}
            <td class="scatter-delta">+${r.delta}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ============ ICEBREAKER ============
function renderIcebreaker() {
  main.innerHTML = `
    <div class="icebreaker-screen">
      <div class="icebreaker-label">Bli-kjent-kort</div>
      <div class="icebreaker-target">${esc(state.icebreakerTarget)}</div>
      <div class="icebreaker-prompt">${esc(state.icebreakerPrompt)}</div>
      <div class="icebreaker-hint">Gi mikken til ${esc(state.icebreakerTarget)} 🎤</div>
    </div>`;
}

// ============ 2 SANNHETER, 1 LØGN ============
function renderLieCollect() {
  const lc = state.lieCollect || { submittedIds: [], totalPlayers: 0 };
  const total = state.players.length;
  const submitted = new Set(lc.submittedIds);
  const submittedCount = submitted.size;
  main.innerHTML = `
    <div class="lie-screen lie-collect-screen">
      <div class="lie-title">🤥 2 sannheter og 1 løgn</div>
      <div class="lie-sub">Alle spillere skriver inn <b>3 påstander om seg selv</b> — 2 sanne, 1 løgn — på telefonen sin.</div>
      <div class="lie-progress">
        <div class="lie-progress-num">${submittedCount} / ${total}</div>
        <div class="lie-progress-label">spillere er ferdig</div>
        <div class="lie-progress-bar"><div class="lie-progress-fill" style="width:${total ? (submittedCount / total * 100) : 0}%"></div></div>
      </div>
      <div class="lie-submitters">
        ${state.players.map(p => `
          <div class="lie-sub-chip ${submitted.has(p.id) ? 'ready' : ''}">
            <span class="avatar-sm">${p.emoji || avatarFor(p.name)}</span>
            <span class="lie-sub-name">${esc(p.name)}</span>
            <span class="lie-sub-status">${submitted.has(p.id) ? '✓' : '…'}</span>
          </div>
        `).join('')}
      </div>
      ${submittedCount >= 2 ? `<div class="lie-hint">Klar til å starte når du vil — trykk "Start runde" nedenfor.</div>` : `<div class="lie-hint lie-hint-wait">Venter på minst 2 innsendinger…</div>`}
    </div>`;
}

function renderLiePlay() {
  const lp = state.liePlay;
  if (!lp) { main.innerHTML = `<div class="lie-screen"><div class="lie-title">Venter…</div></div>`; return; }
  const total = state.players.length;
  const votersTotal = Math.max(0, total - 1); // minus submitter
  const votedCount = lp.votedIds.length;
  main.innerHTML = `
    <div class="lie-screen lie-play-screen">
      <div class="lie-turn">Tur ${lp.turnIdx} / ${lp.totalTurns}</div>
      <div class="lie-player-header">
        <span class="lie-player-emoji">${lp.currentEmoji || avatarFor(lp.currentName)}</span>
        <div class="lie-player-info">
          <div class="lie-player-label">Hvem lyver?</div>
          <div class="lie-player-name">${esc(lp.currentName)}</div>
        </div>
      </div>
      <div class="lie-statements">
        ${lp.statements.map((s, i) => `
          <div class="lie-statement">
            <div class="lie-stmt-num">${i + 1}</div>
            <div class="lie-stmt-text">${esc(s)}</div>
          </div>
        `).join('')}
      </div>
      <div class="lie-vote-status">${votedCount} / ${votersTotal} har stemt</div>
    </div>`;
}

function renderLieReveal() {
  const lp = state.liePlay;
  if (!lp) { main.innerHTML = `<div class="lie-screen"><div class="lie-title">Venter…</div></div>`; return; }
  const lieIdx = lp.lieDisplayIdx;
  const bd = lp.voteBreakdown || [0, 0, 0];
  const names = lp.voterNames || [[], [], []];
  const totalVotes = bd.reduce((a, b) => a + b, 0);
  const fooled = bd.filter((_, i) => i !== lieIdx).reduce((a, b) => a + b, 0);
  const submitter = state.players.find(p => p.id === lp.currentId);
  const submitterDelta = submitter ? submitter.lastDelta : 0;
  main.innerHTML = `
    <div class="lie-screen lie-reveal-screen">
      <div class="lie-turn">Tur ${lp.turnIdx} / ${lp.totalTurns}</div>
      <div class="lie-player-header">
        <span class="lie-player-emoji">${lp.currentEmoji || avatarFor(lp.currentName)}</span>
        <div class="lie-player-info">
          <div class="lie-player-label">Løgnen var…</div>
          <div class="lie-player-name">${esc(lp.currentName)}</div>
        </div>
      </div>
      <div class="lie-statements reveal">
        ${lp.statements.map((s, i) => {
          const isLie = i === lieIdx;
          const count = bd[i] || 0;
          const pct = totalVotes ? Math.round(count / totalVotes * 100) : 0;
          return `
            <div class="lie-statement ${isLie ? 'is-lie' : 'is-truth'}">
              <div class="lie-stmt-num">${isLie ? '🤥' : '✓'}</div>
              <div class="lie-stmt-body">
                <div class="lie-stmt-text">${esc(s)}</div>
                <div class="lie-stmt-votes">
                  <div class="lie-votes-bar"><div class="lie-votes-fill ${isLie ? 'lie' : 'truth'}" style="width:${pct}%"></div></div>
                  <div class="lie-votes-meta">${count} stemme${count === 1 ? '' : 'r'} · ${esc((names[i] || []).join(', ') || '–')}</div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="lie-reveal-summary">
        ${fooled > 0
          ? `🎭 ${esc(lp.currentName)} lurte ${fooled} spiller${fooled === 1 ? '' : 'e'} (+${submitterDelta} poeng til løgneren)`
          : `👀 Ingen lot seg lure — ${esc(lp.currentName)} fikk ingen bonus.`}
      </div>
    </div>`;
}

// ============ SNAKE ============
let snakeSnap = null;
let snakeTimerRAF = null;

let snakeNeedsInit = true;

socket.on('snake:tick', s => {
  snakeSnap = s;
  if (state?.phase !== 'snake') return;
  if (snakeNeedsInit && s.grid) {
    const canvas = document.getElementById('snakeCanvas');
    if (canvas) {
      snake3d.init(canvas, s.grid.w, s.grid.h);
      snakeNeedsInit = false;
    }
  }
  drawSnake();
});

function renderSnake() {
  const showCountdown = snakeSnap && !snakeSnap.started;
  main.innerHTML = `
    <div class="snake-screen">
      <div class="snake-top">
        <div class="snake-time" id="snakeTime">⏱ ${(snakeSnap?.isInfinite || state.snakeDuration === 0) ? '∞' : Math.ceil((snakeSnap?.timeLeft || 60000) / 1000) + 's'}</div>
        <div class="snake-title">🐍 Slange-kamp</div>
        <div class="snake-info">Spis, og unngå kollisjoner!</div>
      </div>
      <div class="snake-arena">
        <div class="snake-canvas-wrap">
          <canvas id="snakeCanvas"></canvas>
          ${showCountdown ? `<div class="snake-overlay"><div id="snakeCd" class="snake-countdown">${Math.min(3, Math.max(1, Math.ceil((snakeSnap.countdownLeft || 3000) / 1000)))}</div></div>` : ''}
        </div>
        <div class="snake-scores" id="snakeScores"></div>
      </div>
    </div>`;
  const canvas = document.getElementById('snakeCanvas');
  snakeNeedsInit = true;
  if (canvas && snakeSnap?.grid) {
    snake3d.init(canvas, snakeSnap.grid.w, snakeSnap.grid.h);
    snake3d.update(snakeSnap);
    snakeNeedsInit = false;
  }
  snakeAnimateTimer();
}

function drawSnake() {
  if (!snakeSnap) return;
  snake3d.update(snakeSnap);
  snake3d.render();
  updateSnakeScores();
}

function updateSnakeScores() {
  const el = document.getElementById('snakeScores');
  if (!el || !snakeSnap) return;
  const sorted = [...snakeSnap.snakes].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((s, i) => `
    <div class="snake-score-row ${s.alive ? '' : 'dead'}" style="border-color:${s.color}">
      <div class="snake-score-rank">${i + 1}</div>
      <div class="snake-score-name">${s.emoji || '🐍'} ${esc(s.name)}</div>
      <div class="snake-score-val" style="color:${s.color}">${s.score}</div>
      ${!s.alive && s.respawnIn > 0 ? `<div class="snake-score-resp">↺ ${Math.ceil(s.respawnIn/1000)}s</div>` : ''}
    </div>`).join('');
}

function snakeAnimateTimer() {
  if (snakeTimerRAF) cancelAnimationFrame(snakeTimerRAF);
  const el = document.getElementById('snakeTime');
  const cdEl = document.getElementById('snakeCd');
  function tick() {
    if (!snakeSnap || state?.phase !== 'snake') return;
    if (el) el.textContent = `⏱ ${snakeSnap.isInfinite ? '∞' : Math.max(0, Math.ceil(snakeSnap.timeLeft / 1000)) + 's'}`;
    if (cdEl && !snakeSnap.started) cdEl.textContent = Math.min(3, Math.max(1, Math.ceil(snakeSnap.countdownLeft / 1000)));
    // Re-render 3D scene hver frame for jevn animasjon
    snake3d.render();
    snakeTimerRAF = requestAnimationFrame(tick);
  }
  tick();
}

function renderSnakeEnd() {
  snake3d.dispose();
  const snakes = snakeSnap ? [...snakeSnap.snakes].sort((a, b) => b.score - a.score) : [];
  const top3 = snakes.slice(0, 3);
  main.innerHTML = `
    <div class="end-screen">
      <h2>🐍 Slange-resultat 🐍</h2>
      <div class="podium">
        ${top3[1] ? `<div class="podium-col p2" style="border-color:${top3[1].color}"><div class="podium-medal">🥈</div><div class="podium-avatar">${top3[1].emoji || '🐍'}</div><div class="podium-name">${esc(top3[1].name)}</div><div class="podium-score">${top3[1].score} p</div></div>` : ''}
        ${top3[0] ? `<div class="podium-col p1" style="border-color:${top3[0].color}"><div class="podium-medal">🥇</div><div class="podium-avatar">${top3[0].emoji || '🐍'}</div><div class="podium-name">${esc(top3[0].name)}</div><div class="podium-score">${top3[0].score} p</div></div>` : ''}
        ${top3[2] ? `<div class="podium-col p3" style="border-color:${top3[2].color}"><div class="podium-medal">🥉</div><div class="podium-avatar">${top3[2].emoji || '🐍'}</div><div class="podium-name">${esc(top3[2].name)}</div><div class="podium-score">${top3[2].score} p</div></div>` : ''}
      </div>
      <p style="color: var(--ink-2); font-size: 16px; margin-top: 20px">Poeng er lagt til hovedscoren</p>
    </div>`;
  for (let i = 0; i < 3; i++) setTimeout(() => window.confetti?.burst(), i * 500);
  window.sfx?.fanfare();
}

// ============ BOMBERMAN ============
let bombSnap = null;
let bombWallsCache = null;
let bombTimerRAF = null;

let bombNeedsInit = true;

socket.on('bomb:tick', s => {
  if (s.walls) bombWallsCache = s.walls;
  else if (bombWallsCache) s.walls = bombWallsCache;
  const prev = bombSnap;
  bombSnap = s;
  // Lazy init av 3D-scenen når første tick ankommer
  if (bombNeedsInit && state?.phase === 'bomb' && s.grid) {
    const canvas = document.getElementById('bombCanvas');
    if (canvas) {
      bomb3d.init(canvas, s.grid.w, s.grid.h);
      bombNeedsInit = false;
    }
  }
  // Detekter døde spillere for kill-cam
  if (prev && prev.players && s.players) {
    for (const np of s.players) {
      const op = prev.players.find(x => x.id === np.id);
      if (op && op.alive && !np.alive) {
        bomb3d.triggerKillCam(np.x, np.y, 2500);
        showKillBanner(np.name, np.emoji);
        window.sfx?.wrong?.();
        break;
      }
    }
  }
});

function showKillBanner(name, emoji) {
  const old = document.getElementById('killBanner');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'killBanner';
  el.className = 'kill-banner';
  el.innerHTML = `<span class="kill-icon">💀</span> <b>${esc(name)}</b> ble sprengt ${emoji || '💣'}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, 2200);
}

function renderBomb() {
  const showCountdown = bombSnap && !bombSnap.started;
  main.innerHTML = `
    <div class="snake-screen">
      <div class="snake-top">
        <div class="snake-time" id="bombTime">⏱ ${(bombSnap?.isInfinite || state.bombDuration === 0) ? '∞' : Math.ceil((bombSnap?.timeLeft || 90000) / 1000) + 's'}</div>
        <div class="snake-title">💣 Bomberman</div>
        <div class="snake-info">Spreng veggene, knus motstanderen</div>
      </div>
      <div class="snake-arena">
        <div class="snake-canvas-wrap">
          <canvas id="bombCanvas"></canvas>
          ${showCountdown ? `<div class="snake-overlay"><div id="bombCd" class="snake-countdown">${Math.min(3, Math.max(1, Math.ceil((bombSnap.countdownLeft || 3000) / 1000)))}</div></div>` : ''}
        </div>
        <div class="snake-scores" id="bombScores"></div>
      </div>
    </div>`;
  // Init Three.js-scenen (hvis bombSnap har grid) — ellers trigges init av bomb:tick-handleren
  const canvas = document.getElementById('bombCanvas');
  bombNeedsInit = true;
  if (canvas && bombSnap?.grid) {
    bomb3d.init(canvas, bombSnap.grid.w, bombSnap.grid.h);
    bomb3d.update(bombSnap);
    bombNeedsInit = false;
  }
  bombAnimateTimer();
}

function drawBomb() {
  if (!bombSnap) return;
  bomb3d.update(bombSnap);
  bomb3d.render();
  updateBombScores();
}

function updateBombScores() {
  const el = document.getElementById('bombScores');
  if (!el || !bombSnap) return;
  const sorted = [...bombSnap.players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((s, i) => `
    <div class="snake-score-row ${s.alive ? '' : 'dead'}" style="border-color:${s.color}">
      <div class="snake-score-rank">${i + 1}</div>
      <div class="snake-score-name">${s.emoji || '💣'} ${esc(s.name)}</div>
      <div class="snake-score-val" style="color:${s.color}">${s.score}</div>
      ${!s.alive && s.respawnIn > 0 ? `<div class="snake-score-resp">↺ ${Math.ceil(s.respawnIn/1000)}s</div>` : ''}
      ${s.alive ? `<div class="snake-score-resp">💣×${s.bombsMax} · 🔥${s.range}${s.shield > 0 ? ' · 🛡️' : ''}</div>` : ''}
    </div>`).join('');
}

function bombAnimateTimer() {
  if (bombTimerRAF) cancelAnimationFrame(bombTimerRAF);
  function tick() {
    if (!bombSnap || state?.phase !== 'bomb') return;
    const el = document.getElementById('bombTime');
    const cdEl = document.getElementById('bombCd');
    if (el) el.textContent = `⏱ ${bombSnap.isInfinite ? '∞' : Math.max(0, Math.ceil(bombSnap.timeLeft / 1000)) + 's'}`;
    if (cdEl && !bombSnap.started) cdEl.textContent = Math.min(3, Math.max(1, Math.ceil(bombSnap.countdownLeft / 1000)));
    // Re-draw for smooth animation av eksplosjoner/pulser
    drawBomb();
    bombTimerRAF = requestAnimationFrame(tick);
  }
  tick();
}

// bomb:tick oppdaterer bare snapshot, drawBomb i RAF-loop håndterer rendering

function renderBombEnd() {
  bomb3d.dispose();
  const players = bombSnap ? [...bombSnap.players].sort((a, b) => b.score - a.score) : [];
  const top3 = players.slice(0, 3);
  main.innerHTML = `
    <div class="end-screen">
      <h2>💣 Bomberman-resultat 💣</h2>
      <div class="podium">
        ${top3[1] ? `<div class="podium-col p2" style="border-color:${top3[1].color}"><div class="podium-medal">🥈</div><div class="podium-avatar">${top3[1].emoji || '💣'}</div><div class="podium-name">${esc(top3[1].name)}</div><div class="podium-score">${top3[1].score} p · ${top3[1].kills} kills</div></div>` : ''}
        ${top3[0] ? `<div class="podium-col p1" style="border-color:${top3[0].color}"><div class="podium-medal">🥇</div><div class="podium-avatar">${top3[0].emoji || '💣'}</div><div class="podium-name">${esc(top3[0].name)}</div><div class="podium-score">${top3[0].score} p · ${top3[0].kills} kills</div></div>` : ''}
        ${top3[2] ? `<div class="podium-col p3" style="border-color:${top3[2].color}"><div class="podium-medal">🥉</div><div class="podium-avatar">${top3[2].emoji || '💣'}</div><div class="podium-name">${esc(top3[2].name)}</div><div class="podium-score">${top3[2].score} p · ${top3[2].kills} kills</div></div>` : ''}
      </div>
      <p style="color: var(--ink-2); font-size: 16px; margin-top: 20px">Poeng lagt til hovedscoren</p>
    </div>`;
  for (let i = 0; i < 3; i++) setTimeout(() => window.confetti?.burst(), i * 500);
  window.sfx?.fanfare();
}

// ============ END ============
function renderEnd() {
  const source = state.teamMode
    ? state.teams.map(t => ({ name: `${t.emoji} ${t.name}`, score: t.score, color: t.color }))
    : state.players.map(p => ({ name: p.name, emoji: p.emoji, score: p.score }));
  const sorted = [...source].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  // Best stats (players only)
  const players = state.players.filter(p => (p.totalCorrect || 0) + (p.totalWrong || 0) > 0);
  const bestStreak = players.reduce((m, p) => (p.bestStreak || 0) > (m?.bestStreak || 0) ? p : m, null);
  const fastest = players.filter(p => p.fastestMs != null).reduce((m, p) => !m || p.fastestMs < m.fastestMs ? p : m, null);
  const mostCorrect = players.reduce((m, p) => (p.totalCorrect || 0) > (m?.totalCorrect || 0) ? p : m, null);
  const mostFirst = players.reduce((m, p) => (p.firstCount || 0) > (m?.firstCount || 0) ? p : m, null);

  main.innerHTML = `
    <div class="end-screen">
      <h2>🏆 ${state.teamMode ? 'Vinnerlag' : 'Vinnere'} 🏆</h2>
      <div class="podium">
        ${top3[1] ? podium(2, top3[1]) : ''}
        ${top3[0] ? podium(1, top3[0]) : ''}
        ${top3[2] ? podium(3, top3[2]) : ''}
      </div>
      ${!state.teamMode && players.length ? `
      <div class="final-stats">
        <h3>Kveldens heder</h3>
        <div class="stats-grid">
          ${mostCorrect ? `<div class="stat-card"><div class="stat-emoji">🎯</div><div class="stat-lbl">Mest riktige svar</div><div class="stat-val">${esc(mostCorrect.name)}</div><div class="stat-sub">${mostCorrect.totalCorrect} riktige</div></div>` : ''}
          ${bestStreak && (bestStreak.bestStreak || 0) >= 2 ? `<div class="stat-card"><div class="stat-emoji">🔥</div><div class="stat-lbl">Beste streak</div><div class="stat-val">${esc(bestStreak.name)}</div><div class="stat-sub">${bestStreak.bestStreak} på rad</div></div>` : ''}
          ${fastest ? `<div class="stat-card"><div class="stat-emoji">⚡</div><div class="stat-lbl">Raskest svar</div><div class="stat-val">${esc(fastest.name)}</div><div class="stat-sub">${(fastest.fastestMs/1000).toFixed(2)} sek</div></div>` : ''}
          ${mostFirst && (mostFirst.firstCount || 0) >= 1 ? `<div class="stat-card"><div class="stat-emoji">🥇</div><div class="stat-lbl">Kjappest på avtrekkeren</div><div class="stat-val">${esc(mostFirst.name)}</div><div class="stat-sub">${mostFirst.firstCount} ${mostFirst.firstCount === 1 ? 'gang' : 'ganger'} først</div></div>` : ''}
        </div>
      </div>` : ''}
      <p style="color: var(--ink-2); font-size: 18px; margin-top: 20px">Takk for i kveld!</p>
    </div>`;
  for (let i = 0; i < 5; i++) setTimeout(() => window.confetti?.burst(), i * 700);
  // Drumroll + applause
  window.sfx?.drumroll?.();
  setTimeout(() => window.sfx?.applause(), 1200);
}
function podium(rank, p) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return `<div class="podium-col p${rank}" ${p.color ? `style="border-color:${p.color}"` : ''}>
    <div class="podium-medal">${medal}</div>
    ${p.emoji ? `<div class="podium-avatar">${p.emoji}</div>` : ''}
    <div class="podium-name">${esc(p.name)}</div>
    <div class="podium-score">${p.score} p</div>
  </div>`;
}

// ============ CONTROLS ============
function renderControls() {
  let html = '';
  if (state.phase === 'lobby') {
    html = `<button class="btn btn-primary btn-lg cta" onclick="openGameMenu()">🎮 Velg spill</button>`;
  } else if (state.phase === 'question') {
    html = `
      ${state.paused
        ? `<button class="btn btn-primary" onclick="act('host:resume')">▶ Fortsett</button>`
        : `<button class="btn btn-ghost" onclick="act('host:pause')">⏸ Pause</button>`}
      <button class="btn btn-ghost" onclick="act('host:reveal')">Avslør nå</button>
      <button class="btn btn-ghost" onclick="act('host:skip')">⏭ Hopp over</button>`;
  } else if (state.phase === 'reveal') {
    html = `<button class="btn btn-primary" onclick="act('host:leaderboard')">📊 Poengtavle</button>
            <button class="btn btn-ghost" onclick="act('host:next')">Neste →</button>`;
  } else if (state.phase === 'leaderboard') {
    html = `<button class="btn btn-primary" onclick="act('host:next')">Neste →</button>`;
  } else if (state.phase === 'voting') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-voting')">Avslutt stemming</button>`;
  } else if (state.phase === 'vote-result') {
    html = `<button class="btn btn-primary" onclick="act('host:start-voting')">🗳️ Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'scatter-play') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-scatter')">Avslutt runde</button>`;
  } else if (state.phase === 'scatter-review') {
    html = `<button class="btn btn-primary" onclick="act('host:start-scatter')">📝 Ny runde</button>
            <button class="btn btn-primary" onclick="act('host:leaderboard')">📊 Poengtavle</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'icebreaker') {
    html = `<button class="btn btn-primary" onclick="act('host:icebreaker')">💬 Neste kort</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'wheel') {
    html = `<button class="btn btn-ghost" onclick="act('host:wheel')">🎡 Snurr igjen</button>
            <button class="btn btn-primary" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'snake') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-snake')">Avslutt runde</button>`;
  } else if (state.phase === 'snake-end') {
    html = `<button class="btn btn-primary" onclick="act('host:start-snake')">🐍 Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'bomb') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-bomb')">Avslutt runde</button>`;
  } else if (state.phase === 'bomb-end') {
    html = `<button class="btn btn-primary" onclick="act('host:start-bomb')">💣 Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'lie-collect') {
    const lc = state.lieCollect || { submittedIds: [] };
    const canStart = lc.submittedIds.length >= 2;
    html = `<button class="btn btn-primary" ${canStart ? '' : 'disabled'} onclick="act('host:start-lie-round')">▶ Start runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'lie-play') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-lie-vote')">Avslutt stemming</button>
            <button class="btn btn-ghost btn-sm" onclick="act('host:skip-lie')">⏭ Hopp over</button>`;
  } else if (state.phase === 'lie-reveal') {
    html = `<button class="btn btn-primary" onclick="act('host:skip-lie')">Neste spiller →</button>`;
  } else if (state.phase === 'end') {
    html = `<button class="btn btn-primary" onclick="act('host:reset')">← Ny runde</button>`;
  }
  if (state.phase !== 'lobby' && state.phase !== 'end') {
    html += `<button class="btn btn-danger btn-sm" onclick="if(confirm('Avslutt spillet?')) act('host:reset')">Avslutt</button>`;
  }
  controls.innerHTML = html;
}

// ============ GAME MENU (modal) ============
// Leaderboard-modal (persisterte historiske score)
window.openLeaderboardModal = async () => {
  document.getElementById('lbModal')?.remove();
  const m = document.createElement('div');
  m.id = 'lbModal';
  m.className = 'game-menu-overlay open';
  m.innerHTML = `
    <div class="game-menu" style="max-width:680px" onclick="event.stopPropagation()">
      <button class="menu-close" onclick="document.getElementById('lbModal').remove()">✕</button>
      <h2>🏆 Historisk topplist</h2>
      <p class="menu-sub">Alle spillere som har deltatt — minimum 4 må være med for at score skal telle.</p>
      <div class="lb-filter">
        ${[
          ['all', '🌟 Alle spill'],
          ['quiz', '🧠 Quiz'],
          ['lightning', '⚡ Lyn-runde'],
          ['bomb', '💣 Bomberman'],
          ['snake', '🐍 Slange'],
          ['scatter', '📝 Kategori'],
          ['lie', '🤥 2 sannheter'],
        ].map(([k, label]) => `<button class="lb-chip ${k === 'all' ? 'active' : ''}" data-g="${k}">${label}</button>`).join('')}
      </div>
      <div id="lbList" class="lb-list">Laster…</div>
    </div>`;
  m.addEventListener('click', () => m.remove());
  document.body.appendChild(m);
  async function loadList(game) {
    const list = document.getElementById('lbList');
    list.innerHTML = 'Laster…';
    try {
      const r = await fetch('/scores?game=' + encodeURIComponent(game));
      const j = await r.json();
      const scores = j.scores || [];
      if (!scores.length) {
        list.innerHTML = `<div class="lb-empty">Ingen historikk enda. Spill minst én runde med 4+ spillere for å bli med på listen! 🎮</div>`;
        return;
      }
      list.innerHTML = scores.map((s, i) => `
        <div class="lb-row ${i < 3 ? 'top' : ''}">
          <div class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</div>
          <div class="lb-name">${esc(s.name)}</div>
          <div class="lb-stats">${s.gamesPlayed} spill · best ${s.bestScore} p</div>
          <div class="lb-score">${s.totalScore} p</div>
        </div>`).join('');
    } catch (e) {
      list.innerHTML = `<div class="lb-empty">Kunne ikke hente score: ${esc(String(e?.message || e))}</div>`;
    }
  }
  m.querySelectorAll('.lb-chip').forEach(b => {
    b.addEventListener('click', () => {
      m.querySelectorAll('.lb-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      loadList(b.dataset.g);
    });
  });
  loadList('all');
};

window.openGameMenu = () => {
  if (!state || state.players.length === 0) {
    showToast('Venter på spillere — be dem skanne QR-koden først 📱');
    return;
  }
  document.getElementById('gameMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'gameMenu';
  menu.className = 'game-menu-overlay';
  menu.innerHTML = `
    <div class="game-menu" onclick="event.stopPropagation()">
      <button class="menu-close" onclick="closeGameMenu()">✕</button>
      <h2>Velg spill</h2>
      <p class="menu-sub">${state.players.length} ${state.players.length === 1 ? 'spiller' : 'spillere'} klar${state.players.length > 1 ? 'e' : ''}${state.teamMode ? ' · ' + state.teams.length + ' lag' : ''}</p>

      <div class="menu-section">
        <div class="menu-section-title">🧠 Quiz</div>
        <div class="menu-grid">
          <div class="menu-card quiz" onclick="pickGame('host:start-quiz','generelt')"><div class="emoji">🌍</div><b>Generelt</b><span>Allmennkunnskap</span></div>
          <div class="menu-card quiz" onclick="pickGame('host:start-quiz','norge')"><div class="emoji">🇳🇴</div><b>Norge</b><span>Historie og geografi</span></div>
          <div class="menu-card quiz" onclick="pickGame('host:start-quiz','dnb')"><div class="emoji">🏦</div><b>DNB & Finans</b><span>Bank og økonomi</span></div>
          <div class="menu-card quiz" onclick="pickGame('host:start-quiz','popkultur')"><div class="emoji">🎬</div><b>Pop-kultur</b><span>Film, musikk, serier</span></div>
          <div class="menu-card quiz" onclick="pickGame('host:start-quiz','emoji')"><div class="emoji">🎭</div><b>Emoji-gåter</b><span>Gjett film fra emojier</span></div>
        </div>
      </div>

      <div class="menu-section">
        <div class="menu-section-title">⚡ Lyn-runde <span style="color:var(--ink-2); font-weight:400">— <span class="lightning-head-dur">${(state.lightningDuration || 5000) / 1000} sek</span>, dobbel poeng</span></div>
        <div class="menu-grid">
          <div class="menu-card lightning" onclick="pickGame('host:start-lightning','generelt')"><div class="emoji">🌍⚡</div><b>Generelt</b><span>Rask & farlig</span>${durChip('lightning', state.lightningDuration || 5000)}</div>
          <div class="menu-card lightning" onclick="pickGame('host:start-lightning','norge')"><div class="emoji">🇳🇴⚡</div><b>Norge</b><span>Ingen tid å tenke</span>${durChip('lightning', state.lightningDuration || 5000)}</div>
          <div class="menu-card lightning" onclick="pickGame('host:start-lightning','popkultur')"><div class="emoji">🎬⚡</div><b>Pop-kultur</b><span>Er du kjapp nok?</span>${durChip('lightning', state.lightningDuration || 5000)}</div>
          <div class="menu-card lightning" onclick="pickGame('host:start-lightning','emoji')"><div class="emoji">🎭⚡</div><b>Emoji</b><span>Instinkt-gåter</span>${durChip('lightning', state.lightningDuration || 5000)}</div>
        </div>
      </div>

      <div class="menu-section">
        <div class="menu-section-title">🎉 Sosiale spill</div>
        <div class="menu-grid">
          <div class="menu-card social" onclick="pickGame('host:start-voting')"><div class="emoji">🗳️</div><b>Hvem er mest sannsynlig</b><span>Anonyme avstemninger</span></div>
          <div class="menu-card social" onclick="pickGame('host:start-lie')"><div class="emoji">🤥</div><b>2 sannheter, 1 løgn</b><span>Stem fram løgneren</span>${durChip('lie', state.lieVoteDuration || 30000)}</div>
          <div class="menu-card social" onclick="pickGame('host:start-scatter')"><div class="emoji">📝</div><b>Kategori-kamp</b><span>Én bokstav, fem kategorier</span>${durChip('scatter', state.scatterDuration || 60000)}</div>
          <div class="menu-card social" onclick="pickGame('host:icebreaker')"><div class="emoji">💬</div><b>Bli-kjent-kort</b><span>Trekk et kort, del et svar</span></div>
          <div class="menu-card social" onclick="pickGame('host:wheel')"><div class="emoji">🎡</div><b>Lykkehjulet</b><span>Trekk en tilfeldig person</span></div>
          <div class="menu-card social" onclick="pickGame('host:start-snake')"><div class="emoji">🐍</div><b>Slange-kamp</b><span>Alle mot alle</span>${durChip('snake', state.snakeDuration || 60000)}</div>
          <div class="menu-card social" onclick="pickGame('host:start-bomb')"><div class="emoji">💣</div><b>Bomberman</b><span>Spreng motstanderen</span>${durChip('bomb', state.bombDuration || 90000)}</div>
        </div>
      </div>
    </div>`;
  menu.addEventListener('click', () => closeGameMenu());
  document.body.appendChild(menu);
  requestAnimationFrame(() => menu.classList.add('open'));
};

window.closeGameMenu = () => {
  const m = document.getElementById('gameMenu');
  if (!m) return;
  m.classList.remove('open');
  setTimeout(() => m.remove(), 200);
};

window.pickGame = (ev, arg) => {
  closeGameMenu();
  socket.emit(ev, arg);
};

// Varighets-cycling på menu-cards
const DUR_OPTS = {
  snake:    { key: 'snakeDuration',     opts: [30000, 45000, 60000, 90000, 120000, 180000, 240000, 0] },
  bomb:     { key: 'bombDuration',      opts: [30000, 60000, 90000, 120000, 180000, 240000, 300000, 0] },
  scatter:  { key: 'scatterDuration',   opts: [30000, 45000, 60000, 90000, 120000, 180000] },
  lie:      { key: 'lieVoteDuration',   opts: [15000, 20000, 30000, 45000, 60000, 90000] },
  lightning:{ key: 'lightningDuration', opts: [3000, 5000, 7000, 10000, 15000] },
};
function fmtDur(ms) { return ms === 0 ? '∞' : (ms / 1000) + 's'; }
window.cycleDur = (ev, game) => {
  ev.stopPropagation();
  const cfg = DUR_OPTS[game];
  if (!cfg) return;
  const cur = state[cfg.key] || 0;
  const idx = cfg.opts.indexOf(cur);
  const next = cfg.opts[(idx + 1) % cfg.opts.length];
  socket.emit('host:config', { [cfg.key]: next });
  // Oppdater alle synlige chips for dette spillet optimistisk
  document.querySelectorAll('.dur-chip[data-dur="' + game + '"]').forEach(el => {
    el.textContent = '⏱ ' + fmtDur(next);
  });
  // Oppdater lightning-section-header også
  if (game === 'lightning') {
    const hdr = document.querySelector('.lightning-head-dur');
    if (hdr) hdr.textContent = fmtDur(next);
  }
};
function durChip(game, cur) {
  return `<span class="dur-chip" data-dur="${game}" onclick="cycleDur(event, '${game}')" title="Klikk for å endre varighet">⏱ ${fmtDur(cur)}</span>`;
}

// ============ KEYBOARD SHORTCUTS ============
window.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '?') { e.preventDefault(); openHelpModal(); return; }
  if (e.key === 'Escape') { closeGameMenu(); closeHelpModal(); return; }
  if (!state) return;
  if (state.phase === 'question') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:reveal'); return; }
    if (e.key.toLowerCase() === 'r') { socket.emit('host:reveal'); return; }
    if (e.key.toLowerCase() === 'p') { socket.emit(state.paused ? 'host:resume' : 'host:pause'); return; }
    if (e.key.toLowerCase() === 's') { socket.emit('host:skip'); return; }
  }
  if (state.phase === 'reveal') {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); socket.emit('host:next'); return; }
    if (e.key.toLowerCase() === 'l') { socket.emit('host:leaderboard'); return; }
  }
  if (state.phase === 'leaderboard') {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); socket.emit('host:next'); return; }
  }
  if (state.phase === 'voting') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:end-voting'); return; }
  }
  if (state.phase === 'icebreaker') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:icebreaker'); return; }
  }
  if (state.phase === 'wheel') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:wheel'); return; }
  }
  if (state.phase === 'lobby') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); openGameMenu(); return; }
  }
});

function openHelpModal() {
  document.getElementById('helpModal')?.remove();
  const m = document.createElement('div');
  m.id = 'helpModal';
  m.className = 'game-menu-overlay';
  m.innerHTML = `<div class="game-menu" style="max-width:560px" onclick="event.stopPropagation()">
    <button class="menu-close" onclick="closeHelpModal()">✕</button>
    <h2>⌨️ Tastatursnarveier</h2>
    <p class="menu-sub">For vert på storskjerm</p>
    <div class="help-list">
      <div><kbd>Space</kbd> <span>Avslør / neste / snurr / start menu</span></div>
      <div><kbd>R</kbd> <span>Avslør svar (under quiz)</span></div>
      <div><kbd>P</kbd> <span>Pause / fortsett</span></div>
      <div><kbd>S</kbd> <span>Hopp over spørsmål</span></div>
      <div><kbd>L</kbd> <span>Vis poengtavle etter reveal</span></div>
      <div><kbd>?</kbd> <span>Vis denne hjelpen</span></div>
      <div><kbd>Esc</kbd> <span>Lukk meny/hjelp</span></div>
    </div>
  </div>`;
  m.addEventListener('click', closeHelpModal);
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('open'));
}
function closeHelpModal() {
  const m = document.getElementById('helpModal');
  if (!m) return;
  m.classList.remove('open');
  setTimeout(() => m.remove(), 200);
}
window.openHelpModal = openHelpModal;
window.closeHelpModal = closeHelpModal;

window.act = (ev, arg) => socket.emit(ev, arg);
window.startIfReady = (ev, arg) => {
  if (!state || state.players.length === 0) {
    showToast('Venter på spillere — be dem skanne QR-koden først 📱');
    return;
  }
  socket.emit(ev, arg);
};

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function animateTimer(startedAt, limit) {
  const bar = document.getElementById('tbar');
  if (!bar) return;
  let lastTickSecond = -1;
  function tick() {
    const elapsed = Date.now() - startedAt;
    const pct = Math.max(0, 1 - elapsed / limit);
    bar.style.width = (pct * 100).toFixed(1) + '%';
    const secondsLeft = Math.ceil((limit - elapsed) / 1000);
    if (secondsLeft <= 3 && secondsLeft > 0) bar.classList.add('urgent');
    else bar.classList.remove('urgent');
    if (secondsLeft <= 5 && secondsLeft > 0 && secondsLeft !== lastTickSecond && !state.paused) {
      lastTickSecond = secondsLeft;
      window.sfx?.countdown();
    }
    if (pct > 0 && (state.phase === 'question' || state.phase === 'scatter-play')) {
      timerRAF = requestAnimationFrame(tick);
    }
  }
  tick();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
